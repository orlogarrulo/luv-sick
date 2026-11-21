import { createFileRoute } from "@tanstack/react-router";

/** Fatura em PDF de uma encomenda ou reserva já paga. */
export const Route = createFileRoute("/api/fatura/$ref")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const api = await import("@/server/luvsick-pay.server");
        const doc = await api.invoicePdf(String(params.ref ?? ""));
        if (!doc) return new Response("Fatura indisponível.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
        return new Response(doc.file as unknown as BodyInit, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `inline; filename="${doc.name}"`,
            "cache-control": "private, no-store",
            "x-robots-tag": "noindex",
          },
        });
      },
    },
  },
});
