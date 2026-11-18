import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Download, Heart, MessageCircle, Minus, Phone, Plus, Search, Share2, X } from "lucide-react";
import { PinMap } from "@/components/pin-map";
import { PinLogo, Wordmark } from "@/components/logo";
import { PROGRESS_STATES, STATUS_LABEL, STORE_WHATSAPP_LINK } from "@/lib/delivery/types";
import { LangSwitch, ThemeSwitch, useI18n } from "@/lib/i18n";
import { drinkChoices } from "@/lib/drinks";
import { matchRecipe } from "@/lib/recipes";
import { categoryLabel, subcategoryLabel } from "@/lib/labels";
import { etaLabel, formatKz, formatPhone, localMobileDigits } from "@/lib/pricing";
import type { CategoryRow, Customer, Notice, OrderSummary, ProductCard, SubcategoryRow } from "@/lib/shop-types";
import {
  bestsellers,
  getMe,
  getOrder,
  getProduct,
  listCategories,
  listNotices,
  listOpenSlots,
  listOrders,
  listSubcategories,
  logout,
  placeOrder,
  quoteCart,
  requestOtp,
  requestRestock,
  saveAddress,
  searchDictionary,
  searchProducts,
  submitFeedback,
  toggleFavorite,
  verifyOtp,
  warmup,
  deleteAccount,
  rateDelivery,
} from "@/server/fns";

const TOKEN_KEY = "ct-customer";
const CART_KEY = "ct-cart";
const PIN_KEY = "ct-pin";

type CartItem = { sku: string; name: string; qty: number; price?: number };
type Pin = { lat: number; lng: number; label: string };
type Pay = "multicaixa" | "unitel_money" | "appypay" | "cash";

type View =
  | { name: "boot" }
  | { name: "onboarding"; step: 0 | 1 | 2 }
  | { name: "register"; returning: boolean }
  | { name: "otp"; phone: string; customerName: string; channel: "sms" | "whatsapp"; demoCode: string }
  | { name: "home" }
  | { name: "bundle"; id: string }
  | { name: "browse"; categoryId?: string; subcategoryId?: string; q?: string; favorites?: boolean; title: string }
  | { name: "product"; sku: string }
  | { name: "cart" }
  | { name: "address" }
  | { name: "pay" }
  | { name: "done"; number: number; eta: string; simulated: boolean; id: string }
  | { name: "track"; id: string }
  | { name: "orders" }
  | { name: "account" }
  | { name: "feedback" }
  | { name: "privacy" };

const SPOTS: Pin[] = [
  { lat: -8.916, lng: 13.184, label: "Talatona" },
  { lat: -8.998, lng: 13.266, label: "Kilamba" },
  { lat: -8.827, lng: 13.234, label: "Maianga" },
  { lat: -8.814, lng: 13.23, label: "Ingombota" },
  { lat: -8.823, lng: 13.245, label: "Maculusso" },
  { lat: -8.847, lng: 13.188, label: "Samba" },
  { lat: -8.955, lng: 13.168, label: "Benfica" },
  { lat: -8.937, lng: 13.198, label: "Morro Bento" },
  { lat: -8.888, lng: 13.178, label: "Patriota" },
  { lat: -8.783, lng: 13.37, label: "Cacuaco" },
];

function readToken() {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

function moneyTone(name: string) {
  const tones = ["bg-blue text-on-blue", "bg-green text-on-green", "bg-gold text-on-gold"];
  return tones[name.length % 3];
}

function Tile({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className={`grid aspect-square place-items-center rounded-md ${moneyTone(name)}`}>
      <span className="font-display text-3xl">{letters || "CT"}</span>
    </div>
  );
}

function foto(file: string) {
  const path = file.startsWith("/") ? file : `/fotos/${file}`;
  return `${path}?v=5`;
}

function ProductPhoto({ name, file, large, onMissing }: { name: string; file: string; large?: boolean; onMissing?: () => void }) {
  const [failed, setFailed] = useState(false);
  if (!file || failed) return <Tile name={name} />;
  return (
    <img
      src={foto(file)}
      alt={name}
      className={large ? "h-72 w-full max-w-full bg-white object-contain" : "aspect-[4/5] w-full max-w-full bg-white object-contain p-3"}
      onError={() => {
        setFailed(true);
        onMissing?.();
      }}
    />
  );
}

function Btn({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-full bg-blue px-5 py-3 text-base text-on-blue disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function ShopApp() {
  const { t, lang } = useI18n();
  const [view, setView] = useState<View>({ name: "home" });
  const [stack, setStack] = useState<View[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bootError, setBootError] = useState("");
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pin, setPin] = useState<Pin>(SPOTS[0]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [homeProducts, setHomeProducts] = useState<ProductCard[]>([]);
  const [favoriteProducts, setFavoriteProducts] = useState<ProductCard[]>([]);
  const [popular, setPopular] = useState<ProductCard[]>([]);
  const [deals, setDeals] = useState<ProductCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [installNote, setInstallNote] = useState(false);
  const [cartSheet, setCartSheet] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function token() {
    return readToken();
  }

  function go(next: View) {
    setStack((prev) => [...prev, view]);
    setView(next);
  }
  function back() {
    setStack((prev) => {
      const copy = [...prev];
      const last = copy.pop();
      if (last) setView(last);
      return copy;
    });
  }
  function reset(next: View) {
    setStack([]);
    setView(next);
  }
  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }
  function saveCart(next: CartItem[]) {
    setCart(next);
    localStorage.setItem(CART_KEY, JSON.stringify(next));
  }
  function addToCart(product: ProductCard, qty = 1) {
    if (product.availability === "out") return;
    const add = Math.max(1, Math.floor(qty));
    const next = [...cart];
    const found = next.find((item) => item.sku === product.sku);
    const max = product.stockLeft ?? add;
    const nextQty = Math.min((found?.qty ?? 0) + add, max);
    if (nextQty < 1) return;
    if (found) {
      found.qty = nextQty;
      found.price = product.priceAoa;
    } else next.push({ sku: product.sku, name: product.name, qty: nextQty, price: product.priceAoa });
    saveCart(next);
    flash(t("added"));
  }
  function addMany(products: ProductCard[]) {
    const next = [...cart];
    for (const product of products) {
      if (product.availability === "out") continue;
      const found = next.find((item) => item.sku === product.sku);
      const max = product.stockLeft ?? 1;
      const nextQty = Math.min((found?.qty ?? 0) + 1, max);
      if (nextQty < 1) continue;
      if (found) {
        found.qty = nextQty;
        found.price = product.priceAoa;
      } else next.push({ sku: product.sku, name: product.name, qty: nextQty, price: product.priceAoa });
    }
    saveCart(next);
    flash(t("added"));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CART_KEY);
    localStorage.removeItem("ct-phone");
    sessionStorage.removeItem("ct-after");
    setCustomer(null);
    setCart([]);
    setCartSheet(false);
    reset({ name: "register", returning: true });
  }
  async function signOut() {
    try {
      await logout({ data: { token: readToken() } });
    } catch {
      /* a sessão local é apagada mesmo sem rede */
    }
    clearSession();
  }
  function cartQty(sku: string, qty: number) {
    saveCart(qty <= 0 ? cart.filter((item) => item.sku !== sku) : cart.map((item) => (item.sku === sku ? { ...item, qty } : item)));
  }
  function checkoutFromSide() {
    setCartSheet(false);
    if (!customer) {
      sessionStorage.setItem("ct-after", "address");
      go({ name: "register", returning: Boolean(localStorage.getItem("ct-phone")) });
      return;
    }
    go({ name: "cart" });
  }
  function repeatLastOrder() {
    setCartSheet(false);
    if (!customer) {
      go({ name: "register", returning: Boolean(localStorage.getItem("ct-phone")) });
      return;
    }
    listOrders({ data: { token: token() } }).then((res) => {
      if (!res.ok || res.orders.length === 0) {
        go({ name: "orders" });
        return;
      }
      const order = res.orders.find((item) => item.status !== "cancelled") ?? res.orders[0];
      saveCart(order.items.map((item) => ({ sku: item.sku, name: item.name, qty: item.qty })));
      go({ name: "cart" });
    });
  }

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const savedCart = localStorage.getItem(CART_KEY);
    if (savedCart) {
      try {
        const parsed = JSON.parse(savedCart) as CartItem[];
        if (Array.isArray(parsed)) setCart(parsed);
      } catch {
        /* ignore broken cache */
      }
    }
    const savedPin = localStorage.getItem(PIN_KEY);
    if (savedPin) {
      try {
        setPin(JSON.parse(savedPin) as Pin);
      } catch {
        /* ignore */
      }
    }
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        await warmup();
        const me = await getMe({ data: { token: readToken() } });
        if (cancel) return;
        setCustomer(me.customer);
      } catch (err) {
        if (!cancel) setBootError(err instanceof Error ? err.message : "error");
      }
    })();
    return () => {
      cancel = true;
    };
    // boot once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view.name === "boot" || view.name === "register" || view.name === "otp") return;
    let cancel = false;
    (async () => {
      const [cats, shelf, favs, best] = await Promise.all([
        listCategories({ data: { token: token() } }),
        searchProducts({ data: { token: token(), limit: 48 } }),
        customer
          ? searchProducts({ data: { token: token(), favoritesOnly: true, limit: 8 } })
          : Promise.resolve({ ok: false as const }),
        bestsellers({ data: { token: token() } }),
      ]);
      if (cancel) return;
      if (cats.ok) setCategories(cats.categories);
      if (shelf.ok) {
        setDeals(shelf.products.filter((item) => item.compareAtAoa).slice(0, 8));
        setHomeProducts(shelf.products.slice(0, 24));
      }
      if (favs.ok) setFavoriteProducts(favs.products);
      if (best.ok) setPopular(best.products);
    })().catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [customer, view.name]);

  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const eta = etaLabel(pin.lat, pin.lng);
  const cartTotal = cart.every((item) => typeof item.price === "number")
    ? cart.reduce((sum, item) => sum + (item.price ?? 0) * item.qty, 0)
    : null;
  const showBar =
    count > 0 &&
    !["boot", "onboarding", "register", "otp", "cart", "address", "pay", "done"].includes(view.name);

  const shell = (body: ReactNode, opts?: { back?: boolean; title?: string; bleed?: boolean; rail?: boolean }) => (
    <div className="min-h-dvh overflow-x-clip bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-paper text-ink">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2 md:flex-row md:items-center md:gap-3 md:py-3">
          <div className="flex min-w-0 items-center gap-3">
            {opts?.back ? (
              <button type="button" onClick={back} aria-label={t("back")} className="grid size-11 shrink-0 place-items-center">
                <ArrowLeft />
              </button>
            ) : null}
            <button type="button" onClick={() => reset({ name: "home" })} className="flex min-w-0 items-center gap-2 text-left" aria-label="COMPRA TUDO">
              <PinLogo className="h-11 w-auto shrink-0" />
              <span className="grid min-w-0 gap-1">
                <Wordmark className="h-[18px] w-auto max-w-full self-start text-blue" />
                <span className="block text-[11px] leading-none tracking-wide text-blue">{t("tagline")}</span>
              </span>
            </button>
            <div className="ml-auto flex shrink-0 items-center md:hidden">
              <ThemeSwitch />
              <LangSwitch />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <div className="hidden items-center md:flex">
              <ThemeSwitch />
              <LangSwitch />
            </div>
            <button
              type="button"
              onClick={() => {
                const prompt = installEvent as (Event & { prompt?: () => Promise<void> }) | null;
                if (prompt?.prompt) {
                  void prompt.prompt();
                  setInstallEvent(null);
                  return;
                }
                setInstallNote(true);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-blue bg-white px-3 py-2 text-sm text-blue"
            >
              <Download className="size-4" />
              {t("downloadApp")}
            </button>
            {customer ? (
              <>
                <button type="button" onClick={() => go({ name: "account" })} className="max-w-40 truncate rounded-full border border-blue bg-white px-3 py-2 text-sm text-blue">
                  {customer.name || t("account")}
                </button>
                <button type="button" onClick={() => void signOut()} className="rounded-full bg-blue px-3 py-2 text-sm text-on-blue">
                  {t("signOutFull")}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => go({ name: "register", returning: true })} className="rounded-full border border-blue bg-white px-3 py-2 text-sm text-blue">
                  {t("shopEnter")}
                </button>
                <button type="button" onClick={() => go({ name: "register", returning: false })} className="rounded-full bg-blue px-3 py-2 text-sm text-on-blue">
                  {t("createAccount")}
                </button>
              </>
            )}
          </div>
        </div>
        {installNote ? <p className="mx-auto max-w-7xl px-4 pb-2 text-xs text-muted">{t("installHelp")}</p> : null}
      </header>
      {!online ? (
        <div className="bg-gold text-on-gold">
          <div className="mx-auto max-w-5xl px-4 py-3">
            <p>{t("offTitle")}</p>
            <p className="text-sm">{t("offBody")}</p>
          </div>
        </div>
      ) : null}
      <main className={`mx-auto ${opts?.rail ? "max-w-7xl" : "max-w-6xl"} ${opts?.bleed ? (showBar ? "pb-28 lg:pb-6" : "") : `px-4 py-5 ${showBar ? "pb-32" : "pb-10"}`}`}>{body}</main>
      {showBar ? (
        <div className={`fixed inset-x-0 bottom-0 z-30 bg-ink text-paper ${opts?.rail ? "lg:hidden" : ""}`}>
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <p className="min-w-0 text-sm leading-tight">
              <span className="block font-bold tabular-nums whitespace-nowrap">
                {count === 1 ? t("cartBarOne") : t("cartBarCount", { n: count })}
                {cartTotal != null ? ` · ${formatKz(cartTotal, lang)}` : ""}
              </span>
              <span className="block truncate text-xs opacity-80">{t("etaShort", { eta })}</span>
            </p>
            <button
              type="button"
              onClick={() => (opts?.rail ? setCartSheet(true) : go({ name: "cart" }))}
              className="ml-auto shrink-0 rounded-full bg-white px-4 py-3 text-sm text-ink"
            >
              {t("seeCart")}
            </button>
          </div>
        </div>
      ) : null}
      {cartSheet && showBar && opts?.rail ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 lg:hidden" onClick={() => setCartSheet(false)}>
          <div
            className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-paper p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-end">
              <button type="button" aria-label={t("back")} onClick={() => setCartSheet(false)} className="grid size-10 place-items-center rounded-full">
                <X className="size-5" />
              </button>
            </div>
            <CartSide cart={cart} total={cartTotal} onCartQty={cartQty} onCheckout={checkoutFromSide} onRepeat={repeatLastOrder} />
          </div>
        </div>
      ) : null}
      {toast ? (
        <p className="fixed top-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-green px-4 py-2 text-sm text-on-green">
          {toast}
        </p>
      ) : null}
    </div>
  );

  if (view.name === "boot") {
    return (
      <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-blue px-6 text-center text-on-blue">
        <FoodBlur shift={0} />
        <div className="relative z-10">
          <Mark large />
          <h1 className="mt-4 font-display text-4xl">COMPRA TUDO</h1>
          <p className="mx-auto mt-3 max-w-sm text-on-blue/85">{bootError || t("preparing")}</p>
          <p className="mx-auto mt-6 max-w-md text-sm text-on-blue/70">{t("splashLine")}</p>
        </div>
      </div>
    );
  }

  if (view.name === "onboarding") {
    const steps = [
      { title: t("ob1Title"), body: t("ob1Body"), cta: t("ob1Cta") },
      { title: t("ob2Title"), body: t("ob2Body"), cta: t("ob2Cta") },
      { title: t("ob3Title"), body: t("ob3Body"), cta: t("ob3Cta") },
    ] as const;
    const step = steps[view.step];
    return (
      <div className="relative grid min-h-dvh overflow-hidden bg-blue text-on-blue">
        <FoodBlur shift={view.step} />
        <div className="relative z-10 mx-auto flex w-full max-w-lg flex-col px-6 py-6">
          <div className="flex items-center justify-between">
            <p className="font-display text-2xl">COMPRA TUDO</p>
            <div className="flex items-center gap-1">
              <ThemeSwitch />
              <LangSwitch />
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-end pb-8">
            <p className="text-sm text-gold">{t("obKicker")}</p>
            <p className="mt-2 text-sm text-gold">{view.step + 1} / 3</p>
            <h1 className="mt-3 text-4xl">{step.title}</h1>
            <p className="mt-4 text-lg text-on-blue/85">{step.body}</p>
            <div className="mt-8">
              <Btn
                onClick={() => {
                  if (view.step < 2) setView({ name: "onboarding", step: (view.step + 1) as 1 | 2 });
                  else {
                    localStorage.setItem("ct-onboarded", "1");
                    reset({ name: "register", returning: false });
                  }
                }}
              >
                {step.cta}
              </Btn>
              {view.step === 1 ? (
                <button
                  type="button"
                  className="mt-4 w-full py-2 text-sm text-gold"
                  onClick={() => {
                    localStorage.setItem("ct-onboarded", "1");
                    reset({ name: "register", returning: true });
                  }}
                >
                  {t("ob2Link")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view.name === "register") {
    return shell(
      <RegisterPanel
        returning={view.returning}
        onEnter={() => go({ name: "register", returning: true })}
        onCreate={() => go({ name: "register", returning: false })}
        onDone={(phone, customerName, channel, address) => {
          localStorage.setItem("ct-phone", phone);
          if (customerName) localStorage.setItem("ct-name", customerName);
          if (address) sessionStorage.setItem("ct-signup-address", address);
          go({ name: "otp", phone, customerName, channel, demoCode: "" });
        }}
      />,
    );
  }

  if (view.name === "otp") {
    return shell(
      <OtpPanel
        phone={view.phone}
        name={view.customerName}
        channel={view.channel}
        demoCode={view.demoCode}
        onVerified={(next) => {
          localStorage.setItem(TOKEN_KEY, next.token);
          localStorage.setItem("ct-onboarded", "1");
          localStorage.setItem("ct-phone", next.customer.phone);
          localStorage.setItem("ct-name", next.customer.name);
          setCustomer(next.customer);
          const address = sessionStorage.getItem("ct-signup-address");
          if (address) {
            localStorage.setItem("ct-complement", address);
            sessionStorage.removeItem("ct-signup-address");
            void saveAddress({ data: { token: next.token, address } });
          }
          const after = sessionStorage.getItem("ct-after");
          sessionStorage.removeItem("ct-after");
          reset(after === "address" ? { name: "address" } : { name: "home" });
        }}
      />,
      { back: true },
    );
  }

  if (view.name === "home" || view.name === "browse") {
    return shell(
      <Catalog
        view={view}
        categories={categories}
        homeProducts={homeProducts}
        favoriteProducts={favoriteProducts}
        popular={popular}
        deals={deals}
        customer={customer}
        onOpenCategory={(category) =>
          go({
            name: "browse",
            categoryId: category.id,
            title: categoryLabel(category.id, category.name, lang),
          })
        }
        onOpenProduct={(sku) => go({ name: "product", sku })}
        onAdd={addToCart}
        onSearch={(q) => go({ name: "browse", q, title: q })}
        onOpenBundle={(id) => go({ name: "bundle", id })}
        onAddAll={addMany}
        cart={cart}
        onCartQty={cartQty}
        onCheckout={checkoutFromSide}
        onFavorites={() => {
          if (!customer) {
            go({ name: "register", returning: Boolean(localStorage.getItem("ct-phone")) });
            return;
          }
          go({ name: "browse", favorites: true, title: t("favorites") });
        }}
        onRepeat={repeatLastOrder}
        onFeedback={() => go({ name: "feedback" })}
      />,
      { bleed: view.name === "home", rail: view.name === "home" },
    );
  }

  if (view.name === "bundle") {
    return shell(
      <BundlePanel
        id={view.id}
        onOpen={(sku) => go({ name: "product", sku })}
        onAdd={addToCart}
        onAddAll={(items) => {
          addMany(items);
          go({ name: "cart" });
        }}
      />,
      { back: true },
    );
  }

  if (view.name === "product") {
    return shell(<ProductPanel sku={view.sku} onAdd={addToCart} onOpen={(next) => go({ name: "product", sku: next })} />, { back: true });
  }

  if (view.name === "cart") {
    return shell(
      <CartPanel
        cart={cart}
        pin={pin}
        onChange={(sku, qty) => {
          saveCart(qty <= 0 ? cart.filter((item) => item.sku !== sku) : cart.map((item) => (item.sku === sku ? { ...item, qty } : item)));
        }}
        onCheckout={() => {
          if (!customer) {
            sessionStorage.setItem("ct-after", "address");
            go({ name: "register", returning: Boolean(localStorage.getItem("ct-phone")) });
            return;
          }
          go({ name: "address" });
        }}
        onBrowse={() => reset({ name: "home" })}
        onAdjusted={(next) => saveCart(next)}
      />,
      { back: true, title: t("cartTitle") },
    );
  }

  if (view.name === "address") {
    return shell(
      <AddressPanel
        pin={pin}
        cart={cart}
        onPin={(next) => {
          setPin(next);
          localStorage.setItem(PIN_KEY, JSON.stringify(next));
        }}
        onContinue={() => go({ name: "pay" })}
      />,
      { back: true },
    );
  }

  if (view.name === "pay") {
    return shell(
      <PayPanel
        cart={cart}
        pin={pin}
        busy={busy}
        onPlace={async (method, coupon, slot) => {
          setBusy(true);
          try {
            const res = await placeOrder({
              data: {
                token: token(),
                items: cart.map((item) => ({ sku: item.sku, qty: item.qty })),
                couponCode: coupon || undefined,
                lat: pin.lat,
                lng: pin.lng,
                label: pin.label,
                complement: localStorage.getItem("ct-complement") ?? "",
                paymentMethod: method,
                slotStart: slot.start,
                slotEnd: slot.end,
                slotLabel: slot.label,
              },
            });
            if (!res.ok) {
              if (res.error === "stock" && res.adjustments) {
                const map = new Map(res.adjustments.map((item) => [item.sku, item]));
                saveCart(
                  cart
                    .map((item) => {
                      const adj = map.get(item.sku);
                      return adj ? { ...item, qty: adj.qty, name: adj.name || item.name } : item;
                    })
                    .filter((item) => item.qty > 0),
                );
                flash(t("stockAdjusted", { name: res.adjustments[0]?.name ?? "", n: res.adjustments[0]?.qty ?? 0 }));
              } else if (res.error === "zone") flash(t("outOfZone"));
              else if (res.error === "slot") flash(t("slotClosed"));
              return;
            }
            saveCart([]);
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("COMPRA TUDO", { body: `CT-${res.order.number}` });
            }
            reset({
              name: "done",
              number: res.order.number,
              eta: res.order.etaLabel,
              simulated: res.simulatedPayment,
              id: res.order.id,
            });
          } finally {
            setBusy(false);
          }
        }}
      />,
      { back: true },
    );
  }

  if (view.name === "done") {
    return shell(
      <div>
        <p className="text-sm text-green">{t("step3")}</p>
        <h1 className="mt-2 text-4xl">{t("confirmedTitle")}</h1>
        <p className="mt-4 text-lg">{t("orderNo", { id: `CT-${view.number}` })}</p>
        <p className="mt-2">{t("etaConfirm", { eta: view.eta })}</p>
        {view.simulated ? <p className="mt-3 text-sm text-muted">{t("payDemo")}</p> : null}
        <div className="mt-8 grid gap-3">
          <Btn onClick={() => reset({ name: "track", id: view.id })}>{t("track")}</Btn>
          <button type="button" className="py-2 text-sm text-blue" onClick={() => reset({ name: "home" })}>
            {t("backHome")}
          </button>
        </div>
      </div>,
    );
  }

  if (view.name === "track") return shell(<TrackPanel id={view.id} />, { back: true });
  if (view.name === "orders") return shell(<OrdersPanel onOpen={(id) => go({ name: "track", id })} onRepeat={(order) => {
    saveCart(order.items.map((item) => ({ sku: item.sku, name: item.name, qty: item.qty })));
    go({ name: "cart" });
  }} />, { back: true, title: t("history") });
  if (view.name === "privacy") return shell(<PrivacyBlock />, { back: true });
  if (view.name === "feedback") return shell(<FeedbackPanel customer={customer} />, { back: true });
  if (view.name !== "account" || !customer) return shell(<p>{t("preparing")}</p>);
  return shell(
    <AccountPanel
      customer={customer}
      onSignedOut={clearSession}
      onOrders={() => go({ name: "orders" })}
      onPrivacy={() => go({ name: "privacy" })}
    />,
    { back: true, title: t("accountTitle") },
  );
}

const BACKDROP = ["/intro/porta.jpg", "/intro/mesa.jpg", "/intro/caixa.jpg"];

function FoodBlur({ shift }: { shift: number }) {
  const spots = [
    "left-[-18%] top-[-14%] h-[52%] w-[78%]",
    "right-[-22%] top-[22%] h-[46%] w-[74%]",
    "left-[6%] bottom-[-16%] h-[50%] w-[88%]",
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {BACKDROP.map((src, index) => (
        <img
          key={src}
          src={src}
          alt=""
          className={`absolute scale-125 object-cover opacity-80 blur-2xl ${spots[(index + shift) % spots.length]}`}
        />
      ))}
      <div className="absolute inset-0 bg-blue/70" />
    </div>
  );
}

function Mark({ large }: { large?: boolean }) {
  return <PinLogo inverse className={large ? "mx-auto h-20 w-auto" : "h-10 w-auto"} />;
}

function RegisterPanel({
  returning,
  onEnter,
  onCreate,
  onDone,
}: {
  returning: boolean;
  onEnter: () => void;
  onCreate: () => void;
  onDone: (phone: string, name: string, channel: "sms" | "whatsapp", address: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(() => localStorage.getItem("ct-name") ?? "");
  const [phone, setPhone] = useState(() => localMobileDigits(localStorage.getItem("ct-phone") ?? ""));
  const [address, setAddress] = useState(() => localStorage.getItem("ct-complement") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mx-auto grid max-w-lg gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const full = phone.length === 9 ? `+244${phone}` : phone;
        const res = await requestOtp({
          data: { name: returning ? "" : name.trim(), phone: full, channel: "sms" },
        });
        setBusy(false);
        if (!res.ok) {
          setError(res.error === "phone" ? t("phoneError") : res.error === "send" ? t("sendError") : res.error === "rate" || res.error === "wait" ? t("rate") : t("nameError"));
          return;
        }
        localStorage.setItem("ct-phone", res.phone);
        if (!returning) localStorage.setItem("ct-complement", address.trim());
        onDone(res.phone, name.trim(), "sms", returning ? "" : address.trim());
      }}
    >
      <h1 className="text-3xl sm:text-4xl">{returning ? t("loginTitle") : t("createAccount")}</h1>
      {returning ? null : (
        <label className="grid gap-1 text-sm">
          {t("nameLabel")}
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="rounded-md border border-line bg-card px-3 py-3 text-base font-normal" required />
        </label>
      )}
      <label className="grid gap-1 text-sm">
        {t("phoneLabel")}
        <div className="flex overflow-hidden rounded-md border border-line bg-card">
          <span className="grid place-items-center border-r border-line px-3 text-base tabular-nums">+244</span>
          <input
            value={phone}
            onChange={(e) => setPhone(localMobileDigits(e.target.value))}
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={9}
            pattern="9[0-9]{8}"
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base font-normal tabular-nums"
            placeholder="9XX XXX XXX"
            required
          />
        </div>
      </label>
      {returning ? null : (
        <label className="grid gap-1 text-sm">
          {t("addressLabel")}
          <input value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" className="rounded-md border border-line bg-card px-3 py-3 text-base font-normal" required minLength={3} />
        </label>
      )}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Btn type="submit" disabled={busy || phone.length !== 9}>{returning ? t("shopEnter") : t("createAccount")}</Btn>
      {returning ? (
        <button type="button" onClick={onCreate} className="text-sm text-blue">{t("createAccount")}</button>
      ) : (
        <button type="button" onClick={onEnter} className="text-sm text-blue">{t("shopEnter")}</button>
      )}
    </form>
  );
}

function OtpPanel({
  phone,
  name,
  channel,
  demoCode,
  onVerified,
}: {
  phone: string;
  name: string;
  channel: "sms" | "whatsapp";
  demoCode: string;
  onVerified: (result: { token: string; customer: Customer }) => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [wait, setWait] = useState(30);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);
  return (
    <form
      className="mx-auto grid max-w-lg gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const res = await verifyOtp({ data: { phone, code } });
        setBusy(false);
        if (!res.ok) {
          setError(t("otpError"));
          return;
        }
        onVerified(res);
      }}
    >
      <h1 className="text-4xl">{t("otpTitle")}</h1>
      <p>{t("otpBody", { phone: formatPhone(phone) })}</p>
      <p className="text-sm text-muted">{t("otpDemo")}</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        className="rounded-md border border-line bg-card px-3 py-3 text-2xl tracking-widest tabular-nums"
        required
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Btn type="submit" disabled={busy || code.length !== 6}>{t("confirmCta")}</Btn>
      {wait > 0 ? (
        <p className="text-sm text-muted">{t("resendWait", { seconds: wait })}</p>
      ) : (
        <button
          type="button"
          className="text-sm text-blue"
          onClick={async () => {
            const res = await requestOtp({ data: { name, phone, channel } });
            if (!res.ok) {
              setError(t("sendError"));
              return;
            }
            setWait(res.retryIn);
            setError("");
          }}
        >
          {t("resend")}
        </button>
      )}
    </form>
  );
}

const CAT_PHOTO: Record<string, string> = {
  mercearia: "MER-0001.jpg",
  bebidas: "BEB-0081.jpg",
  frescos: "FRE-0041.jpg",
  frutas: "FRE-0001.jpg",
  carne: "FRE-0094.jpg",
  peixe: "FRE-0122.jpg",
  padaria: "PAD-0001.jpg",
  "lacticinios-e-ovos": "LAC-0001.jpg",
  congelados: "CON-0001.jpg",
  "snacks-e-doces": "SNA-0001.jpg",
  bebe: "INF-0001.jpg",
  "higiene-pessoal": "HIG-0001.jpg",
  "limpeza-da-casa": "LIM-0001.jpg",
  animais: "ANI-0001.jpg",
  "casa-e-descartaveis": "CAS-0001.jpg",
  "farmacia-basica": "FAR-0001.jpg",
};

const BUNDLES = [
  {
    id: "semana" as const,
    title: "bundleWeek" as const,
    line: "bundleWeekLine" as const,
    photo: "/fotos/MER-0001.jpg",
    skus: ["MER-0001", "MER-0067", "MER-0049", "LAC-0063", "MER-0085"],
  },
  {
    id: "grelha" as const,
    title: "bundleGrill" as const,
    line: "bundleGrillLine" as const,
    photo: "/fotos/FRE-0107.jpg",
    skus: ["FRE-0094", "FRE-0107", "FRE-0110", "PAD-0011"],
  },
  {
    id: "mar" as const,
    title: "bundleSea" as const,
    line: "bundleSeaLine" as const,
    photo: "/fotos/FRE-0123.jpg",
    skus: ["FRE-0123", "MER-0001", "MER-0127", "BEB-0081"],
  },
  {
    id: "manha" as const,
    title: "bundleMorning" as const,
    line: "bundleMorningLine" as const,
    photo: "/fotos/PAD-0001.jpg",
    skus: ["PAD-0001", "LAC-0001", "LAC-0063", "LAC-0052"],
  },
  {
    id: "bebidas" as const,
    title: "bundleDrinks" as const,
    line: "bundleDrinksLine" as const,
    photo: "/fotos/BEB-0003.jpg",
    skus: ["BEB-0003", "BEB-0074", "BEB-0082"],
  },
  {
    id: "frescos" as const,
    title: "bundleFresh" as const,
    line: "bundleFreshLine" as const,
    photo: "/fotos/FRE-0001.jpg",
    skus: ["FRE-0001", "FRE-0041", "FRE-0094", "FRE-0123"],
  },
  {
    id: "lanche" as const,
    title: "bundleSnack" as const,
    line: "bundleSnackLine" as const,
    photo: "/fotos/LAC-0035.jpg",
    skus: ["LAC-0035", "PAD-0011", "BEB-0074"],
  },
];

function campaignUntil(lang: "pt" | "fr" | "en") {
  const now = new Date();
  const day = now.getUTCDay();
  const end = new Date(now);
  end.setUTCDate(now.getUTCDate() + (day === 0 ? 0 : 7 - day));
  return end.toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "pt-PT", { day: "numeric", month: "short" });
}

function bundleTotals(items: ProductCard[]) {
  const promo = items.reduce((sum, product) => sum + product.priceAoa, 0);
  const was = items.reduce((sum, product) => sum + (product.compareAtAoa && product.compareAtAoa > product.priceAoa ? product.compareAtAoa : product.priceAoa), 0);
  const off = was > promo ? Math.round((1 - promo / was) * 100) : 0;
  return { promo, was, off };
}

function BundlePanel({
  id,
  onOpen,
  onAdd,
  onAddAll,
}: {
  id: string;
  onOpen: (sku: string) => void;
  onAdd: (product: ProductCard) => void;
  onAddAll: (products: ProductCard[]) => void;
}) {
  const { t, lang } = useI18n();
  const bundle = BUNDLES.find((item) => item.id === id) ?? BUNDLES[0];
  const [items, setItems] = useState<ProductCard[]>([]);
  useEffect(() => {
    let cancel = false;
    Promise.all(
      bundle.skus.map((sku) => getProduct({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", sku } })),
    ).then((rows) => {
      if (cancel) return;
      setItems(rows.flatMap((row) => (row.ok ? [row.product] : [])));
    });
    return () => {
      cancel = true;
    };
  }, [bundle]);
  const totals = bundleTotals(items);
  const until = campaignUntil(lang);
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <p className="text-sm text-blue">{t("campaign")}</p>
      <h1 className="text-4xl font-bold">{t(bundle.title)}</h1>
      <p>{t(bundle.line)}</p>
      <p className="text-sm text-muted">{t("validUntil", { date: until })}</p>
      <img src={foto(bundle.photo)} alt="" className="h-56 w-full rounded-2xl bg-white object-contain" />
      {totals.promo > 0 ? (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-blue px-4 py-4 text-on-blue">
          {totals.off > 0 ? <span className="rounded-full bg-gold px-3 py-1 text-sm font-bold text-on-gold">-{totals.off}%</span> : null}
          <span>
            {totals.was > totals.promo ? <span className="mr-2 text-sm line-through opacity-70">{formatKz(totals.was, lang)}</span> : null}
            <span className="text-3xl font-bold tabular-nums">{formatKz(totals.promo, lang)}</span>
          </span>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((product) => {
          const off = product.compareAtAoa && product.compareAtAoa > product.priceAoa ? Math.round((1 - product.priceAoa / product.compareAtAoa) * 100) : 0;
          return (
            <article key={product.sku} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line">
              <button type="button" onClick={() => onOpen(product.sku)} className="shrink-0">
                <img src={foto(product.photoFile)} alt="" className="size-24 rounded-xl bg-white object-contain" />
              </button>
              <div className="flex min-w-0 flex-1 flex-col">
                <button type="button" onClick={() => onOpen(product.sku)} className="text-left">
                  <span className="block leading-snug">{product.name}</span>
                </button>
                <span className="mt-1">
                  {off > 0 ? <span className="mr-2 text-sm font-bold text-blue">-{off}%</span> : null}
                  {product.compareAtAoa && product.compareAtAoa > product.priceAoa ? (
                    <span className="mr-2 text-sm text-muted line-through tabular-nums">{formatKz(product.compareAtAoa, lang)}</span>
                  ) : null}
                  <span className="font-bold tabular-nums">{formatKz(product.priceAoa, lang)}</span>
                </span>
                <button type="button" onClick={() => onAdd(product)} className="mt-auto self-start rounded-full bg-gold px-4 py-2 text-sm text-on-gold">
                  {t("addOne")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <Btn onClick={() => onAddAll(items)}>{t("addBundle")}</Btn>
      <ShareBundle title={t(bundle.title)} line={t(bundle.line)} photo={bundle.photo} items={items} light />
    </div>
  );
}

function OfferRail({
  slide,
  items,
  onStep,
  onOpen,
  onAdd,
  onAddAll,
}: {
  slide: number;
  items: ProductCard[];
  onStep: (delta: number) => void;
  onOpen: (id: string) => void;
  onAdd: (product: ProductCard) => void;
  onAddAll: (products: ProductCard[]) => void;
}) {
  const { t, lang } = useI18n();
  const bundle = BUNDLES[slide] ?? BUNDLES[0];
  const totals = bundleTotals(items);
  const until = campaignUntil(lang);
  return (
    <section className="mt-4 overflow-hidden rounded-3xl bg-blue text-white shadow-lg shadow-blue/20">
      <div className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <button type="button" onClick={() => onOpen(bundle.id)} aria-label={t(bundle.title)} className="relative min-h-44 bg-white text-left md:min-h-64">
          <img src={foto(bundle.photo)} alt="" className="absolute inset-0 h-full w-full bg-white object-contain" />
        </button>
        <div className="flex flex-col justify-center gap-4 p-4">
          <div>
            <p className="text-xs tracking-wide text-[#FFC700]">{t("campaign")} {slide + 1}/{BUNDLES.length}</p>
            <h2 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">{t(bundle.title)}</h2>
            <p className="mt-2 text-sm text-white/85">{t(bundle.line)}</p>
            <p className="mt-2 text-sm text-white/80">{t("validUntil", { date: until })}</p>
            {totals.promo > 0 ? (
              <p className="mt-3">
                {totals.off > 0 ? <span className="mr-2 rounded-full bg-gold px-2 py-0.5 text-sm font-bold text-on-gold">-{totals.off}%</span> : null}
                {totals.was > totals.promo ? <span className="mr-2 text-sm line-through opacity-70">{formatKz(totals.was, lang)}</span> : null}
                <span className="text-2xl font-bold tabular-nums">{formatKz(totals.promo, lang)}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label={t("prevOffer")} onClick={() => onStep(-1)} className="grid size-11 place-items-center rounded-full bg-white/15">
              <ArrowLeft />
            </button>
            <button type="button" aria-label={t("nextOffer")} onClick={() => onStep(1)} className="grid size-11 place-items-center rounded-full bg-white/15">
              <ArrowLeft className="rotate-180" />
            </button>
            <button type="button" onClick={() => onAddAll(items)} className="rounded-full bg-[#FFC700] px-4 py-2 text-sm text-[#0B1F4D]">
              {t("addBundle")}
            </button>
            <ShareBundle title={t(bundle.title)} line={t(bundle.line)} photo={bundle.photo} items={items} />
          </div>
        </div>
      </div>
    </section>
  );
}

function foldWord(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function editDistance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

function suggestWords(query: string, words: string[]) {
  const needle = foldWord(query.trim());
  if (needle.length < 2) return [];
  if (words.some((word) => foldWord(word) === needle)) return [];
  const ranked = words.flatMap((word) => {
    const folded = foldWord(word);
    if (folded.startsWith(needle)) return [{ word, score: 1 }];
    if (needle.length >= 3 && folded.includes(needle)) return [{ word, score: 2 }];
    if (folded[0] !== needle[0] || Math.abs(folded.length - needle.length) > 1) return [];
    const distance = editDistance(needle, folded.length > 14 ? folded.slice(0, 14) : folded);
    return distance === 1 ? [{ word, score: 4 }] : [];
  });
  ranked.sort((a, b) => a.score - b.score || a.word.localeCompare(b.word, "pt"));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of ranked) {
    const key = foldWord(item.word);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.word);
    if (out.length === 8) break;
  }
  return out;
}

function FeedbackPanel({ customer }: { customer: Customer | null }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"complaint" | "suggestion">("complaint");
  const [orderRef, setOrderRef] = useState("");
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer ? localMobileDigits(customer.phone) : "");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (sent) {
    return (
      <div className="mx-auto grid max-w-lg gap-3">
        <h1 className="text-4xl">{t("feedbackSentTitle")}</h1>
        <p>{t("feedbackSentBody")}</p>
      </div>
    );
  }
  return (
    <form
      className="mx-auto grid max-w-lg gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const res = await submitFeedback({
          data: { kind, orderRef, name, phone: phone ? `+244${phone}` : "", body },
        });
        setBusy(false);
        if (!res.ok) {
          setError(t("feedbackError"));
          return;
        }
        setSent(true);
      }}
    >
      <h1 className="text-4xl">{t("feedbackTitle")}</h1>
      <div className="flex gap-2">
        <button type="button" onClick={() => setKind("complaint")} className={`rounded-full px-4 py-2 text-sm ${kind === "complaint" ? "bg-blue text-on-blue" : "border border-line"}`}>
          {t("complaint")}
        </button>
        <button type="button" onClick={() => setKind("suggestion")} className={`rounded-full px-4 py-2 text-sm ${kind === "suggestion" ? "bg-blue text-on-blue" : "border border-line"}`}>
          {t("suggestion")}
        </button>
      </div>
      <input value={orderRef} onChange={(event) => setOrderRef(event.target.value)} placeholder={t("orderRef")} className="rounded-full border border-line bg-card px-4 py-3" />
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("namePh")} required className="rounded-full border border-line bg-card px-4 py-3" />
      <label className="flex items-center gap-2 rounded-full border border-line bg-card px-4 py-3">
        <span>+244</span>
        <input value={phone} onChange={(event) => setPhone(localMobileDigits(event.target.value))} inputMode="numeric" placeholder="9XXXXXXXX" required className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={t("feedbackPh")} required minLength={5} rows={5} className="rounded-2xl border border-line bg-card px-4 py-3" />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Btn type="submit" disabled={busy}>{busy ? t("processing") : t("sendFeedback")}</Btn>
    </form>
  );
}

function Catalog({
  view,
  categories,
  homeProducts,
  favoriteProducts,
  popular,
  deals,
  customer,
  onOpenCategory,
  onOpenProduct,
  onAdd,
  onSearch,
  onOpenBundle,
  onAddAll,
  cart,
  onCartQty,
  onCheckout,
  onFavorites,
  onRepeat,
  onFeedback,
}: {
  view: Extract<View, { name: "home" | "browse" }>;
  categories: CategoryRow[];
  homeProducts: ProductCard[];
  favoriteProducts: ProductCard[];
  popular: ProductCard[];
  deals: ProductCard[];
  customer: Customer | null;
  onOpenCategory: (category: CategoryRow) => void;
  onOpenProduct: (sku: string) => void;
  onAdd: (product: ProductCard) => void;
  onSearch: (q: string) => void;
  onOpenBundle: (id: string) => void;
  onAddAll: (products: ProductCard[]) => void;
  cart: CartItem[];
  onCartQty: (sku: string, qty: number) => void;
  onCheckout: () => void;
  onFavorites: () => void;
  onRepeat: () => void;
  onFeedback: () => void;
}) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState(view.name === "browse" ? view.q ?? "" : "");
  const [subs, setSubs] = useState<SubcategoryRow[]>([]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [live, setLive] = useState<ProductCard[] | null>(null);
  const [slide, setSlide] = useState(0);
  const [bundleStock, setBundleStock] = useState<Record<string, ProductCard[]>>({});
  const [dictionary, setDictionary] = useState<string[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  useEffect(() => {
    if (view.name !== "home") return;
    const query = q.trim();
    if (!query && !activeCat) {
      setLive(null);
      return;
    }
    let cancel = false;
    const handle = window.setTimeout(() => {
      searchProducts({
        data: {
          token: localStorage.getItem(TOKEN_KEY) ?? "",
          q: query || undefined,
          categoryId: activeCat ?? undefined,
          limit: 48,
        },
      }).then((res) => {
        if (!cancel && res.ok) setLive(res.products);
      });
    }, 180);
    return () => {
      cancel = true;
      window.clearTimeout(handle);
    };
  }, [q, activeCat, view.name]);
  useEffect(() => {
    if (view.name !== "home") return;
    let cancel = false;
    Promise.all(
      BUNDLES.map(async (bundle) => {
        const rows = await Promise.all(
          bundle.skus.map((sku) => getProduct({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", sku } })),
        );
        return [bundle.id, rows.flatMap((row) => (row.ok ? [row.product] : []))] as const;
      }),
    ).then((pairs) => {
      if (!cancel) setBundleStock(Object.fromEntries(pairs));
    });
    return () => {
      cancel = true;
    };
  }, [view.name]);
  useEffect(() => {
    if (view.name !== "home" || dictionary.length > 0) return;
    searchDictionary().then((res) => {
      if (res.ok) setDictionary(res.words);
    });
  }, [view.name, dictionary.length]);
  useEffect(() => {
    if (view.name !== "browse") return;
    let cancel = false;
    searchProducts({
      data: {
        token: localStorage.getItem(TOKEN_KEY) ?? "",
        q: view.q,
        categoryId: view.categoryId,
        subcategoryId: view.subcategoryId,
        favoritesOnly: view.favorites,
        limit: 240,
      },
    }).then((res) => {
      if (!cancel && res.ok) setProducts(res.products);
    });
    if (view.categoryId) {
      listSubcategories({
        data: { token: localStorage.getItem(TOKEN_KEY) ?? "", categoryId: view.categoryId },
      }).then((res) => {
        if (!cancel && res.ok) setSubs(res.subcategories);
      });
    }
    return () => {
      cancel = true;
    };
  }, [view]);

  if (view.name === "browse") {
    return (
      <div>
        <h1 className="text-3xl">{view.title}</h1>
        {subs.length > 0 ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {subs.map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() =>
                  searchProducts({
                    data: {
                      token: localStorage.getItem(TOKEN_KEY) ?? "",
                      categoryId: view.categoryId,
                      subcategoryId: sub.id,
                      limit: 240,
                    },
                  }).then((res) => {
                    if (res.ok) setProducts(res.products);
                  })
                }
                className="shrink-0 rounded-full border border-line bg-card px-3 py-2 text-sm"
              >
                {subcategoryLabel(sub.name, lang)} · {sub.count}
              </button>
            ))}
          </div>
        ) : null}
        {products.length === 0 ? (
          <div className="mt-8">
            <h2 className="text-2xl">{t("noResults", { query: view.q || view.title })}</h2>
            <p className="mt-2 text-muted">{t("searchHint")}</p>
          </div>
        ) : (
          <ProductGrid products={products} onOpen={onOpenProduct} onAdd={onAdd} />
        )}
      </div>
    );
  }

  const shown = live ?? (deals.length ? [...deals, ...homeProducts.filter((item) => !deals.some((deal) => deal.sku === item.sku))] : homeProducts);
  const activeName = categories.find((category) => category.id === activeCat);
  const hints = suggestWords(q, dictionary);
  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[250px_minmax(0,1fr)_280px] lg:items-start lg:gap-6 lg:px-4 lg:py-4">
      <aside className="order-2 flex gap-2 overflow-x-auto bg-paper px-4 pt-3 pb-1 [scrollbar-width:none] lg:order-none lg:sticky lg:top-20 lg:z-10 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:px-0 lg:py-0">
        <button
          type="button"
          onClick={() => {
            setActiveCat(null);
            setQ("");
          }}
          className={`shrink-0 rounded-full px-3 py-2 text-left text-sm lg:block lg:w-full lg:rounded-lg ${activeCat || q.trim() ? "bg-card ring-1 ring-line" : "bg-blue text-on-blue"}`}
        >
          {t("allAisles")}
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => {
              setActiveCat(category.id);
              setQ("");
            }}
            className={`flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 text-left text-sm whitespace-nowrap lg:mt-1 lg:whitespace-normal lg:w-full lg:rounded-xl lg:px-2 lg:py-2 ${activeCat === category.id ? "bg-blue text-on-blue" : "bg-card ring-1 ring-line lg:bg-transparent lg:ring-0 lg:hover:bg-blue-soft"}`}
          >
            <img src={foto(CAT_PHOTO[category.id] ?? "MER-0001.jpg")} alt="" className="size-10 rounded-lg bg-white object-contain" />
            <span className="min-w-0 flex-1">{categoryLabel(category.id, category.name, lang)}</span>
            <span className="text-xs opacity-70">{category.count}</span>
          </button>
        ))}
        <button type="button" onClick={onFavorites} className="shrink-0 rounded-full bg-card px-3 py-2 text-sm ring-1 ring-line lg:mt-3 lg:block lg:w-full lg:rounded-lg lg:text-left">
          {t("favorites")}
        </button>
      </aside>
      <div className="contents lg:block lg:min-w-0">
        <form
          className="relative order-1 px-4 pt-3 lg:px-0 lg:pt-0"
          onSubmit={(event) => {
            event.preventDefault();
            setActiveCat(null);
            setQ(q.trim());
            setSuggestOpen(false);
          }}
        >
          <label className="relative block">
            <Search className="pointer-events-none absolute top-3.5 left-4 size-5 text-muted" />
            <input
              value={q}
              onChange={(event) => {
                setActiveCat(null);
                setQ(event.target.value);
                setSuggestOpen(true);
              }}
              placeholder={t("searchPh")}
              autoComplete="off"
              className="w-full rounded-full border border-line bg-white py-3 pr-4 pl-12 text-base"
            />
          </label>
          {suggestOpen && hints.length > 0 ? (
            <ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-line bg-white shadow-lg">
              {hints.map((hint) => (
                <li key={hint}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCat(null);
                      setQ(hint);
                      setSuggestOpen(false);
                    }}
                    className="block w-full px-4 py-3 text-left text-base hover:bg-blue-soft"
                  >
                    {hint}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        <div className="order-3 min-w-0 px-4 lg:px-0">
        {!q.trim() && !activeCat ? (
          <OfferRail
            slide={slide}
            items={bundleStock[BUNDLES[slide]?.id ?? ""] ?? []}
            onStep={(delta) => setSlide((current) => (current + delta + BUNDLES.length) % BUNDLES.length)}
            onOpen={onOpenBundle}
            onAdd={onAdd}
            onAddAll={onAddAll}
          />
        ) : null}
        <h1 className="mt-6 text-3xl">
          {q.trim() ? q.trim() : activeName ? categoryLabel(activeName.id, activeName.name, lang) : t("homeLine")}
        </h1>
        {shown.length === 0 ? (
          <p className="mt-4 text-muted">{t("preparing")}</p>
        ) : (
          <ProductGrid products={shown} onOpen={onOpenProduct} onAdd={onAdd} />
        )}
        <footer className="mt-10 flex flex-wrap items-center gap-4 border-t border-line py-8">
          <button type="button" onClick={onFeedback} className="rounded-full border border-blue bg-paper px-4 py-2 text-sm text-blue">
            {t("feedbackBtn")}
          </button>
          <a
            href={STORE_WHATSAPP_LINK}
            target="_blank"
            rel="noreferrer"
            aria-label={t("supportWa")}
            className="grid size-11 place-items-center rounded-full border border-line bg-paper"
          >
            <MessageCircle className="size-5" />
          </a>
        </footer>
        </div>
      </div>
      <aside className="order-4 mt-6 hidden px-4 lg:sticky lg:top-20 lg:mt-0 lg:block lg:px-0">
        <CartSide cart={cart} total={cart.every((item) => typeof item.price === "number") ? cart.reduce((sum, item) => sum + (item.price ?? 0) * item.qty, 0) : null} onCartQty={onCartQty} onCheckout={onCheckout} onRepeat={onRepeat} />
      </aside>
    </div>
  );
}

function CartSide({
  cart,
  total,
  onCartQty,
  onCheckout,
  onRepeat,
}: {
  cart: CartItem[];
  total: number | null;
  onCartQty: (sku: string, qty: number) => void;
  onCheckout: () => void;
  onRepeat: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <h2 className="text-xl">{t("cartTitle")}</h2>
      {cart.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("cartEmptySide")}</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {cart.map((item) => (
            <li key={item.sku} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <img src={foto(`${item.sku}.jpg`)} alt="" className="size-12 shrink-0 rounded-lg bg-white object-contain" />
                <p className="min-w-0 text-sm leading-snug">{item.name}</p>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button type="button" aria-label="-" className="grid size-8 place-items-center rounded-full border border-line" onClick={() => onCartQty(item.sku, item.qty - 1)}>
                  <Minus />
                </button>
                <span className="w-5 text-center text-sm tabular-nums">{item.qty}</span>
                <button type="button" aria-label="+" className="grid size-8 place-items-center rounded-full border border-line" onClick={() => onCartQty(item.sku, item.qty + 1)}>
                  <Plus />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {cart.length > 0 ? (
        <>
          {total != null ? (
            <p className="mt-4 flex items-baseline justify-between text-sm">
              <span>{t("subtotal")}</span>
              <span className="text-lg font-bold tabular-nums whitespace-nowrap">{formatKz(total, lang)}</span>
            </p>
          ) : null}
          <button type="button" onClick={onCheckout} className="mt-4 w-full rounded-full bg-blue py-3 text-sm text-on-blue">
            {t("seeCart")}
          </button>
        </>
      ) : null}
      <button type="button" onClick={onRepeat} className="mt-2 w-full text-sm text-blue">
        {t("repeatLast")}
      </button>
    </div>
  );
}

function ShareBundle({
  title,
  line,
  photo,
  items,
  light,
}: {
  title: string;
  line: string;
  photo: string;
  items: ProductCard[];
  light?: boolean;
}) {
  const { t, lang } = useI18n();
  return (
    <button
      type="button"
      aria-label={t("shareBundle")}
      className={light ? "grid size-11 place-items-center rounded-full border border-line" : "grid size-11 place-items-center rounded-full bg-white text-[#0B1F4D]"}
      onClick={() => {
        void shareBundleCard(title, line, photo, items, lang);
      }}
    >
      <Share2 className="size-5" />
    </button>
  );
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = src;
  });
}

async function shareBundleCard(title: string, line: string, photo: string, items: ProductCard[], lang: "pt" | "fr" | "en") {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0B1F4D";
  ctx.fillRect(0, 0, 1080, 1350);
  try {
    const hero = await loadImage(photo);
    ctx.drawImage(hero, 0, 0, 1080, 620);
  } catch {
    /* the brand band still identifies the campaign */
  }
  ctx.fillStyle = "rgba(11,31,77,0.55)";
  ctx.fillRect(0, 500, 1080, 120);
  ctx.fillStyle = "#FFC700";
  ctx.font = "700 28px sans-serif";
  ctx.fillText("COMPRA TUDO", 48, 560);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 54px sans-serif";
  ctx.fillText(title.slice(0, 28), 48, 620);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 640, 1080, 710);
  ctx.fillStyle = "#0B1F4D";
  ctx.font = "600 32px sans-serif";
  ctx.fillText(line.slice(0, 48), 48, 710);
  let y = 790;
  for (const product of items.slice(0, 4)) {
    try {
      const thumb = await loadImage(foto(product.photoFile));
      ctx.drawImage(thumb, 48, y - 48, 96, 96);
    } catch {
      ctx.fillStyle = "#E7EEF8";
      ctx.fillRect(48, y - 48, 96, 96);
    }
    ctx.fillStyle = "#10233F";
    ctx.font = "700 30px sans-serif";
    ctx.fillText(product.name.slice(0, 32), 168, y);
    ctx.fillStyle = "#1E4FD8";
    ctx.font = "700 28px sans-serif";
    ctx.fillText(formatKz(product.priceAoa, lang), 168, y + 40);
    y += 120;
  }
  ctx.fillStyle = "#0B1F4D";
  ctx.fillRect(0, 1240, 1080, 110);
  ctx.fillStyle = "#FFC700";
  ctx.font = "800 36px sans-serif";
  ctx.fillText("COMPRA TUDO  ·  Luanda", 48, 1305);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) return;
  const file = new File([blob], "compra-tudo.jpg", { type: "image/jpeg" });
  const text = `${title} — ${line}\nCOMPRA TUDO, mercearia em Luanda.\n${window.location.origin}/clientes`;
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `COMPRA TUDO — ${title}`, text });
      return;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

function ProductGrid({
  products,
  onOpen,
  onAdd,
}: {
  products: ProductCard[];
  onOpen: (sku: string) => void;
  onAdd: (product: ProductCard) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {products.map((product) => (
        <article key={product.sku} className="shop-card @container flex h-full min-w-0 flex-col rounded-3xl bg-white p-2 shadow-sm ring-1 ring-line sm:p-3">
          <button type="button" onClick={() => onOpen(product.sku)} className="min-w-0 text-left">
            <div className="bg-white p-2">
              <ProductPhoto name={product.name} file={product.photoFile} />
            </div>
            <div className="px-1 pt-2 @[12rem]:px-3">
              <p className="truncate text-xs text-muted">{product.brand}</p>
              <h3 className="line-clamp-2 min-h-[2.75em] text-base leading-snug">{product.name}</h3>
              <p className="truncate text-xs text-muted">{product.format}</p>
            </div>
          </button>
          <div className="mt-auto px-1 pt-2 pb-2 @[12rem]:px-3 sm:pb-3">
            {product.compareAtAoa ? (
              <p className="text-sm font-bold text-blue">-{Math.round((1 - product.priceAoa / product.compareAtAoa) * 100)}%</p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-base leading-none font-bold whitespace-nowrap tabular-nums @[10rem]:text-lg @[13rem]:text-2xl">{formatKz(product.priceAoa, lang)}</p>
              {product.availability === "out" ? null : (
                <button type="button" aria-label={t("add")} onClick={() => onAdd(product)} className="grid size-9 shrink-0 place-items-center rounded-full bg-gold text-on-gold @[10rem]:size-10 @[13rem]:size-11">
                  <Plus />
                </button>
              )}
            </div>
            {product.availability === "low" && product.stockLeft != null ? (
              <p className="mt-1 text-xs">{t("lowStock", { n: product.stockLeft })}</p>
            ) : null}
            {product.availability === "out" ? <p className="mt-1 text-xs text-muted">{t("soldOut")}</p> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function RecipeList({
  product,
  ingredients,
  onOpen,
  onAdd,
}: {
  product: ProductCard;
  ingredients: ProductCard[];
  onOpen: (sku: string) => void;
  onAdd: (product: ProductCard) => void;
}) {
  const { t, lang } = useI18n();
  const recipe = matchRecipe(product);
  if (!recipe) return null;
  return (
    <section className="grid gap-3 rounded-2xl bg-white p-3 ring-1 ring-line">
      <p className="text-sm text-blue">{t("recipeKicker")}</p>
      <img src={`${recipe.photo}?v=5`} alt={recipe.title[lang]} className="aspect-[4/3] w-full rounded-xl bg-white object-contain" />
      <h2 className="text-2xl font-bold">{recipe.title[lang]}</h2>
      <p>{recipe.steps[lang]}</p>
      <h3 className="text-base">{t("recipeList")}</h3>
      <ul className="grid gap-2">
        {ingredients.map((item) => (
          <li key={item.sku} className="flex items-center gap-2">
            <button type="button" onClick={() => onOpen(item.sku)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <img src={foto(item.photoFile)} alt="" className="size-14 shrink-0 rounded-lg bg-white object-contain" />
              <span className="min-w-0">
                <span className="line-clamp-2 block text-sm">{item.name}</span>
                <span className="font-bold tabular-nums">{formatKz(item.priceAoa, lang)}</span>
              </span>
            </button>
            {item.availability === "out" ? null : (
              <button type="button" onClick={() => onAdd(item)} className="shrink-0 rounded-full bg-gold px-3 py-2 text-sm text-on-gold">
                {t("addOne")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          for (const item of ingredients) {
            if (item.availability !== "out") onAdd(item);
          }
        }}
        className="rounded-full bg-blue px-4 py-3 text-on-blue"
      >
        {t("addRecipe")}
      </button>
    </section>
  );
}

function ProductPanel({ sku, onAdd, onOpen }: { sku: string; onAdd: (product: ProductCard, qty?: number) => void; onOpen: (sku: string) => void }) {
  const { t, lang } = useI18n();
  const [product, setProduct] = useState<ProductCard | null>(null);
  const [related, setRelated] = useState<ProductCard[]>([]);
  const [ingredients, setIngredients] = useState<ProductCard[]>([]);
  const [note, setNote] = useState("");
  const [missingPhoto, setMissingPhoto] = useState(false);
  const [qty, setQty] = useState(1);
  useEffect(() => {
    setMissingPhoto(false);
    setQty(1);
    setRelated([]);
    setIngredients([]);
    getProduct({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", sku } }).then((res) => {
      if (!res.ok) return;
      setProduct(res.product);
      const recipe = matchRecipe(res.product);
      if (recipe) {
        Promise.all(recipe.skus.map((item) => getProduct({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", sku: item } }))).then((rows) => {
          setIngredients(rows.flatMap((row) => (row.ok ? [row.product] : [])));
        });
      }
      searchProducts({
        data: {
          token: localStorage.getItem(TOKEN_KEY) ?? "",
          categoryId: res.product.categoryId,
          limit: 40,
        },
      }).then((more) => {
        if (!more.ok) return;
        const others = more.products.filter((item) => item.sku !== res.product.sku);
        const step = Math.max(1, Math.ceil(others.length / 8));
        setRelated(others.filter((_, index) => index % step === 0).slice(0, 8));
      });
    });
  }, [sku]);
  if (!product) return <p>{t("preparing")}</p>;
  const choices = drinkChoices(product);
  const picked = choices?.some((choice) => choice.qty === qty) ? qty : (choices?.[0]?.qty ?? 1);
  return (
    <article className="mx-auto grid min-w-0 max-w-xl gap-4 [&>*]:min-w-0">
      <ProductPhoto name={product.name} file={product.photoFile} onMissing={() => setMissingPhoto(true)} />
      {missingPhoto ? <p className="text-sm text-muted">{t("photoSoon", { file: product.photoFile })}</p> : null}
      <p className="text-sm text-muted">{product.brand} · {product.format} · {product.unit}</p>
      <h1 className="text-3xl sm:text-4xl">{product.name}</h1>
      <p>{product.description}</p>
      {product.compareAtAoa ? (
        <p className="text-muted line-through tabular-nums">{t("beforePrice", { price: formatKz(product.compareAtAoa, lang) })}</p>
      ) : null}
      <p className="font-display text-3xl font-bold tabular-nums sm:text-4xl">{formatKz(product.priceAoa, lang)}</p>
      <p className="text-sm text-muted">{t("todayPrice")}</p>
      {product.promoEnds ? <p className="text-sm">{t("promoUntil", { date: product.promoEnds })}</p> : null}
      {product.availability === "low" && product.stockLeft != null ? <p>{t("lowStock", { n: product.stockLeft })}</p> : null}
      {product.availability === "out" ? <p>{t("soldOut")}</p> : null}
      {choices && choices.length > 1 ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted">{t("drinkHow")}</p>
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <button
                key={choice.qty}
                type="button"
                onClick={() => setQty(choice.qty)}
                className={`min-h-11 rounded-full px-4 text-sm ${picked === choice.qty ? "bg-blue text-on-blue" : "bg-card ring-1 ring-line"}`}
              >
                {choice.kind === "unit"
                  ? t("drinkUnit")
                  : choice.kind === "crate"
                    ? t("drinkCrate", { n: choice.qty })
                    : t("drinkPack", { n: choice.qty })}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {note ? <p className="text-sm text-green">{note}</p> : null}
      {product.availability === "out" ? (
        <Btn
          onClick={async () => {
            await requestRestock({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", sku } });
            setNote(t("notified"));
          }}
        >
          {t("notifyMe")}
        </Btn>
      ) : (
        <Btn onClick={() => onAdd(product, picked)}>{t("add")}</Btn>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-2 text-sm text-blue"
        onClick={async () => {
          const res = await toggleFavorite({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", sku } });
          if (res.ok) {
            setProduct({ ...product, favorite: res.favorite });
            setNote(res.favorite ? t("favOn") : t("favAdd"));
          }
        }}
      >
        <Heart className={product.favorite ? "fill-green text-green" : ""} />
        {product.favorite ? t("favOn") : t("favAdd")}
      </button>
      {ingredients.length > 0 ? (
        <RecipeList
          product={product}
          ingredients={ingredients}
          onOpen={onOpen}
          onAdd={onAdd}
        />
      ) : null}
      {related.length > 0 ? (
        <section>
          <h2 className="text-lg">{t("alsoCategory")}</h2>
          <div className="mt-2 flex min-w-0 gap-2 overflow-x-auto pb-1">
            {related.map((item) => (
              <button key={item.sku} type="button" onClick={() => onOpen(item.sku)} className="w-20 shrink-0 text-left">
                <img src={foto(item.photoFile)} alt="" className="size-16 rounded-xl bg-white object-contain ring-1 ring-line" />
                <span className="mt-1 line-clamp-2 block text-xs leading-snug">{item.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function CartPanel({
  cart,
  pin,
  onChange,
  onCheckout,
  onBrowse,
  onAdjusted,
}: {
  cart: CartItem[];
  pin: Pin;
  onChange: (sku: string, qty: number) => void;
  onCheckout: () => void;
  onBrowse: () => void;
  onAdjusted: (items: CartItem[]) => void;
}) {
  const { t, lang } = useI18n();
  const [coupon, setCoupon] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [lines, setLines] = useState<{ sku: string; name: string; qty: number; unitPrice: number; compareAt: number | null; lineTotal: number }[]>([]);
  const [totals, setTotals] = useState({ subtotal: 0, delivery: 0, discount: 0, total: 0, note: "" });
  useEffect(() => {
    if (cart.length === 0) return;
    quoteCart({
      data: {
        token: localStorage.getItem(TOKEN_KEY) ?? "",
        items: cart.map((item) => ({ sku: item.sku, qty: item.qty })),
        couponCode: coupon || undefined,
        lat: pin.lat,
        lng: pin.lng,
      },
    }).then((res) => {
      if (!res.ok) return;
      setLines(res.quote.lines);
      setTotals({
        subtotal: res.quote.subtotal,
        delivery: res.quote.delivery,
        discount: res.quote.discount,
        total: res.quote.total,
        note: res.quote.discountNote ?? "",
      });
      if (res.quote.couponError) setQuoteNote(t("couponBad"));
      else if (coupon && !res.quote.couponError) setQuoteNote(t("couponOk"));
      if (res.quote.adjustments.length) {
        const map = new Map(res.quote.adjustments.map((item) => [item.sku, item.qty]));
        onAdjusted(
          cart
            .map((item) => (map.has(item.sku) ? { ...item, qty: map.get(item.sku) ?? 0 } : item))
            .filter((item) => item.qty > 0),
        );
        const first = res.quote.adjustments[0];
        setQuoteNote(t("stockAdjusted", { name: first.name, n: first.qty }));
      }
    });
    // quote when cart identity changes; coupon applied via button
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, pin.lat, pin.lng]);

  if (cart.length === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="text-4xl">{t("cartEmptyTitle")}</h1>
        <p className="mt-3">{t("cartEmptyBody")}</p>
        <div className="mt-8">
          <Btn onClick={onBrowse}>{t("seeCatalog")}</Btn>
        </div>
      </div>
    );
  }
  const shown = lines.length ? lines : cart.map((item) => ({ ...item, unitPrice: 0, compareAt: null, lineTotal: 0 }));
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <h1 className="text-4xl">{t("cartTitle")}</h1>
      <p>{t("eta", { eta: etaLabel(pin.lat, pin.lng) })}</p>
      {shown.map((line) => (
        <div key={line.sku} className="flex gap-3 rounded-lg border border-line bg-card p-3">
          <img src={foto(`${line.sku}.jpg`)} alt="" className="size-16 shrink-0 rounded-lg bg-white object-contain" />
          <div className="min-w-0 flex-1">
          <p>{line.name}</p>
          {line.compareAt ? <p className="text-sm text-muted">{t("promoLine")}</p> : null}
          <div className="mt-2 flex items-center justify-between">
            <p className="tabular-nums">{line.unitPrice ? formatKz(line.unitPrice, lang) : ""}</p>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="-" className="grid size-11 place-items-center rounded-full border border-line" onClick={() => onChange(line.sku, line.qty - 1)}>
                <Minus />
              </button>
              <span className="w-6 text-center tabular-nums">{line.qty}</span>
              <button type="button" aria-label="+" className="grid size-11 place-items-center rounded-full border border-line" onClick={() => onChange(line.sku, line.qty + 1)}>
                <Plus />
              </button>
            </div>
          </div>
          </div>
        </div>
      ))}
      {totals.note ? <p className="text-sm">{t("discountLine", { note: totals.note })}</p> : null}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          quoteCart({
            data: {
              token: localStorage.getItem(TOKEN_KEY) ?? "",
              items: cart.map((item) => ({ sku: item.sku, qty: item.qty })),
              couponCode: coupon,
              lat: pin.lat,
              lng: pin.lng,
            },
          }).then((res) => {
            if (!res.ok) return;
            setLines(res.quote.lines);
            setTotals({
              subtotal: res.quote.subtotal,
              delivery: res.quote.delivery,
              discount: res.quote.discount,
              total: res.quote.total,
              note: res.quote.discountNote ?? "",
            });
            setQuoteNote(res.quote.couponError ? t("couponBad") : t("couponOk"));
          });
        }}
      >
        <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder={t("couponPh")} className="flex-1 rounded-full border border-line bg-card px-4 py-3" />
        <button type="submit" className="rounded-full border border-blue px-4 text-sm text-blue">{t("applyCoupon")}</button>
      </form>
      {quoteNote ? <p className="text-sm">{quoteNote}</p> : null}
      <dl className="grid gap-1 text-sm">
        <div className="flex justify-between"><dt>{t("subtotal")}</dt><dd className="tabular-nums">{formatKz(totals.subtotal, lang)}</dd></div>
        <div className="flex justify-between"><dt>{t("delivery")}</dt><dd className="tabular-nums">{formatKz(totals.delivery, lang)}</dd></div>
        {totals.discount > 0 ? <div className="flex justify-between"><dt>−</dt><dd className="tabular-nums">{formatKz(totals.discount, lang)}</dd></div> : null}
        <div className="flex justify-between text-lg font-bold"><dt>{t("total")}</dt><dd className="tabular-nums">{formatKz(totals.total, lang)}</dd></div>
      </dl>
      <p className="text-sm text-muted">{t("feesNote")}</p>
      <Btn onClick={onCheckout}>{t("goDelivery")}</Btn>
      <button type="button" className="text-sm text-blue" onClick={onBrowse}>{t("addMore")}</button>
    </div>
  );
}

function AddressPanel({
  pin,
  cart,
  onPin,
  onContinue,
}: {
  pin: Pin;
  cart: CartItem[];
  onPin: (pin: Pin) => void;
  onContinue: () => void;
}) {
  const { t, lang } = useI18n();
  const [complement, setComplement] = useState(localStorage.getItem("ct-complement") ?? "");
  const [place, setPlace] = useState("");
  const [fee, setFee] = useState<number | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const inside = fee != null;
  useEffect(() => {
    let live = true;
    quoteCart({
      data: {
        token: localStorage.getItem(TOKEN_KEY) ?? "",
        items: cart.map((item) => ({ sku: item.sku, qty: item.qty })),
        lat: pin.lat,
        lng: pin.lng,
      },
    }).then((res) => {
      if (!live || !res.ok) return;
      setFee(res.quote.inZone ? res.quote.delivery : null);
      setZone(res.quote.zoneName);
    });
    return () => {
      live = false;
    };
  }, [cart, pin.lat, pin.lng]);
  useEffect(() => {
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pin.lat}&lon=${pin.lng}&zoom=18&addressdetails=1`,
        { headers: { "accept-language": "pt" }, signal: ctrl.signal },
      )
        .then((res) => res.json())
        .then((data: { address?: Record<string, string> }) => {
          const a = data.address ?? {};
          const line = [a.road, a.suburb || a.neighbourhood || a.quarter, a.city || a.town || "Luanda"]
            .filter(Boolean)
            .join(", ");
          if (line) setPlace(line);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [pin.lat, pin.lng]);
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <p className="text-sm text-green">{t("step1")}</p>
      <h1 className="text-3xl sm:text-4xl">{t("addrTitle")}</h1>
      <p>{t("mapHelp")}</p>
      <button
        type="button"
        className="text-sm text-blue"
        onClick={() => {
          if (!navigator.geolocation) return;
          navigator.geolocation.getCurrentPosition((pos) => {
            onPin({ ...pin, lat: pos.coords.latitude, lng: pos.coords.longitude });
          });
        }}
      >
        {t("useHere")}
      </button>
      <PinMap lat={pin.lat} lng={pin.lng} onChange={(lat, lng) => onPin({ ...pin, lat, lng, label: pin.label })} />
      {place ? <p className="text-sm">{place}</p> : null}
      <p className="text-sm text-muted">{t("spots")}</p>
      <div className="flex flex-wrap gap-2">
        {SPOTS.map((spot) => (
          <button key={spot.label} type="button" onClick={() => onPin(spot)} className={`rounded-full px-3 py-2 text-sm ${spot.label === pin.label ? "bg-blue text-on-blue" : "bg-card ring-1 ring-line"}`}>
            {spot.label}
          </button>
        ))}
      </div>
      <label className="grid gap-1 text-sm">
        {t("complement")}
        <input
          value={complement}
          onChange={(e) => {
            setComplement(e.target.value);
            localStorage.setItem("ct-complement", e.target.value);
          }}
          className="rounded-md border border-line bg-card px-3 py-3 font-normal"
        />
      </label>
      {fee == null ? <p className="text-sm text-danger">{t("outOfZone")}</p> : (
        <p className="text-sm tabular-nums">
          {zone ? t("zoneLine", { zone, fee: formatKz(fee, lang), eta: etaLabel(pin.lat, pin.lng) }) : t("zonePlain", { fee: formatKz(fee, lang), eta: etaLabel(pin.lat, pin.lng) })}
        </p>
      )}
      <p className="text-sm text-muted">{t("carrierHidden")}</p>
      <Btn disabled={!inside} onClick={onContinue}>{t("useAddress")}</Btn>
    </div>
  );
}

function PayPanel({
  cart,
  pin,
  busy,
  onPlace,
}: {
  cart: CartItem[];
  pin: Pin;
  busy: boolean;
  onPlace: (method: Pay, coupon: string, slot: { start: string; end: string; label: string }) => void;
}) {
  const { t, lang } = useI18n();
  const [method, setMethod] = useState<Pay | "">("");
  const [total, setTotal] = useState(0);
  const [coupon, setCoupon] = useState("");
  const [slots, setSlots] = useState<{ start: string; end: string; label: string; left: number }[]>([]);
  const [slotStart, setSlotStart] = useState("");
  useEffect(() => {
    listOpenSlots({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "" } }).then((res) => {
      if (res.ok) setSlots(res.slots);
    });
  }, []);
  useEffect(() => {
    quoteCart({
      data: {
        token: localStorage.getItem(TOKEN_KEY) ?? "",
        items: cart.map((item) => ({ sku: item.sku, qty: item.qty })),
        lat: pin.lat,
        lng: pin.lng,
      },
    }).then((res) => {
      if (res.ok) setTotal(res.quote.total);
    });
  }, [cart, pin.lat, pin.lng]);
  const options: { id: Pay; label: string }[] = [
    { id: "multicaixa", label: t("payMc") },
    { id: "unitel_money", label: t("payUnitel") },
    { id: "appypay", label: t("payAppy") },
    { id: "cash", label: t("payCash") },
  ];
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <p className="text-sm text-green">{t("step2")}</p>
      <h1 className="text-4xl">{t("payTitle")}</h1>
      <fieldset className="grid gap-2">
        <legend className="text-lg">{t("slotTitle")}</legend>
        {slots.length === 0 ? <p className="text-sm text-muted">{t("slotEmpty")}</p> : null}
        {slots.map((slot) => (
          <label key={slot.start} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-3">
            <span className="flex items-center gap-3">
              <input type="radio" name="slot" checked={slotStart === slot.start} onChange={() => setSlotStart(slot.start)} />
              {slot.label}
            </span>
            <span className="text-sm text-muted">{t("slotLeft", { n: slot.left })}</span>
          </label>
        ))}
      </fieldset>
      {options.map((option) => (
        <label key={option.id} className="flex items-center gap-3 rounded-lg border border-line bg-card px-3 py-3">
          <input type="radio" name="pay" checked={method === option.id} onChange={() => setMethod(option.id)} />
          {option.label}
        </label>
      ))}
      <p className="text-sm">{t("noCard")}</p>
      <p className="text-sm">{t("feesNote")}</p>
      <p className="text-sm text-muted">{t("payDemo")}</p>
      <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder={t("couponPh")} className="rounded-full border border-line bg-card px-4 py-3" />
      <Btn disabled={!method || !slotStart || busy} onClick={() => {
        const slot = slots.find((item) => item.start === slotStart);
        if (method && slot) onPlace(method, coupon, slot);
      }}>
        {busy ? t("processing") : t("confirmOrder", { total: formatKz(total, lang) })}
      </Btn>
    </div>
  );
}

function TrackPanel({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [stars, setStars] = useState(0);
  const [thanks, setThanks] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => {
      getOrder({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", orderId: id } }).then((res) => {
        if (live && res.ok) setOrder(res.order);
      });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [id]);
  if (!order) return <p>{t("preparing")}</p>;
  const delivery = order.delivery;
  const estado = delivery?.estado || (order.status === "delivered" ? "entregue" : order.status === "cancelled" ? "cancelado" : order.status === "on_the_way" ? "a_caminho_do_cliente" : "pendente");
  const step = PROGRESS_STATES.indexOf(estado as (typeof PROGRESS_STATES)[number]);
  const exception = step < 0;
  const phone = delivery?.courierPhone;
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <h1 className="text-4xl">{t("orderNo", { id: `CT-${order.number}` })}</h1>
      <p className="text-lg">{exception ? STATUS_LABEL[estado as keyof typeof STATUS_LABEL] ?? estado : STATUS_LABEL[estado as keyof typeof STATUS_LABEL] ?? estado}</p>
      <p className="text-sm text-muted">{t("demoPace")}</p>
      <ol className="grid grid-cols-7 gap-1">
        {PROGRESS_STATES.map((state, index) => (
          <li key={state} className={`h-2 rounded-full ${!exception && index <= step ? "bg-green" : "bg-line"}`} title={STATUS_LABEL[state]} />
        ))}
      </ol>
      <p className="text-sm">{STATUS_LABEL[estado as keyof typeof STATUS_LABEL] ?? order.status}</p>
      {delivery?.carrierName ? <p className="text-sm">{delivery.carrierName}</p> : <p className="text-sm text-muted">{t("carrierHidden")}</p>}
      <PinMap
        lat={order.lat}
        lng={order.lng}
        readOnly
        onChange={() => undefined}
        courier={delivery?.courierLat != null && delivery.courierLng != null ? { lat: delivery.courierLat, lng: delivery.courierLng } : null}
      />
      <p className="text-sm text-muted">{order.addressLabel} {order.complement}</p>
      {delivery?.courierName ? (
        <div className="rounded-lg border border-line bg-card p-4">
          <p>{delivery.courierName}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {phone ? (
              <a href={`tel:${phone}`} className="inline-flex items-center gap-2 rounded-full bg-blue px-4 py-2 text-sm text-on-blue">
                <Phone className="size-4" />
                {t("callCourier")}
              </a>
            ) : null}
            {phone ? (
              <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-green px-4 py-2 text-sm text-on-green">
                <MessageCircle className="size-4" />
                {t("waCourier")}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      {delivery?.pin ? (
        <div className="rounded-lg bg-gold/40 p-4">
          <p className="text-sm">{t("pinTitle")}</p>
          <p className="font-display text-4xl tabular-nums tracking-widest">{delivery.pin}</p>
          <p className="text-sm">{t("pinHelp")}</p>
        </div>
      ) : null}
      {delivery?.whatsappSent ? <p className="text-sm">{t("waNotice")}</p> : null}
      <a href={STORE_WHATSAPP_LINK} target="_blank" rel="noreferrer" className="text-sm text-blue">{t("supportWaHelp")}</a>
      <p className="font-bold tabular-nums">{formatKz(order.totalAoa, lang)}</p>
      {estado === "entregue" && !thanks && delivery?.rating == null ? (
        <div>
          <p>{t("rateTitle")}</p>
          <div className="mt-2 flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                className={`size-11 rounded-full ${stars === value ? "bg-blue text-on-blue" : "bg-card ring-1 ring-line"}`}
                onClick={async () => {
                  setStars(value);
                  const res = await rateDelivery({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", orderId: id, rating: value } });
                  if (res.ok) setThanks(true);
                }}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {thanks || (delivery?.rating != null && estado === "entregue") ? <p>{t("rateThanks")}</p> : null}
    </div>
  );
}

function OrdersPanel({
  onOpen,
  onRepeat,
}: {
  onOpen: (id: string) => void;
  onRepeat: (order: OrderSummary) => void;
}) {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  useEffect(() => {
    listOrders({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "" } }).then((res) => {
      if (res.ok) setOrders(res.orders);
    });
  }, []);
  if (!orders) return <p>{t("preparing")}</p>;
  if (orders.length === 0) return <p>{t("ordersEmpty")}</p>;
  return (
    <div className="grid gap-3">
      {orders.map((order) => (
        <article key={order.id} className="rounded-lg border border-line bg-card p-4">
          <button type="button" onClick={() => onOpen(order.id)} className="text-left">
            <h2 className="font-sans text-lg">CT-{order.number}</h2>
            <p className="text-sm text-muted">{order.status} · {formatKz(order.totalAoa, lang)}</p>
          </button>
          <button type="button" className="mt-2 text-sm text-blue" onClick={() => onRepeat(order)}>
            {t("reorder")}
          </button>
        </article>
      ))}
    </div>
  );
}

function AccountPanel({
  customer,
  onSignedOut,
  onOrders,
  onPrivacy,
}: {
  customer: Customer;
  onSignedOut: () => void;
  onOrders: () => void;
  onPrivacy: () => void;
}) {
  const { t } = useI18n();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    listNotices({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "" } }).then((res) => {
      if (res.ok) setNotices(res.notices);
    });
  }, []);
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <h1 className="text-4xl">{customer.name}</h1>
      <p className="tabular-nums">{formatPhone(customer.phone)}</p>
      <button type="button" className="text-left text-blue" onClick={onOrders}>{t("history")}</button>
      <section>
        <h2 className="text-2xl">{t("notices")}</h2>
        {notices.length === 0 ? <p className="text-sm text-muted">{t("none")}</p> : null}
        <ul className="mt-2 grid gap-2">
          {notices.map((notice) => (
            <li key={notice.id} className="rounded-md bg-card px-3 py-2 text-sm ring-1 ring-line">{notice.title}</li>
          ))}
        </ul>
      </section>
      <button
        type="button"
        className="rounded-full border border-line bg-card px-4 py-3 text-left text-sm"
        onClick={() => {
          if (typeof Notification === "undefined") return;
          void Notification.requestPermission();
        }}
      >
        <span className="block">{t("enablePush")}</span>
        <span className="text-muted">{t("pushHelp")}</span>
      </button>
      <button type="button" className="text-left text-sm text-blue" onClick={onPrivacy}>{t("privacy")}</button>
      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="font-sans text-lg">{t("deleteEntry")}</h2>
        <p className="mt-2 text-sm">{t("deleteExplain")}</p>
        <p className="mt-2 text-sm">{t("deleteConfirm", { word: t("deleteWord") })}</p>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-2 w-full rounded-md border border-line px-3 py-3" />
        <button
          type="button"
          className="mt-3 text-sm text-danger"
          onClick={async () => {
            const res = await deleteAccount({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "", confirm } });
            if (!res.ok) return;
            setMessage(t("deleteOk"));
            onSignedOut();
          }}
        >
          {t("deleteBtn")}
        </button>
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </section>
      <button
        type="button"
        className="text-sm"
        onClick={async () => {
          await logout({ data: { token: localStorage.getItem(TOKEN_KEY) ?? "" } });
          onSignedOut();
        }}
      >
        {t("signOut")}
      </button>
    </div>
  );
}

function PrivacyBlock() {
  const { t } = useI18n();
  return (
    <article className="mx-auto max-w-lg">
      <h1 className="text-4xl">{t("privacyTitle")}</h1>
      <p className="mt-4">{t("privacyBody")}</p>
    </article>
  );
}

