import { createFileRoute } from "@tanstack/react-router";
import { ReceiptPage } from "@/components/luvsick-receipt";

export const Route = createFileRoute("/recibo/$ref")({
  component: function Recibo() {
    const { ref } = Route.useParams();
    return <ReceiptPage refCode={ref} />;
  },
});
