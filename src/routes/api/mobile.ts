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

export const Route = createFileRoute("/api/mobile")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => json({ ok: true, service: "compra-tudo", client: "mobile" }),
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          const parsed = await request.json();
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "json" }, 400);
        }
        try {
          const { mobileAction } = await import("@/server/mobile-api.server");
          return json(await mobileAction(body));
        } catch (error) {
          console.error("[mobile-api]", error);
          return json({ ok: false, error: "server" }, 500);
        }
      },
    },
  },
});
