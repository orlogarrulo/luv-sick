import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";
import {
  ALL_PRODUCTS,
  PAY,
  RATE,
  PRACTICE_EMAIL,
  PRODUCTS,
  kzAmount,
  productById,
  RESERVE_EXPIRE_HOURS,
  RESERVE_REMIND_HOURS,
  SIZES,
  formatAmount,
  payMethod,
  quote,
  reserveCancelSubject,
  reserveCancelText,
  reserveReminderSubject,
  reserveReminderText,
  splitHalf,
  type Market,
} from "@/lib/luvsick";
import { phoneOkFull } from "@/lib/phone";

const START_QTY = 5;
const DESK_CODE = process.env.LUVSICK_DESK_CODE?.trim() || "LuvSick-1847";

type Need = { productId: string; size: string; qty: number };

export type StockRow = { productId: string; size: string; qty: number; received: number; out: number };
export type DeskOrder = {
  id: string;
  ref: string;
  createdAt: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postal: string;
  market: string;
  pay: string;
  totalLabel: string;
  coupon: string;
  lines: Need[];
  seen: boolean;
  paidAt: string;
  nif: string;
  receiptNo: string;
  email: string;
  trial: boolean;
  invoiceNo: string;
  proofStatus: string;
};

async function payApi() {
  return import("./luvsick-pay.server");
}

/** O método tem de existir no mercado; Apple Pay só com o Stripe configurado. */
async function payAllowed(market: Market, pay: string) {
  const method = payMethod(market, pay);
  if (!method) return false;
  if (method.kind === "card") return (await payApi()).stripeReady();
  return true;
}

export function allowed(code: string) {
  const a = Buffer.from(code);
  const b = Buffer.from(DESK_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ensureReservationTables(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql.query(
    `create table if not exists luv_reservations (
      id text primary key,
      ref text not null,
      created_at timestamptz not null default now(),
      customer_name text not null,
      phone text not null,
      email text not null,
      lines text not null,
      received_sent boolean not null default false,
      stock_sent boolean not null default false
    )`,
  );
  await sql.query(`create table if not exists luv_flags (key text primary key, value text not null)`);
  await sql.query(`insert into luv_flags (key, value) values ('stock_in', '0') on conflict (key) do nothing`);
  await sql.query(`alter table luv_reservations add column if not exists total_label text not null default ''`);
  await sql.query(`alter table luv_reservations add column if not exists deposit_label text not null default ''`);
  await sql.query(`alter table luv_reservations add column if not exists balance_label text not null default ''`);
  await sql.query(`alter table luv_reservations add column if not exists pay text not null default ''`);
  await sql.query(`alter table luv_reservations add column if not exists market text not null default ''`);
  await sql.query(`alter table luv_reservations add column if not exists receipt_no text not null default ''`);
  await sql.query(`alter table luv_reservations add column if not exists invoice_no text not null default ''`);
  await sql.query(`alter table luv_reservations add column if not exists emailed_at timestamptz`);
  await sql.query(`alter table luv_reservations add column if not exists trial boolean not null default false`);
  await sql.query(`alter table luv_reservations add column if not exists paid_at timestamptz`);
  await sql.query(`alter table luv_reservations add column if not exists proof_status text not null default ''`);
  // Prazo das reservas (igual à migração 0019; aqui para a base local e como rede de segurança).
  await sql.query(`alter table luv_reservations add column if not exists clock_at timestamptz not null default now()`);
  await sql.query(`alter table luv_reservations add column if not exists reminder_at timestamptz`);
  await sql.query(`alter table luv_reservations add column if not exists reminder_emailed boolean not null default false`);
  await sql.query(`alter table luv_reservations add column if not exists cancelled_at timestamptz`);
  await sql.query(`alter table luv_reservations add column if not exists cancel_reason text not null default ''`);
  await sql.query(`alter table luv_reservations add column if not exists cancel_emailed boolean not null default false`);
  await sql.query(`alter table luv_reservations add column if not exists lang text not null default 'pt'`);
  await sql.query(`alter table luv_reservations add column if not exists stock_held boolean`);
  await sql.query(`update luv_reservations set stock_held = not coalesce(trial, false) where stock_held is null`);
  await sql.query(`alter table luv_orders add column if not exists email text not null default ''`);
  await sql.query(`alter table luv_orders add column if not exists trial boolean not null default false`);
  await sql.query(`alter table luv_orders add column if not exists invoice_no text not null default ''`);
  // Câmbio (Kz por 1 €) em vigor quando a encomenda/reserva foi feita (null = anteriores a 21/11/2026).
  await sql.query(`alter table luv_orders add column if not exists kz_rate numeric(12,2)`);
  await sql.query(`alter table luv_reservations add column if not exists kz_rate numeric(12,2)`);
}

export async function ensureStock() {
  const sql = await getSql();
  await ensureReservationTables(sql);
  await sql.query(`alter table luv_stock add column if not exists received integer`);
  // Catálogo dinâmico (gestão → Produtos): preços, câmbio e peças vêm da BD em cada pedido.
  await (await import("./luvsick-catalog.server")).loadCatalog(sql);
  for (const product of ALL_PRODUCTS) {
    for (const size of SIZES) {
      await sql.query(
        `insert into luv_stock (product_id, size, qty) values ($1, $2, $3) on conflict (product_id, size) do nothing`,
        [product.id, size, START_QTY],
      );
    }
  }
  await openLedger(sql);
  return sql;
}

/** Grava o câmbio em vigor no momento da compra (encomendas/reservas mantêm sempre o preço e o câmbio da altura). */
async function stampRate(sql: Awaited<ReturnType<typeof getSql>>, table: "luv_orders" | "luv_reservations", id: string, rate: number) {
  await sql.query(`update ${table} set kz_rate = $2 where id = $1 and kz_rate is null`, [id, rate]);
}

/** Linhas limpas (só campos conhecidos) com o preço unitário e o nome no momento da compra, calculados no servidor. */
function priceLines(lines: Need[], market: Market) {
  return lines.map((line) => {
    const product = productById(line.productId);
    const unit = product ? (market === "AO" ? kzAmount(product) : product.priceEur) : 0;
    return { productId: line.productId, size: line.size, qty: Math.floor(Number(line.qty)), unit, eur: product?.priceEur ?? 0, kzRate: RATE.kz, name: product?.name.pt ?? line.productId };
  });
}

function addMoves(bucket: Map<string, number>, raw: string) {
  let lines: Need[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    lines = [];
  }
  for (const line of lines) {
    const qty = Math.floor(Number(line.qty));
    if (!line.productId || !line.size || qty < 1) continue;
    const key = `${line.productId}|${line.size}`;
    bucket.set(key, (bucket.get(key) ?? 0) + qty);
  }
}

async function openLedger(sql: Awaited<ReturnType<typeof getSql>>) {
  const flag = await sql.query<{ value: string }>(`select value from luv_flags where key = 'stock_ledger'`);
  if (flag[0]?.value === "1") {
    await sql.query(`update luv_stock set received = qty where received is null`);
    return;
  }
  const sold = new Map<string, number>();
  const held = new Map<string, number>();
  const orders = await sql.query<{ lines: string }>(`select lines from luv_orders where coalesce(trial, false) = false`);
  const reservations = await sql.query<{ lines: string }>(`select lines from luv_reservations where coalesce(trial, false) = false`);
  orders.forEach((row) => addMoves(sold, row.lines));
  reservations.forEach((row) => addMoves(held, row.lines));
  const rows = await sql.query<{ product_id: string; size: string; qty: number }>(`select product_id, size, qty from luv_stock where received is null`);
  for (const row of rows) {
    const key = `${row.product_id}|${row.size}`;
    const outSales = sold.get(key) ?? 0;
    const outHolds = held.get(key) ?? 0;
    const received = Number(row.qty) + outSales;
    const qty = Math.max(0, Number(row.qty) - outHolds);
    await sql.query(`update luv_stock set received = $3, qty = $4 where product_id = $1 and size = $2`, [row.product_id, row.size, received, qty]);
  }
  await sql.query(`insert into luv_flags (key, value) values ('stock_ledger', '1') on conflict (key) do update set value = excluded.value`);
}

export async function luvStock(): Promise<StockRow[]> {
  const sql = await ensureStock();
  await lazySweep(sql);
  const rows = await sql.query<{ product_id: string; size: string; qty: number; received: number | null }>(
    `select product_id, size, qty, received from luv_stock order by product_id, size`,
  );
  return rows.map((row) => {
    const qty = Number(row.qty);
    const received = Number(row.received ?? qty);
    return { productId: row.product_id, size: row.size, qty, received, out: Math.max(0, received - qty) };
  });
}

function practiceEmail(value: string) {
  return value.trim().toLowerCase() === PRACTICE_EMAIL;
}

function postalOk(country: string, postal: string) {
  const value = postal.trim();
  if (country === "PT") return /^\d{4}-\d{3}$/.test(value);
  return value.length >= 3 && value.length <= 10;
}

export async function luvPlace(input: {
  lines: Need[];
  name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postal: string;
  market: string;
  pay: string;
  coupon: string;
  email?: string;
  lang?: string;
}) {
  await (await import("./luvsick-catalog.server")).loadCatalog();
  let lines: Need[] = (Array.isArray(input.lines) ? input.lines : [])
    .map((line) => ({ productId: String(line?.productId ?? ""), size: String(line?.size ?? ""), qty: Math.floor(Number(line?.qty)) }))
    .filter((line) => line.qty > 0 && line.qty <= 50 && SIZES.includes(line.size as (typeof SIZES)[number]) && PRODUCTS.some((item) => item.id === line.productId));
  const country = input.country === "AO" || input.country === "PT" ? input.country : "";
  if (!lines.length || !input.name.trim() || !phoneOkFull(input.phone) || !country || !postalOk(country, input.postal)) {
    return { ok: false as const, error: !input.phone.trim() || phoneOkFull(input.phone) ? "form" as const : "phone" as const };
  }
  const market: Market = country;
  if (!(await payAllowed(market, input.pay))) return { ok: false as const, error: "pay" as const };
  const sql = await ensureStock();
  const asked = input.coupon.trim().toUpperCase();
  let percent = 0;
  if (asked) {
    const found = await sql.query<{ percent: number }>(`select percent from luv_coupons where code = $1 and active`, [asked]);
    if (!found.length) return { ok: false as const, error: "coupon" as const };
    percent = Number(found[0].percent);
  }
  const saleRate = RATE.kz;
  const priced = quote(lines, market, percent);
  lines = priceLines(lines, market);
  const totalLabel = formatAmount(priced.total, market);
  const ref = `LS-${randomBytes(2).toString("hex").toUpperCase()}`;
  const id = randomBytes(8).toString("hex");
  const email = (input.email ?? "").trim().toLowerCase();
  if (!emailOk(email)) return { ok: false as const, error: "form" as const };
  const profile = {
    email,
    name: input.name,
    phone: input.phone,
    address: input.address,
    city: input.city,
    country,
    postal: input.postal,
  };
  if (practiceEmail(email)) {
    const code = ref.slice(3);
    const receiptNo = `TL-${code}`;
    const invoiceNo = `FT-${code}`;
    await sql.query(
      `insert into luv_orders (id, ref, customer_name, phone, address, city, country, postal, market, pay, total_label, lines, coupon, email, trial, paid_at, receipt_no, invoice_no, seen)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, now(), $15, $16, true)`,
      [
        id,
        ref,
        input.name.trim(),
        input.phone.trim(),
        input.address.trim(),
        input.city.trim(),
        country,
        input.postal.trim(),
        market,
        input.pay,
        totalLabel,
        JSON.stringify(lines),
        asked,
        email,
        receiptNo,
        invoiceNo,
      ],
    );
    const codeRes = await openCustomer(profile, input.lang ?? "pt");
    await stampRate(sql, "luv_orders", id, saleRate);
    return { ok: true as const, ref, totalLabel, trial: true as const, receiptNo, invoiceNo, codeSent: codeRes.sent, codePending: codeRes.pending };
  }
  const placed = await sql.query<{ ref: string }>(
    `with need as (
       select product_id, size, qty from jsonb_to_recordset($1::jsonb) as x(product_id text, size text, qty int)
     ),
     gate as (
       select (count(*) = (select count(*) from need) and bool_and(s.qty >= n.qty)) as good
       from need n
       join luv_stock s on s.product_id = n.product_id and s.size = n.size
     ),
     upd as (
       update luv_stock s
       set qty = s.qty - n.qty
       from need n, gate g
       where g.good and s.product_id = n.product_id and s.size = n.size
       returning 1
     ),
     ins as (
       insert into luv_orders (id, ref, customer_name, phone, address, city, country, postal, market, pay, total_label, lines, coupon, email)
       select $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       from gate where good
       returning ref
     )
     select ref from ins`,
    [
      JSON.stringify(lines.map((line) => ({ product_id: line.productId, size: line.size, qty: line.qty }))),
      id,
      ref,
      input.name.trim(),
      input.phone.trim(),
      input.address.trim(),
      input.city.trim(),
      country,
      input.postal.trim(),
      market,
      input.pay,
      formatAmount(priced.total, market),
      JSON.stringify(lines),
      asked,
      email,
    ],
  );
  if (!placed.length) return { ok: false as const, error: "stock" as const };
  await stampRate(sql, "luv_orders", id, saleRate);
  const codeRes = await openCustomer(profile, input.lang ?? "pt");
  return { ok: true as const, ref: placed[0].ref, totalLabel, trial: false as const, receiptNo: "", invoiceNo: "", codeSent: codeRes.sent, codePending: codeRes.pending };
}

function mapOrder(row: Record<string, unknown>): DeskOrder {
  let lines: Need[] = [];
  try {
    const parsed = JSON.parse(String(row.lines));
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    lines = [];
  }
  return {
    id: String(row.id),
    ref: String(row.ref),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    name: String(row.customer_name),
    phone: String(row.phone),
    address: String(row.address),
    city: String(row.city),
    country: String(row.country ?? ""),
    postal: String(row.postal ?? ""),
    market: String(row.market),
    pay: String(row.pay),
    totalLabel: String(row.total_label),
    coupon: String(row.coupon ?? ""),
    lines,
    seen: Boolean(row.seen),
    paidAt: row.paid_at ? (row.paid_at instanceof Date ? row.paid_at.toISOString() : String(row.paid_at)) : "",
    nif: String(row.nif ?? ""),
    receiptNo: String(row.receipt_no ?? ""),
    email: String(row.email ?? ""),
    trial: Boolean(row.trial),
    invoiceNo: String(row.invoice_no ?? ""),
    proofStatus: String(row.proof_status ?? ""),
  };
}

export async function luvDesk(code: string) {
  if (!allowed(code)) return { ok: false as const };
  const sql = await ensureStock();
  const stock = await luvStock();
  const orders = await sql.query(`select * from luv_orders order by created_at desc limit 40`);
  const visits = await luvVisitReport();
  const coupons = await sql.query<{ code: string; percent: number; active: boolean }>(
    `select code, percent, active from luv_coupons order by created_at desc`,
  );
  await sweepReservations(sql);
  const reservations = await sql.query(`select * from luv_reservations where cancelled_at is null order by created_at desc limit 200`);
  const cancelled = await sql.query(`select * from luv_reservations where cancelled_at is not null order by cancelled_at desc limit 200`);
  const flag = await sql.query<{ value: string }>(`select value from luv_flags where key = 'stock_in'`);
  const proofs = await (await payApi()).deskProofs(sql);
  const pendingCodes = await deskPendingCodes(sql);
  return {
    ok: true as const,
    proofs,
    pendingCodes,
    mailReady: mailReady(),
    stock,
    orders: orders.map(mapOrder),
    visits,
    coupons: coupons.map((row) => ({ code: row.code, percent: Number(row.percent), active: Boolean(row.active) })),
    reservations: reservations.map(mapReservation),
    cancelled: cancelled.map(mapReservation),
    stockIn: flag[0]?.value === "1",
  };
}

export type DeskReservation = {
  id: string;
  ref: string;
  createdAt: string;
  name: string;
  phone: string;
  email: string;
  lines: Need[];
  receivedSent: boolean;
  stockSent: boolean;
  totalLabel: string;
  depositLabel: string;
  balanceLabel: string;
  pay: string;
  market: string;
  receiptNo: string;
  invoiceNo: string;
  emailed: boolean;
  trial: boolean;
  paidAt: string;
  proofStatus: string;
  lang: string;
  clockAt: string;
  reminderAt: string;
  reminderEmailed: boolean;
  cancelledAt: string;
  cancelReason: string;
  cancelEmailed: boolean;
  /** Fica em risco: sem comprovativo e sem pagamento, a menos de 12 h de expirar. */
  atRisk: boolean;
  expiresAt: string;
};

function mapReservation(row: Record<string, unknown>): DeskReservation {
  let lines: Need[] = [];
  try {
    const parsed = JSON.parse(String(row.lines));
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    lines = [];
  }
  return {
    id: String(row.id),
    ref: String(row.ref),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    name: String(row.customer_name),
    phone: String(row.phone),
    email: String(row.email),
    lines,
    receivedSent: Boolean(row.received_sent),
    stockSent: Boolean(row.stock_sent),
    totalLabel: String(row.total_label ?? ""),
    depositLabel: String(row.deposit_label ?? ""),
    balanceLabel: String(row.balance_label ?? ""),
    pay: String(row.pay ?? ""),
    market: String(row.market ?? ""),
    receiptNo: String(row.receipt_no ?? ""),
    invoiceNo: String(row.invoice_no ?? ""),
    emailed: Boolean(row.emailed_at),
    trial: Boolean(row.trial),
    paidAt: row.paid_at ? (row.paid_at instanceof Date ? row.paid_at.toISOString() : String(row.paid_at)) : "",
    proofStatus: String(row.proof_status ?? ""),
    lang: String(row.lang ?? "pt"),
    clockAt: stamp(row.clock_at ?? row.created_at),
    reminderAt: row.reminder_at ? stamp(row.reminder_at) : "",
    reminderEmailed: Boolean(row.reminder_emailed),
    cancelledAt: row.cancelled_at ? stamp(row.cancelled_at) : "",
    cancelReason: String(row.cancel_reason ?? ""),
    cancelEmailed: Boolean(row.cancel_emailed),
    atRisk: atRisk(row),
    expiresAt: expiresAt(row),
  };
}

function expiresAt(row: Record<string, unknown>) {
  const start = new Date(stamp(row.clock_at ?? row.created_at)).getTime();
  return Number.isNaN(start) ? "" : new Date(start + RESERVE_EXPIRE_HOURS * 3600 * 1000).toISOString();
}

function atRisk(row: Record<string, unknown>) {
  if (row.cancelled_at || row.paid_at || String(row.proof_status ?? "")) return false;
  const start = new Date(stamp(row.clock_at ?? row.created_at)).getTime();
  return !Number.isNaN(start) && Date.now() - start >= RESERVE_REMIND_HOURS * 3600 * 1000;
}

/* ------------------------------------------------------------------ */
/* Prazo das reservas                                                   */
/* ------------------------------------------------------------------ */

/** Sem comprovativo, sem pagamento (manual ou Stripe) e ainda não cancelada. */
const OPEN_RESERVE = `cancelled_at is null and paid_at is null and coalesce(proof_status, '') = ''`;

function noticeRow(row: Record<string, unknown>) {
  return {
    name: String(row.customer_name ?? ""),
    ref: String(row.ref ?? ""),
    depositLabel: String(row.deposit_label ?? ""),
    pay: String(row.pay ?? ""),
    market: String(row.market ?? ""),
  };
}

type CancelledRow = { id: string; ref: string; email: string; customer_name: string; deposit_label: string; pay: string; market: string; lang: string; held: boolean };

/**
 * Cancela numa só instrução: marca a reserva, devolve as peças ao stock (só se estavam retiradas)
 * e põe stock_held = false. "for update skip locked" + "cancelled_at is null" tornam-na idempotente.
 */
async function cancelWhere(sql: Awaited<ReturnType<typeof getSql>>, where: string, params: unknown[], reason: "auto" | "manual") {
  const reasonIdx = params.length + 1;
  return sql.query<CancelledRow>(
    `with picked as (
       select id, coalesce(stock_held, false) as held from luv_reservations where ${where} for update skip locked
     ),
     done as (
       update luv_reservations r
          set cancelled_at = now(), cancel_reason = $${reasonIdx}, stock_held = false
         from picked p
        where r.id = p.id and r.cancelled_at is null
       returning r.id, r.ref, r.email, r.customer_name, r.deposit_label, r.pay, r.market, r.lang, r.lines, p.held
     ),
     back as (
       select x."productId" as product_id, x.size, sum(x.qty)::int as qty
         from done d, jsonb_to_recordset(d.lines::jsonb) as x("productId" text, size text, qty int)
        where d.held and x.qty > 0
        group by 1, 2
     ),
     upd as (
       update luv_stock s set qty = s.qty + b.qty from back b
        where s.product_id = b.product_id and s.size = b.size
       returning 1
     )
     select id, ref, email, customer_name, deposit_label, pay, market, lang, held from done`,
    [...params, reason],
  );
}

async function mailCancelled(sql: Awaited<ReturnType<typeof getSql>>, rows: CancelledRow[], reason: "auto" | "manual") {
  for (const row of rows) {
    const lang = String(row.lang || "pt");
    const sent = await mailCustomer(row.email, reserveCancelSubject(lang, row.ref), reserveCancelText(lang, noticeRow(row as unknown as Record<string, unknown>), reason));
    if (sent) await sql.query(`update luv_reservations set cancel_emailed = true where id = $1`, [row.id]);
  }
}

/**
 * Lembrete às 12 h e cancelamento às 24 h, contados a partir de clock_at.
 * Idempotente: cada lembrete é marcado antes de sair (reminder_at) e só sai uma vez;
 * cada cancelamento só acontece uma vez e devolve o stock uma vez.
 */
export async function sweepReservations(sqlIn?: Awaited<ReturnType<typeof getSql>>) {
  const sql = sqlIn ?? (await ensureStock());
  const remind = await sql.query(
    `update luv_reservations set reminder_at = now()
      where id in (
        select id from luv_reservations
         where ${OPEN_RESERVE} and reminder_at is null
           and clock_at <= now() - make_interval(hours => $1)
           and clock_at > now() - make_interval(hours => $2)
         for update skip locked
      )
      returning id, ref, email, customer_name, deposit_label, pay, market, lang`,
    [RESERVE_REMIND_HOURS, RESERVE_EXPIRE_HOURS],
  );
  for (const row of remind) {
    const lang = String(row.lang || "pt");
    const sent = await mailCustomer(String(row.email), reserveReminderSubject(lang, String(row.ref)), reserveReminderText(lang, noticeRow(row)));
    if (sent) await sql.query(`update luv_reservations set reminder_emailed = true where id = $1`, [row.id]);
  }
  const cancelled = await cancelWhere(sql, `${OPEN_RESERVE} and clock_at <= now() - make_interval(hours => $1)`, [RESERVE_EXPIRE_HOURS], "auto");
  await mailCancelled(sql, cancelled, "auto");
  return { reminded: remind.map((row) => String(row.ref)), cancelled: cancelled.map((row) => row.ref) };
}

let lastSweep = 0;

/** Rede de segurança: quando o stock é lido, corre no máximo uma vez por minuto por instância. */
async function lazySweep(sql: Awaited<ReturnType<typeof getSql>>) {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  try {
    await sweepReservations(sql);
  } catch (err) {
    console.error("[luvsick] sweep failed", err instanceof Error ? err.message : "unknown");
  }
}

/** Botão «Cancelar reserva» da gestão. */
export async function luvCancelReserve(code: string, id: string) {
  if (!allowed(code)) return { ok: false as const };
  const clean = id.replace(/[^a-f0-9]/g, "");
  if (clean.length < 8) return { ok: false as const };
  const sql = await ensureStock();
  const rows = await cancelWhere(sql, `id = $1 and cancelled_at is null`, [clean], "manual");
  await mailCancelled(sql, rows, "manual");
  return { ok: true as const, cancelled: rows.length > 0 };
}

/**
 * Volta a pôr activa uma reserva cancelada, se o stock ainda chegar (as de ensaio não retiram stock).
 * O prazo recomeça agora. Usado por «Confirmar pagamento» e pelo Stripe.
 */
export async function reviveReservation(sql: Awaited<ReturnType<typeof getSql>>, where: { id?: string; ref?: string }) {
  const rows = await sql.query(`select id, lines, trial, cancelled_at from luv_reservations where ${where.id ? "id = $1" : "ref = $1"}`, [where.id ?? where.ref]);
  const row = rows[0];
  if (!row) return { ok: false as const, error: "missing" as const };
  if (!row.cancelled_at) return { ok: true as const, revived: false };
  if (row.trial) {
    await sql.query(
      `update luv_reservations set cancelled_at = null, cancel_reason = '', cancel_emailed = false, clock_at = now(), reminder_at = null, reminder_emailed = false
        where id = $1 and cancelled_at is not null`,
      [row.id],
    );
    return { ok: true as const, revived: true };
  }
  let lines: Need[] = [];
  try {
    const parsed = JSON.parse(String(row.lines));
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    lines = [];
  }
  const done = await sql.query(
    `with need as (
       select product_id, size, sum(qty)::int as qty from jsonb_to_recordset($1::jsonb) as x(product_id text, size text, qty int) group by 1, 2
     ),
     me as (
       select id from luv_reservations where id = $2 and cancelled_at is not null for update
     ),
     gate as (
       select (count(*) = (select count(*) from need) and bool_and(s.qty >= n.qty) and exists (select 1 from me)) as good
         from need n join luv_stock s on s.product_id = n.product_id and s.size = n.size
     ),
     upd as (
       update luv_stock s set qty = s.qty - n.qty from need n, gate g
        where g.good and s.product_id = n.product_id and s.size = n.size
       returning 1
     )
     update luv_reservations r
        set cancelled_at = null, cancel_reason = '', cancel_emailed = false, stock_held = true, clock_at = now(), reminder_at = null, reminder_emailed = false
       from gate g
      where g.good and r.id = $2
     returning r.ref`,
    [JSON.stringify(lines.map((line) => ({ product_id: line.productId, size: line.size, qty: line.qty }))), row.id],
  );
  if (!done.length) return { ok: false as const, error: "stock" as const };
  return { ok: true as const, revived: true };
}

function emailOk(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function luvMode() {
  const sql = await ensureStock();
  const flag = await sql.query<{ value: string }>(`select value from luv_flags where key = 'stock_in'`);
  return { stockIn: flag[0]?.value === "1", stripe: (await payApi()).stripeReady() };
}

function payLabel(market: string, pay: string) {
  const list = market === "AO" || market === "PT" ? PAY[market] : [];
  return list.find((item) => item.id === pay)?.label ?? "";
}

function reserveLetter(row: DeskReservation) {
  const items = row.lines
    .map((line) => {
      const product = productById(line.productId);
      return `- ${product?.name.pt ?? line.productId} · ${line.size} · ${line.qty}`;
    })
    .join("\n");
  return [
    `Olá ${row.name},`,
    "",
    "Recebemos a tua reserva na Luv Sick.",
    "Os 50% iniciais ainda não estão confirmados.",
    "A fatura dos outros 50% paga-se no dia do envio.",
    "As entregas começam a 15 de dezembro.",
    "",
    `Reserva ${row.ref}`,
    items,
    "",
    `RECIBO ${row.receiptNo}`,
    `Pago agora (50%): ${row.depositLabel}`,
    row.pay ? `Meio: ${row.pay}` : "",
    "",
    `FATURA ${row.invoiceNo}`,
    `Em aberto (50%): ${row.balanceLabel}`,
    "Data de pagamento: no dia do envio.",
    "",
    `Total da reserva: ${row.totalLabel}`,
    `Documentos: https://luvsickstore.com/recibo/${row.ref}`,
    "",
    "Luv Sick",
  ].join("\n");
}

function mailReady() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.LUVSICK_FROM_EMAIL?.trim());
}

async function mailCustomer(to: string, subject: string, body: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.LUVSICK_FROM_EMAIL?.trim();
  if (!key || !from) {
    console.warn("[luvsick] email not configured (RESEND_API_KEY / LUVSICK_FROM_EMAIL missing)");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    });
    if (!res.ok) console.error(`[luvsick] resend failed: ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error("[luvsick] resend error", err instanceof Error ? err.message : "unknown");
    return false;
  }
}

type CustomerProfile = {
  email: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postal: string;
};

async function ensureCustomers(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql.query(
    `create table if not exists luv_customers (
      email text primary key,
      name text not null default '',
      phone text not null default '',
      address text not null default '',
      city text not null default '',
      country text not null default '',
      postal text not null default '',
      created_at timestamptz not null default now()
    )`,
  );
  await sql.query(
    `create table if not exists luv_login_codes (
      email text primary key,
      code text not null,
      expires_at timestamptz not null
    )`,
  );
  await sql.query(`alter table luv_login_codes add column if not exists pending boolean not null default false`);
  await sql.query(`alter table luv_login_codes add column if not exists tries int not null default 0`);
  await sql.query(`alter table luv_login_codes add column if not exists asked_at timestamptz not null default now()`);
  await sql.query(
    `create table if not exists luv_sessions (
      token text primary key,
      email text not null,
      created_at timestamptz not null default now()
    )`,
  );
}

function codeText(lang: string, code: string) {
  if (lang === "en") return `Hello,\n\nYour Luv Sick code is ${code}.\nIt is valid for 15 minutes.\n\nLuv Sick`;
  if (lang === "fr") return `Bonjour,\n\nTon code Luv Sick est ${code}.\nIl est valable 15 minutes.\n\nLuv Sick`;
  return `Olá,\n\nO teu código Luv Sick é ${code}.\nÉ válido durante 15 minutos.\n\nLuv Sick`;
}

/** Sem serviço de email, o código fica em "Códigos pendentes" na gestão para ser enviado por WhatsApp. */
const PENDING_MINUTES = 12 * 60;

async function sendLoginCode(email: string, lang: string): Promise<{ sent: boolean; pending: boolean }> {
  const sql = await ensureStock();
  await ensureCustomers(sql);
  if (!mailReady()) {
    // Mantém um código pendente ainda válido, para não invalidar o que a equipa já possa ter enviado.
    const open = await sql.query(`select 1 from luv_login_codes where email = $1 and pending and expires_at > now() and tries < 5`, [email]);
    if (open.length) return { sent: false, pending: true };
  }
  const code = String(randomInt(100000, 1000000));
  const minutes = mailReady() ? 15 : PENDING_MINUTES;
  const expires = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  await sql.query(
    `insert into luv_login_codes (email, code, expires_at, pending, tries, asked_at) values ($1, $2, $3, false, 0, now())
     on conflict (email) do update set code = excluded.code, expires_at = excluded.expires_at, pending = false, tries = 0, asked_at = now()`,
    [email, code, expires],
  );
  const subject = lang === "en" ? "Your Luv Sick code" : lang === "fr" ? "Ton code Luv Sick" : "O teu código Luv Sick";
  const sent = mailReady() ? await mailCustomer(email, subject, codeText(lang, code)) : false;
  if (sent) return { sent: true, pending: false };
  const later = new Date(Date.now() + PENDING_MINUTES * 60 * 1000).toISOString();
  await sql.query(`update luv_login_codes set pending = true, expires_at = $2 where email = $1`, [email, later]);
  return { sent: false, pending: true };
}

export async function deskPendingCodes(sql: Awaited<ReturnType<typeof getSql>>) {
  await ensureCustomers(sql);
  const rows = await sql.query(
    `select c.email, c.code, c.expires_at, c.asked_at, coalesce(p.name, '') as name, coalesce(p.phone, '') as phone
       from luv_login_codes c left join luv_customers p on p.email = c.email
      where c.pending and c.expires_at > now() and c.tries < 5
      order by c.asked_at desc limit 50`,
  );
  return rows.map((row) => ({
    email: String(row.email),
    code: String(row.code),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    askedAt: stamp(row.asked_at),
    expiresAt: stamp(row.expires_at),
  }));
}

async function saveCustomer(profile: CustomerProfile) {
  const sql = await ensureStock();
  await ensureCustomers(sql);
  const email = profile.email.trim().toLowerCase();
  await sql.query(
    `insert into luv_customers (email, name, phone, address, city, country, postal)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (email) do update set
       name = excluded.name,
       phone = excluded.phone,
       address = case when excluded.address <> '' then excluded.address else luv_customers.address end,
       city = case when excluded.city <> '' then excluded.city else luv_customers.city end,
       country = case when excluded.country <> '' then excluded.country else luv_customers.country end,
       postal = case when excluded.postal <> '' then excluded.postal else luv_customers.postal end`,
    [email, profile.name.trim(), profile.phone.trim(), profile.address.trim(), profile.city.trim(), profile.country.trim(), profile.postal.trim()],
  );
}

async function openCustomer(profile: CustomerProfile, lang: string) {
  await saveCustomer(profile);
  return sendLoginCode(profile.email.trim().toLowerCase(), lang);
}

function stamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

async function accountBundle(email: string) {
  const sql = await ensureStock();
  const people = await sql.query(`select * from luv_customers where email = $1`, [email]);
  const row = (people[0] ?? {}) as Record<string, unknown>;
  const orders = await sql.query(`select ref, total_label, created_at, paid_at from luv_orders where email = $1 order by created_at desc limit 30`, [email]);
  const reservations = await sql.query(
    `select ref, deposit_label, balance_label, created_at, paid_at from luv_reservations where email = $1 order by created_at desc limit 30`,
    [email],
  );
  return {
    email,
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    address: String(row.address ?? ""),
    city: String(row.city ?? ""),
    country: String(row.country ?? ""),
    postal: String(row.postal ?? ""),
    orders: orders.map((item) => ({
      ref: String(item.ref),
      totalLabel: String(item.total_label),
      createdAt: stamp(item.created_at),
      paid: Boolean(item.paid_at),
    })),
    reservations: reservations.map((item) => ({
      ref: String(item.ref),
      depositLabel: String(item.deposit_label ?? ""),
      balanceLabel: String(item.balance_label ?? ""),
      createdAt: stamp(item.created_at),
      paid: Boolean(item.paid_at),
    })),
  };
}

export async function luvAskCode(email: string, lang: string) {
  const clean = email.trim().toLowerCase();
  if (!emailOk(clean)) return { ok: false as const, error: "form" as const };
  const sql = await ensureStock();
  await ensureCustomers(sql);
  const found = await sql.query(`select email from luv_customers where email = $1`, [clean]);
  if (!found.length) return { ok: false as const, error: "missing" as const };
  const res = await sendLoginCode(clean, lang);
  return { ok: true as const, sent: res.sent, pending: res.pending };
}

export async function luvEnter(email: string, code: string) {
  const clean = email.trim().toLowerCase();
  const pin = code.replace(/\D/g, "");
  if (!emailOk(clean) || pin.length !== 6) return { ok: false as const, error: "code" as const };
  const sql = await ensureStock();
  await ensureCustomers(sql);
  const rows = await sql.query<{ code: string; expires_at: Date | string; tries: number }>(`select code, expires_at, tries from luv_login_codes where email = $1`, [clean]);
  const row = rows[0];
  const expires = row ? new Date(row.expires_at).getTime() : 0;
  if (!row || Number(row.tries) >= 5 || Number.isNaN(expires) || expires < Date.now()) return { ok: false as const, error: "code" as const };
  if (row.code !== pin) {
    await sql.query(`update luv_login_codes set tries = tries + 1 where email = $1`, [clean]);
    return { ok: false as const, error: "code" as const };
  }
  await sql.query(`delete from luv_login_codes where email = $1`, [clean]);
  const token = randomBytes(24).toString("hex");
  await sql.query(`insert into luv_sessions (token, email) values ($1, $2)`, [token, clean]);
  return { ok: true as const, token, account: await accountBundle(clean) };
}

export async function luvAccount(token: string) {
  const sql = await ensureStock();
  await ensureCustomers(sql);
  const rows = await sql.query<{ email: string }>(`select email from luv_sessions where token = $1`, [token]);
  if (!rows.length) return { ok: false as const };
  return { ok: true as const, account: await accountBundle(rows[0].email) };
}

export async function luvSaveAddress(token: string, input: { address: string; city: string; country: string; postal: string }) {
  const sql = await ensureStock();
  await ensureCustomers(sql);
  const rows = await sql.query<{ email: string }>(`select email from luv_sessions where token = $1`, [token]);
  if (!rows.length) return { ok: false as const };
  const email = rows[0].email;
  const country = input.country === "AO" || input.country === "PT" ? input.country : "";
  if (!input.address.trim() || !input.city.trim() || !country || !postalOk(country, input.postal)) {
    return { ok: false as const, error: "form" as const };
  }
  await sql.query(`update luv_customers set address = $2, city = $3, country = $4, postal = $5 where email = $1`, [
    email,
    input.address.trim(),
    input.city.trim(),
    country,
    input.postal.trim(),
  ]);
  await sql.query(`update luv_orders set address = $2, city = $3, country = $4, postal = $5 where email = $1 and paid_at is null`, [
    email,
    input.address.trim(),
    input.city.trim(),
    country,
    input.postal.trim(),
  ]);
  return { ok: true as const, account: await accountBundle(email) };
}

export async function luvReserve(input: { name: string; phone: string; email: string; lines: Need[]; pay: string; market: string; lang?: string }) {
  await (await import("./luvsick-catalog.server")).loadCatalog();
  let lines: Need[] = (Array.isArray(input.lines) ? input.lines : [])
    .map((line) => ({ productId: String(line?.productId ?? ""), size: String(line?.size ?? ""), qty: Math.floor(Number(line?.qty)) }))
    .filter((line) => line.qty > 0 && line.qty <= 50 && SIZES.includes(line.size as (typeof SIZES)[number]) && PRODUCTS.some((item) => item.id === line.productId));
  const email = input.email.trim().toLowerCase();
  const market: Market = input.market === "PT" ? "PT" : "AO";
  const pay = (await payAllowed(market, input.pay)) ? payLabel(market, input.pay) : "";
  if (!lines.length || !input.name.trim() || !phoneOkFull(input.phone) || !emailOk(email) || !pay) {
    return { ok: false as const, error: input.phone.trim() && !phoneOkFull(input.phone) ? "phone" as const : "form" as const };
  }
  const sql = await ensureStock();
  const flag = await sql.query<{ value: string }>(`select value from luv_flags where key = 'stock_in'`);
  if (flag[0]?.value === "1") return { ok: false as const, error: "closed" as const };
  const saleRate = RATE.kz;
  const priced = quote(lines, market);
  lines = priceLines(lines, market);
  const parts = splitHalf(priced.total);
  const totalLabel = formatAmount(priced.total, market);
  const depositLabel = formatAmount(parts.deposit, market);
  const balanceLabel = formatAmount(parts.balance, market);
  const ref = `LR-${randomBytes(2).toString("hex").toUpperCase()}`;
  const id = randomBytes(8).toString("hex");
  const code = ref.slice(3);
  const receiptNo = `RC-${code}`;
  const invoiceNo = `FT-${code}`;
  const trial = practiceEmail(email);
  const lang = input.lang === "en" || input.lang === "fr" ? input.lang : "pt";
  if (trial) {
    await sql.query(
      `insert into luv_reservations (id, ref, customer_name, phone, email, lines, total_label, deposit_label, balance_label, pay, market, receipt_no, invoice_no, trial, lang, stock_held)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false)`,
      [id, ref, input.name.trim(), input.phone.trim(), email, JSON.stringify(lines), totalLabel, depositLabel, balanceLabel, pay, market, receiptNo, invoiceNo, true, lang],
    );
  } else {
    const placed = await sql.query<{ ref: string }>(
      `with need as (
         select product_id, size, qty from jsonb_to_recordset($1::jsonb) as x(product_id text, size text, qty int)
       ),
       gate as (
         select (count(*) = (select count(*) from need) and bool_and(s.qty >= n.qty)) as good
         from need n
         join luv_stock s on s.product_id = n.product_id and s.size = n.size
       ),
       upd as (
         update luv_stock s
         set qty = s.qty - n.qty
         from need n, gate g
         where g.good and s.product_id = n.product_id and s.size = n.size
         returning 1
       ),
       ins as (
         insert into luv_reservations (id, ref, customer_name, phone, email, lines, total_label, deposit_label, balance_label, pay, market, receipt_no, invoice_no, trial, lang, stock_held)
         select $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, $15, true
         from gate
         where good
         returning ref
       )
       select ref from ins`,
      [
        JSON.stringify(lines.map((line) => ({ product_id: line.productId, size: line.size, qty: line.qty }))),
        id,
        ref,
        input.name.trim(),
        input.phone.trim(),
        email,
        JSON.stringify(lines),
        totalLabel,
        depositLabel,
        balanceLabel,
        pay,
        market,
        receiptNo,
        invoiceNo,
        lang,
      ],
    );
    if (!placed.length) return { ok: false as const, error: "stock" as const };
  }
  await stampRate(sql, "luv_reservations", id, saleRate);
  const paper: DeskReservation = {
    id,
    ref,
    createdAt: new Date().toISOString(),
    name: input.name.trim(),
    phone: input.phone.trim(),
    email,
    lines,
    receivedSent: false,
    stockSent: false,
    totalLabel,
    depositLabel,
    balanceLabel,
    pay,
    market,
    receiptNo,
    invoiceNo,
    emailed: false,
    trial,
    paidAt: "",
    proofStatus: "",
    lang,
    clockAt: new Date().toISOString(),
    reminderAt: "",
    reminderEmailed: false,
    cancelledAt: "",
    cancelReason: "",
    cancelEmailed: false,
    atRisk: false,
    expiresAt: new Date(Date.now() + RESERVE_EXPIRE_HOURS * 3600 * 1000).toISOString(),
  };
  const emailed = await mailCustomer(email, `Luv Sick · ${ref} · recibo e fatura`, reserveLetter(paper));
  if (emailed) await sql.query(`update luv_reservations set emailed_at = now() where id = $1`, [id]);
  const codeRes = await openCustomer({ email, name: input.name, phone: input.phone, address: "", city: "", country: "", postal: "" }, input.lang ?? "pt");
  return { ok: true as const, ref, totalLabel, depositLabel, balanceLabel, receiptNo, invoiceNo, emailed, codeSent: codeRes.sent, codePending: codeRes.pending };
}

export async function luvReservePaper(ref: string) {
  const asked = ref.trim().toUpperCase();
  if (!/^LR-[A-Z0-9]{4}$/.test(asked)) return { ok: false as const };
  const sql = await ensureStock();
  const rows = await sql.query(`select * from luv_reservations where ref = $1`, [asked]);
  if (!rows.length) return { ok: false as const };
  return { ok: true as const, paper: mapReservation(rows[0]) };
}

export async function luvResendReserve(code: string, id: string) {
  if (!allowed(code)) return { ok: false as const };
  const sql = await ensureStock();
  const rows = await sql.query(`select * from luv_reservations where id = $1`, [id]);
  if (!rows.length) return { ok: false as const };
  const paper = mapReservation(rows[0]);
  const emailed = await mailCustomer(paper.email, `Luv Sick · ${paper.ref} · recibo e fatura`, reserveLetter(paper));
  if (emailed) await sql.query(`update luv_reservations set emailed_at = now() where id = $1`, [id]);
  return { ok: true as const, emailed };
}

export async function luvSetStockIn(code: string, stockIn: boolean) {
  if (!allowed(code)) return { ok: false as const };
  const sql = await ensureStock();
  await sql.query(`insert into luv_flags (key, value) values ('stock_in', $1) on conflict (key) do update set value = excluded.value`, [
    stockIn ? "1" : "0",
  ]);
  return { ok: true as const, stockIn };
}

export async function luvMarkReservations(code: string, kind: string, ids: string[]) {
  if (!allowed(code)) return { ok: false as const };
  const column = kind === "stock" ? "stock_sent" : kind === "received" ? "received_sent" : "";
  const clean = ids.map((id) => id.replace(/[^a-f0-9]/g, "")).filter((id) => id.length >= 8);
  if (!column || !clean.length) return { ok: false as const };
  const sql = await ensureStock();
  await sql.query(`update luv_reservations set ${column} = true where id = any($1::text[])`, [clean]);
  return { ok: true as const };
}

export async function luvConfirmReserve(code: string, id: string) {
  if (!allowed(code)) return { ok: false as const };
  const clean = id.replace(/[^a-f0-9]/g, "");
  if (clean.length < 8) return { ok: false as const };
  const sql = await ensureStock();
  await ensureReservationTables(sql);
  const back = await reviveReservation(sql, { id: clean });
  if (!back.ok) return { ok: false as const, error: back.error };
  const rows = await sql.query<{ ref: string }>(`update luv_reservations set paid_at = coalesce(paid_at, now()) where id = $1 returning ref`, [clean]);
  if (rows[0]) await (await payApi()).acceptProofs(sql, rows[0].ref);
  return { ok: true as const };
}

export async function luvAckOrder(code: string, id: string) {
  if (!allowed(code)) return { ok: false as const };
  const sql = await ensureStock();
  await sql.query(`update luv_orders set seen = true where id = $1`, [id]);
  return { ok: true as const };
}

export async function luvIssueReceipt(code: string, id: string, nif: string) {
  if (!allowed(code)) return { ok: false as const, error: "code" as const };
  const clean = nif.replace(/\D/g, "");
  if (nif.trim() && !/^\d{9,14}$/.test(clean)) return { ok: false as const, error: "nif" as const };
  const sql = await ensureStock();
  const rows = await sql.query<{ ref: string; receipt_no: string }>(`select ref, receipt_no from luv_orders where id = $1`, [id]);
  if (!rows.length) return { ok: false as const, error: "missing" as const };
  const receiptNo = rows[0].receipt_no || `TL-${rows[0].ref.replace(/^LS-/, "")}`;
  const invoiceNo = `FT-${rows[0].ref.replace(/^LS-/, "")}`;
  await sql.query(
    `update luv_orders set paid_at = coalesce(paid_at, now()), nif = $2, receipt_no = $3, seen = true,
       invoice_no = case when invoice_no = '' then $4 else invoice_no end where id = $1`,
    [id, clean, receiptNo, invoiceNo],
  );
  await (await payApi()).acceptProofs(sql, rows[0].ref);
  return { ok: true as const, ref: rows[0].ref, receiptNo, nif: clean };
}

export async function luvReceipt(ref: string) {
  const asked = ref.trim().toUpperCase();
  if (!/^LS-[A-Z0-9]{4}$/.test(asked)) return { ok: false as const };
  const sql = await ensureStock();
  const rows = await sql.query(`select * from luv_orders where ref = $1`, [asked]);
  if (!rows.length) return { ok: false as const };
  const order = mapOrder(rows[0]);
  if (!order.paidAt) return { ok: true as const, paid: false as const, ref: order.ref };
  return { ok: true as const, paid: true as const, order };
}

export async function luvSetStock(code: string, productId: string, size: string, qty: number) {
  if (!allowed(code)) return { ok: false as const };
  await (await import("./luvsick-catalog.server")).loadCatalog();
  if (!ALL_PRODUCTS.some((item) => item.id === productId) || !SIZES.includes(size as (typeof SIZES)[number])) return { ok: false as const };
  const received = Math.max(0, Math.floor(qty));
  const sql = await ensureStock();
  const rows = await sql.query<{ qty: number; received: number | null }>(`select qty, received from luv_stock where product_id = $1 and size = $2`, [productId, size]);
  if (!rows.length) return { ok: false as const };
  const onHand = Number(rows[0].qty);
  const currentIn = Number(rows[0].received ?? onHand);
  const out = Math.max(0, currentIn - onHand);
  const next = Math.max(0, received - out);
  await sql.query(`update luv_stock set received = $3, qty = $4 where product_id = $1 and size = $2`, [productId, size, received, next]);
  return { ok: true as const, qty: next, received, out: received - next };
}

export async function luvCheckCoupon(coupon: string) {
  const asked = coupon.trim().toUpperCase();
  if (!asked) return { ok: false as const };
  const sql = await ensureStock();
  const found = await sql.query<{ percent: number }>(`select percent from luv_coupons where code = $1 and active`, [asked]);
  if (!found.length) return { ok: false as const };
  return { ok: true as const, code: asked, percent: Number(found[0].percent) };
}

export async function luvSaveCoupon(code: string, coupon: string, percent: number) {
  if (!allowed(code)) return { ok: false as const };
  const asked = coupon.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const next = Math.round(percent);
  if (asked.length < 3 || next < 1 || next > 90) return { ok: false as const };
  const sql = await ensureStock();
  await sql.query(
    `insert into luv_coupons (code, percent, active) values ($1, $2, true)
     on conflict (code) do update set percent = excluded.percent, active = true`,
    [asked, next],
  );
  return { ok: true as const, code: asked, percent: next };
}

export async function luvVisit(visitor: string, country: string, city: string) {
  const id = visitor.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (id.length < 8) return { ok: false as const };
  const sql = await ensureStock();
  const countryName = country.trim().slice(0, 80) || "Desconhecido";
  const cityName = city.trim().slice(0, 80) || "Desconhecida";
  const found = await sql.query(`select id from luv_visits where visitor = $1 and created_at > now() - interval '1 day' limit 1`, [id]);
  if (found.length) return { ok: true as const };
  await sql.query(`insert into luv_visits (id, visitor, country, city) values ($1, $2, $3, $4)`, [
    randomBytes(8).toString("hex"),
    id,
    countryName,
    cityName,
  ]);
  return { ok: true as const };
}

export async function luvVisitReport() {
  const sql = await ensureStock();
  const total = await sql.query<{ n: number }>(`select count(*)::int as n from luv_visits`);
  const countries = await sql.query<{ country: string; n: number }>(
    `select country, count(*)::int as n from luv_visits group by country order by n desc, country`,
  );
  const cities = await sql.query<{ country: string; city: string; n: number }>(
    `select country, city, count(*)::int as n from luv_visits group by country, city order by n desc, city`,
  );
  return {
    total: Number(total[0]?.n ?? 0),
    countries: countries.map((row) => ({ country: row.country, n: Number(row.n) })),
    cities: cities.map((row) => ({ country: row.country, city: row.city, n: Number(row.n) })),
  };
}
