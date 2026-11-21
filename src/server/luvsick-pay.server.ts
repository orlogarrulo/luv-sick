import { createHash, randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getSql } from "@/lib/db";
import { PAY, kzAmount, payName, productById, type Market } from "@/lib/luvsick";
import { allowed, ensureStock } from "./luvsick.server";
import { LOGO_PNG_BASE64 } from "./logo-png";
import { APPLE_PAY_WIRED, stripeKeys } from "./stripe.server";

type Sql = Awaited<ReturnType<typeof getSql>>;
type Line = { productId: string; size: string; qty: number; unit?: number; name?: string };

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
/** Bytes por pedaço: cada envio fica bem abaixo do limite de 4,5 MB das funções do Vercel. */
export const PROOF_CHUNK_BYTES = 1024 * 1024;
const PROOF_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
const MAX_PROOFS_PER_REF = 6;

/**
 * Apple Pay só fica activo quando as chaves do Stripe estão no Vercel E o botão Apple Pay
 * (Stripe Express Checkout Element) estiver ligado no checkout (APPLE_PAY_WIRED).
 */
export function stripeReady() {
  return APPLE_PAY_WIRED && stripeKeys().ready;
}

let tablesReady: Promise<void> | null = null;

export async function ensurePayTables(sql: Sql) {
  tablesReady ??= (async () => {
    await sql.query(
      `create table if not exists luv_proofs (
        id text primary key,
        ref text not null,
        created_at timestamptz not null default now(),
        file_name text not null default '',
        mime text not null,
        size integer not null,
        chunks integer not null,
        complete boolean not null default false,
        status text not null default 'pending'
      )`,
    );
    await sql.query(`create index if not exists luv_proofs_ref on luv_proofs (ref)`);
    await sql.query(
      `create table if not exists luv_proof_chunks (
        proof_id text not null,
        idx integer not null,
        data text not null,
        primary key (proof_id, idx)
      )`,
    );
    await sql.query(`alter table luv_orders add column if not exists proof_status text not null default ''`);
    await sql.query(`alter table luv_reservations add column if not exists proof_status text not null default ''`);
  })().catch((err) => {
    tablesReady = null;
    throw err;
  });
  return tablesReady;
}

async function paySql() {
  const sql = await ensureStock();
  await ensurePayTables(sql);
  return sql;
}

function cleanRef(ref: string) {
  const asked = ref.trim().toUpperCase();
  if (/^LS-[A-Z0-9]{4}$/.test(asked)) return { ref: asked, kind: "order" as const };
  if (/^LR-[A-Z0-9]{4}$/.test(asked)) return { ref: asked, kind: "reserve" as const };
  return null;
}

type PayRow = {
  id: string;
  ref: string;
  kind: "order" | "reserve";
  market: Market;
  pay: string;
  amountLabel: string;
  totalLabel: string;
  paidAt: string;
  proofStatus: string;
  trial: boolean;
  cancelled: boolean;
};

function stamp(value: unknown) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

async function findPayRow(sql: Sql, ref: string): Promise<PayRow | null> {
  const asked = cleanRef(ref);
  if (!asked) return null;
  if (asked.kind === "order") {
    const rows = await sql.query(`select id, ref, market, pay, total_label, paid_at, proof_status, trial from luv_orders where ref = $1`, [asked.ref]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      ref: String(row.ref),
      kind: "order",
      market: row.market === "AO" ? "AO" : "PT",
      pay: String(row.pay ?? ""),
      amountLabel: String(row.total_label ?? ""),
      totalLabel: String(row.total_label ?? ""),
      paidAt: stamp(row.paid_at),
      proofStatus: String(row.proof_status ?? ""),
      trial: Boolean(row.trial),
      cancelled: false,
    };
  }
  const rows = await sql.query(
    `select id, ref, market, pay, total_label, deposit_label, paid_at, proof_status, trial, cancelled_at from luv_reservations where ref = $1`,
    [asked.ref],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    ref: String(row.ref),
    kind: "reserve",
    market: row.market === "AO" ? "AO" : "PT",
    pay: String(row.pay ?? ""),
    amountLabel: String(row.deposit_label || row.total_label || ""),
    totalLabel: String(row.total_label ?? ""),
    paidAt: stamp(row.paid_at),
    proofStatus: String(row.proof_status ?? ""),
    trial: Boolean(row.trial),
    cancelled: Boolean(row.cancelled_at),
  };
}

/** Dados de pagamento públicos de uma referência (sem dados pessoais). */
export async function luvPayInfo(ref: string) {
  const sql = await paySql();
  const row = await findPayRow(sql, ref);
  if (!row) return { ok: false as const };
  const proofs = await sql.query<{ n: number }>(`select count(*)::int as n from luv_proofs where ref = $1 and complete`, [row.ref]);
  return {
    ok: true as const,
    ref: row.ref,
    kind: row.kind,
    market: row.market,
    pay: row.pay,
    payLabel: payName(row.market, row.pay),
    amountLabel: row.amountLabel,
    totalLabel: row.totalLabel,
    paid: Boolean(row.paidAt),
    proofStatus: row.proofStatus,
    proofs: Number(proofs[0]?.n ?? 0),
    stripe: stripeReady(),
    cancelled: row.cancelled,
  };
}

function setProofStatus(sql: Sql, row: { kind: "order" | "reserve"; ref: string }, status: string) {
  const table = row.kind === "order" ? "luv_orders" : "luv_reservations";
  return sql.query(`update ${table} set proof_status = $2 where ref = $1`, [row.ref, status]);
}

export async function luvProofStart(input: { ref: string; name: string; mime: string; size: number }) {
  const sql = await paySql();
  const row = await findPayRow(sql, input.ref);
  if (!row) return { ok: false as const, error: "missing" as const };
  if (row.paidAt) return { ok: false as const, error: "paid" as const };
  const mime = PROOF_TYPES.find((item) => item === input.mime);
  const size = Math.floor(Number(input.size));
  if (!mime) return { ok: false as const, error: "type" as const };
  if (!Number.isFinite(size) || size < 100 || size > PROOF_MAX_BYTES) return { ok: false as const, error: "size" as const };
  const count = await sql.query<{ n: number }>(`select count(*)::int as n from luv_proofs where ref = $1`, [row.ref]);
  if (Number(count[0]?.n ?? 0) >= MAX_PROOFS_PER_REF) return { ok: false as const, error: "many" as const };
  const id = randomBytes(16).toString("hex");
  const chunks = Math.ceil(size / PROOF_CHUNK_BYTES);
  const name = input.name.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) || "comprovativo";
  await sql.query(`insert into luv_proofs (id, ref, file_name, mime, size, chunks) values ($1, $2, $3, $4, $5, $6)`, [id, row.ref, name, mime, size, chunks]);
  return { ok: true as const, id, chunks, chunkBytes: PROOF_CHUNK_BYTES };
}

function cleanId(id: string) {
  const value = id.replace(/[^a-f0-9]/g, "");
  return value.length === 32 ? value : "";
}

export async function luvProofChunk(input: { id: string; idx: number; data: string }) {
  const id = cleanId(input.id);
  const idx = Math.floor(Number(input.idx));
  if (!id || !Number.isFinite(idx) || idx < 0) return { ok: false as const };
  if (typeof input.data !== "string" || input.data.length > Math.ceil(PROOF_CHUNK_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]+=*$/.test(input.data)) {
    return { ok: false as const };
  }
  const sql = await paySql();
  const rows = await sql.query<{ chunks: number; complete: boolean }>(`select chunks, complete from luv_proofs where id = $1`, [id]);
  const proof = rows[0];
  if (!proof || proof.complete || idx >= Number(proof.chunks)) return { ok: false as const };
  await sql.query(
    `insert into luv_proof_chunks (proof_id, idx, data) values ($1, $2, $3) on conflict (proof_id, idx) do update set data = excluded.data`,
    [id, idx, input.data],
  );
  return { ok: true as const };
}

function magicOk(mime: string, head: Buffer) {
  if (mime === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === "image/png") return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === "application/pdf") return head.subarray(0, 4).toString("latin1") === "%PDF";
  return false;
}

export async function luvProofFinish(input: { id: string }) {
  const id = cleanId(input.id);
  if (!id) return { ok: false as const };
  const sql = await paySql();
  const rows = await sql.query<{ ref: string; mime: string; size: number; chunks: number; complete: boolean }>(
    `select ref, mime, size, chunks, complete from luv_proofs where id = $1`,
    [id],
  );
  const proof = rows[0];
  if (!proof || proof.complete) return { ok: false as const };
  const parts = await sql.query<{ idx: number; data: string }>(`select idx, data from luv_proof_chunks where proof_id = $1 order by idx`, [id]);
  const total = parts.reduce((sum, part) => sum + Buffer.from(part.data, "base64").length, 0);
  const first = parts[0] ? Buffer.from(parts[0].data, "base64") : Buffer.alloc(0);
  if (parts.length !== Number(proof.chunks) || total !== Number(proof.size) || !magicOk(proof.mime, first)) {
    await sql.query(`delete from luv_proof_chunks where proof_id = $1`, [id]);
    await sql.query(`delete from luv_proofs where id = $1`, [id]);
    return { ok: false as const, error: "broken" as const };
  }
  await sql.query(`update luv_proofs set complete = true where id = $1`, [id]);
  const row = await findPayRow(sql, proof.ref);
  if (row && !row.paidAt) await setProofStatus(sql, row, "sent");
  return { ok: true as const };
}

export type DeskProof = { id: string; ref: string; createdAt: string; name: string; mime: string; size: number; chunks: number; status: string };

export async function deskProofs(sql: Sql): Promise<DeskProof[]> {
  await ensurePayTables(sql);
  const rows = await sql.query(
    `select id, ref, created_at, file_name, mime, size, chunks, status from luv_proofs where complete order by created_at desc limit 300`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    ref: String(row.ref),
    createdAt: stamp(row.created_at),
    name: String(row.file_name ?? ""),
    mime: String(row.mime),
    size: Number(row.size),
    chunks: Number(row.chunks),
    status: String(row.status),
  }));
}

/** Só a gestão lê os ficheiros, pedaço a pedaço. */
export async function luvProofPart(code: string, id: string, idx: number) {
  if (!allowed(code)) return { ok: false as const };
  const clean = cleanId(id);
  if (!clean) return { ok: false as const };
  const sql = await paySql();
  const rows = await sql.query<{ data: string }>(
    `select c.data from luv_proof_chunks c join luv_proofs p on p.id = c.proof_id where p.complete and c.proof_id = $1 and c.idx = $2`,
    [clean, Math.floor(Number(idx))],
  );
  if (!rows.length) return { ok: false as const };
  return { ok: true as const, data: rows[0].data };
}

/** Marca os comprovativos e o estado depois de "Confirmar pagamento". */
export async function acceptProofs(sql: Sql, ref: string) {
  await ensurePayTables(sql);
  await sql.query(`update luv_proofs set status = 'accepted' where ref = $1 and complete and status = 'pending'`, [ref]);
  const row = await findPayRow(sql, ref);
  if (row) await setProofStatus(sql, row, "accepted");
}

export async function luvRejectProof(code: string, ref: string) {
  if (!allowed(code)) return { ok: false as const };
  const sql = await paySql();
  const row = await findPayRow(sql, ref);
  if (!row || row.paidAt) return { ok: false as const };
  await sql.query(`update luv_proofs set status = 'rejected' where ref = $1 and complete and status = 'pending'`, [row.ref]);
  await setProofStatus(sql, row, "rejected");
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* Fatura em PDF                                                        */
/* ------------------------------------------------------------------ */

/** Taxas de IVA provisórias: a loja ainda não tem regras de IVA próprias. Os preços já incluem IVA. */
const IVA_RATE: Record<Market, number> = { PT: 23, AO: 14 };

export const ISSUER = {
  name: "Luv Sick",
  nif: "TEMP-000000",
  address: "Morada a definir",
  provisional: "dados provisórios",
  site: "luvsickstore.com",
};

function money(amount: number, market: Market) {
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "-" : ""}${grouped},${cents} ${market === "AO" ? "Kz" : "€"}`;
}

function labelAmount(label: string) {
  const digits = label.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function dateLabel(value: string) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleDateString("pt-PT", { timeZone: "Africa/Luanda", day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, ".");
}

function parseLines(raw: unknown): Line[] {
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type InvoiceData = {
  kind: "order" | "reserve";
  market: Market;
  ref: string;
  invoiceNo: string;
  createdAt: string;
  paidAt: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  postal: string;
  city: string;
  country: string;
  nif: string;
  pay: string;
  coupon: string;
  lines: Line[];
  total: number;
  deposit: number;
  balance: number;
  trial: boolean;
};

async function invoiceData(ref: string): Promise<InvoiceData | null> {
  const asked = cleanRef(ref);
  if (!asked) return null;
  const sql = await paySql();
  if (asked.kind === "order") {
    const rows = await sql.query(`select * from luv_orders where ref = $1`, [asked.ref]);
    const row = rows[0];
    if (!row || !row.paid_at) return null;
    const market: Market = row.market === "AO" ? "AO" : "PT";
    let invoiceNo = String(row.invoice_no ?? "");
    if (!invoiceNo) {
      invoiceNo = `FT-${asked.ref.slice(3)}`;
      await sql.query(`update luv_orders set invoice_no = $2 where ref = $1 and invoice_no = ''`, [asked.ref, invoiceNo]);
    }
    return {
      kind: "order",
      market,
      ref: asked.ref,
      invoiceNo,
      createdAt: stamp(row.created_at),
      paidAt: stamp(row.paid_at),
      name: String(row.customer_name ?? ""),
      email: String(row.email ?? ""),
      phone: String(row.phone ?? ""),
      address: String(row.address ?? ""),
      postal: String(row.postal ?? ""),
      city: String(row.city ?? ""),
      country: String(row.country ?? ""),
      nif: String(row.nif ?? ""),
      pay: payName(market, String(row.pay ?? "")),
      coupon: String(row.coupon ?? ""),
      lines: parseLines(row.lines),
      total: labelAmount(String(row.total_label ?? "")),
      deposit: 0,
      balance: 0,
      trial: Boolean(row.trial),
    };
  }
  const rows = await sql.query(`select * from luv_reservations where ref = $1`, [asked.ref]);
  const row = rows[0];
  if (!row || !row.paid_at) return null;
  const market: Market = row.market === "AO" ? "AO" : "PT";
  return {
    kind: "reserve",
    market,
    ref: asked.ref,
    invoiceNo: String(row.invoice_no || `FT-${asked.ref.slice(3)}`),
    createdAt: stamp(row.created_at),
    paidAt: stamp(row.paid_at),
    name: String(row.customer_name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    address: "",
    postal: "",
    city: "",
    country: "",
    nif: "",
    pay: payName(market, String(row.pay ?? "")),
    coupon: "",
    lines: parseLines(row.lines),
    total: labelAmount(String(row.total_label ?? "")),
    deposit: labelAmount(String(row.deposit_label ?? "")),
    balance: labelAmount(String(row.balance_label ?? "")),
    trial: Boolean(row.trial),
  };
}

function customerNumber(data: InvoiceData) {
  const key = (data.email || data.phone || data.name).trim().toLowerCase();
  return `C-${createHash("sha1").update(key).digest("hex").slice(0, 6).toUpperCase()}`;
}

/** Remove caracteres que a fonte padrão do PDF (WinAnsi) não consegue escrever. */
function safe(text: string) {
  return text
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\u00a0-\u00ff€•·]/g, "");
}

export async function invoicePdf(ref: string): Promise<{ file: Uint8Array; name: string } | null> {
  const data = await invoiceData(ref);
  if (!data) return null;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Fatura ${data.invoiceNo} · Luv Sick`);
  pdf.setAuthor("Luv Sick");
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const ink = rgb(0.1, 0.09, 0.08);
  const soft = rgb(0.4, 0.4, 0.4);
  const L = 56;
  const R = 539;

  const text = (value: string, x: number, y: number, size = 9, f: PDFFont = font, color = ink) =>
    page.drawText(safe(value), { x, y, size, font: f, color });
  const right = (value: string, x: number, y: number, size = 9, f: PDFFont = font, color = ink) => {
    const clean = safe(value);
    page.drawText(clean, { x: x - f.widthOfTextAtSize(clean, size), y, size, font: f, color });
  };
  const line = (x1: number, y1: number, x2: number, y2: number, p: PDFPage = page) =>
    p.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.6, color: ink });

  // Logo e marca, em cima à direita (como no modelo).
  page.drawImage(logo, { x: R - 62, y: 762, width: 62, height: 62 * (logo.height / logo.width) });
  right("LUV SICK", R - 72, 790, 22, bold);
  right(ISSUER.site, R - 72, 776, 8, font, soft);
  if (data.trial) text("ENSAIO · documento de teste, sem valor", L, 800, 9, bold);

  // Linha do emitente.
  text(`${ISSUER.name} · ${ISSUER.address} · NIF ${ISSUER.nif} (${ISSUER.provisional})`, L, 742, 7.5);

  // Bloco do cliente, à esquerda.
  const who = [
    data.name,
    data.address,
    [data.postal, data.city].filter(Boolean).join(" "),
    data.country === "AO" ? "Angola" : data.country === "PT" ? "Portugal" : "",
    data.nif ? `NIF ${data.nif}` : "",
    data.kind === "reserve" ? data.email : "",
    data.kind === "reserve" ? data.phone : "",
  ].filter(Boolean);
  who.forEach((row, i) => text(row, L, 712 - i * 13, 10));

  // Caixa à direita.
  const box: [string, string][] = [
    ["Nº de cliente:", customerNumber(data)],
    ["Nº da fatura:", data.invoiceNo],
    ["Data da fatura:", dateLabel(data.paidAt)],
    [data.kind === "reserve" ? "Nº da reserva:" : "Nº da encomenda:", data.ref],
    [data.kind === "reserve" ? "Data da reserva:" : "Data da encomenda:", dateLabel(data.createdAt)],
  ];
  box.forEach(([k, v], i) => {
    text(k, 352, 722 - i * 14, 9);
    right(v, R, 722 - i * 14, 9);
  });

  text("Fatura", L, 600, 20);
  text(`Moeda: ${data.market === "AO" ? "Kwanza (Kz)" : "Euro (€)"}`, L, 584, 8, font, soft);

  // Tabela.
  const rate = IVA_RATE[data.market];
  let y = 556;
  text("Qtd.", L, y, 9, bold);
  text("Artigo", L + 36, y, 9, bold);
  right("Taxa IVA*", 362, y, 9, bold);
  right("Preço unit.", 452, y, 9, bold);
  right("Total", R, y, 9, bold);
  right("(IVA incl.)", 452, y - 11, 7.5, font, soft);
  y -= 26;
  text(data.kind === "reserve" ? "Reserva" : "Encomenda", L, y, 9, bold);
  y -= 15;
  let gross = 0;
  for (const item of data.lines) {
    const product = productById(item.productId);
    const qty = Math.max(0, Math.floor(Number(item.qty)));
    if ((!product && !item.unit) || !qty) continue;
    // Preço gravado no momento da compra; para encomendas antigas, o preço atual do catálogo.
    const unit = Number(item.unit) > 0 ? Number(item.unit) : product ? (data.market === "AO" ? kzAmount(product) : product.priceEur) : 0;
    gross += unit * qty;
    right(String(qty), L + 18, y, 9);
    text(`${product?.name.pt ?? item.name ?? item.productId} · tamanho ${item.size}`, L + 36, y, 9);
    right(`${rate} %`, 362, y, 9);
    right(money(unit, data.market), 452, y, 9);
    right(money(unit * qty, data.market), R, y, 9);
    y -= 14;
  }
  y -= 4;
  line(L, y, R, y);

  const total = data.total || gross;
  const discount = Math.max(0, gross - total);
  const net = (value: number) => value / (1 + rate / 100);

  // Bloco dos totais (à direita) e texto do pagamento (à esquerda).
  const tx = 300;
  let ty = y - 14;
  const row = (k: string, v: string, f: PDFFont = font) => {
    text(k, tx, ty, 8.5, f);
    right(v, R, ty, 8.5, f);
    ty -= 12;
  };
  row(`Total dos artigos (líquido) ${rate} % IVA:`, money(net(gross), data.market));
  row(`IVA dos artigos ${rate} %:`, money(gross - net(gross), data.market));
  ty -= 6;
  line(tx, ty + 13, R, ty + 13);
  row("Total dos artigos (bruto):", money(gross, data.market));
  row("Portes e embalagem (bruto):", money(0, data.market));
  row(`Desconto${data.coupon ? ` (${data.coupon})` : ""} (bruto):`, money(-discount, data.market));
  ty -= 6;
  line(tx, ty + 13, R, ty + 13);
  row("Subtotal (bruto):", money(total, data.market));
  row("Subtotal (líquido):", money(net(total), data.market));
  row(`IVA ${rate} %:`, money(total - net(total), data.market));
  ty -= 6;
  line(tx, ty + 13, R, ty + 13);
  row("Total da fatura:", money(total, data.market), bold);
  if (data.kind === "reserve") {
    row("Pago (sinal de 50%):", money(data.deposit, data.market));
    row("Valor a pagar (restante, no dia do envio):", money(data.balance, data.market), bold);
  } else {
    row("Valor a pagar:", money(total, data.market), bold);
  }

  const paidText =
    data.kind === "reserve"
      ? [
          `O sinal de 50% (${money(data.deposit, data.market)}) foi pago`,
          `por ${data.pay || "transferência"} em ${dateLabel(data.paidAt)}.`,
          `O restante (${money(data.balance, data.market)}) paga-se no dia do envio.`,
        ]
      : [`O valor da fatura foi pago por ${data.pay || "transferência"}`, `em ${dateLabel(data.paidAt)}. Referência: ${data.ref}.`];
  let py = y - 22;
  paidText.forEach((value) => {
    text(value, L, py, 9);
    py -= 12;
  });
  py -= 16;
  text("Data da prestação igual à data da fatura.", L, py, 9);
  py -= 12;
  text("Obrigado pela sua encomenda!", L, py, 9, bold);
  py -= 22;
  text(`* IVA provisório: taxa de ${rate} % incluída nos preços.`, L, py, 7.5, font, soft);
  py -= 10;
  text("A confirmar com o contabilista antes da emissão certificada.", L, py, 7.5, font, soft);

  // Rodapé.
  line(L, 92, R, 92);
  const foot = [
    `${ISSUER.name} • ${ISSUER.address} • NIF ${ISSUER.nif} • ${ISSUER.site}`,
    `Dados da empresa: ${ISSUER.provisional}`,
    `Angola: Multicaixa Express ${PAY.AO[0].value} • IBAN ${PAY.AO[1].value}`,
    `Portugal: MB WAY ${PAY.PT[0].value} • IBAN ${PAY.PT.find((item) => item.kind === "iban")?.value ?? ""}`,
  ];
  foot.forEach((value, i) => {
    const clean = safe(value);
    const w = font.widthOfTextAtSize(clean, 7.5);
    page.drawText(clean, { x: (595.28 - w) / 2, y: 80 - i * 10, size: 7.5, font, color: ink });
  });

  const file = await pdf.save();
  return { file, name: `Fatura-${data.invoiceNo}-LuvSick.pdf` };
}
