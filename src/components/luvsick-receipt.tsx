import { useEffect, useState } from "react";
import { productById } from "@/lib/luvsick";
import { luvReceipt } from "@/server/fns";

type Line = { productId: string; size: string; qty: number };
type Order = {
  ref: string;
  createdAt: string;
  name: string;
  city: string;
  country: string;
  pay: string;
  totalLabel: string;
  coupon: string;
  lines: Line[];
  paidAt: string;
  nif: string;
  receiptNo: string;
};

export function ReceiptPage({ refCode }: { refCode: string }) {
  const [state, setState] = useState<"wait" | "open" | "pending" | "missing">("wait");
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    luvReceipt({ data: { ref: refCode } }).then((res) => {
      if (!res.ok) {
        setState("missing");
        return;
      }
      if (!res.paid) {
        setState("pending");
        return;
      }
      setOrder(res.order);
      setState("open");
    });
  }, [refCode]);

  if (state === "wait") return <main className="grid min-h-dvh place-items-center bg-[#f4f1ec] text-[#1a1714]">A carregar o talão…</main>;
  if (state === "missing") return <main className="grid min-h-dvh place-items-center bg-[#f4f1ec] px-4 text-center text-[#1a1714]">Este talão não existe.</main>;
  if (state === "pending" || !order) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f4f1ec] px-4 text-center text-[#1a1714]">
        <p className="max-w-sm">O talão de {refCode.toUpperCase()} fica disponível depois de confirmarmos o pagamento.</p>
      </main>
    );
  }

  const when = new Date(order.paidAt);
  const date = Number.isNaN(when.getTime()) ? order.paidAt : when.toLocaleString("pt-PT");

  return (
    <main className="min-h-dvh bg-[#f4f1ec] px-4 py-8 text-[#1a1714]">
      <article className="mx-auto grid max-w-sm gap-3 bg-white p-6 text-sm">
        <img src="/luvsick/brand/logo-black.svg" alt="Luv Sick" className="mx-auto h-14 w-14 object-contain" />
        <h1 className="text-center text-lg font-medium tracking-[0.2em]">TALÃO</h1>
        <p className="text-center font-bold">{order.receiptNo}</p>
        <p className="text-center">{date}</p>
        <p>Encomenda {order.ref}</p>
        <p>{order.name}</p>
        {order.nif ? <p>NIF {order.nif}</p> : null}
        <p>{order.city}{order.country ? ` · ${order.country}` : ""}</p>
        <ul className="grid gap-2 border-y border-[#1a1714]/15 py-3">
          {order.lines.map((line) => {
            const item = productById(line.productId);
            return (
              <li key={`${line.productId}-${line.size}`} className="flex justify-between gap-3">
                <span>{item?.name.pt ?? line.productId} · {line.size} · {line.qty}</span>
              </li>
            );
          })}
        </ul>
        <p>Pagamento: {order.pay}{order.coupon ? ` · ${order.coupon}` : ""}</p>
        <p className="text-lg font-bold">Total {order.totalLabel}</p>
        <p className="text-center text-xs tracking-[0.16em]">PAGO · LUV SICK</p>
      </article>
      <button type="button" onClick={() => window.print()} className="btn-brown mx-auto mt-6 block rounded-full px-6 py-3 print:hidden">Imprimir</button>
    </main>
  );
}
