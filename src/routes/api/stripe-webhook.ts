import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do Stripe (preparado para o Apple Pay em Portugal).
 * Fica desligado (503) enquanto STRIPE_WEBHOOK_SECRET não estiver definido no Vercel.
 */
export const Route = createFileRoute("/api/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const api = await import("@/server/stripe.server");
        const body = await request.text();
        const result = await api.handleStripeWebhook(body, request.headers.get("stripe-signature") ?? "");
        return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
      },
    },
  },
});
