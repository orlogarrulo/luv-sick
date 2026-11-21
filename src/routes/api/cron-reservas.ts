import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

/**
 * Prazo das reservas: lembrete às 12 h e cancelamento às 24 h sem comprovativo.
 * Chamado pelo Vercel Cron e pelo agendamento do GitHub Actions, com "Authorization: Bearer CRON_SECRET".
 * Idempotente: pode correr quantas vezes for preciso.
 */
function authorised(header: string) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(request: Request) {
  if (!authorised(request.headers.get("authorization") ?? "")) {
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const api = await import("@/server/luvsick.server");
  const result = await api.sweepReservations();
  console.log(`[luvsick] cron reservas: ${result.reminded.length} lembretes, ${result.cancelled.length} canceladas`);
  return new Response(JSON.stringify({ ok: true, reminded: result.reminded.length, cancelled: result.cancelled.length }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/cron-reservas")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
