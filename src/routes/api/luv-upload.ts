import { createFileRoute } from "@tanstack/react-router";

/**
 * Uploads diretos do browser para o Vercel Blob (fotos e vídeos dos produtos, gestão → Produtos).
 * O servidor só emite um token de curta duração depois de validar o código de gestão (cabeçalho x-luv-desk).
 * A chave do Blob (BLOB_READ_WRITE_TOKEN) nunca sai do servidor.
 */
export const Route = createFileRoute("/api/luv-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { allowed } = await import("@/server/luvsick.server");
        const code = request.headers.get("x-luv-desk") ?? "";
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "pedido inválido" }, { status: 400 });
        }
        const kind = (body as { type?: string })?.type;
        if (kind === "blob.generate-client-token" && !allowed(code)) return Response.json({ error: "Código de gestão incorreto." }, { status: 401 });
        if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: "Armazenamento de ficheiros não configurado." }, { status: 503 });
        const { handleUpload } = await import("@vercel/blob/client");
        try {
          const result = await handleUpload({
            request,
            body: body as Parameters<typeof handleUpload>[0]["body"],
            onBeforeGenerateToken: async (pathname) => {
              if (!/^luvsick\/(produtos|videos)\/[\w.-]+$/.test(pathname)) throw new Error("Caminho inválido.");
              return {
                allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"],
                maximumSizeInBytes: 200 * 1024 * 1024,
                addRandomSuffix: true,
              };
            },
          });
          return Response.json(result);
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : "Falha no upload." }, { status: 400 });
        }
      },
    },
  },
});
