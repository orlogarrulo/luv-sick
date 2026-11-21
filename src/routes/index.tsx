import { createFileRoute } from "@tanstack/react-router";
import { LuvSickApp } from "@/components/luvsick-app";
import { luvCatalog } from "@/server/fns";

export const Route = createFileRoute("/")({
  loader: () => luvCatalog().catch(() => null),
  component: function Home() {
    return <LuvSickApp catalog={Route.useLoaderData()} />;
  },
});
