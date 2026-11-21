import { createHmac, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";

/**
 * Stripe Checkout (só Portugal): cartão, Apple Pay e Google Pay na página alojada do Stripe.
 *
 * Variáveis no Vercel:
 *   STRIPE_SECRET_KEY      chave secreta/restrita (só servidor)
 *   STRIPE_WEBHOOK_SECRET  whsec_… do endpoint /api/stripe-webhook
 * O Checkout alojado não precisa de chave publicável.
 */
export const APPLE_PAY_WIRED = true;

const SITE = "https://luvsickstore.com";

type Sql = Awaited<ReturnType<typeof getSql>>;

export function stripeKeys() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  return { ready: Boolean(secret), secret, webhook };
}

async function stripe(method: "GET" | "POST", path: string, form?: URLSearchParams, idempotency?: string) {
  const { secret } = stripeKeys();
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  if (form) headers["content-type"] = "application/x-www-form-urlencoded";
  if (idempotency) headers["Idempotency-Key"] = idempotency;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body: form });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

let columnsReady: Promise<void> | null = null;
async function ensureStripeColumns(sql: Sql) {
  columnsReady ??= (async () => {
    await sql.query(`alter table luv_orders add column if not exists stripe_session text not null default ''`);
    await sql.query(`alter table luv_reservations add column if not exists stripe_session text not null default ''`);
  })().catch((err) => {
    columnsReady = null;
    throw err;
  });
  return columnsReady;
}

/** Valor em cêntimos a partir do que está guardado na base de dados ("35 €", "1.234,50 €"). */
function eurCents(label: string) {
  const clean = label.replace(/[^\d,.]/g, "");
  if (!clean) return 0;
  const normal = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const value = Number(normal);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

type Target = {
  table: "luv_orders" | "luv_reservations";
  kind: "order" | "reserve";
  ref: string;
  market: string;
  pay: string;
  email: string;
  cents: number;
  paid: boolean;
  session: string;
};

async function findTarget(sql: Sql, ref: string): Promise<Target | null> {
  const asked = ref.trim().toUpperCase();
  await ensureStripeColumns(sql);
  if (/^LS-[A-Z0-9]{4}$/.test(asked)) {
    const rows = await sql.query(`select ref, market, pay, email, total_label, paid_at, stripe_session from luv_orders where ref = $1`, [asked]);
    const row = rows[0];
    if (!row) return null;
    return { table: "luv_orders", kind: "order", ref: asked, market: String(row.market), pay: String(row.pay ?? ""), email: String(row.email ?? ""), cents: eurCents(String(row.total_label ?? "")), paid: Boolean(row.paid_at), session: String(row.stripe_session ?? "") };
  }
  if (/^LR-[A-Z0-9]{4}$/.test(asked)) {
    const rows = await sql.query(`select ref, market, pay, email, deposit_label, total_label, paid_at, stripe_session from luv_reservations where ref = $1`, [asked]);
    const row = rows[0];
    if (!row) return null;
    return { table: "luv_reservations", kind: "reserve", ref: asked, market: String(row.market), pay: String(row.pay ?? ""), email: String(row.email ?? ""), cents: eurCents(String(row.deposit_label || row.total_label || "")), paid: Boolean(row.paid_at), session: String(row.stripe_session ?? "") };
  }
  return null;
}

/** Marca como paga (idempotente) e prepara os números do talão/fatura. */
async function markPaid(sql: Sql, target: Pick<Target, "table" | "ref">) {
  const code = target.ref.slice(3);
  if (target.table === "luv_orders") {
    await sql.query(
      `update luv_orders set paid_at = coalesce(paid_at, now()),
         receipt_no = case when receipt_no = '' then $2 else receipt_no end,
         invoice_no = case when invoice_no = '' then $3 else invoice_no end
       where ref = $1`,
      [target.ref, `TL-${code}`, `FT-${code}`],
    );
  } else {
    await sql.query(`update luv_reservations set paid_at = coalesce(paid_at, now()) where ref = $1`, [target.ref]);
  }
  await sql.query(`alter table ${target.table} add column if not exists proof_status text not null default ''`);
  await sql.query(`update ${target.table} set proof_status = 'stripe' where ref = $1 and proof_status in ('', 'sent', 'rejected')`, [target.ref]);
}

type Session = { id?: string; url?: string; status?: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: Record<string, string> };

function sessionPaysTarget(session: Session, target: Target) {
  return (
    session.payment_status === "paid" &&
    session.currency === "eur" &&
    String(session.metadata?.ref ?? "").toUpperCase() === target.ref &&
    Number(session.amount_total ?? 0) >= target.cents
  );
}

/** Cria (ou reaproveita) a Checkout Session de uma encomenda/reserva de Portugal. O valor vem sempre da base de dados. */
export async function createCheckout(ref: string) {
  if (!stripeKeys().ready || !APPLE_PAY_WIRED) return { ok: false as const, error: "off" as const };
  const sql = await getSql();
  const target = await findTarget(sql, ref);
  if (!target) return { ok: false as const, error: "missing" as const };
  if (target.market !== "PT") return { ok: false as const, error: "market" as const };
  if (target.paid) return { ok: false as const, error: "paid" as const };
  if (target.cents < 50) return { ok: false as const, error: "amount" as const };

  if (target.session) {
    const old = await stripe("GET", `checkout/sessions/${encodeURIComponent(target.session)}`);
    const s = old.body as Session;
    if (old.ok && sessionPaysTarget(s, target)) {
      await markPaid(sql, target);
      return { ok: false as const, error: "paid" as const };
    }
    if (old.ok && s.status === "open" && s.url && Number(s.amount_total) === target.cents) return { ok: true as const, url: s.url };
    if (old.ok && s.status === "open") await stripe("POST", `checkout/sessions/${encodeURIComponent(target.session)}/expire`);
  }

  const label = target.kind === "reserve" ? `Luv Sick · Reserva ${target.ref} (sinal de 50%)` : `Luv Sick · Encomenda ${target.ref}`;
  const form = new URLSearchParams({
    mode: "payment",
    locale: "pt",
    // Só euros: sem conversão automática de moeda (Adaptive Pricing).
    "adaptive_pricing[enabled]": "false",
    client_reference_id: target.ref,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(target.cents),
    "line_items[0][price_data][product_data][name]": label,
    "metadata[ref]": target.ref,
    "metadata[kind]": target.kind,
    "payment_intent_data[metadata][ref]": target.ref,
    "payment_intent_data[description]": label,
    success_url: `${SITE}/recibo/${target.ref}?pago=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/recibo/${target.ref}?cancelado=1`,
  });
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.email)) form.set("customer_email", target.email);
  const made = await stripe("POST", "checkout/sessions", form);
  const s = made.body as Session;
  if (!made.ok || !s.id || !s.url) {
    console.error("[stripe] checkout session failed", made.status, (made.body.error as { code?: string; type?: string } | undefined)?.type ?? "");
    return { ok: false as const, error: "stripe" as const };
  }
  await sql.query(`update ${target.table} set stripe_session = $2 where ref = $1`, [target.ref, s.id]);
  return { ok: true as const, url: s.url };
}

/** No regresso do Stripe: confirma o estado da sessão guardada (caso o webhook ainda não tenha chegado). */
export async function syncCheckout(ref: string) {
  if (!stripeKeys().ready) return { ok: false as const, paid: false };
  const sql = await getSql();
  const target = await findTarget(sql, ref);
  if (!target) return { ok: false as const, paid: false };
  if (target.paid) return { ok: true as const, paid: true };
  if (!target.session) return { ok: true as const, paid: false };
  const res = await stripe("GET", `checkout/sessions/${encodeURIComponent(target.session)}`);
  if (res.ok && sessionPaysTarget(res.body as Session, target)) {
    await markPaid(sql, target);
    return { ok: true as const, paid: true };
  }
  return { ok: true as const, paid: false };
}

function signatureOk(body: string, header: string, secret: string) {
  const items = header.split(",").map((item) => item.trim());
  const t = items.find((item) => item.startsWith("t="))?.slice(2) ?? "";
  const v1 = items.filter((item) => item.startsWith("v1=")).map((item) => item.slice(3));
  if (!t || !v1.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return v1.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

/** Webhook: checkout.session.completed / async_payment_succeeded com payment_status "paid" marca como paga. Idempotente. */
export async function handleStripeWebhook(body: string, signature: string) {
  const keys = stripeKeys();
  if (!keys.webhook) return { status: 503, body: { ok: false, error: "stripe-off" } };
  if (!signatureOk(body, signature, keys.webhook)) return { status: 400, body: { ok: false, error: "signature" } };
  let event: { type?: string; data?: { object?: Session } } = {};
  try {
    event = JSON.parse(body);
  } catch {
    return { status: 400, body: { ok: false } };
  }
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return { status: 200, body: { ok: true, ignored: true } };
  }
  const session = event.data?.object ?? {};
  const ref = String(session.metadata?.ref ?? "").toUpperCase();
  const sql = await getSql();
  const target = await findTarget(sql, ref);
  if (!target) return { status: 200, body: { ok: true, unknown: true } };
  if (session.payment_status !== "paid") return { status: 200, body: { ok: true, pending: true } };
  if (!sessionPaysTarget(session, target)) {
    console.error("[stripe] webhook amount/ref mismatch", target.ref);
    return { status: 200, body: { ok: true, mismatch: true } };
  }
  await markPaid(sql, target);
  return { status: 200, body: { ok: true, paid: target.ref } };
}
