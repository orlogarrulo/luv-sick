import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PRODUCTS, SIZES } from "@/lib/luvsick";
import { luvAckOrder, luvDesk, luvIssueReceipt, luvMarkReservations, luvResendReserve, luvSaveCoupon, luvSetStock, luvSetStockIn } from "@/server/fns";

type Stock = { productId: string; size: string; qty: number };
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
};
type Visits = { total: number; countries: { country: string; n: number }[]; cities: { country: string; city: string; n: number }[] };
type Coupon = { code: string; percent: number; active: boolean };
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
};

const RECEIVED_ALL = `Olá,

Recebemos a tua reserva na Luv Sick.
Pagaste 50%. O recibo e a fatura dos outros 50% seguem por email.
Os outros 50% pagam-se no dia do recebimento, data a combinar.
As entregas começam a 15 de dezembro.

Luv Sick`;

const STOCK_ALL = `Olá,

A tua reserva já pode ser entregue.
O restante de 50% paga-se no dia do recebimento, data a combinar.

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
    ? `Pago agora (50%): ${item.depositLabel}\nRestante (50%): ${item.balanceLabel}\nData de pagamento do restante: a combinar, no dia do recebimento.`
    : "Os outros 50% pagam-se no dia do recebimento, data a combinar.";
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
  const [stockIn, setStockIn] = useState(false);
  const [copied, setCopied] = useState("");
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
    setNotice(result === "granted" ? "Avisos ligados neste aparelho." : "Os avisos ficam só dentro da gestão.");
  }

  async function saveQty(row: Stock) {
    const qty = Number(draft[`${row.productId}|${row.size}`] ?? row.qty);
    const res = await luvSetStock({ data: { code, productId: row.productId, size: row.size, qty } });
    if (!res.ok) return;
    setStock((current) => current.map((item) => (item.productId === row.productId && item.size === row.size ? { ...item, qty: res.qty } : item)));
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
          <Link to="/" className="text-sm underline">Loja</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["stock", "orders", "visits", "coupons", "reserves"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setTab(item)} className={`px-3 py-2 text-sm font-bold ${tab === item ? "bg-white text-black" : "ring-1 ring-white"}`}>
              {item === "stock" ? "Stock" : item === "orders" ? `Encomendas${unseen.length ? ` (${unseen.length})` : ""}` : item === "visits" ? "Visitas" : item === "coupons" ? "Cupões" : `Reservas${reservations.length ? ` (${reservations.length})` : ""}`}
            </button>
          ))}
          <button type="button" onClick={allowNotices} className="px-3 py-2 text-sm font-bold ring-1 ring-white">Avisos</button>
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
                  return (
                    <label key={size} className="flex items-center gap-2 text-sm">
                      <span className="w-8 font-bold">{size}</span>
                      <input
                        inputMode="numeric"
                        value={draft[key] ?? String(row?.qty ?? 0)}
                        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                        className="w-20 border border-black px-2 py-2"
                      />
                      <button type="button" onClick={() => row && saveQty(row)} className="bg-black px-3 py-2 font-bold text-white">Guardar</button>
                      {(row?.qty ?? 0) === 0 ? <span>Sem venda</span> : null}
                    </label>
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
                const note = personalMessage(stockIn ? "stock" : "received", item);
                const qty = item.lines.reduce((sum, line) => sum + line.qty, 0);
                return (
                  <li key={item.id} className="grid gap-2 bg-white p-3 text-sm text-black">
                    <p className="font-bold">{item.ref} · {item.name}{item.trial ? " · Ensaio" : ""}</p>
                    <p>{item.phone} · {item.email}</p>
                    <p>{lineLabel(item.lines)} · {qty}</p>
                    {item.depositLabel ? <p>Pago 50%: {item.depositLabel}{item.pay ? ` · ${item.pay}` : ""}</p> : null}
                    {item.balanceLabel ? <p>Fatura 50%: {item.balanceLabel} · a combinar, no dia do recebimento</p> : null}
                    <p className="text-black/60">{item.receivedSent ? "Receção enviada. " : ""}{item.stockSent ? "Lembrete de stock enviado. " : ""}{item.emailed ? "Email enviado." : "Email por enviar."}</p>
                    <pre className="whitespace-pre-wrap font-sans">{note}</pre>
                    <a href={`https://wa.me/${waDigits(item.phone)}?text=${encodeURIComponent(note)}`} target="_blank" rel="noreferrer" className="font-bold underline">WhatsApp desta pessoa</a>
                    {item.receiptNo ? <a href={`/recibo/${item.ref}`} className="font-bold underline">{item.receiptNo} · {item.invoiceNo}</a> : null}
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
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {tab === "visits" ? (
          <section className="grid gap-4">
            <p className="text-3xl font-bold">{visits.total}</p>
            <p className="text-sm text-white/70">Visitas dos últimos acessos, uma por pessoa por dia.</p>
            <div>
              <h2 className="mb-2 font-bold">País</h2>
              <ul>{visits.countries.map((row) => <li key={row.country}>{row.country}: {row.n}</li>)}</ul>
            </div>
            <div>
              <h2 className="mb-2 font-bold">Cidade</h2>
              <ul>{visits.cities.map((row) => <li key={`${row.country}-${row.city}`}>{row.city}, {row.country}: {row.n}</li>)}</ul>
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
