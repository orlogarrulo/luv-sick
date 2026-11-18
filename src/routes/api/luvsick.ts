import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}

export const Route = createFileRoute("/api/luvsick")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => json({ ok: true, shop: "luvsick" }),
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          const parsed = await request.json();
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
        } catch {
          return json({ ok: false }, 400);
        }
        const api = await import("@/server/luvsick.server");
        const action = String(body.action ?? "");
        if (action === "stock") return json(await api.luvStock());
        if (action === "coupon") return json(await api.luvCheckCoupon(String(body.coupon ?? "")));
        if (action === "visit") return json(await api.luvVisit(String(body.visitor ?? ""), String(body.country ?? ""), String(body.city ?? "")));
        if (action === "place") {
          return json(
            await api.luvPlace({
              lines: Array.isArray(body.lines) ? (body.lines as { productId: string; size: string; qty: number }[]) : [],
              name: String(body.name ?? ""),
              phone: String(body.phone ?? ""),
              address: String(body.address ?? ""),
              city: String(body.city ?? ""),
              country: String(body.country ?? ""),
              postal: String(body.postal ?? ""),
              market: String(body.market ?? "PT"),
              pay: String(body.pay ?? ""),
              coupon: String(body.coupon ?? ""),
            }),
          );
        }
        return json({ ok: false }, 400);
      },
    },
  },
});
