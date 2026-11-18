import { createFileRoute } from "@tanstack/react-router";
import { LuvSickDesk } from "@/components/luvsick-desk";

export const Route = createFileRoute("/gestao")({
  component: LuvSickDesk,
});

