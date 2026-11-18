import { env } from "@/lib/env.server";

function digits(phone: string) {
  return phone.replace(/\D/g, "");
}

async function sendWhatsapp(phone: string, code: string) {
  const token = env("WHATSAPP_TOKEN");
  const phoneId = env("WHATSAPP_PHONE_ID");
  if (!token || !phoneId) return false;
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits(phone),
      type: "text",
      text: {
        preview_url: false,
        body: `COMPRA TUDO: o seu código é ${code}. Vale 5 minutos. Não o partilhe.`,
      },
    }),
    signal: AbortSignal.timeout(12000),
  });
  return res.ok;
}

async function sendSms(phone: string, code: string) {
  const sid = env("TWILIO_ACCOUNT_SID");
  const auth = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM");
  if (!sid || !auth || !from) return false;
  const body = new URLSearchParams({
    To: phone,
    From: from,
    Body: `COMPRA TUDO: o seu codigo e ${code}. Vale 5 minutos.`,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(12000),
  });
  return res.ok;
}

export async function deliverOtp(channel: "sms" | "whatsapp", phone: string, code: string) {
  try {
    const sent = channel === "whatsapp" ? await sendWhatsapp(phone, code) : await sendSms(phone, code);
    return sent ? { ok: true as const } : { ok: false as const, error: "config" as const };
  } catch {
    return { ok: false as const, error: "send" as const };
  }
}
