import { createFileRoute } from "@tanstack/react-router";
import { LuvSickApp } from "@/components/luvsick-app";

export const Route = createFileRoute("/")({
  component: LuvSickApp,
});
