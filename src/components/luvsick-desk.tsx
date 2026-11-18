import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { PRODUCTS, SIZES } from "@/lib/luvsick";
import { luvDesk, luvSaveCoupon, luvSetStock } from "@/server/fns";

type Stock = { productId: string; size: string; qty: number };
type Order = { id: string; ref: string; name: string; phone: string; city: string; country?: string; postal?: string; pay: string; totalLabel: string; coupon?: string };
type Visits = { total: number; countries: { country: string; n: number }[]; cities: { country: string; city: string; n: number }[] };
type Coupon = { code: string; percent: number; active: boolean };

const KEY = "luvsick-desk";

export function LuvSickDesk() {
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<"stock" | "orders" | "visits" | "coupons">("stock");
  const [stock, setStock] = useState<Stock[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [visits, setVisits] = useState<Visits>({ total: 0, countries: [], cities: [] });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [coupon, setCoupon] = useState("");
  const [percent, setPercent] = useState("10");
  const [ready, setReady] = useState(false);

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
    setError("");
    setReady(true);
  }

  async function saveQty(row: Stock) {
    const qty = Number(draft[`${row.productId}|${row.size}`] ?? row.qty);
    const res = await luvSetStock({ data: { code, productId: row.productId, size: row.size, qty } });
    if (!res.ok) return;
    setStock((current) => current.map((item) => (item.productId === row.productId && item.size === row.size ? { ...item, qty: res.qty } : item)));
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
          {(["stock", "orders", "visits", "coupons"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setTab(item)} className={`px-3 py-2 text-sm font-bold ${tab === item ? "bg-white text-black" : "ring-1 ring-white"}`}>
              {item === "stock" ? "Stock" : item === "orders" ? "Encomendas" : item === "visits" ? "Visitas" : "Cupões"}
            </button>
          ))}
        </div>
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
              <li key={order.id} className="bg-white p-3 text-sm text-black">
                <p className="font-bold">{order.ref} · {order.totalLabel}</p>
                <p>{order.name} · {order.phone} · {order.postal} {order.city} · {order.country}</p>
                <p>{order.pay}{order.coupon ? ` · ${order.coupon}` : ""}</p>
              </li>
            ))}
          </ul>
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
