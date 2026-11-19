import { useEffect, useState } from "react";
import { productById } from "@/lib/luvsick";
import { luvReceipt, luvReservePaper } from "@/server/fns";

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
  invoiceNo?: string;
  trial?: boolean;
  email?: string;
};
type Paper = {
  ref: string;
  createdAt: string;
  name: string;
  email: string;
  pay: string;
  lines: Line[];
  totalLabel: string;
  depositLabel: string;
  balanceLabel: string;
  receiptNo: string;
  invoiceNo: string;
  trial?: boolean;
};

function whenLabel(value: string) {
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? value : when.toLocaleString("pt-PT");
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <ul className="grid gap-2 border-y border-[#1a1714]/15 py-3">
      {lines.map((line) => {
        const item = productById(line.productId);
        return (
          <li key={`${line.productId}-${line.size}`} className="flex justify-between gap-3">
            <span>{item?.name.pt ?? line.productId} · {line.size} · {line.qty}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ReceiptPage({ refCode }: { refCode: string }) {
  const reserve = refCode.toUpperCase().startsWith("LR-");
  const [state, setState] = useState<"wait" | "open" | "pending" | "missing">("wait");
  const [order, setOrder] = useState<Order | null>(null);
  const [paper, setPaper] = useState<Paper | null>(null);

  useEffect(() => {
    if (reserve) {
      luvReservePaper({ data: { ref: refCode } }).then((res) => {
        if (!res.ok) {
          setState("missing");
          return;
        }
        setPaper(res.paper);
        setState("open");
      });
      return;
    }
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
  }, [refCode, reserve]);

  if (state === "wait") return <main className="grid min-h-dvh place-items-center bg-[#f4f1ec] text-[#1a1714]">A carregar…</main>;
  if (state === "missing") return <main className="grid min-h-dvh place-items-center bg-[#f4f1ec] px-4 text-center text-[#1a1714]">Este documento não existe.</main>;
  if (paper) {
    return (
      <main className="min-h-dvh bg-[#f4f1ec] px-4 py-8 text-[#1a1714]">
        {paper.trial ? <p className="mx-auto mb-4 max-w-sm text-center text-sm">Ensaio. Este documento não entra no stock nem nos totais.</p> : null}
        <div className="mx-auto grid max-w-sm gap-6">
          <article className="grid gap-3 bg-white p-6 text-sm">
            <img src="/luvsick/brand/logo-black.svg" alt="Luv Sick" className="mx-auto h-14 w-14 object-contain" />
            <h1 className="text-center text-lg font-medium tracking-[0.2em]">RECIBO</h1>
            <p className="text-center font-bold">{paper.receiptNo}</p>
            <p className="text-center">{whenLabel(paper.createdAt)}</p>
            <p>Reserva {paper.ref}</p>
            <p>{paper.name}</p>
            <p>{paper.email}</p>
            <Lines lines={paper.lines} />
            <p>Pagamento: {paper.pay} · 50%</p>
            <p className="text-lg font-bold">{paper.depositLabel}</p>
            <p className="text-center text-xs tracking-[0.16em]">PAGO · LUV SICK</p>
          </article>
          <article className="grid gap-3 bg-white p-6 text-sm">
            <h1 className="text-center text-lg font-medium tracking-[0.2em]">FATURA</h1>
            <p className="text-center font-bold">{paper.invoiceNo}</p>
            <p>Reserva {paper.ref}</p>
            <p>{paper.name}</p>
            <Lines lines={paper.lines} />
            <p>Restante 50% de {paper.totalLabel}</p>
            <p className="text-lg font-bold">{paper.balanceLabel}</p>
            <p>Data de pagamento: no dia do envio.</p>
            <p className="text-center text-xs tracking-[0.16em]">EM ABERTO · LUV SICK</p>
          </article>
        </div>
        <button type="button" onClick={() => window.print()} className="btn-brown mx-auto mt-6 block rounded-full px-6 py-3 print:hidden">Imprimir</button>
      </main>
    );
  }
  if (state === "pending" || !order) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f4f1ec] px-4 text-center text-[#1a1714]">
        <p className="max-w-sm">O talão de {refCode.toUpperCase()} fica disponível depois de confirmarmos o pagamento.</p>
      </main>
    );
  }

  if (order.trial) {
    return (
      <main className="min-h-dvh bg-[#f4f1ec] px-4 py-8 text-[#1a1714]">
        <p className="mx-auto mb-4 max-w-sm text-center text-sm">Ensaio. Este documento não entra no stock nem nos totais.</p>
        <div className="mx-auto grid max-w-sm gap-6">
          <article className="grid gap-3 bg-white p-6 text-sm">
            <img src="/luvsick/brand/logo-black.svg" alt="Luv Sick" className="mx-auto h-14 w-14 object-contain" />
            <h1 className="text-center text-lg font-medium tracking-[0.2em]">RECIBO</h1>
            <p className="text-center font-bold">{order.receiptNo}</p>
            <p className="text-center">{whenLabel(order.paidAt)}</p>
            <p>Encomenda {order.ref}</p>
            <p>{order.name}</p>
            {order.email ? <p>{order.email}</p> : null}
            <Lines lines={order.lines} />
            <p>Pagamento: {order.pay}{order.coupon ? ` · ${order.coupon}` : ""}</p>
            <p className="text-lg font-bold">{order.totalLabel}</p>
            <p className="text-center text-xs tracking-[0.16em]">ENSAIO · PAGO · LUV SICK</p>
          </article>
          <article className="grid gap-3 bg-white p-6 text-sm">
            <h1 className="text-center text-lg font-medium tracking-[0.2em]">FATURA</h1>
            <p className="text-center font-bold">{order.invoiceNo}</p>
            <p>Encomenda {order.ref}</p>
            <p>{order.name}</p>
            <Lines lines={order.lines} />
            <p className="text-lg font-bold">{order.totalLabel}</p>
            <p className="text-center text-xs tracking-[0.16em]">ENSAIO · LUV SICK</p>
          </article>
        </div>
        <button type="button" onClick={() => window.print()} className="btn-brown mx-auto mt-6 block rounded-full px-6 py-3 print:hidden">Imprimir</button>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f4f1ec] px-4 py-8 text-[#1a1714]">
      <article className="mx-auto grid max-w-sm gap-3 bg-white p-6 text-sm">
        <img src="/luvsick/brand/logo-black.svg" alt="Luv Sick" className="mx-auto h-14 w-14 object-contain" />
        <h1 className="text-center text-lg font-medium tracking-[0.2em]">TALÃO</h1>
        <p className="text-center font-bold">{order.receiptNo}</p>
        <p className="text-center">{whenLabel(order.paidAt)}</p>
        <p>Encomenda {order.ref}</p>
        <p>{order.name}</p>
        {order.nif ? <p>NIF {order.nif}</p> : null}
        <p>{order.city}{order.country ? ` · ${order.country}` : ""}</p>
        <Lines lines={order.lines} />
        <p>Pagamento: {order.pay}{order.coupon ? ` · ${order.coupon}` : ""}</p>
        <p className="text-lg font-bold">Total {order.totalLabel}</p>
        <p className="text-center text-xs tracking-[0.16em]">PAGO · LUV SICK</p>
      </article>
      <button type="button" onClick={() => window.print()} className="btn-brown mx-auto mt-6 block rounded-full px-6 py-3 print:hidden">Imprimir</button>
    </main>
  );
}
