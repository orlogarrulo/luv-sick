import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PRODUCTS, SIZES, reserveReminderText } from "@/lib/luvsick";
import { luvAckOrder, luvCancelReserve, luvConfirmReserve, luvDesk, luvIssueReceipt, luvMarkReservations, luvProofPart, luvRejectProof, luvResendReserve, luvSaveCoupon, luvSetStock, luvSetStockIn } from "@/server/fns";

type Stock = { productId: string; size: string; qty: number; received: number; out: number };
type Line = { productId: string; size: string; qty: number };
type Order = {
  id: string;
  ref: string;
  name: string;
  phone: string;
  city: string;
  country?: string;
  postal?: string;
  pay: string;
  totalLabel: string;
  coupon?: string;
  seen?: boolean;
  lines?: Line[];
  paidAt?: string;
  nif?: string;
  receiptNo?: string;
  trial?: boolean;
  invoiceNo?: string;
  proofStatus?: string;
};
type Proof = { id: string; ref: string; createdAt: string; name: string; mime: string; size: number; chunks: number; status: string };
type Visits = { total: number; countries: { country: string; n: number }[]; cities: { country: string; city: string; n: number }[] };
type Coupon = { code: string; percent: number; active: boolean };
type PendingCode = { email: string; code: string; name: string; phone: string; askedAt: string; expiresAt: string };

function codeWhatsapp(item: PendingCode) {
  const text = `Olá${item.name ? ` ${item.name.split(" ")[0]}` : ""}! O teu código Luv Sick é ${item.code}. Escreve-o em Conta, em luvsickstore.com, com o email ${item.email}.`;
  const number = item.phone.replace(/\D/g, "");
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function hhmm(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
type Reservation = {
  id: string;
  ref: string;
  name: string;
  phone: string;
  email: string;
  lines: Line[];
  receivedSent?: boolean;
  stockSent?: boolean;
  totalLabel?: string;
  depositLabel?: string;
  balanceLabel?: string;
  pay?: string;
  receiptNo?: string;
  invoiceNo?: string;
  emailed?: boolean;
  trial?: boolean;
  paidAt?: string;
  proofStatus?: string;
  market?: string;
  lang?: string;
  reminderAt?: string;
  reminderEmailed?: boolean;
  cancelledAt?: string;
  cancelReason?: string;
  cancelEmailed?: boolean;
  atRisk?: boolean;
  expiresAt?: string;
};

function reminderNote(item: Reservation) {
  return reserveReminderText(item.lang || "pt", { name: item.name, ref: item.ref, depositLabel: item.depositLabel ?? "", pay: item.pay ?? "", market: item.market ?? "" });
}

/** Linha do prazo de 24 h de uma reserva activa (vazia quando já tem comprovativo ou está paga). */
function deadlineLabel(item: Reservation) {
  if (item.paidAt || item.proofStatus || !item.expiresAt) return "";
  const when = new Date(item.expiresAt).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const reminder = item.reminderAt ? (item.reminderEmailed ? " · Lembrete enviado." : " · Lembrete: o email não saiu, usa o WhatsApp.") : "";
  return `${item.atRisk ? "Em risco · " : ""}Sem comprovativo: cancela automaticamente em ${when}.${reminder}`;
}

const PROOF_STATE: Record<string, string> = { pending: "por ver", accepted: "aceite", rejected: "rejeitado" };

function proofLabel(paidAt: string | undefined, status: string | undefined) {
  if (paidAt) return "Paga";
  if (status === "sent") return "Comprovativo enviado";
  if (status === "rejected") return "Comprovativo rejeitado";
  return "Sem comprovativo";
}

/** Comprovativos de uma referência, com ver ficheiro e "Rejeitar". Só a gestão os vê. */
function ProofBlock({ code, refCode, proofs, paidAt, status, onRejected, onError }: { code: string; refCode: string; proofs: Proof[]; paidAt?: string; status?: string; onRejected: () => void; onError: (text: string) => void }) {
  const mine = proofs.filter((item) => item.ref === refCode);
  const [busy, setBusy] = useState("");

  async function open(item: Proof) {
    setBusy(item.id);
    const tab = window.open("", "_blank");
    try {
      const parts: BlobPart[] = [];
      for (let idx = 0; idx < item.chunks; idx += 1) {
        const res = await luvProofPart({ data: { code, id: item.id, idx } });
        if (!res.ok) throw new Error("part");
        const raw = atob(res.data);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        parts.push(bytes);
      }
      const url = URL.createObjectURL(new Blob(parts, { type: item.mime }));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      onError("Não foi possível abrir o comprovativo.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-1 border-t border-black/10 pt-2" data-desk-proofs={refCode}>
      <p className="font-bold">{proofLabel(paidAt, status)}</p>
      {mine.map((item) => (
        <button key={item.id} type="button" onClick={() => open(item)} className="w-fit text-left underline" data-proof-open>
          {busy === item.id ? "A abrir…" : `Ver comprovativo · ${item.name} · ${Math.max(1, Math.round(item.size / 1024))} KB · ${PROOF_STATE[item.status] ?? item.status}`}
        </button>
      ))}
      {!paidAt && status === "sent" ? (
        <button
          type="button"
          onClick={async () => {
            const res = await luvRejectProof({ data: { code, ref: refCode } });
            if (res.ok) onRejected();
          }}
          className="w-fit px-3 py-2 font-bold ring-1 ring-black"
        >
          Rejeitar
        </button>
      ) : null}
      {paidAt ? <a href={`/api/fatura/${refCode}`} target="_blank" rel="noreferrer" className="w-fit underline">Fatura (PDF)</a> : null}
    </div>
  );
}

const RECEIVED_ALL = `Olá,

Recebemos a tua reserva na Luv Sick.
Pagaste 50%. O recibo e a fatura dos outros 50% seguem por email.
Os outros 50% pagam-se no dia do envio.
As entregas começam a 15 de dezembro.

Luv Sick`;

const STOCK_ALL = `Olá,

A tua reserva já pode ser entregue.
O restante de 50% paga-se no dia do envio.

Luv Sick`;

function lineLabel(lines: Line[]) {
  return lines
    .map((line) => {
      const product = PRODUCTS.find((item) => item.id === line.productId);
      return `${product?.name.pt ?? line.productId} · ${line.size} · ${line.qty}`;
    })
    .join("\n");
}

function personalMessage(kind: "received" | "stock", item: Reservation) {
  const items = lineLabel(item.lines);
  const money = item.depositLabel
    ? `Pago agora (50%): ${item.depositLabel}\nRestante (50%): ${item.balanceLabel}\nData de pagamento do restante: no dia do envio.`
    : "Os outros 50% pagam-se no dia do envio.";
  if (kind === "stock") {
    return `Olá ${item.name},\n\nA tua reserva já pode ser entregue.\n${items}\n${money}\n\nLuv Sick`;
  }
  return `Olá ${item.name},\n\nRecebemos a tua reserva na Luv Sick.\n${items}\n${money}\nAs entregas começam a 15 de dezembro.\n\nLuv Sick`;
}

function waDigits(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("244") || digits.startsWith("351")) return digits;
  if (digits.length === 9 && digits.startsWith("9")) return `244${digits}`;
  if (digits.length === 9) return `351${digits}`;
  return digits;
}

const KEY = "luvsick-desk";

export function LuvSickDesk() {
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<"stock" | "orders" | "visits" | "coupons" | "reserves">("stock");
  const [stock, setStock] = useState<Stock[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [visits, setVisits] = useState<Visits>({ total: 0, countries: [], cities: [] });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [coupon, setCoupon] = useState("");
  const [percent, setPercent] = useState("10");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [nifDraft, setNifDraft] = useState<Record<string, string>>({});
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [cancelledList, setCancelledList] = useState<Reservation[]>([]);
  const [stockIn, setStockIn] = useState(false);
  const [copied, setCopied] = useState("");
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [pendingCodes, setPendingCodes] = useState<PendingCode[]>([]);
  const [mailOn, setMailOn] = useState(false);
  const told = useRef(new Set<string>());
  const unseen = orders.filter((order) => !order.seen);

  async function load(nextCode: string) {
    const res = await luvDesk({ data: { code: nextCode } });
    if (!res.ok) {
      setError("Código incorrecto.");
      setReady(false);
      return;
    }
    sessionStorage.setItem(KEY, nextCode);
    setCode(nextCode);
    setStock(res.stock);
    setOrders(res.orders);
    setVisits(res.visits);
    setCoupons(res.coupons);
    setReservations(res.reservations ?? []);
    setCancelledList(res.cancelled ?? []);
    setProofs(res.proofs ?? []);
    setPendingCodes(res.pendingCodes ?? []);
    setMailOn(Boolean(res.mailReady));
    setStockIn(Boolean(res.stockIn));
    setError("");
    setReady(true);
  }

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      void load(code);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [ready, code]);

  useEffect(() => {
    if (!ready) return;
    const fresh = unseen.filter((order) => !told.current.has(order.id));
    if (!fresh.length) return;
    fresh.forEach((order) => told.current.add(order.id));
    document.title = `(${unseen.length}) Gestão`;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      fresh.forEach((order) => {
        new Notification("Luv Sick · nova compra", { body: `${order.ref} · ${order.name} · ${order.totalLabel}` });
      });
    }
  }, [ready, unseen]);

  useEffect(() => {
    if (!ready) return;
    document.title = unseen.length ? `(${unseen.length}) Gestão` : "Gestão";
  }, [ready, unseen.length]);

  async function ack(id: string) {
    const res = await luvAckOrder({ data: { code, id } });
    if (!res.ok) return;
    setOrders((current) => current.map((order) => (order.id === id ? { ...order, seen: true } : order)));
  }

  async function allowNotices() {
    if (typeof Notification === "undefined") {
      setNotice("Este browser não mostra avisos fora da página.");
      return;
    }
    const result = await Notification.requestPermission();
    setNotice(result === "granted" ? "Avisos ligados neste telemóvel. Avisam quando entra uma compra nova. Não são uma lista." : "Os avisos não foram permitidos. As compras novas continuam só dentro da gestão.");
  }

  async function saveQty(row: Stock) {
    const received = Number(draft[`${row.productId}|${row.size}`] ?? row.received);
    const res = await luvSetStock({ data: { code, productId: row.productId, size: row.size, qty: received } });
    if (!res.ok) return;
    setStock((current) => current.map((item) => (item.productId === row.productId && item.size === row.size ? { ...item, qty: res.qty, received: res.received, out: res.out } : item)));
  }

  async function issue(order: Order) {
    const nif = nifDraft[order.id] ?? order.nif ?? "";
    const res = await luvIssueReceipt({ data: { code, id: order.id, nif } });
    if (!res.ok) {
      setError(res.error === "nif" ? "O NIF tem de ter entre 9 e 14 números." : "Não foi possível emitir o talão.");
      return;
    }
    setError("");
    setOrders((current) =>
      current.map((item) => (item.id === order.id ? { ...item, paidAt: item.paidAt || new Date().toISOString(), nif: res.nif, receiptNo: res.receiptNo, seen: true } : item)),
    );
    void load(code);
  }

  async function flipStock() {
    const res = await luvSetStockIn({ data: { code, stockIn: !stockIn } });
    if (!res.ok) return;
    setStockIn(res.stockIn);
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied("");
      setError("Não foi possível copiar. Selecciona o texto da mensagem.");
    }
  }

  async function sendAll(kind: "received" | "stock") {
    const targets = reservations.filter((item) => (kind === "stock" ? !item.stockSent : !item.receivedSent));
    const list = targets.length ? targets : reservations;
    if (!list.length) return;
    const body = kind === "stock" ? STOCK_ALL : RECEIVED_ALL;
    const subject = kind === "stock" ? "Luv Sick · a tua reserva está disponível" : "Luv Sick · reserva recebida";
    const bcc = list.map((item) => item.email).filter(Boolean).join(",");
    const marked = await luvMarkReservations({ data: { code, kind, ids: list.map((item) => item.id) } });
    if (!marked.ok) return;
    setReservations((current) =>
      current.map((item) => (list.some((target) => target.id === item.id) ? { ...item, ...(kind === "stock" ? { stockSent: true } : { receivedSent: true }) } : item)),
    );
    const link = document.createElement("a");
    link.href = `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    link.click();
  }

  async function createCoupon(event: FormEvent) {
    event.preventDefault();
    const res = await luvSaveCoupon({ data: { code, coupon, percent: Number(percent) } });
    if (!res.ok) {
      setError("O cupão precisa de 3 letras ou números e uma percentagem entre 1 e 90.");
      return;
    }
    setCoupon("");
    await load(code);
  }

  if (!ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-black px-4 text-white">
        <form
          className="grid w-full max-w-sm gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            load(code);
          }}
        >
          <img src="/luvsick/brand/logo-white.svg" alt="Luv Sick" className="mx-auto h-16 w-16 object-contain" />
          <h1 className="text-center text-2xl font-bold">Gestão</h1>
          <input type="password" value={code} onChange={(event) => setCode(event.target.value)} aria-label="Código" className="border border-white bg-black px-3 py-3" />
          {error ? <p className="text-sm text-white/70">{error}</p> : null}
          <button className="bg-white px-4 py-3 font-bold text-black">Entrar</button>
          <Link to="/" className="text-center text-sm underline">Loja</Link>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-black px-4 py-6 text-white">
      <div className="mx-auto grid max-w-3xl gap-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Gestão</h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={allowNotices} className="text-sm underline">Ligar avisos</button>
            <Link to="/" className="text-sm underline">Loja</Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["stock", "orders", "visits", "coupons", "reserves"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setTab(item)} className={`px-3 py-2 text-sm font-bold ${tab === item ? "bg-white text-black" : "ring-1 ring-white"}`}>
              {item === "stock" ? "Stock" : item === "orders" ? `Encomendas${unseen.length ? ` (${unseen.length})` : ""}` : item === "visits" ? "Visitas" : item === "coupons" ? "Cupões" : `Reservas${reservations.length ? ` (${reservations.length})` : ""}`}
            </button>
          ))}
        </div>
        {unseen.length ? (
          <section className="grid gap-2 bg-white p-3 text-black">
            <p className="font-bold">Nova compra</p>
            {unseen.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{order.ref} · {order.name} · {order.phone} · {order.totalLabel}</span>
                <button type="button" onClick={() => ack(order.id)} className="bg-black px-3 py-2 font-bold text-white">Já vi</button>
              </div>
            ))}
          </section>
        ) : null}
        {pendingCodes.length ? (
          <section className="grid gap-2 bg-white p-3 text-black" data-pending-codes>
            <p className="font-bold">Códigos pendentes ({pendingCodes.length})</p>
            <p className="text-xs text-black/60">{mailOn ? "O envio do email falhou. Envia o código ao cliente por WhatsApp." : "O envio de emails ainda não está ligado. Envia o código ao cliente por WhatsApp."}</p>
            {pendingCodes.map((item) => (
              <div key={item.email} className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-2 text-sm">
                <span>
                  {item.name || item.email} · {item.email}{item.phone ? ` · ${item.phone}` : ""} · <b className="font-mono">{item.code}</b> · pedido {hhmm(item.askedAt)} · válido até {hhmm(item.expiresAt)}
                </span>
                {item.phone ? (
                  <a href={codeWhatsapp(item)} target="_blank" rel="noopener noreferrer" className="bg-black px-3 py-2 font-bold text-white">WhatsApp</a>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        {notice ? <p className="text-sm text-white/70">{notice}</p> : null}
        {error ? <p className="text-sm text-white/70">{error}</p> : null}
        {tab === "stock" ? (
          <div className="grid gap-4">
            {PRODUCTS.map((product) => (
              <section key={product.id} className="grid gap-2 bg-white p-3 text-black">
                <h2 className="font-bold">{product.name.pt}</h2>
                {SIZES.map((size) => {
                  const row = stock.find((item) => item.productId === product.id && item.size === size);
                  const key = `${product.id}|${size}`;
                  const received = row?.received ?? row?.qty ?? 0;
                  const out = row?.out ?? 0;
                  const onHand = row?.qty ?? 0;
                  return (
                    <div key={size} className="grid items-end gap-2 border-t border-black/10 py-2 sm:grid-cols-[2.5rem_5.5rem_5.5rem_6rem_auto]">
                      <span className="font-bold">{size}</span>
                      <label className="grid gap-1 text-xs">
                        Entradas
                        <input
                          inputMode="numeric"
                          aria-label={`Entradas ${size}`}
                          value={draft[key] ?? String(received)}
                          onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                          className="w-full border border-black px-2 py-2 text-sm"
                        />
                      </label>
                      <p className="text-sm">Saídas <span className="font-bold tabular-nums">{out}</span></p>
                      <p className="text-sm">Existente <span className="font-bold tabular-nums">{onHand}</span></p>
                      <button type="button" onClick={() => row && saveQty(row)} className="bg-black px-3 py-2 font-bold text-white">Guardar</button>
                      {onHand === 0 ? <span className="text-sm sm:col-span-5">Esgotado</span> : null}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : null}
        {tab === "orders" ? (
          <ul className="grid gap-2">
            {orders.length === 0 ? <li>Ainda não há encomendas.</li> : null}
            {orders.map((order) => (
              <li key={order.id} className="grid gap-2 bg-white p-3 text-sm text-black">
                <p className="font-bold">{order.ref} · {order.totalLabel}{order.trial ? " · Ensaio" : ""}</p>
                <p>{order.name} · {order.phone} · {order.postal} {order.city} · {order.country}</p>
                <p>{order.pay}{order.coupon ? ` · ${order.coupon}` : ""}</p>
                <label className="grid gap-1">
                  NIF
                  <input
                    inputMode="numeric"
                    value={nifDraft[order.id] ?? order.nif ?? ""}
                    onChange={(event) => setNifDraft({ ...nifDraft, [order.id]: event.target.value })}
                    placeholder="Opcional"
                    className="border border-black px-2 py-2"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => issue(order)} className="bg-black px-3 py-2 font-bold text-white">
                    {order.receiptNo ? "Actualizar talão" : "Confirmar pagamento"}
                  </button>
                  {order.receiptNo ? <a href={`/recibo/${order.ref}`} className="underline">{order.receiptNo}</a> : null}
                </div>
                <ProofBlock
                  code={code}
                  refCode={order.ref}
                  proofs={proofs}
                  paidAt={order.paidAt}
                  status={order.proofStatus}
                  onError={setError}
                  onRejected={() => void load(code)}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {tab === "reserves" ? (
          <section className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 text-black">
              <p className="text-sm">{stockIn ? "Stock confirmado. A loja já aceita pagamento." : "À espera das peças da fábrica. A loja só aceita reservas."}</p>
              <button type="button" onClick={flipStock} className="bg-black px-3 py-2 text-sm font-bold text-white">
                {stockIn ? "Voltar a só reservas" : "Confirmar que o stock chegou"}
              </button>
            </div>
            <article className="grid gap-2 bg-white p-3 text-sm text-black">
              <h2 className="font-bold">Mensagem de receção</h2>
              <p>Para todos os que reservaram. As entregas começam a 15 de dezembro.</p>
              <pre className="whitespace-pre-wrap font-sans">{RECEIVED_ALL}</pre>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => sendAll("received")} className="bg-black px-3 py-2 font-bold text-white">Enviar a todos por email</button>
                <button type="button" onClick={() => copyText("receção", RECEIVED_ALL)} className="px-3 py-2 font-bold ring-1 ring-black">Copiar mensagem</button>
              </div>
            </article>
            <article className={`grid gap-2 bg-white p-3 text-sm text-black ${stockIn ? "" : "opacity-60"}`}>
              <h2 className="font-bold">Mensagem de stock</h2>
              <p>Quando o stock está confirmado: a reserva já está disponível e podem pagar.</p>
              <pre className="whitespace-pre-wrap font-sans">{STOCK_ALL}</pre>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!stockIn} onClick={() => sendAll("stock")} className="bg-black px-3 py-2 font-bold text-white disabled:opacity-40">Enviar lembrete a todos</button>
                <button type="button" onClick={() => copyText("stock", STOCK_ALL)} className="px-3 py-2 font-bold ring-1 ring-black">Copiar mensagem</button>
              </div>
            </article>
            {copied ? <p className="text-sm text-white/70">Mensagem copiada: {copied}.</p> : null}
            {reservations.length === 0 ? <p>Ainda não há reservas.</p> : null}
            <ul className="grid gap-2">
              {reservations.map((item) => {
                const note = item.atRisk ? reminderNote(item) : personalMessage(stockIn ? "stock" : "received", item);
                const deadline = deadlineLabel(item);
                const qty = item.lines.reduce((sum, line) => sum + line.qty, 0);
                return (
                  <li key={item.id} className="grid gap-2 bg-white p-3 text-sm text-black">
                    <p className="font-bold">{item.ref} · {item.name}{item.trial ? " · Ensaio" : ""}</p>
                    <p>{item.phone} · {item.email}</p>
                    <p>{lineLabel(item.lines)} · {qty}</p>
                    {item.depositLabel ? <p>{item.paidAt ? "Pago" : "Por confirmar"} 50%: {item.depositLabel}{item.pay ? ` · ${item.pay}` : ""}</p> : null}
                    {item.balanceLabel ? <p>Fatura 50%: {item.balanceLabel} · no dia do envio</p> : null}
                    <p className="text-black/60">{item.receivedSent ? "Receção enviada. " : ""}{item.stockSent ? "Lembrete de stock enviado. " : ""}{item.emailed ? "Email enviado." : "Email por enviar."}</p>
                    {deadline ? <p className={item.atRisk ? "font-bold text-[#a3341f]" : "text-black/60"} data-reserve-deadline>{deadline}</p> : null}
                    <pre className="whitespace-pre-wrap font-sans">{note}</pre>
                    <a href={`https://wa.me/${waDigits(item.phone)}?text=${encodeURIComponent(note)}`} target="_blank" rel="noreferrer" className="font-bold underline">WhatsApp desta pessoa</a>
                    {item.receiptNo ? <a href={`/recibo/${item.ref}`} className="font-bold underline">{item.receiptNo} · {item.invoiceNo}</a> : null}
                    <ProofBlock
                      code={code}
                      refCode={item.ref}
                      proofs={proofs}
                      paidAt={item.paidAt}
                      status={item.proofStatus}
                      onError={setError}
                      onRejected={() => void load(code)}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await luvConfirmReserve({ data: { code, id: item.id } });
                        if (!res.ok) {
                          if ("error" in res && res.error === "stock") setError("Não há stock suficiente para esta reserva.");
                          return;
                        }
                        setReservations((current) => current.map((row) => (row.id === item.id ? { ...row, paidAt: row.paidAt || new Date().toISOString() } : row)));
                        void load(code);
                      }}
                      className="w-fit bg-black px-3 py-2 font-bold text-white"
                    >
                      {item.paidAt ? "Pagamento confirmado" : "Confirmar pagamento"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await luvResendReserve({ data: { code, id: item.id } });
                        if (!res.ok) return;
                        setReservations((current) => current.map((row) => (row.id === item.id ? { ...row, emailed: res.emailed || row.emailed } : row)));
                        setCopied(res.emailed ? "email" : "");
                        if (!res.emailed) setError("O email não saiu. Confirma o envio no serviço de email.");
                      }}
                      className="w-fit bg-black px-3 py-2 font-bold text-white"
                    >
                      Reenviar recibo e fatura
                    </button>
                    <button
                      type="button"
                      data-cancel-reserve={item.ref}
                      onClick={async () => {
                        const warn = item.paidAt ? "\n\nAtenção: esta reserva já está paga. O reembolso tem de ser feito à parte." : "";
                        if (!window.confirm(`Cancelar a reserva ${item.ref} de ${item.name}?\n\nAs peças voltam ao stock e o cliente recebe um email a avisar.${warn}`)) return;
                        const res = await luvCancelReserve({ data: { code, id: item.id } });
                        if (!res.ok) {
                          setError("Não foi possível cancelar a reserva.");
                          return;
                        }
                        setNotice(`Reserva ${item.ref} cancelada. As peças voltaram ao stock.`);
                        void load(code);
                      }}
                      className="w-fit px-3 py-2 font-bold text-[#a3341f] ring-1 ring-[#a3341f]"
                    >
                      Cancelar reserva
                    </button>
                  </li>
                );
              })}
            </ul>
            {cancelledList.length ? (
              <details className="bg-white p-3 text-sm text-black" data-cancelled-list>
                <summary className="cursor-pointer font-bold">Canceladas ({cancelledList.length})</summary>
                <p className="mt-2 text-black/60">Não contam para o stock. Se o cliente enviar o comprovativo, «Confirmar pagamento» volta a pôr a reserva activa, se o stock chegar.</p>
                <ul className="mt-2 grid gap-2">
                  {cancelledList.map((item) => (
                    <li key={item.id} className="grid gap-1 border-t border-black/10 pt-2">
                      <p className="font-bold">{item.ref} · {item.name}{item.trial ? " · Ensaio" : ""}</p>
                      <p>{item.phone} · {item.email}</p>
                      <p>{lineLabel(item.lines)}{item.depositLabel ? ` · 50%: ${item.depositLabel}` : ""}{item.pay ? ` · ${item.pay}` : ""}</p>
                      <p className="text-black/60">
                        Cancelada {item.cancelledAt ? new Date(item.cancelledAt).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""} · {item.cancelReason === "manual" ? "à mão" : "automática: sem comprovativo em 24 h"}
                        {item.cancelEmailed ? " · Email ao cliente enviado." : " · Email ao cliente por enviar."}
                        {item.reminderAt ? (item.reminderEmailed ? " · Lembrete enviado." : " · Lembrete não saiu.") : ""}
                      </p>
                      <ProofBlock code={code} refCode={item.ref} proofs={proofs} paidAt={item.paidAt} status={item.proofStatus} onError={setError} onRejected={() => void load(code)} />
                      {item.proofStatus === "sent" || item.paidAt ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await luvConfirmReserve({ data: { code, id: item.id } });
                            if (!res.ok) {
                              setError("error" in res && res.error === "stock" ? `Não há stock suficiente para reativar a ${item.ref}.` : "Não foi possível confirmar.");
                              return;
                            }
                            setNotice(`Reserva ${item.ref} reativada e paga.`);
                            void load(code);
                          }}
                          className="w-fit bg-black px-3 py-2 font-bold text-white"
                        >
                          Confirmar pagamento
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}
        {tab === "visits" ? (
          <section className="grid gap-6">
            <div>
              <p className="text-3xl font-bold tabular-nums">{visits.total}</p>
              <p className="mt-1 max-w-xl text-sm text-white/70">Visitas reais à loja, uma por pessoa por dia. O país e a cidade vêm do endereço de internet. Desconhecido significa que a localização não foi obtida.</p>
            </div>
            <div className="grid gap-8 sm:grid-cols-2">
              <div>
                <h2 className="mb-2 text-sm font-bold tracking-[0.16em] uppercase">País</h2>
                <ul>
                  {visits.countries.map((row) => (
                    <li key={row.country} className="flex items-baseline justify-between gap-6 border-t border-white/15 py-2">
                      <span>{row.country}</span>
                      <span className="tabular-nums font-bold">{row.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="mb-2 text-sm font-bold tracking-[0.16em] uppercase">Cidade</h2>
                <ul>
                  {visits.cities.map((row) => (
                    <li key={`${row.country}-${row.city}`} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 border-t border-white/15 py-2">
                      <span>{row.city}</span>
                      <span className="text-white/55">{row.country}</span>
                      <span className="tabular-nums font-bold">{row.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}
        {tab === "coupons" ? (
          <section className="grid gap-3">
            <form onSubmit={createCoupon} className="grid gap-2 sm:grid-cols-[1fr_6rem_auto]">
              <input value={coupon} onChange={(event) => setCoupon(event.target.value.toUpperCase())} placeholder="CÓDIGO" aria-label="Código do cupão" className="border border-white bg-black px-3 py-3 uppercase" />
              <input value={percent} onChange={(event) => setPercent(event.target.value)} inputMode="numeric" aria-label="Percentagem" className="border border-white bg-black px-3 py-3" />
              <button className="bg-white px-4 py-3 font-bold text-black">Criar</button>
            </form>
            <ul className="grid gap-2">
              {coupons.map((item) => (
                <li key={item.code} className="bg-white px-3 py-2 font-bold text-black">{item.code} · {item.percent}%</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
