import { createHmac, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";

/**
 * Preparação do Apple Pay via Stripe (só Portugal).
 *
 * Variáveis no Vercel (Production):
 *   STRIPE_SECRET_KEY        sk_live_…  (servidor)
 *   STRIPE_PUBLISHABLE_KEY   pk_live_…  (browser, para o Stripe.js / Express Checkout Element)
 *   STRIPE_WEBHOOK_SECRET    whsec_…    (assinatura do webhook /api/stripe-webhook)
 *
 * Enquanto as duas primeiras não existirem, o Apple Pay aparece como "em breve" e o servidor recusa-o.
 */
/** Passa a true quando o botão Apple Pay do Stripe estiver ligado no checkout (falta só esse passo). */
export const APPLE_PAY_WIRED = false;

export function stripeKeys() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const publishable = process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  return { ready: Boolean(secret && publishable), secret, publishable, webhook };
}

/** Cria um PaymentIntent em euros para uma encomenda (a ligar ao botão Apple Pay quando o Stripe estiver pronto). */
export async function createPaymentIntent(input: { ref: string; amountEur: number; email: string }) {
  const keys = stripeKeys();
  if (!keys.ready) return { ok: false as const, error: "stripe-off" as const };
  const form = new URLSearchParams({
    amount: String(Math.round(input.amountEur * 100)),
    currency: "eur",
    "automatic_payment_methods[enabled]": "true",
    "metadata[ref]": input.ref,
    description: `Luv Sick ${input.ref}`,
  });
  if (input.email) form.set("receipt_email", input.email);
  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: { Authorization: `Bearer ${keys.secret}`, "content-type": "application/x-www-form-urlencoded", "Idempotency-Key": `luvsick-${input.ref}` },
    body: form,
  });
  if (!res.ok) return { ok: false as const, error: "stripe" as const };
  const intent = (await res.json()) as { id: string; client_secret: string };
  return { ok: true as const, id: intent.id, clientSecret: intent.client_secret, publishable: keys.publishable };
}

function signatureOk(body: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((item) => item.split("=") as [string, string]));
  const t = parts.t;
  const v1 = header.split(",").filter((item) => item.startsWith("v1=")).map((item) => item.slice(3));
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return v1.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

export async function handleStripeWebhook(body: string, signature: string) {
  const keys = stripeKeys();
  if (!keys.webhook) return { status: 503, body: { ok: false, error: "stripe-off" } };
  if (!signatureOk(body, signature, keys.webhook)) return { status: 400, body: { ok: false } };
  let event: { type?: string; data?: { object?: { metadata?: { ref?: string } } } } = {};
  try {
    event = JSON.parse(body);
  } catch {
    return { status: 400, body: { ok: false } };
  }
  const ref = String(event.data?.object?.metadata?.ref ?? "").toUpperCase();
  if (event.type === "payment_intent.succeeded" && /^L[SR]-[A-Z0-9]{4}$/.test(ref)) {
    const sql = await getSql();
    const table = ref.startsWith("LS-") ? "luv_orders" : "luv_reservations";
    await sql.query(`update ${table} set paid_at = coalesce(paid_at, now()) where ref = $1`, [ref]);
    if (table === "luv_orders") {
      const code = ref.slice(3);
      await sql.query(
        `update luv_orders set receipt_no = case when receipt_no = '' then $2 else receipt_no end,
           invoice_no = case when invoice_no = '' then $3 else invoice_no end where ref = $1`,
        [ref, `TL-${code}`, `FT-${code}`],
      );
    }
  }
  return { status: 200, body: { ok: true } };
}
