import { createFileRoute } from "@tanstack/react-router";
import { ReceiptPage } from "@/components/luvsick-receipt";
import { useCatalog } from "@/lib/luvsick-catalog-client";
import { luvCatalog } from "@/server/fns";

export const Route = createFileRoute("/recibo/$ref")({
  loader: () => luvCatalog().catch(() => null),
  component: function Recibo() {
    const { ref } = Route.useParams();
    useCatalog(Route.useLoaderData());
    return <ReceiptPage refCode={ref} />;
  },
});
