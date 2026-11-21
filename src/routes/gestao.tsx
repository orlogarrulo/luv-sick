import { createFileRoute } from "@tanstack/react-router";
import { LuvSickDesk } from "@/components/luvsick-desk";
import { useCatalog } from "@/lib/luvsick-catalog-client";
import { luvCatalog } from "@/server/fns";

export const Route = createFileRoute("/gestao")({
  loader: () => luvCatalog().catch(() => null),
  component: function Gestao() {
    useCatalog(Route.useLoaderData());
    return <LuvSickDesk />;
  },
});
