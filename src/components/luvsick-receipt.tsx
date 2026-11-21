import { useCallback, useEffect, useState } from "react";
import { PayDetails, ProofUpload, proofWhatsApp } from "@/components/luvsick-pay";
import { payMethod, productById, type Market } from "@/lib/luvsick";
import { luvPayInfo, luvReceipt, luvReservePaper, luvStripeSync } from "@/server/fns";

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

type PayInfo = {
  ref: string;
  kind: "order" | "reserve";
  market: Market;
  pay: string;
  payLabel: string;
  amountLabel: string;
  paid: boolean;
  proofStatus: string;
  proofs: number;
  stripe?: boolean;
  cancelled?: boolean;
};

const STATUS: Record<string, string> = {
  "": "À espera do pagamento",
  sent: "Comprovativo enviado",
  rejected: "Comprovativo rejeitado. Envia outro ou fala connosco pelo WhatsApp.",
  accepted: "Paga",
};

/** Pagamento por confirmar: dados para pagar, envio do comprovativo e WhatsApp. */
function PaymentBox({ info, onChange }: { info: PayInfo; onChange: () => void }) {
  const status = info.paid ? "Paga" : info.cancelled ? "Reserva cancelada" : STATUS[info.proofStatus] ?? STATUS[""];
  const card = !info.cancelled && payMethod(info.market, info.pay)?.kind === "card" && Boolean(info.stripe) && info.market === "PT";
  const [back] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("cancelado") ? "Pagamento cancelado. Podes tentar outra vez." : ""));
  return (
    <section className="mx-auto grid max-w-sm gap-4 bg-white p-6 text-sm print:hidden" data-payment-box>
      <img src="/luvsick/brand/logo-black.svg" alt="Luv Sick" className="mx-auto h-14 w-14 object-contain" />
      <h1 className="text-center text-lg font-medium tracking-[0.2em]">PAGAMENTO</h1>
      <p className="text-center">
        {info.kind === "reserve" ? "Reserva" : "Encomenda"} <span className="font-bold">{info.ref}</span>
      </p>
      <p className="text-center font-bold" data-proof-status>
        Estado: {status}
      </p>
      {back ? <p className="text-center text-sm">{back}</p> : null}
      {info.cancelled ? (
        <p className="text-center text-sm" data-reserve-cancelled>
          {info.proofStatus === "sent" ? "Recebemos o teu comprovativo. Vamos ver se as peças ainda estão disponíveis e avisamos-te." : "Esta reserva foi cancelada. Se já pagaste, envia o comprovativo: reativamos a reserva se as peças ainda estiverem disponíveis."}
        </p>
      ) : null}
      <PayDetails market={info.market} pay={info.pay} amountLabel={info.amountLabel} refCode={info.ref} lang="pt" stripe={Boolean(info.stripe) && !info.cancelled} />
      {info.kind === "reserve" ? <p className="text-xs text-[#1a1714]/70">Valor do sinal de 50%. O restante paga-se no dia do envio.</p> : null}
      {card ? null : <ProofUpload refCode={info.ref} onDone={onChange} />}
      <a href={proofWhatsApp(info.market, info.ref, info.amountLabel)} target="_blank" rel="noreferrer" className="rounded-full border border-[#1a1714] px-5 py-3 text-center font-bold">
        Enviar pelo WhatsApp
      </a>
    </section>
  );
}

function InvoiceLink({ refCode }: { refCode: string }) {
  return (
    <a href={`/api/fatura/${refCode}`} target="_blank" rel="noreferrer" className="btn-brown mx-auto mt-4 block w-fit rounded-full px-6 py-3 text-center print:hidden" data-invoice-link>
      Descarregar fatura (PDF)
    </a>
  );
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
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [reload, setReload] = useState(0);

  const loadPay = useCallback(() => {
    luvPayInfo({ data: { ref: refCode } }).then((res) => {
      if (res.ok) setInfo(res);
    });
  }, [refCode]);

  useEffect(() => {
    const back = new URLSearchParams(window.location.search).get("pago");
    if (!back) {
      loadPay();
      return;
    }
    // Regresso do Stripe: confirma a sessão e recarrega o estado e o documento.
    luvStripeSync({ data: { ref: refCode } })
      .catch(() => null)
      .finally(() => {
        loadPay();
        setReload((n) => n + 1);
      });
  }, [loadPay, refCode]);

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
  }, [refCode, reserve, reload]);

  if (state === "wait") return <main className="grid min-h-dvh place-items-center bg-[#f4f1ec] text-[#1a1714]">A carregar…</main>;
  if (state === "missing") return <main className="grid min-h-dvh place-items-center bg-[#f4f1ec] px-4 text-center text-[#1a1714]">Este documento não existe.</main>;
  if (paper) {
    return (
      <main className="min-h-dvh bg-[#f4f1ec] px-4 py-8 text-[#1a1714]">
        {paper.trial ? <p className="mx-auto mb-4 max-w-sm text-center text-sm">Ensaio. Este documento não entra no stock nem nos totais.</p> : null}
        {info && !info.paid ? <div className="mb-6"><PaymentBox info={info} onChange={loadPay} /></div> : null}
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
            <p className="text-center text-xs tracking-[0.16em]">{info && !info.paid ? "POR CONFIRMAR · LUV SICK" : "PAGO · LUV SICK"}</p>
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
        {info?.paid ? <InvoiceLink refCode={paper.ref} /> : null}
        <button type="button" onClick={() => window.print()} className="btn-brown mx-auto mt-6 block rounded-full px-6 py-3 print:hidden">Imprimir</button>
      </main>
    );
  }
  if (state === "pending" || !order) {
    return (
      <main className="min-h-dvh bg-[#f4f1ec] px-4 py-8 text-[#1a1714]">
        {info && !info.paid ? <PaymentBox info={info} onChange={loadPay} /> : null}
        <p className="mx-auto mt-6 max-w-sm text-center text-sm">O talão de {refCode.toUpperCase()} fica disponível depois de confirmarmos o pagamento.</p>
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
        <InvoiceLink refCode={order.ref} />
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
      <InvoiceLink refCode={order.ref} />
      <button type="button" onClick={() => window.print()} className="btn-brown mx-auto mt-6 block rounded-full px-6 py-3 print:hidden">Imprimir</button>
    </main>
  );
}
