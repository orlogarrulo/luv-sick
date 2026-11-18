import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { CarriersDesk, DeliveriesDesk, DeliveryReportDesk, ReconcileDesk } from "@/components/delivery-desk";
import { PinLogo, Wordmark } from "@/components/logo";
import { LangSwitch, ThemeSwitch, useI18n, type MsgKey } from "@/lib/i18n";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { formatKz } from "@/lib/pricing";
import type { AdminProduct, AuditRow, OrderSummary, PromoSuggestion, Staff, StaffRole } from "@/lib/shop-types";
import {
  activatePromo,
  adminOrders,
  adminProducts,
  advanceOrder,
  createCoupon,
  createDiscount,
  listAudit,
  listDeliveryWindows,
  listFeedback,
  report,
  setAutoPromos,
  staffLogin,
  staffLogout,
  staffMe,
  staffVerify,
  suggestions,
  saveDeliveryWindow,
  deleteDeliveryWindow,
  updatePrice,
  updateStock,
  warmup,
} from "@/server/fns";

const STAFF_KEY = "ct-staff";

type Tab = "overview" | "stock" | "prices" | "orders" | "deliveries" | "carriers" | "delReport" | "reconcile" | "promos" | "discounts" | "slots" | "messages" | "audit";

const ACCOUNTS: { email: string; role: StaffRole }[] = [
  { email: "gestao@compratudo.ao", role: "admin" },
  { email: "stock@compratudo.ao", role: "stock_manager" },
  { email: "financeiro@compratudo.ao", role: "finance" },
  { email: "operacao@compratudo.ao", role: "operator" },
];

function can(role: StaffRole, tab: Tab) {
  if (role === "admin") return true;
  if (tab === "overview") return true;
  if (tab === "stock") return role === "stock_manager";
  if (tab === "prices" || tab === "promos" || tab === "discounts" || tab === "audit" || tab === "delReport" || tab === "reconcile") {
    return role === "finance";
  }
  if (tab === "orders" || tab === "slots" || tab === "messages") return role === "operator";
  if (tab === "deliveries") return role === "operator" || role === "finance";
  return false;
}

export function AdminApp() {
  const { t, lang } = useI18n();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [challenge, setChallenge] = useState<{ id: string; code: string } | null>(null);
  const [email, setEmail] = useState(ACCOUNTS[0].email);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    warmup()
      .then(() => staffMe({ data: { token: localStorage.getItem(STAFF_KEY) ?? "" } }))
      .then((res) => setStaff(res.staff))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-blue text-on-blue">
        <div className="grid justify-items-center gap-3">
          <PinLogo inverse className="h-20 w-auto" />
          <Wordmark className="h-7 w-auto text-white" />
        </div>
      </main>
    );
  }

  if (!staff) {
    return (
      <main className="min-h-dvh bg-paper px-4 py-8 text-ink">
        <div className="mx-auto grid max-w-md grid-cols-[minmax(0,1fr)] gap-4">
          <div className="flex items-center gap-3">
            <PinLogo className="h-12 w-auto shrink-0" />
            <span className="grid min-w-0 gap-1">
              <Wordmark className="h-5 w-auto max-w-full self-start text-blue" />
              <span className="text-[11px] tracking-wide text-blue">{t("tagline")}</span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <h1 className="min-w-0 text-3xl sm:text-4xl">{t("adminTitle")}</h1>
            <div className="flex items-center gap-2">
              <ThemeSwitch />
              <LangSwitch />
            </div>
          </div>
          <p className="text-sm">{t("demoBanner")}</p>
          <AccessLinks />
          <ul className="grid gap-1 text-sm">
            {ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button type="button" className="text-blue" onClick={() => setEmail(account.email)}>
                  {account.email} · {account.role}
                </button>
              </li>
            ))}
          </ul>
          {challenge ? (
            <form
              className="grid gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const res = await staffVerify({ data: { challengeId: challenge.id, code } });
                if (!res.ok) {
                  setError(t("otpError"));
                  return;
                }
                localStorage.setItem(STAFF_KEY, res.token);
                setStaff(res.staff);
              }}
            >
              <h2 className="text-2xl">{t("twoFactor")}</h2>
              <p className="text-sm">{t("twoFactorHelp")}</p>
              <p className="font-display text-3xl tabular-nums tracking-widest">{challenge.code}</p>
              <input value={code} onChange={(e) => setCode(e.target.value)} className="rounded-md border border-line bg-card px-3 py-3" inputMode="numeric" />
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <button className="rounded-full bg-gold px-4 py-3 font-semibold text-on-gold">{t("verify")}</button>
            </form>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setError("");
                const res = await staffLogin({ data: { email, password } });
                if (!res.ok) {
                  setError(res.error === "locked" ? t("locked") : t("wrongLogin"));
                  return;
                }
                setChallenge({ id: res.challengeId, code: res.demoCode });
              }}
            >
              <label className="grid gap-1 text-sm font-semibold">
                {t("email")}
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-md border border-line bg-card px-3 py-3 font-normal" />
              </label>
              <div className="grid gap-1 text-sm font-semibold">
                <span>{t("password")}</span>
                <span className="relative block">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-label={t("password")}
                    className="w-full rounded-md border border-line bg-card px-3 py-3 pr-14 font-normal"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center text-ink"
                  >
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </span>
              </div>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <button className="rounded-full bg-gold px-4 py-3 font-semibold text-on-gold">{t("enter")}</button>
            </form>
          )}
          <Link to="/" className="text-sm text-blue">{t("backShop")}</Link>
        </div>
      </main>
    );
  }

  const groups: { title: MsgKey; items: { id: Tab; key: MsgKey }[] }[] = [
    {
      title: "areaStore",
      items: [
        { id: "stock", key: "navStock" },
        { id: "prices", key: "navPrices" },
        { id: "promos", key: "navPromos" },
        { id: "discounts", key: "navDiscounts" },
      ],
    },
    {
      title: "areaOrders",
      items: [
        { id: "orders", key: "navOrders" },
        { id: "slots", key: "navSlots" },
        { id: "messages", key: "navMessages" },
      ],
    },
    {
      title: "areaDelivery",
      items: [
        { id: "deliveries", key: "navDeliveries" },
        { id: "carriers", key: "navCarriers" },
        { id: "delReport", key: "navDelReport" },
        { id: "reconcile", key: "navReconcile" },
      ],
    },
    {
      title: "areaControl",
      items: [
        { id: "overview", key: "navOverview" },
        { id: "audit", key: "navAudit" },
      ],
    },
  ];

  return (
    <main className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-line bg-paper text-ink">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <PinLogo className="h-12 w-auto shrink-0" />
          <div className="grid min-w-0 gap-1">
            <Wordmark className="h-5 w-auto max-w-full self-start text-blue" />
            <p className="text-sm text-muted">{staff.name} · {t("role")} {staff.role}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ThemeSwitch />
            <LangSwitch />
            <button
              type="button"
              className="rounded-full bg-gold px-4 py-2 text-sm text-on-gold"
              onClick={async () => {
                await staffLogout({ data: { token: localStorage.getItem(STAFF_KEY) ?? "" } });
                localStorage.removeItem(STAFF_KEY);
                setStaff(null);
              }}
            >
              {t("signOutSession")}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-4">
        <p className="rounded-md bg-gold/50 px-3 py-2 text-sm">{t("demoBanner")}</p>
        <div className="mt-3">
          <AccessLinks />
        </div>
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <nav className="grid content-start gap-3">
            {groups.map((group) => {
              const items = group.items.filter((item) => can(staff.role, item.id));
              if (items.length === 0) return null;
              return (
                <section key={group.title} className="rounded-2xl border border-line bg-card p-3">
                  <h2 className="px-1 text-sm text-muted">{t(group.title)}</h2>
                  <div className="mt-2 grid gap-1">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        className={`rounded-xl px-3 py-2 text-left text-sm ${tab === item.id ? "bg-blue text-on-blue" : "hover:bg-blue-soft"}`}
                      >
                        {t(item.key)}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </nav>
          <div>
            {tab === "overview" ? <Overview /> : null}
            {tab === "stock" ? <StockDesk /> : null}
            {tab === "prices" ? <PriceDesk /> : null}
            {tab === "orders" ? <OrdersDesk lang={lang} /> : null}
            {tab === "slots" ? <SlotsDesk /> : null}
            {tab === "messages" ? <MessagesDesk /> : null}
            {tab === "deliveries" ? <DeliveriesDesk role={staff.role} /> : null}
            {tab === "carriers" ? <CarriersDesk /> : null}
            {tab === "delReport" ? <DeliveryReportDesk /> : null}
            {tab === "reconcile" ? <ReconcileDesk /> : null}
            {tab === "promos" ? <PromoDesk role={staff.role} /> : null}
            {tab === "discounts" ? <DiscountDesk /> : null}
            {tab === "audit" ? <AuditDesk /> : null}
          </div>
        </div>
        <Link to="/" className="mt-8 inline-block text-sm text-blue">{t("backShop")}</Link>
      </div>
    </main>
  );
}

function token() {
  return localStorage.getItem(STAFF_KEY) ?? "";
}

function accessUrl(path: string) {
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${window.location.origin}${prefix}${path}`;
}

function AccessLinks() {
  const { t } = useI18n();
  const [copied, setCopied] = useState("");
  const [links, setLinks] = useState([
    { id: "clientes", label: "", href: "/clientes" },
    { id: "gestao", label: "", href: "/gestao" },
  ]);
  useEffect(() => {
    setLinks([
      { id: "clientes", label: t("linkCustomers"), href: accessUrl("/clientes") },
      { id: "gestao", label: t("linkStaff"), href: accessUrl("/gestao") },
    ]);
  }, [t]);
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-line bg-card p-3 text-ink">
      <h2 className="font-sans text-base font-semibold">{t("accessTitle")}</h2>
      {links.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <a href={item.href} className="min-w-0 flex-1 truncate text-sm text-blue">
            {item.label || item.id}: {item.href}
          </a>
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-full bg-blue px-3 text-sm font-semibold text-on-blue"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(item.href);
              } catch {
                /* o link continua visível para copiar à mão */
              }
              setCopied(item.id);
            }}
          >
            {copied === item.id ? t("copied") : t("copyLink")}
          </button>
        </div>
      ))}
    </section>
  );
}

function MessagesDesk() {
  const { t } = useI18n();
  const [items, setItems] = useState<{ id: string; kind: string; orderRef: string; name: string; phone: string; body: string; createdAt: string }[]>([]);
  useEffect(() => {
    listFeedback({ data: { token: localStorage.getItem(STAFF_KEY) ?? "" } }).then((res) => {
      if (res.ok) setItems(res.items);
    });
  }, []);
  return (
    <div className="grid gap-3">
      <h2 className="text-2xl">{t("navMessages")}</h2>
      {items.length === 0 ? <p className="text-muted">{t("noMessages")}</p> : null}
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-line bg-card p-4">
          <p className="text-sm font-semibold text-blue">{item.kind === "complaint" ? t("complaint") : t("suggestion")} · {item.orderRef || "—"}</p>
          <p className="mt-1 font-semibold">{item.name} · {item.phone}</p>
          <p className="mt-2">{item.body}</p>
        </article>
      ))}
    </div>
  );
}

function SlotsDesk() {
  const { t } = useI18n();
  const [windows, setWindows] = useState<{ id: string; label: string; weekday: number; startMin: number; endMin: number; capacity: number; active: boolean }[]>([]);
  const [weekday, setWeekday] = useState(7);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("12:00");
  const [capacity, setCapacity] = useState(8);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const days = [t("dayAll"), t("daySun"), t("dayMon"), t("dayTue"), t("dayWed"), t("dayThu"), t("dayFri"), t("daySat")];
  async function load() {
    const res = await listDeliveryWindows({ data: { token: localStorage.getItem(STAFF_KEY) ?? "" } });
    if (res.ok) setWindows(res.windows);
  }
  useEffect(() => {
    void load();
  }, []);
  function minutes(value: string) {
    const [hour, minute] = value.split(":").map((part) => Number(part));
    return hour * 60 + minute;
  }
  return (
    <div className="grid gap-4">
      <h2 className="text-2xl">{t("navSlots")}</h2>
      <p className="text-sm text-muted">{t("slotAdminNote")}</p>
      <form
        className="grid gap-2 rounded-xl border border-line bg-card p-4 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const res = await saveDeliveryWindow({
            data: {
              token: localStorage.getItem(STAFF_KEY) ?? "",
              label,
              weekday,
              startMin: minutes(start),
              endMin: minutes(end),
              capacity,
              active: true,
            },
          });
          setError(res.ok ? "" : t("slotInvalid"));
          if (res.ok) {
            setLabel("");
            await load();
          }
        }}
      >
        <label className="text-sm">{t("slotDay")}
          <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2">
            <option value={7}>{days[0]}</option>
            {days.slice(1).map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select>
        </label>
        <label className="text-sm">{t("slotName")}
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="10:00–12:00" className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2" />
        </label>
        <label className="text-sm">{t("slotFrom")}
          <input type="time" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2" />
        </label>
        <label className="text-sm">{t("slotTo")}
          <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2" />
        </label>
        <label className="text-sm">{t("slotCapacity")}
          <input type="number" min={1} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2" />
        </label>
        <button className="self-end rounded-full bg-blue px-4 py-2 text-sm font-semibold text-on-blue">{t("slotSave")}</button>
      </form>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <ul className="grid gap-2">
        {windows.map((window) => (
          <li key={window.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2">
            <span>{days[window.weekday === 7 ? 0 : window.weekday + 1]} · {window.label} · {t("slotLeft", { n: window.capacity })}</span>
            <button type="button" className="text-sm font-semibold text-danger" onClick={async () => { await deleteDeliveryWindow({ data: { token: localStorage.getItem(STAFF_KEY) ?? "", id: window.id } }); await load(); }}>{t("slotRemove")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Overview() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Awaited<ReturnType<typeof report>> | null>(null);
  useEffect(() => {
    report({ data: { token: token() } }).then(setData);
  }, []);
  if (!data || !data.ok) return <p>{data && !data.ok ? t("forbidden") : t("preparing")}</p>;
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <Stat label={t("revenue")} value={data.orders === 0 ? "—" : formatKz(data.revenue, lang)} />
      <Stat label={t("margin")} value={data.orders === 0 ? "—" : formatKz(data.margin, lang)} />
      <Stat label={t("stockouts")} value={String(data.stockouts)} />
      <div className="sm:col-span-3">
        <h2 className="text-2xl">{t("top")}</h2>
        {data.top.length === 0 ? <p className="text-sm text-muted">{t("noSalesYet")}</p> : (
          <ul className="mt-2 grid gap-1">
            {data.top.map((item) => (
              <li key={item.name} className="flex justify-between rounded-md bg-card px-3 py-2 text-sm ring-1 ring-line">
                <span>{item.name}</span>
                <span className="tabular-nums">{item.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg bg-card p-4 ring-1 ring-line">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display text-3xl tabular-nums">{value}</p>
    </article>
  );
}

function ProductTools({ mode }: { mode: "stock" | "price" }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { stock: string; reason: string; price: string; cost: string; margin: string }>>({});

  async function load(nextOffset = offset, query = q) {
    const res = await adminProducts({ data: { token: token(), q: query, offset: nextOffset } });
    if (!res.ok) {
      setMessage(t("forbidden"));
      return;
    }
    setRows(res.products);
    setTotal(res.total);
    const next: typeof drafts = {};
    for (const row of res.products) {
      next[row.sku] = {
        stock: String(row.stock),
        reason: "",
        price: row.priceAoa == null ? "" : String(row.priceAoa),
        cost: row.costAoa == null ? "" : String(row.costAoa),
        margin: String(row.minMarginPct),
      };
    }
    setDrafts(next);
  }

  useEffect(() => {
    void load(0, "");
    // initial page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          void load(0, q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchAdmin")} className="flex-1 rounded-full border border-line bg-card px-4 py-3" />
        <button className="rounded-full bg-blue px-4 text-sm font-semibold text-on-blue">{t("seeCatalog")}</button>
      </form>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      <div className="mt-4 grid gap-3">
        {rows.map((row) => {
          const draft = drafts[row.sku];
          if (!draft) return null;
          return (
            <article key={row.sku} className="rounded-lg bg-card p-3 ring-1 ring-line">
              <p className="text-xs text-muted">{row.sku} · {row.categoryName} · {row.priority}</p>
              <h3 className="font-sans text-base font-semibold">{row.name}</h3>
              <p className="text-sm text-muted">{row.brand} · {row.format}</p>
              {mode === "stock" ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
                  <input value={draft.stock} onChange={(e) => setDrafts({ ...drafts, [row.sku]: { ...draft, stock: e.target.value } })} inputMode="numeric" className="rounded-md border border-line px-3 py-2" aria-label={t("navStock")} />
                  <input value={draft.reason} onChange={(e) => setDrafts({ ...drafts, [row.sku]: { ...draft, reason: e.target.value } })} placeholder={t("reason")} className="rounded-md border border-line px-3 py-2" />
                  <button
                    type="button"
                    className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-on-gold"
                    onClick={async () => {
                      const res = await updateStock({
                        data: { token: token(), sku: row.sku, stock: Number(draft.stock), reason: draft.reason },
                      });
                      setMessage(res.ok ? t("saved") : t(res.error === "forbidden" ? "forbidden" : "reason"));
                      if (res.ok) void load();
                    }}
                  >
                    {t("save")}
                  </button>
                </div>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <label className="text-xs">{t("price")}
                    <input value={draft.price} onChange={(e) => setDrafts({ ...drafts, [row.sku]: { ...draft, price: e.target.value } })} className="mt-1 w-full rounded-md border border-line px-2 py-2" />
                  </label>
                  <label className="text-xs">{t("cost")}
                    <input value={draft.cost} onChange={(e) => setDrafts({ ...drafts, [row.sku]: { ...draft, cost: e.target.value } })} className="mt-1 w-full rounded-md border border-line px-2 py-2" />
                  </label>
                  <label className="text-xs">{t("minMargin")}
                    <input value={draft.margin} onChange={(e) => setDrafts({ ...drafts, [row.sku]: { ...draft, margin: e.target.value } })} className="mt-1 w-full rounded-md border border-line px-2 py-2" />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="w-full rounded-full bg-gold px-3 py-2 text-sm font-semibold text-on-gold"
                      onClick={async () => {
                        const res = await updatePrice({
                          data: {
                            token: token(),
                            sku: row.sku,
                            priceAoa: Number(draft.price),
                            costAoa: Number(draft.cost),
                            minMarginPct: Number(draft.margin),
                          },
                        });
                        if (!res.ok && res.error === "margin") {
                          setMessage(t("marginRefuse", { floor: formatKz(res.floor ?? 0, lang) }));
                          return;
                        }
                        setMessage(res.ok ? t("saved") : t("forbidden"));
                        if (res.ok) void load();
                      }}
                    >
                      {t("save")}
                    </button>
                  </div>
                  <p className="text-xs text-muted sm:col-span-4">{t("floor")}: {row.floorAoa == null ? "—" : formatKz(row.floorAoa, lang)} · {t("navStock")} {row.stock}</p>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <button type="button" disabled={offset === 0} className="disabled:opacity-40" onClick={() => { const next = Math.max(0, offset - 40); setOffset(next); void load(next); }}>{t("back")}</button>
        <span className="tabular-nums">{t("page")} {Math.floor(offset / 40) + 1} {t("of")} {Math.max(1, Math.ceil(total / 40))}</span>
        <button type="button" disabled={offset + 40 >= total} className="disabled:opacity-40" onClick={() => { const next = offset + 40; setOffset(next); void load(next); }}>{t("enter")}</button>
      </div>
    </section>
  );
}

function StockDesk() {
  return <ProductTools mode="stock" />;
}
function PriceDesk() {
  return <ProductTools mode="price" />;
}

function OrdersDesk({ lang }: { lang: "pt" | "fr" | "en" }) {
  const { t } = useI18n();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [message, setMessage] = useState("");
  const [extra, setExtra] = useState<Record<string, { courier: string; cash: string; reason: string }>>({});

  async function load() {
    const res = await adminOrders({ data: { token: token() } });
    if (!res.ok) {
      setMessage(t("forbidden"));
      return;
    }
    setOrders(res.orders);
    const next = { ...extra };
    for (const order of res.orders) {
      next[order.id] ??= { courier: order.courierName ?? "", cash: String(order.totalAoa), reason: "" };
    }
    setExtra(next);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel = (status: string) => {
    if (status === "preparing") return t("statusPreparing");
    if (status === "on_the_way") return t("statusWay");
    if (status === "delivered") return t("statusDelivered");
    if (status === "cancelled") return t("statusCancelled");
    return t("statusReceived");
  };

  return (
    <section className="grid gap-3">
      {message ? <p className="text-sm">{message}</p> : null}
      {orders.length === 0 ? <p>{t("none")}</p> : null}
      {orders.map((order) => {
        const fields = extra[order.id] ?? { courier: "", cash: "", reason: "" };
        return (
          <article key={order.id} className="rounded-lg bg-card p-4 ring-1 ring-line">
            <h3 className="font-sans text-lg font-semibold">CT-{order.number} · {statusLabel(order.status)}</h3>
            <p className="text-sm text-muted">{order.addressLabel} · {order.paymentMethod} · {formatKz(order.totalAoa, lang)}</p>
            <ul className="mt-2 text-sm">
              {order.items.map((item) => (
                <li key={item.sku}>{item.qty} × {item.name}</li>
              ))}
            </ul>
            {order.status !== "delivered" && order.status !== "cancelled" ? (
              <div className="mt-3 grid gap-2">
                <input value={fields.courier} onChange={(e) => setExtra({ ...extra, [order.id]: { ...fields, courier: e.target.value } })} placeholder={t("courier")} className="rounded-md border border-line px-3 py-2" />
                {order.paymentMethod === "cash" && order.status === "on_the_way" ? (
                  <input value={fields.cash} onChange={(e) => setExtra({ ...extra, [order.id]: { ...fields, cash: e.target.value } })} placeholder={t("cashIn")} className="rounded-md border border-line px-3 py-2" />
                ) : null}
                <input value={fields.reason} onChange={(e) => setExtra({ ...extra, [order.id]: { ...fields, reason: e.target.value } })} placeholder={t("reason")} className="rounded-md border border-line px-3 py-2" />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-on-gold"
                    onClick={async () => {
                      const res = await advanceOrder({
                        data: {
                          token: token(),
                          orderId: order.id,
                          courierName: fields.courier,
                          cashReceived: Number(fields.cash),
                        },
                      });
                      setMessage(res.ok ? t("saved") : t(res.error === "cash" ? "cashIn" : res.error === "forbidden" ? "forbidden" : "reason"));
                      if (res.ok) void load();
                    }}
                  >
                    {t("nextStatus")}
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-danger px-4 py-2 text-sm font-semibold text-danger"
                    onClick={async () => {
                      const res = await advanceOrder({
                        data: { token: token(), orderId: order.id, cancel: true, cancelReason: fields.reason },
                      });
                      setMessage(res.ok ? t("saved") : t("reason"));
                      if (res.ok) void load();
                    }}
                  >
                    {t("cancelOrder")}
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function PromoDesk({ role }: { role: StaffRole }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<PromoSuggestion[]>([]);
  const [auto, setAuto] = useState(false);
  const [message, setMessage] = useState("");
  const [sku, setSku] = useState("");
  const [percent, setPercent] = useState("10");

  async function load() {
    const res = await suggestions({ data: { token: token() } });
    if (!res.ok) {
      setMessage(t("forbidden"));
      return;
    }
    setRows(res.suggestions);
    setAuto(res.auto);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="grid gap-4">
      <p className="text-sm text-muted">{t("autoHelp")}</p>
      {role === "admin" ? (
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={auto}
            onChange={async (event) => {
              const res = await setAutoPromos({ data: { token: token(), on: event.target.checked } });
              if (res.ok) void load();
            }}
          />
          {t("auto")}
        </label>
      ) : null}
      {message ? <p className="text-sm">{message}</p> : null}
      {rows.length === 0 ? <p>{t("none")}</p> : null}
      {rows.map((row) => (
        <article key={row.sku + row.origin} className="rounded-lg bg-card p-4 ring-1 ring-line">
          <h3 className="font-sans text-base font-semibold">{row.name}</h3>
          <p className="text-sm text-muted">{row.sku} · {row.stock} {t("units")} · {formatKz(row.priceAoa, lang)}</p>
          {row.origin === "overstock" && row.coverageDays != null ? <p className="text-sm">{t("coverage", { days: row.coverageDays })}</p> : null}
          {row.origin === "near_expiry" && row.expiry ? <p className="text-sm">{t("near", { date: row.expiry })}</p> : null}
          {!row.viable ? <p className="text-sm text-danger">{t("notViable")}</p> : null}
          {role === "admin" || role === "finance" ? (
            <button
              type="button"
              disabled={!row.viable}
              className="mt-2 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-on-gold disabled:opacity-40"
              onClick={async () => {
                const res = await activatePromo({
                  data: { token: token(), sku: row.sku, percent: row.suggestedPercent, origin: row.origin },
                });
                if (!res.ok && res.error === "margin") setMessage(t("marginRefuse", { floor: formatKz(res.floor ?? row.floorAoa, lang) }));
                else setMessage(res.ok ? t("saved") : t("forbidden"));
                if (res.ok) void load();
              }}
            >
              {t("activate", { pct: row.suggestedPercent })}
            </button>
          ) : null}
        </article>
      ))}
      {role === "admin" || role === "finance" ? (
        <form
          className="grid gap-2 rounded-lg bg-card p-4 ring-1 ring-line sm:grid-cols-[1fr_6rem_auto]"
          onSubmit={async (event) => {
            event.preventDefault();
            const res = await activatePromo({
              data: { token: token(), sku: sku.trim(), percent: Number(percent), origin: "manual" },
            });
            if (!res.ok && res.error === "margin") setMessage(t("marginRefuse", { floor: formatKz(res.floor ?? 0, lang) }));
            else setMessage(res.ok ? t("saved") : t(res.error === "forbidden" ? "forbidden" : "sku"));
            if (res.ok) void load();
          }}
        >
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder={t("sku")} className="rounded-md border border-line px-3 py-2" />
          <input value={percent} onChange={(e) => setPercent(e.target.value)} aria-label={t("manualPromo")} className="rounded-md border border-line px-3 py-2" />
          <button className="rounded-full bg-blue px-4 py-2 text-sm font-semibold text-on-blue">{t("manualPromo")}</button>
        </form>
      ) : null}
    </section>
  );
}

function DiscountDesk() {
  const { t, lang } = useI18n();
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("10");
  const [scope, setScope] = useState<"order" | "category" | "product">("order");
  const [scopeRef, setScopeRef] = useState("");
  const [days, setDays] = useState("14");
  const [reason, setReason] = useState("");
  const [singleUse, setSingleUse] = useState(true);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="grid gap-2 rounded-lg bg-card p-4 ring-1 ring-line"
        onSubmit={async (event) => {
          event.preventDefault();
          const res = await createDiscount({
            data: {
              token: token(),
              phone,
              kind,
              value: Number(value),
              scope,
              scopeRef,
              singleUse,
              days: Number(days),
              reason,
            },
          });
          if (!res.ok && res.error === "margin") setMessage(t("marginRefuse", { floor: formatKz(res.floor ?? 0, lang) }));
          else setMessage(res.ok ? t("created") : t(res.error === "forbidden" ? "forbidden" : "phoneError"));
        }}
      >
        <h2 className="text-2xl">{t("discountTitle")}</h2>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("customerPhone")} className="rounded-md border border-line px-3 py-2" />
        <select value={kind} onChange={(e) => setKind(e.target.value === "amount" ? "amount" : "percent")} className="rounded-md border border-line bg-card px-3 py-2">
          <option value="percent">{t("percent")}</option>
          <option value="amount">{t("amount")}</option>
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} className="rounded-md border border-line px-3 py-2" />
        <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="rounded-md border border-line bg-card px-3 py-2">
          <option value="order">{t("scopeOrder")}</option>
          <option value="category">{t("scopeCategory")}</option>
          <option value="product">{t("scopeProduct")}</option>
        </select>
        {scope !== "order" ? <input value={scopeRef} onChange={(e) => setScopeRef(e.target.value)} placeholder={t("sku")} className="rounded-md border border-line px-3 py-2" /> : null}
        <input value={days} onChange={(e) => setDays(e.target.value)} aria-label={t("days")} className="rounded-md border border-line px-3 py-2" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reason")} className="rounded-md border border-line px-3 py-2" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} />
          {t("singleUse")}
        </label>
        <button className="rounded-full bg-gold px-4 py-3 font-semibold text-on-gold">{t("create")}</button>
      </form>
      <form
        className="grid content-start gap-2 rounded-lg bg-card p-4 ring-1 ring-line"
        onSubmit={async (event) => {
          event.preventDefault();
          const res = await createCoupon({
            data: {
              token: token(),
              code,
              phone: phone || undefined,
              kind,
              value: Number(value),
              days: Number(days),
              reason,
            },
          });
          setMessage(res.ok ? t("created") : t(res.error === "forbidden" ? "forbidden" : "code"));
        }}
      >
        <h2 className="text-2xl">{t("couponTitle")}</h2>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("couponTitle")} className="rounded-md border border-line px-3 py-2" />
        <p className="text-sm text-muted">{t("customerPhone")}: {phone || "—"}</p>
        <button className="rounded-full bg-blue px-4 py-3 font-semibold text-on-blue">{t("create")}</button>
        {message ? <p className="text-sm">{message}</p> : null}
      </form>
    </div>
  );
}

function AuditDesk() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    listAudit({ data: { token: token() } }).then((res) => {
      if (res.ok) setRows(res.rows);
    });
  }, []);
  if (rows.length === 0) return <p>{t("none")}</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md bg-card px-3 py-2 text-sm ring-1 ring-line">
          <span className="font-semibold">{row.action}</span> · {row.entity} {row.entityId} · {row.actor}
          <span className="block text-xs text-muted">{row.createdAt}</span>
        </li>
      ))}
    </ul>
  );
}
