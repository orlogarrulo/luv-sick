import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  COPY,
  LANGS,
  PAY,
  payMethod,
  PRACTICE_EMAIL,
  PRODUCTS,
  SHOP_EMAIL,
  SIZES,
  WA,
  formatAmount,
  formatMoney,
  kzAmount,
  payUnit,
  productById,
  quote,
  splitHalf,
  type Lang,
  type Market,
  type Product,
} from "@/lib/luvsick";
import { DIALS, dialOf, fullPhone } from "@/lib/dials";
import { phoneOk } from "@/lib/phone";
import { PAY_COPY, PayDetails, openStripe } from "@/components/luvsick-pay";
import { luvAccount, luvAskCode, luvCheckCoupon, luvEnter, luvMode, luvPlace, luvReserve, luvSaveAddress, luvStock, luvVisit } from "@/server/fns";

type Line = { productId: string; size: string; qty: number };
type View = "splash" | "shop" | "store" | "product" | "bag" | "reserve" | "checkout" | "sent" | "account";
type Form = { name: string; phone: string; address: string; city: string; country: "AO" | "PT"; postal: string };

const BAG_KEY = "luvsick-bag";
const LANG_KEY = "luvsick-lang";
const MARKET_KEY = "luvsick-market";
const VISITOR_KEY = "luvsick-visitor";
const SOUND_KEY = "luvsick-sound";
const WISH_KEY = "luvsick-wish";
const SESSION_KEY = "luvsick-session";

function stockKey(productId: string, size: string) {
  return `${productId}|${size}`;
}

function readBag(): Line[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BAG_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((line) => productById(String(line.productId)) && (SIZES as readonly string[]).includes(line.size) && Number(line.qty) > 0);
  } catch {
    return [];
  }
}

function countOf(lines: Line[]) {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

function shapePostal(country: "AO" | "PT", raw: string) {
  if (country === "PT") {
    const digits = raw.replace(/\D/g, "").slice(0, 7);
    return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
  }
  return raw.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 10);
}

function postalOk(country: "AO" | "PT", postal: string) {
  if (country === "PT") return /^\d{4}-\d{3}$/.test(postal);
  return postal.trim().length >= 3;
}

function waLink(market: Market, text: string) {
  return `https://wa.me/${WA[market].n}?text=${encodeURIComponent(text)}`;
}

type Account = {
  email: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postal: string;
  orders: { ref: string; totalLabel: string; createdAt: string; paid: boolean }[];
  reservations: { ref: string; depositLabel: string; balanceLabel: string; createdAt: string; paid: boolean }[];
};

export function LuvSickApp() {
  const [view, setView] = useState<View>("splash");
  const [lang, setLang] = useState<Lang>("pt");
  const [market, setMarket] = useState<Market>("PT");
  const [lines, setLines] = useState<Line[]>([]);
  const [productId, setProductId] = useState(PRODUCTS[0].id);
  const [shot, setShot] = useState(0);
  const [size, setSize] = useState<string>("M");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [waOpen, setWaOpen] = useState(false);
  const [form, setForm] = useState<Form>({ name: "", phone: "", address: "", city: "", country: "PT", postal: "" });
  const [pay, setPay] = useState("");
  const [payError, setPayError] = useState("");
  const [errors, setErrors] = useState<Partial<Form>>({});
  const [orderError, setOrderError] = useState("");
  const [stock, setStock] = useState<Record<string, number>>({});
  const [stockKnown, setStockKnown] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [couponPercent, setCouponPercent] = useState(0);
  const [couponNote, setCouponNote] = useState("");
  const [refCode, setRefCode] = useState("");
  const [ready, setReady] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [wish, setWish] = useState<string[]>([]);
  const [wishOnly, setWishOnly] = useState(false);
  const [stockIn, setStockIn] = useState(false);
  const [stripe, setStripe] = useState(false);
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<"order" | "reserve">("order");
  const [paper, setPaper] = useState({ deposit: "", balance: "", total: "", receiptNo: "", invoiceNo: "", emailed: false });
  const [trial, setTrial] = useState(false);
  const [phoneIso, setPhoneIso] = useState("PT");
  const [session, setSession] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [code, setCode] = useState("");
  const [codeNote, setCodeNote] = useState("");
  const [addressNote, setAddressNote] = useState("");
  const sound = useRef<HTMLAudioElement | null>(null);
  const t = COPY[lang];
  const product = productById(productId) ?? PRODUCTS[0];
  const pieces = countOf(lines);

  useEffect(() => {
    const el = new Audio("/luvsick/brand/house.mp3");
    el.loop = true;
    el.volume = 0.22;
    sound.current = el;
    return () => {
      el.pause();
    };
  }, []);

  function playSound() {
    const el = sound.current;
    if (!el) return;
    el.play()
      .then(() => {
        setSoundOn(true);
        localStorage.setItem(SOUND_KEY, "on");
      })
      .catch(() => setSoundOn(false));
  }

  function toggleSound() {
    const el = sound.current;
    if (!el) return;
    if (soundOn) {
      el.pause();
      setSoundOn(false);
      localStorage.setItem(SOUND_KEY, "off");
      return;
    }
    playSound();
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedLang = params.get("l");
    const savedLang = localStorage.getItem(LANG_KEY);
    if (linkedLang === "pt" || linkedLang === "en" || linkedLang === "fr") setLang(linkedLang);
    else if (savedLang === "pt" || savedLang === "en" || savedLang === "fr") setLang(savedLang);
    const savedMarket = localStorage.getItem(MARKET_KEY);
    if (savedMarket === "PT" || savedMarket === "AO") {
      setMarket(savedMarket);
      setPhoneIso(savedMarket);
      setForm((current) => ({ ...current, country: savedMarket }));
    } else detectMarket((next) => {
      setMarket(next);
      setPhoneIso(next);
    });
    setLines(readBag());
    try {
      const savedWish = JSON.parse(localStorage.getItem(WISH_KEY) ?? "[]");
      if (Array.isArray(savedWish)) {
        setWish(savedWish.filter((id) => typeof id === "string" && productById(id)));
      }
    } catch {
      setWish([]);
    }
    const opened = params.get("p");
    if (opened && productById(opened)) {
      setProductId(opened);
      setView("product");
      window.history.replaceState({ view: "product", productId: opened }, "");
    } else {
      window.history.replaceState({ view: "splash" }, "");
    }
    setReady(true);
    const token = localStorage.getItem(SESSION_KEY);
    if (token) {
      luvAccount({ data: { token } }).then((res) => {
        if (!res.ok) {
          localStorage.removeItem(SESSION_KEY);
          return;
        }
        setSession(token);
        setAccount(res.account);
      });
    }
    luvStock()
      .then((rows) => {
        const next: Record<string, number> = {};
        rows.forEach((row) => {
          next[stockKey(row.productId, row.size)] = row.qty;
        });
        setStock(next);
        setStockKnown(true);
      })
      .catch(() => setStockKnown(false));
    luvMode()
      .then((mode) => {
        setStockIn(mode.stockIn);
        setStripe(Boolean(mode.stripe));
      })
      .catch(() => setStockIn(false));
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(BAG_KEY, JSON.stringify(lines));
  }, [lines, ready]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!ready) return;
    let visitor = localStorage.getItem(VISITOR_KEY) ?? "";
    if (!/^[a-zA-Z0-9-]{8,}$/.test(visitor)) {
      visitor = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, visitor);
    }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fallback = zone === "Africa/Luanda" ? { country: "Angola", city: "Luanda" } : zone === "Europe/Lisbon" ? { country: "Portugal", city: "Lisboa" } : { country: "Desconhecido", city: "Desconhecida" };
    fetch("https://ipapi.co/json/")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { country_name?: string; city?: string }) =>
        luvVisit({ data: { visitor, country: data.country_name || fallback.country, city: data.city || fallback.city } }),
      )
      .catch(() => luvVisit({ data: { visitor, country: fallback.country, city: fallback.city } }));
  }, [ready]);

  const priced = useMemo(() => quote(lines, market, couponPercent), [lines, market, couponPercent]);
  const totalLabel = formatAmount(priced.total, market);

  function toggleWish(id: string) {
    setWish((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      localStorage.setItem(WISH_KEY, JSON.stringify(next));
      return next;
    });
  }

  function shareProduct(id: string) {
    const item = productById(id);
    if (!item) return;
    const url = `${window.location.origin}/?p=${encodeURIComponent(id)}&l=${lang}&card=1`;
    const text = t.shareLine.replace("{name}", item.name[lang]);
    const payload = { title: `${item.name[lang]} — Luv Sick`, text, url };
    if (typeof navigator.share === "function") {
      navigator.share(payload).catch(() => undefined);
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener,noreferrer");
  }

  function chooseLang(next: Lang) {
    setLang(next);
    localStorage.setItem(LANG_KEY, next);
  }

  function chooseMarket(next: Market) {
    setMarket(next);
    setPhoneIso(next);
    setPay("");
    setForm((current) => ({ ...current, country: next, postal: shapePostal(next, current.postal) }));
    localStorage.setItem(MARKET_KEY, next);
  }

  async function applyCoupon() {
    const checked = await luvCheckCoupon({ data: { coupon } });
    if (!checked.ok) {
      setCouponPercent(0);
      setCouponNote(t.couponBad);
      return;
    }
    setCoupon(checked.code);
    setCouponPercent(checked.percent);
    setCouponNote(t.couponOk.replace("{n}", String(checked.percent)));
  }

  function available(productId: string, size: string) {
    if (!stockKnown) return 99;
    return stock[stockKey(productId, size)] ?? 0;
  }

  function inBag(productId: string, size: string) {
    return lines.find((line) => line.productId === productId && line.size === size)?.qty ?? 0;
  }

  function addProduct(productId: string, nextSize: string) {
    if (available(productId, nextSize) - inBag(productId, nextSize) < 1) {
      setOrderError(t.noStock);
      return;
    }
    setOrderError("");
    setProductId(productId);
    setSize(nextSize);
    setLines((current) => {
      const found = current.find((line) => line.productId === productId && line.size === nextSize);
      if (found) return current.map((line) => (line === found ? { ...line, qty: line.qty + 1 } : line));
      return [...current, { productId, size: nextSize, qty: 1 }];
    });
    setView("bag");
  }

  function addCurrent() {
    addProduct(product.id, size);
  }

  function setQty(index: number, qty: number) {
    setLines((current) =>
      current.flatMap((line, i) => {
        if (i !== index) return [line];
        if (qty < 1) return [];
        return [{ ...line, qty: Math.min(qty, available(line.productId, line.size)) }];
      }),
    );
  }

  function orderText(code: string) {
    const rows = lines
      .map((line) => {
        const item = productById(line.productId);
        if (!item) return "";
        const deal = priced.tracksuitDeal && item.id.startsWith("tracksuit-");
        const each = payUnit(item, market, deal);
        return `- ${item.name[lang]} · ${line.size} · ${line.qty} × ${formatAmount(each, market)} = ${formatAmount(each * line.qty, market)}${deal ? " (−10%)" : ""}`;
      })
      .filter(Boolean)
      .join("\n");
    return [
      `${t.ref}: ${code}`,
      `${t.name}: ${form.name.trim()}`,
      `${t.phone}: ${fullPhone(phoneIso, form.phone)}`,
      `${t.address}: ${form.address.trim()}`,
      `${t.city}: ${form.city.trim()}`,
      `${t.country}: ${form.country === "AO" ? "Angola" : "Portugal"}`,
      `${t.postal}: ${form.postal.trim()}`,
      `${t.pay}: ${PAY[market].find((item) => item.id === pay)?.label ?? ""}`,
      "",
      rows,
      "",
      `${t.total}: ${totalLabel}`,
      priced.tracksuitDeal ? `${t.tracksuitDeal} −${formatAmount(priced.tracksuitOff, market)}` : "",
      couponPercent ? `${t.coupon} ${coupon} −${formatAmount(priced.couponOff, market)}` : "",
      "",
      t.orderLead,
    ].join("\n");
  }


  async function submitReserve(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Form> = {};
    if (!form.name.trim()) next.name = t.required;
    if (!phoneOk(phoneIso, form.phone)) next.phone = form.phone.replace(/\D/g, "") ? t.phoneBad : t.required;
    setErrors(next);
    const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!pay) setPayError(t.required);
    if (Object.keys(next).length || !mailOk || !pay || lines.length === 0) {
      if (!mailOk) setOrderError(t.emailBad);
      return;
    }
    const placed = await luvReserve({ data: { lines, name: form.name, phone: fullPhone(phoneIso, form.phone), email, pay, market, lang } });
    if (!placed.ok) {
      setOrderError(placed.error === "stock" ? t.noStock : placed.error === "phone" ? t.phoneBad : placed.error === "closed" ? t.buy : t.required);
      if (placed.error === "closed") setStockIn(true);
      if (placed.error === "stock") {
        const rows = await luvStock();
        const nextStock: Record<string, number> = {};
        rows.forEach((row) => {
          nextStock[stockKey(row.productId, row.size)] = row.qty;
        });
        setStock(nextStock);
        setStockKnown(true);
      }
      return;
    }
    setRefCode(placed.ref);
    setTrial(email.trim().toLowerCase() === PRACTICE_EMAIL);
    setPaper({
      deposit: placed.depositLabel,
      balance: placed.balanceLabel,
      total: placed.totalLabel,
      receiptNo: placed.receiptNo,
      invoiceNo: placed.invoiceNo,
      emailed: placed.emailed,
    });
    setOrderError("");
    setCodeNote(placed.codeSent ? t.codeSent : placed.codePending ? t.codeWhatsapp : t.codeFail);
    setKind("reserve");
    setView("sent");
    if (payMethod(market, pay)?.kind === "card") void openStripe(placed.ref).catch(() => false);
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Form> = {};
    (["name", "address", "city"] as const).forEach((key) => {
      if (!form[key].trim()) next[key] = t.required;
    });
    if (!phoneOk(phoneIso, form.phone)) next.phone = form.phone.replace(/\D/g, "") ? t.phoneBad : t.required;
    if (!postalOk(form.country, form.postal)) next.postal = t.postalBad;
    setErrors(next);
    const known = PAY[market].some((item) => item.id === pay);
    const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    setPayError(known ? "" : t.pickPay);
    if (!mailOk) setOrderError(t.emailBad);
    if (Object.keys(next).length || !known || !mailOk || lines.length === 0) return;
    const placed = await luvPlace({
      data: {
        lines,
        name: form.name,
        phone: fullPhone(phoneIso, form.phone),
        address: form.address,
        city: form.city,
        country: form.country,
        postal: form.postal,
        market,
        pay,
        coupon: couponPercent ? coupon : "",
        email,
        lang,
      },
    });
    if (!placed.ok) {
      setOrderError(placed.error === "coupon" ? t.couponBad : placed.error === "phone" ? t.phoneBad : placed.error === "form" ? t.postalBad : placed.error === "pay" ? t.pickPay : t.noStock);
      const rows = await luvStock();
      const nextStock: Record<string, number> = {};
      rows.forEach((row) => {
        nextStock[stockKey(row.productId, row.size)] = row.qty;
      });
      setStock(nextStock);
      setStockKnown(true);
      return;
    }
    setRefCode(placed.ref);
    setTrial(placed.trial);
    setPaper({
      deposit: placed.totalLabel,
      balance: placed.totalLabel,
      total: placed.totalLabel,
      receiptNo: placed.receiptNo,
      invoiceNo: placed.invoiceNo,
      emailed: false,
    });
    setOrderError("");
    setCodeNote(placed.codeSent ? t.codeSent : placed.codePending ? t.codeWhatsapp : t.codeFail);
    setKind("order");
    setView("sent");
    if (!placed.trial && payMethod(market, pay)?.kind === "card") void openStripe(placed.ref).catch(() => false);
  }

  function remember(token: string, next: Account) {
    localStorage.setItem(SESSION_KEY, token);
    setSession(token);
    setAccount(next);
    setCode("");
    setCodeNote("");
    setView("account");
  }

  async function submitCode(event: { preventDefault: () => void }) {
    event.preventDefault();
    const res = await luvEnter({ data: { email, code } });
    if (!res.ok) {
      setCodeNote(t.codeBad);
      return;
    }
    remember(res.token, res.account);
  }

  async function askCode(event: FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setCodeNote(t.emailBad);
      return;
    }
    const res = await luvAskCode({ data: { email, lang } });
    if (!res.ok) {
      setCodeNote(t.noOrders);
      return;
    }
    setCodeNote(res.sent ? t.codeSent : res.pending ? t.codeWhatsapp : t.codeFail);
  }

  async function saveAddress(event: FormEvent) {
    event.preventDefault();
    if (!session || !account) return;
    const res = await luvSaveAddress({
      data: { token: session, address: account.address, city: account.city, country: account.country || "PT", postal: account.postal },
    });
    if (!res.ok) {
      setAddressNote(t.postalBad);
      return;
    }
    setAccount(res.account);
    setAddressNote(t.addressSaved);
  }

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const state = (event.state ?? {}) as { view?: View; productId?: string };
      if (state.productId && productById(state.productId)) setProductId(state.productId);
      setView(state.view ?? "shop");
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openProduct(id: string) {
    setProductId(id);
    setShot(0);
    setSize("M");
    setView("product");
    window.history.pushState({ view: "product", productId: id }, "");
    window.scrollTo(0, 0);
  }

  function leaveProduct() {
    if (window.history.state?.view === "product") window.history.back();
    else {
      setView("store");
      window.scrollTo(0, 0);
    }
  }

  function goHome(anchor?: string) {
    setView("shop");
    window.setTimeout(() => {
      if (!anchor || anchor === "inicio") window.scrollTo({ top: 0, behavior: "smooth" });
      else document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
    }, 40);
  }

  function goStore() {
    setWishOnly(false);
    setView("store");
    window.history.pushState({ view: "store" }, "");
    window.scrollTo(0, 0);
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setSession("");
    setAccount(null);
    setView("shop");
  }

  return (
    <div className="min-h-dvh bg-[#f4f1ec] text-[#1a1714]">
      {view === "splash" ? (
        <section className="flex min-h-dvh w-full items-center justify-center bg-black text-white">
          <div className="flex flex-col items-center justify-center gap-16 px-6">
            <img src="/luvsick/brand/logo-white.svg" alt="Luv Sick" className="h-48 w-48 object-contain sm:h-56 sm:w-56" />
            <button
              type="button"
              onClick={() => { if (localStorage.getItem(SOUND_KEY) !== "off") playSound(); setView("shop"); window.history.pushState({ view: "shop" }, ""); }}
              className="btn-enter rounded-full border border-white bg-white px-10 py-3 text-[11px] font-medium tracking-[0.18em] text-black uppercase" style={{ borderRadius: "9999px" }}
            >
              {t.enter}
            </button>
          </div>
        </section>
      ) : (
        <>
          <header className="sticky top-0 z-20 border-b border-[#e4ddd4] bg-[#f4f1ec]/95 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              {view === "product" ? (
                <button type="button" onClick={leaveProduct} className="grid size-11 place-items-center text-xl" aria-label={lang === "en" ? "Back" : lang === "fr" ? "Retour" : "Voltar"}>
                  ←
                </button>
              ) : null}
              <button type="button" onClick={() => { setView("shop"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="mr-auto shrink-0" aria-label="Luv Sick">
                <img src="/luvsick/brand/logo-black.svg" alt="Luv Sick" className="h-11 w-11 object-contain" />
              </button>
              <div className="flex rounded-full ring-1 ring-[#1a1714]/25" role="group" aria-label={t.langName}>
                {LANGS.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => chooseLang(code)}
                    aria-pressed={lang === code}
                    className={`px-2 py-1 text-xs font-bold uppercase ${lang === code ? "bg-[#1a1714] text-white" : ""}`}
                  >
                    {code}
                  </button>
                ))}
              </div>
              <div className="flex rounded-full ring-1 ring-[#1a1714]/25" role="group" aria-label={t.marketName}>
                {(["PT", "AO"] as Market[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => chooseMarket(code)}
                    aria-pressed={market === code}
                    className={`px-2 py-1 text-xs font-bold ${market === code ? "bg-[#1a1714] text-white" : ""}`}
                  >
                    {code === "PT" ? "€" : "Kz"}
                  </button>
                ))}
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-label={t.whatsapp}
                  aria-expanded={waOpen}
                  onClick={() => setWaOpen((open) => !open)}
                  className="grid size-11 place-items-center"
                >
                  <WaIcon />
                </button>
                {waOpen ? (
                  <div className="absolute right-0 z-30 mt-1 grid w-44 gap-1 rounded-2xl border border-[#e4ddd4] bg-white p-2 text-[#1a1714]">
                    {(["AO", "PT"] as Market[]).map((code) => (
                      <a
                        key={code}
                        href={`https://wa.me/${WA[code].n}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`px-2 py-2 text-sm font-bold ${code === market ? "bg-[#1a1714] text-white" : ""}`}
                        onClick={() => setWaOpen(false)}
                      >
                        {WA[code].label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={toggleSound} className="grid size-11 place-items-center" aria-pressed={soundOn} aria-label={soundOn ? t.mute : t.sound}>
                <SpeakerIcon on={soundOn} />
              </button>
              <button
                type="button"
                onClick={() => { setWishOnly((on) => !on); setView("store"); window.history.pushState({ view: "store" }, ""); window.scrollTo(0, 0); }}
                className="relative grid size-11 place-items-center"
                aria-pressed={wishOnly}
                aria-label={t.wish}
              >
                <HeartIcon on={wishOnly || wish.length > 0} />
                {wish.length > 0 ? <span className="absolute top-0 right-0 grid min-w-5 place-items-center rounded-full bg-[#1a1714] px-1 text-[10px] font-bold text-white">{wish.length}</span> : null}
              </button>
              <button type="button" onClick={() => { setView("account"); window.scrollTo(0, 0); }} className="grid size-11 place-items-center" aria-label={t.account}>
                <AccountIcon />
              </button>
              <button type="button" onClick={() => setView("bag")} className="relative grid size-11 place-items-center" aria-label={`${t.bag}${pieces ? ` ${pieces}` : ""}`}>
                <BagIcon />
                {pieces > 0 ? <span className="absolute top-0 right-0 grid min-w-5 place-items-center rounded-full bg-[#1a1714] px-1 text-[10px] font-bold text-white">{pieces}</span> : null}
              </button>
            </div>
            {view === "shop" || view === "store" ? (
              <nav className="flex gap-4 overflow-x-auto px-4 pb-2 text-[11px] tracking-[0.18em] uppercase" aria-label={t.shop}>
                {[
                  ["inicio", t.home],
                  ["loja", t.shop],
                  ["marca", t.about],
                  ["contacto", t.contact],
                ].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => (id === "loja" ? goStore() : goHome(id))} className="shrink-0 py-1">
                    {label}
                  </button>
                ))}
              </nav>
            ) : null}
          </header>

          {view === "shop" ? (
            <>
              <section id="inicio">
                <video
                  src="/luvsick/brand/hero-meet-17.mp4"
                  poster="/luvsick/brand/hero-meet-12.jpg"
                  className="mx-auto block h-auto max-h-[70vh] w-full bg-[#cbb7a2] object-contain"
                  autoPlay
                  muted
                  loop
                  playsInline
                />
                <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
                  <p className="luv-title text-[11px] tracking-[0.28em] uppercase">{t.newIn}</p>
                  <h1 className="mt-2 text-4xl leading-tight font-medium tracking-tight sm:text-6xl">{t.heroTitle}</h1>
                  <button type="button" onClick={goStore} className="btn-brown mx-auto mt-5 block rounded-full px-12 py-6" style={{ fontSize: 22 }}>
                    {t.shop}
                  </button>
                </div>
              </section>
              <DetailReel lang={lang} onOpen={openProduct} />
            </>
          ) : null}
          {view === "store" ? (
            <Catalog market={market} lang={lang} stock={stock} known={stockKnown} stockIn={stockIn} wish={wish} wishOnly={wishOnly} onWish={toggleWish} onShare={shareProduct} onOpen={openProduct} onBuy={(id) => {
                const open = SIZES.find((option) => available(id, option) > 0);
                if (!open) {
                  setOrderError(t.noStock);
                  return;
                }
                addProduct(id, open);
              }} />
          ) : null}
          {view === "product" ? (
            <ProductView
              product={product}
              lang={lang}
              market={market}
              shot={shot}
              size={size}
              onShot={setShot}
              onSize={setSize}
              onAdd={addCurrent}
              left={available(product.id, size)}
              selling={stockIn}
              wished={wish.includes(product.id)}
              onWish={() => toggleWish(product.id)}
              onShare={() => shareProduct(product.id)}
            />
          ) : null}
          {view === "bag" ? <BagView lines={lines} lang={lang} market={market} priced={priced} actionLabel={stockIn ? t.checkout : t.reserve} onQty={setQty} onCheckout={() => setView(stockIn ? "checkout" : "reserve")} /> : null}
          {view === "reserve" ? (
            <form onSubmit={submitReserve} className="mx-auto grid max-w-lg gap-3 px-4 py-6">
              <h1 className="text-3xl font-bold">{t.reserve}</h1>
              <p className="text-sm text-[#1a1714]/70">{t.reserveOk}</p>
              <ul className="grid gap-2">
                {lines.map((line) => {
                  const item = productById(line.productId);
                  if (!item) return null;
                  return <li key={`${line.productId}-${line.size}`} className="text-sm">{item.name[lang]} · {line.size} · {line.qty}</li>;
                })}
              </ul>
              <p className="text-sm">{t.total} {formatAmount(priced.total, market)}</p>
              <p className="font-bold">{t.halfNow}: {formatAmount(splitHalf(priced.total).deposit, market)}</p>
              <p className="text-sm text-[#1a1714]/70">{t.halfLater}</p>
              <p className="text-sm">{t.invoiceWord}: {formatAmount(splitHalf(priced.total).balance, market)}</p>
              <label className="grid gap-1 text-sm font-bold">
                {t.name}
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" autoComplete="name" />
                {errors.name ? <span className="font-normal text-[#1a1714]/70">{errors.name}</span> : null}
              </label>
              <PhoneField iso={phoneIso} local={form.phone} label={t.phone} error={errors.phone} onIso={setPhoneIso} onLocal={(value) => setForm({ ...form, phone: value })} />
              <label className="grid gap-1 text-sm font-bold">
                {t.email}
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" />
              </label>
              {orderError ? <p className="text-sm">{orderError}</p> : null}
              <fieldset className="grid gap-2">
                <legend className="text-sm font-bold">{t.pay}</legend>
                {PAY[market].map((item) => {
                  const off = item.kind === "card" && !stripe;
                  return (
                    <label key={item.id} className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${off ? "cursor-not-allowed border-[#1a1714]/15 opacity-50" : pay === item.id ? "border-[#1a1714] bg-[#1a1714] text-white" : "border-[#1a1714]/25"}`}>
                      <input type="radio" name="reserve-pay" disabled={off} checked={pay === item.id} onChange={() => { setPay(item.id); setPayError(""); }} />
                      <span className="font-bold">{item.label}{off ? ` · ${PAY_COPY[lang].soon}` : ""}</span>
                    </label>
                  );
                })}
                {payError ? <span className="text-sm text-[#1a1714]/70">{payError}</span> : null}
              </fieldset>
              {pay ? <PayDetails market={market} pay={pay} amountLabel={formatAmount(splitHalf(priced.total).deposit, market)} lang={lang} stripe={stripe} /> : null}
              <button className="btn-brown w-fit rounded-full px-5 py-3">{t.halfNow}</button>
            </form>
          ) : null}
          {view === "checkout" ? (
            <form onSubmit={submitOrder} className="mx-auto grid max-w-lg gap-3 px-4 py-6">
              <h1 className="text-3xl font-bold">{t.checkout}</h1>
              <label className="grid gap-1 text-sm font-bold">
                {t.name}
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal text-[#1a1714]" autoComplete="name" />
                {errors.name ? <span className="font-normal text-[#1a1714]/70">{errors.name}</span> : null}
              </label>
              <PhoneField iso={phoneIso} local={form.phone} label={t.phone} error={errors.phone} onIso={setPhoneIso} onLocal={(value) => setForm({ ...form, phone: value })} />
              {(["address", "city"] as const).map((key) => (
                <label key={key} className="grid gap-1 text-sm font-bold">
                  {t[key]}
                  <input
                    value={form[key]}
                    onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                    className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal text-[#1a1714]"
                    autoComplete={key === "address" ? "street-address" : "address-level2"}
                  />
                  {errors[key] ? <span className="font-normal text-[#1a1714]/70">{errors[key]}</span> : null}
                </label>
              ))}
              <label className="grid gap-1 text-sm font-bold">
                {t.email}
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal text-[#1a1714]" autoComplete="email" />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                {t.country}
                <select
                  value={form.country}
                  onChange={(event) => chooseMarket(event.target.value === "AO" ? "AO" : "PT")}
                  className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal text-[#1a1714]"
                >
                  <option value="AO">Angola</option>
                  <option value="PT">Portugal</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-bold">
                {t.postal}
                <input
                  value={form.postal}
                  inputMode={form.country === "PT" ? "numeric" : "text"}
                  autoComplete="postal-code"
                  placeholder={form.country === "PT" ? "0000-000" : ""}
                  onChange={(event) => setForm({ ...form, postal: shapePostal(form.country, event.target.value) })}
                  className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal text-[#1a1714]"
                />
                {errors.postal ? <span className="font-normal text-[#1a1714]/70">{errors.postal}</span> : null}
              </label>
              <Totals lang={lang} market={market} priced={priced} />
              <label className="grid gap-1 text-sm font-bold">
                {t.coupon}
                <span className="flex gap-2">
                  <input value={coupon} onChange={(event) => setCoupon(event.target.value.toUpperCase())} className="min-w-0 flex-1 rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal uppercase text-[#1a1714]" />
                  <button type="button" onClick={applyCoupon} className="btn-brown rounded-full px-4">{t.apply}</button>
                </span>
                {couponNote ? <span className="font-normal text-[#1a1714]/70">{couponNote}</span> : null}
              </label>
              {orderError ? <p className="text-sm text-[#1a1714]/70">{orderError}</p> : null}
              <fieldset className="grid gap-2">
                <legend className="text-sm font-bold">{t.pay}</legend>
                {PAY[market].map((item) => {
                  const off = item.kind === "card" && !stripe;
                  return (
                    <label key={item.id} className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${off ? "cursor-not-allowed border-[#1a1714]/15 opacity-50" : pay === item.id ? "border-[#1a1714] bg-[#1a1714] text-white" : "border-[#1a1714]/25"}`}>
                      <input
                        type="radio"
                        name="pay"
                        disabled={off}
                        checked={pay === item.id}
                        onChange={() => { setPay(item.id); setPayError(""); }}
                      />
                      <span className="font-bold">{item.label}{off ? ` · ${PAY_COPY[lang].soon}` : ""}</span>
                    </label>
                  );
                })}
                {payError ? <span className="text-sm text-[#1a1714]/70">{payError}</span> : null}
              </fieldset>
              {pay ? <PayDetails market={market} pay={pay} amountLabel={totalLabel} lang={lang} stripe={stripe} /> : null}
              <button className="btn-brown rounded-full px-4 py-3">{t.send}</button>
            </form>
          ) : null}
          {view === "sent" && kind === "reserve" ? (
            <section className="mx-auto grid max-w-lg gap-4 px-4 py-8">
              <p className="text-sm font-bold tracking-[0.18em] uppercase text-[#1a1714]/70">{refCode}</p>
              <h1 className="text-3xl font-bold">{t.reserveWait}</h1>
              <p>{t.halfLater}</p>
              {trial ? <p className="text-sm text-[#1a1714]/70">{t.practice}</p> : null}
              <p>{form.name.trim()} · {fullPhone(phoneIso, form.phone)}</p>
              <p>{email.trim()}</p>
              <p className="font-bold">{t.receiptWord} {paper.receiptNo} · {paper.deposit}</p>
              <p className="font-bold">{t.invoiceWord} {paper.invoiceNo} · {paper.balance}</p>
              <p className="text-sm text-[#1a1714]/70">{paper.emailed ? t.mailed : t.halfLater}</p>
              <PayDetails market={market} pay={pay} amountLabel={paper.deposit} refCode={refCode} lang={lang} stripe={stripe} />
              <a href={`/recibo/${refCode}`} className="text-sm underline">{PAY_COPY[lang].proofLink} · {t.receiptWord} · {t.invoiceWord}</a>
              <form onSubmit={submitCode} className="grid gap-2">
                <p className="text-sm">{codeNote}</p>
                <label className="grid gap-1 text-sm font-bold">
                  {t.codeLabel}
                  <input value={code} inputMode="numeric" autoComplete="one-time-code" onChange={(event) => setCode(event.target.value)} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" />
                </label>
                <button className="btn-brown w-fit rounded-full px-5 py-3">{t.account}</button>
              </form>
              <ul className="grid gap-2">
                {lines.map((line) => {
                  const item = productById(line.productId);
                  if (!item) return null;
                  return <li key={`${line.productId}-${line.size}`}>{item.name[lang]} · {line.size} · {line.qty}</li>;
                })}
              </ul>
              <button type="button" onClick={() => { setLines([]); setKind("order"); goStore(); }} className="text-sm underline">{t.continueShop}</button>
            </section>
          ) : null}
          {view === "sent" && kind === "order" ? (
            <section className="mx-auto grid max-w-lg gap-4 px-4 py-8">
              <p className="text-sm font-bold tracking-[0.18em] uppercase text-[#1a1714]/70">{t.successTitle}</p>
              <h1 className="text-4xl font-bold">{refCode}</h1>
              <p>{t.thanks}</p>
              <div className="grid gap-3 rounded-[2rem] bg-white p-5 text-black">
                <p className="font-bold">{form.name.trim()}</p>
                <p className="text-sm">{fullPhone(phoneIso, form.phone)}</p>
                <p className="text-sm">{form.address.trim()}, {form.postal.trim()} {form.city.trim()}, {form.country === "AO" ? "Angola" : "Portugal"}</p>
                <ul className="grid gap-2 border-t border-black/10 pt-3">
                  {lines.map((line) => {
                    const item = productById(line.productId);
                    if (!item) return null;
                    const deal = priced.tracksuitDeal && item.id.startsWith("tracksuit-");
                    const each = payUnit(item, market, deal);
                    return (
                      <li key={`${line.productId}-${line.size}`} className="flex items-center justify-between gap-3 text-sm">
                        <span>{item.name[lang]} · {line.size} · {line.qty}{deal ? " · −10%" : ""}</span>
                        <span className="font-bold">{formatAmount(each * line.qty, market)}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="border-t border-black/10 pt-3 text-sm">{t.pay}: <span className="font-bold">{PAY[market].find((item) => item.id === pay)?.label}</span></p>
                <p className="text-lg font-bold">{t.total} {totalLabel}</p>
              </div>
              <p className="text-sm text-[#1a1714]/70">{trial ? t.practice : t.sentNote}</p>
              {trial ? (
                <p className="font-bold">{t.receiptWord} {paper.receiptNo} · {t.invoiceWord} {paper.invoiceNo}</p>
              ) : null}
              {trial ? null : <PayDetails market={market} pay={pay} amountLabel={totalLabel} refCode={refCode} lang={lang} stripe={stripe} />}
              <a href={`/recibo/${refCode}`} className="text-sm underline">{trial ? `${t.receiptWord} · ${t.invoiceWord}` : `${PAY_COPY[lang].proofLink} · Talão de compra`}</a>
              <form onSubmit={submitCode} className="grid gap-2">
                <p className="text-sm">{codeNote}</p>
                <label className="grid gap-1 text-sm font-bold">
                  {t.codeLabel}
                  <input value={code} inputMode="numeric" autoComplete="one-time-code" onChange={(event) => setCode(event.target.value)} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" />
                </label>
                <button className="btn-brown w-fit rounded-full px-5 py-3">{t.account}</button>
              </form>
              <a href={waLink(market, orderText(refCode))} target="_blank" rel="noreferrer" className="btn-brown rounded-full px-4 py-3 text-center">
                {t.whatsapp} · {WA[market].label}
              </a>
              <a href={waLink(market === "AO" ? "PT" : "AO", orderText(refCode))} target="_blank" rel="noreferrer" className="text-center text-sm underline">
                {t.otherNumber} · {WA[market === "AO" ? "PT" : "AO"].label}
              </a>
              {SHOP_EMAIL ? (
                <a
                  href={`mailto:${SHOP_EMAIL}?subject=${encodeURIComponent(refCode)}&body=${encodeURIComponent(orderText(refCode))}`}
                  className="text-center underline"
                >
                  Email
                </a>
              ) : null}
              <button type="button" onClick={() => { setLines([]); goStore(); }} className="text-sm underline">
                {t.continueShop}
              </button>
            </section>
          ) : null}

          {view === "account" ? (
            <section className="mx-auto grid max-w-lg gap-4 px-4 py-8">
              <h1 className="text-3xl font-bold">{t.account}</h1>
              {account && session ? (
                <>
                  <p className="font-bold">{account.name}</p>
                  <p>{account.email}</p>
                  <p>{account.phone}</p>
                  <form onSubmit={saveAddress} className="grid gap-2">
                    <label className="grid gap-1 text-sm font-bold">
                      {t.address}
                      <input value={account.address} onChange={(event) => setAccount({ ...account, address: event.target.value })} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" />
                    </label>
                    <label className="grid gap-1 text-sm font-bold">
                      {t.city}
                      <input value={account.city} onChange={(event) => setAccount({ ...account, city: event.target.value })} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" />
                    </label>
                    <label className="grid gap-1 text-sm font-bold">
                      {t.country}
                      <select value={account.country || "PT"} onChange={(event) => setAccount({ ...account, country: event.target.value })} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal">
                        <option value="AO">Angola</option>
                        <option value="PT">Portugal</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-bold">
                      {t.postal}
                      <input value={account.postal} onChange={(event) => setAccount({ ...account, postal: event.target.value })} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" />
                    </label>
                    <button className="btn-brown w-fit rounded-full px-5 py-3">{t.saveAddress}</button>
                    {addressNote ? <p className="text-sm">{addressNote}</p> : null}
                  </form>
                  <h2 className="font-bold">{t.myOrders}</h2>
                  {account.orders.length + account.reservations.length === 0 ? <p>{t.noOrders}</p> : null}
                  <ul className="grid gap-3">
                    {account.orders.map((order) => (
                      <li key={order.ref} className={`grid gap-1 rounded-2xl px-3 py-3 ${order.paid ? "bg-[#e5f4ea]" : "bg-white"}`}>
                        <p>{order.ref} · {order.totalLabel}</p>
                        <PayMark paid={order.paid} done={t.paidOk} wait={t.awaitPay} />
                      </li>
                    ))}
                    {account.reservations.map((item) => (
                      <li key={item.ref} className={`grid gap-1 rounded-2xl px-3 py-3 ${item.paid ? "bg-[#e5f4ea]" : "bg-white"}`}>
                        <p>{item.ref} · {item.depositLabel} · {item.balanceLabel}</p>
                        <PayMark paid={item.paid} done={t.paidOk} wait={t.awaitPay} />
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={logout} className="text-sm underline">{t.logout}</button>
                </>
              ) : (
                <form onSubmit={askCode} className="grid gap-3">
                  <label className="grid gap-1 text-sm font-bold">
                    {t.email}
                    <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" />
                  </label>
                  <button className="btn-brown w-fit rounded-full px-5 py-3">{t.sendCode}</button>
                  <label className="grid gap-1 text-sm font-bold">
                    {t.codeLabel}
                    <input value={code} inputMode="numeric" autoComplete="one-time-code" onChange={(event) => setCode(event.target.value)} className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal" />
                  </label>
                  <button type="button" onClick={submitCode} className="w-fit rounded-full px-5 py-3 ring-1 ring-[#1a1714]">{t.account}</button>
                  {codeNote ? <p className="text-sm">{codeNote}</p> : null}
                </form>
              )}
            </section>
          ) : null}
          {view === "shop" ? <Story lang={lang} /> : null}
          {view === "shop" ? <Faq lang={lang} open={openFaq} onToggle={(index) => setOpenFaq((current) => (current === index ? null : index))} /> : null}
          <p className="bg-[#1c1917] px-4 py-8 text-center text-xs tracking-[0.16em] text-white/70">© LUV SICK · Since 2025</p>
        </>
      )}
    </div>
  );
}

function detectMarket(setMarket: (market: Market) => void) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fromZone: Market | null = zone === "Africa/Luanda" ? "AO" : zone === "Europe/Lisbon" ? "PT" : null;
  fetch("https://ipapi.co/json/")
    .then((res) => (res.ok ? res.json() : Promise.reject()))
    .then((data: { country_code?: string }) => {
      if (localStorage.getItem(MARKET_KEY)) return;
      setMarket(data.country_code === "AO" ? "AO" : "PT");
    })
    .catch(() => {
      if (!localStorage.getItem(MARKET_KEY) && fromZone) setMarket(fromZone);
    });
}

function Totals({ lang, market, priced }: { lang: Lang; market: Market; priced: ReturnType<typeof quote> }) {
  const t = COPY[lang];
  return (
    <div className="grid gap-1 text-sm">
      <p>{t.subtotal} {formatAmount(priced.sub, market)}</p>
      {priced.tracksuitDeal ? <p>{t.tracksuitDeal} −{formatAmount(priced.tracksuitOff, market)}</p> : null}
      {priced.couponOff ? <p>{t.coupon} −{formatAmount(priced.couponOff, market)}</p> : null}
      <p className="text-lg font-bold">{t.total} {formatAmount(priced.total, market)}</p>
    </div>
  );
}

const SPIN: Record<string, { video?: string; stills?: [string, string]; a: string; b: string; la: Record<Lang, string>; lb: Record<Lang, string> }> = {
  "tracksuit-brown": {
    video: "/luvsick/spin/brown-4.mp4",
    a: "/luvsick/details/brown-hoodie.jpg",
    b: "/luvsick/details/brown-pants.jpg",
    la: { pt: "Hoodie", en: "Hoodie", fr: "Hoodie" },
    lb: { pt: "Calças", en: "Trousers", fr: "Pantalon" },
  },
  "long-sleeve": {
    video: "/luvsick/spin/sleeve.mp4",
    a: "/luvsick/details/sleeve-front.jpg",
    b: "/luvsick/details/sleeve-arm.jpg",
    la: { pt: "Frente", en: "Front", fr: "Face" },
    lb: { pt: "Manga", en: "Sleeve", fr: "Manche" },
  },
  "tracksuit-black": {
    video: "/luvsick/spin/black-4.mp4",
    a: "/luvsick/details/black-hoodie.jpg",
    b: "/luvsick/details/black-pants.jpg",
    la: { pt: "Hoodie", en: "Hoodie", fr: "Hoodie" },
    lb: { pt: "Calças", en: "Trousers", fr: "Pantalon" },
  },
};

type Detail = { src: string; label: Record<Lang, string> };
const SIDE_DETAILS: Record<string, { front: Detail[]; back: Detail[] }> = {
  "long-sleeve": {
    front: [
      { src: "/luvsick/details/sleeve-front.jpg", label: { pt: "Frente", en: "Front", fr: "Face" } },
      { src: "/luvsick/details/sleeve-arm.jpg", label: { pt: "Manga", en: "Sleeve", fr: "Manche" } },
    ],
    back: [
      { src: "/luvsick/details/sleeve-back-script.jpg", label: { pt: "Lettering na manga", en: "Sleeve lettering", fr: "Lettrage sur la manche" } },
      { src: "/luvsick/details/sleeve-back.jpg", label: { pt: "Costas", en: "Back", fr: "Dos" } },
    ],
  },
  "tracksuit-black": {
    front: [
      { src: "/luvsick/details/black-hoodie.jpg", label: { pt: "Coração no peito", en: "Chest heart", fr: "Cœur poitrine" } },
      { src: "/luvsick/details/black-cuff.jpg", label: { pt: "Punho", en: "Cuff", fr: "Poignet" } },
      { src: "/luvsick/details/black-hem-signature.jpg", label: { pt: "Assinatura na bainha", en: "Hem signature", fr: "Signature sur l'ourlet" } },
      { src: "/luvsick/details/black-pants.jpg", label: { pt: "Calças", en: "Trousers", fr: "Pantalon" } },
    ],
    back: [
      { src: "/luvsick/details/black-hood.jpg", label: { pt: "Capuz", en: "Hood", fr: "Capuche" } },
      { src: "/luvsick/details/black-back-hem-2.jpg", label: { pt: "Assinatura", en: "Signature", fr: "Signature" } },
    ],
  },
  "tracksuit-brown": {
    front: [
      { src: "/luvsick/details/brown-hoodie.jpg", label: { pt: "Coração no peito", en: "Chest heart", fr: "Cœur poitrine" } },
      { src: "/luvsick/details/brown-cuff.jpg", label: { pt: "Punho", en: "Cuff", fr: "Poignet" } },
      { src: "/luvsick/details/brown-hem-signature.jpg", label: { pt: "Assinatura na bainha", en: "Hem signature", fr: "Signature sur l'ourlet" } },
      { src: "/luvsick/details/brown-pants.jpg", label: { pt: "Calças", en: "Trousers", fr: "Pantalon" } },
    ],
    back: [
      { src: "/luvsick/details/brown-hood.jpg", label: { pt: "Capuz", en: "Hood", fr: "Capuche" } },
      { src: "/luvsick/details/brown-back-hem-2.jpg", label: { pt: "Assinatura", en: "Signature", fr: "Signature" } },
    ],
  },
};

function PhotoZoom({ src, alt, className, imgClassName, caption, gallery, index = 0 }: { src: string; alt: string; className?: string; imgClassName?: string; caption?: string; gallery?: { src: string; alt: string }[]; index?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <img src={src} alt={alt} className={imgClassName} draggable={false} />
        {caption ? <span className="mt-2 block text-[11px] tracking-[0.22em] uppercase">{caption}</span> : null}
      </button>
      {open ? <ZoomStage items={gallery?.length ? gallery : [{ src, alt }]} start={gallery?.length ? index : 0} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ZoomStage({ items, start, onClose }: { items: { src: string; alt: string }[]; start: number; onClose: () => void }) {
  const [current, setCurrent] = useState(start);
  const { src, alt } = items[current] ?? items[0];
  const many = items.length > 1;
  const swipe = useRef({ x: 0, y: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ dist: 0, scale: 1, x: 0, y: 0, sx: 0, sy: 0, moved: false });
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const lastTap = useRef(0);

  function limit() {
    const box = frame.current;
    const img = picture.current;
    if (!box || !img?.naturalWidth) return 3;
    const rendered = Math.min(box.clientWidth, img.naturalWidth * (box.clientHeight / img.naturalHeight));
    return Math.max(1, img.naturalWidth / rendered);
  }

  function apply(nextScale: number, nextShift: { x: number; y: number }) {
    const next = Math.min(limit(), Math.max(1, nextScale));
    const point = next <= 1 ? { x: 0, y: 0 } : nextShift;
    view.current = { scale: next, x: point.x, y: point.y };
    setScale(next);
    setShift(point);
  }

  function go(step: number) {
    if (!many) return;
    view.current = { scale: 1, x: 0, y: 0 };
    setScale(1);
    setShift({ x: 0, y: 0 });
    setCurrent((value) => (value + step + items.length) % items.length);
  }
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      apply(view.current.scale * (event.deltaY < 0 ? 1.12 : 0.9), { x: view.current.x, y: view.current.y });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") goRef.current(-1);
      else if (event.key === "ArrowRight") goRef.current(1);
    };
    box.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      box.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/92" role="dialog" aria-modal="true" aria-label={alt}>
      <button type="button" onClick={onClose} className="absolute top-4 right-4 z-10 grid size-11 place-items-center rounded-full bg-white text-2xl leading-none text-black" aria-label="Fechar">×</button>
      {many ? (
        <>
          <button type="button" onClick={() => go(-1)} className="absolute top-1/2 left-3 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-3xl leading-none text-black shadow sm:left-6" aria-label="Anterior">‹</button>
          <button type="button" onClick={() => go(1)} className="absolute top-1/2 right-3 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-3xl leading-none text-black shadow sm:right-6" aria-label="Seguinte">›</button>
          <p className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-black">{alt} · {current + 1}/{items.length}</p>
        </>
      ) : null}
      <div
        ref={frame}
        className="flex h-full w-full touch-none items-center justify-center overflow-hidden"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          gesture.current.moved = false;
          if (pointers.current.size === 1) swipe.current = { x: event.clientX, y: event.clientY };
          if (pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            gesture.current.dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            gesture.current.scale = view.current.scale;
          } else {
            gesture.current.x = event.clientX;
            gesture.current.y = event.clientY;
            gesture.current.sx = view.current.x;
            gesture.current.sy = view.current.y;
          }
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            gesture.current.moved = true;
            apply(gesture.current.scale * (dist / gesture.current.dist), { x: view.current.x, y: view.current.y });
            return;
          }
          const dx = event.clientX - gesture.current.x;
          const dy = event.clientY - gesture.current.y;
          if (Math.hypot(dx, dy) > 6) gesture.current.moved = true;
          if (view.current.scale <= 1) return;
          apply(view.current.scale, { x: gesture.current.sx + dx, y: gesture.current.sy + dy });
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size === 0 && view.current.scale <= 1) {
            const dx = event.clientX - swipe.current.x;
            const dy = event.clientY - swipe.current.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
              go(dx < 0 ? 1 : -1);
              return;
            }
          }
          if (pointers.current.size > 0 || gesture.current.moved) return;
          const now = Date.now();
          if (now - lastTap.current < 280) apply(view.current.scale > 1 ? 1 : limit(), { x: 0, y: 0 });
          lastTap.current = now;
        }}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
      >
        <img
          ref={picture}
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
          style={{ transform: `translate(${shift.x}px, ${shift.y}px) scale(${scale})` }}
        />
      </div>
    </div>
  );
}

function DetailReel({ lang, onOpen }: { lang: Lang; onOpen: (id: string) => void }) {
  const ids = ["tracksuit-brown", "long-sleeve", "tracksuit-black"];
  const [index, setIndex] = useState(0);
  const drag = useRef({ x: 0, moved: false });
  const id = ids[index];
  const spin = SPIN[id];
  const product = productById(id);
  const line = product?.material[lang].split(".")[0] ?? "";
  const [turn, setTurn] = useState(0);
  const reel = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    reel.current.forEach((video, slot) => {
      if (!video) return;
      if (slot === index) {
        video.currentTime = 0;
        void video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, [index]);

  useEffect(() => {
    setTurn(0);
    if (spin.video) return;
    const flip = window.setInterval(() => setTurn((current) => (current === 0 ? 1 : 0)), 2400);
    const next = window.setTimeout(() => setIndex((current) => (current + 1) % ids.length), 9600);
    return () => {
      window.clearInterval(flip);
      window.clearTimeout(next);
    };
  }, [id, spin.video, ids.length]);

  return (
    <section
      className="bg-white"
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, moved: false };
      }}
      onPointerUp={(event) => {
        const dx = event.clientX - drag.current.x;
        if (dx > 48) {
          drag.current.moved = true;
          setIndex((current) => (current + ids.length - 1) % ids.length);
        } else if (dx < -48) {
          drag.current.moved = true;
          setIndex((current) => (current + 1) % ids.length);
        }
      }}
    >
      <div className="relative mx-auto flex h-[70vh] max-h-[760px] w-full max-w-3xl items-center justify-center bg-white">
        {/* Os três vídeos ficam carregados e sobrepostos; a troca é um cruzamento suave, sem remontar o elemento (evita o frame vazio/flash). */}
        {ids.map((item, slot) =>
          SPIN[item].video ? (
            <video
              key={item}
              ref={(element) => {
                reel.current[slot] = element;
              }}
              src={SPIN[item].video}
              className={`absolute inset-0 m-auto max-h-full max-w-full object-contain transition-opacity duration-500 ${slot === index ? "opacity-100" : "opacity-0"}`}
              muted
              playsInline
              preload="auto"
              autoPlay={slot === 0}
              onEnded={() => {
                if (slot === index) setIndex((current) => (current + 1) % ids.length);
              }}
            />
          ) : null,
        )}
        {spin.video ? null : <img src={spin.stills?.[turn]} alt="" className="max-h-full max-w-full object-contain" />}
        <button
          type="button"
          onClick={() => {
            if (!drag.current.moved) onOpen(id);
          }}
          className="absolute inset-0"
          aria-label={product?.name[lang] ?? ""}
        />
      </div>
      <div className="flex items-center gap-4 px-4 py-3 sm:px-8">
        <p className="min-w-0 flex-1 truncate text-left text-[11px] tracking-[0.22em] text-[#1a1714] uppercase">
          {product?.name[lang]} · {line}
        </p>
        <div className="flex shrink-0 gap-2">
          {ids.map((item, dot) => (
            <button
              key={item}
              type="button"
              aria-label={`${dot + 1}`}
              onClick={() => setIndex(dot)}
              className={`size-2 rounded-full ${dot === index ? "bg-[#1a1714]" : "bg-[#1a1714]/25"}`}
            />
          ))}
        </div>
      </div>
      <div className="mx-auto flex max-w-lg justify-center gap-4 px-4 pb-10">
        {([{ src: spin.a, label: spin.la[lang] }, { src: spin.b, label: spin.lb[lang] }] as const).map((item, index, all) => (
          <PhotoZoom key={item.src} src={item.src} alt={item.label} caption={item.label} gallery={all.map((entry) => ({ src: entry.src, alt: entry.label }))} index={index} className="w-36 text-left sm:w-44" imgClassName="h-40 w-full rounded-2xl object-cover sm:h-48" />
        ))}
      </div>
    </section>
  );
}

function Catalog({ market, lang, stock, known, stockIn, wish, wishOnly, onWish, onShare, onOpen, onBuy }: { market: Market; lang: Lang; stock: Record<string, number>; known: boolean; stockIn: boolean; wish: string[]; wishOnly: boolean; onWish: (id: string) => void; onShare: (id: string) => void; onOpen: (id: string) => void; onBuy: (id: string) => void }) {
  const t = COPY[lang];
  const items = wishOnly ? PRODUCTS.filter((item) => wish.includes(item.id)) : PRODUCTS;
  return (
    <main id="loja" className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-3">
      <h2 className="text-xs tracking-[0.28em] uppercase sm:col-span-3">{wishOnly ? t.wish : t.arrivals}</h2>
      {items.length === 0 && wishOnly ? <p className="sm:col-span-3">{t.wishEmpty}</p> : null}
      {items.map((item) => {
        const gone = known && SIZES.every((size) => (stock[`${item.id}|${size}`] ?? 0) <= 0);
        const saved = wish.includes(item.id);
        return (
          <article key={item.id} className="grid text-left text-[#1a1714]">
            <button type="button" onClick={() => onOpen(item.id)} className="aspect-[3/4] overflow-hidden bg-white">
              <img src={item.images[0]} alt={item.alt[lang][0]} className="h-full w-full object-contain" />
            </button>
            <div className="grid gap-2 py-3">
              <p className="text-sm tracking-wide">{item.name[lang]}</p>
              <p className="text-sm text-[#1a1714]/75">{item.blurb[lang]}</p>
              <p className="text-sm">{gone ? t.soldOut : formatMoney(item, market)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onBuy(item.id)} disabled={gone} className="btn-brown w-fit rounded-full px-5 py-2 disabled:bg-[#1a1714]/30">
                  {gone ? t.soldOut : stockIn ? t.buy : t.reserve}
                </button>
                <button type="button" onClick={() => onWish(item.id)} aria-pressed={saved} aria-label={saved ? t.wishOn : t.wish} className="grid size-10 place-items-center rounded-full ring-1 ring-[#1a1714]">
                  <HeartIcon on={saved} />
                </button>
                <button type="button" onClick={() => onShare(item.id)} aria-label={t.share} className="grid size-10 place-items-center rounded-full ring-1 ring-[#1a1714]">
                  <ShareIcon />
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </main>
  );
}

function ProductView({
  product,
  lang,
  market,
  shot,
  size,
  onShot,
  onSize,
  onAdd,
  left,
  selling,
  wished,
  onWish,
  onShare,
}: {
  product: Product;
  lang: Lang;
  market: Market;
  shot: number;
  size: string;
  onShot: (index: number) => void;
  onSize: (size: string) => void;
  onAdd: () => void;
  left: number;
  selling: boolean;
  wished: boolean;
  onWish: () => void;
  onShare: () => void;
}) {
  const t = COPY[lang];
  return (
    <article className="mx-auto grid max-w-3xl gap-4 px-4 py-4">
      <div className="overflow-hidden rounded-2xl bg-[#ebe4da]">
        <img src={product.images[shot]} alt={product.alt[lang][shot]} className="mx-auto max-h-[70vh] w-full object-contain" />
      </div>
      {SPIN[product.id] ? (
        <div className="flex justify-center gap-2 sm:gap-3">
          {(SIDE_DETAILS[product.id]
            ? SIDE_DETAILS[product.id][shot === 1 ? "back" : "front"].map((item) => ({ src: item.src, label: item.label[lang] }))
            : [
                { src: SPIN[product.id].a, label: SPIN[product.id].la[lang] },
                { src: SPIN[product.id].b, label: SPIN[product.id].lb[lang] },
              ]
          ).map((item, index, all) => {
            const size = all.length > 3 ? "h-28 w-[4.75rem] sm:h-36 sm:w-28" : "h-36 w-28";
            return <PhotoZoom key={item.src} src={item.src} alt={item.label} gallery={all.map((entry) => ({ src: entry.src, alt: entry.label }))} index={index} className={`${size} overflow-hidden rounded-2xl`} imgClassName={`${size} object-cover`} />;
          })}
        </div>
      ) : null}
      <div className="flex gap-2">
        {[t.front, t.back].map((label, index) => (
          <button key={label} type="button" onClick={() => onShot(index)} aria-pressed={shot === index} className={`rounded-full px-3 py-2 text-sm font-bold ring-1 ring-[#1a1714] ${shot === index ? "bg-[#1a1714] text-white" : ""}`}>
            {label}
          </button>
        ))}
      </div>
      <h1 className="text-3xl font-bold">{product.name[lang]}</h1>
      <p className="max-w-xl text-lg leading-snug">{product.material[lang]}</p>
      <p className="text-xl font-bold">{formatMoney(product, market)}</p>
      {product.id.startsWith("tracksuit-") ? <p className="text-sm font-bold">{t.tracksuitDeal}</p> : null}
      <p className="text-[#1a1714]/75">{product.blurb[lang]}</p>
      <p className="text-sm font-bold">{t.size}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t.size}>
        {SIZES.map((option) => (
          <button key={option} type="button" onClick={() => onSize(option)} aria-pressed={size === option} className={`min-w-12 rounded-full px-3 py-2 font-bold ring-1 ring-[#1a1714] ${size === option ? "bg-[#1a1714] text-white" : ""}`}>
            {option}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAdd} disabled={left < 1} className="btn-brown w-fit rounded-full px-5 py-3 disabled:bg-[#1a1714]/30">{left < 1 ? t.soldOut : selling ? t.add : t.reserve}</button>
        <button type="button" onClick={onWish} aria-pressed={wished} aria-label={wished ? t.wishOn : t.wish} className="grid size-11 place-items-center rounded-full ring-1 ring-[#1a1714]">
          <HeartIcon on={wished} />
        </button>
        <button type="button" onClick={onShare} aria-label={t.share} className="grid size-11 place-items-center rounded-full ring-1 ring-[#1a1714]">
          <ShareIcon />
        </button>
      </div>
      <p className="text-sm text-[#1a1714]/70">{left < 1 ? t.noStock : t.left.replace("{n}", String(left))}</p>
    </article>
  );
}

function BagView({
  lines,
  lang,
  market,
  priced,
  onQty,
  onCheckout,
  actionLabel,
}: {
  lines: Line[];
  lang: Lang;
  market: Market;
  priced: ReturnType<typeof quote>;
  onQty: (index: number, qty: number) => void;
  onCheckout: () => void;
  actionLabel: string;
}) {
  const t = COPY[lang];
  return (
    <section className="mx-auto grid max-w-lg gap-3 px-4 py-6">
      <h1 className="text-3xl font-bold">{t.bag}</h1>
      {lines.length === 0 ? <p>{t.bagEmpty}</p> : null}
      <ul className="grid gap-3">
        {lines.map((line, index) => {
          const item = productById(line.productId);
          if (!item) return null;
          const deal = priced.tracksuitDeal && item.id.startsWith("tracksuit-");
          const unit = market === "AO" ? kzAmount(item) : item.priceEur;
          const each = payUnit(item, market, deal);
          return (
            <li key={`${line.productId}-${line.size}`} className="grid grid-cols-[72px_1fr] gap-3 rounded-[1.5rem] bg-white p-2 text-black">
              <img src={item.images[0]} alt="" className="size-[72px] object-contain" />
              <span className="grid gap-1">
                <span className="font-bold">{item.name[lang]}</span>
                <span className="text-sm">
                  {line.size} · {line.qty} × {deal ? <><s>{formatAmount(unit, market)}</s> {formatAmount(each, market)} · −10%</> : formatAmount(unit, market)}
                </span>
                <span className="text-sm font-bold">{formatAmount(each * line.qty, market)}</span>
                <span className="flex items-center gap-2">
                  <button type="button" aria-label={t.qty} onClick={() => onQty(index, line.qty - 1)} className="size-9 rounded-full bg-black font-bold text-white">−</button>
                  <span className="tabular-nums">{line.qty}</span>
                  <button type="button" aria-label={t.qty} onClick={() => onQty(index, line.qty + 1)} className="size-9 rounded-full bg-black font-bold text-white">+</button>
                  <button type="button" onClick={() => onQty(index, 0)} className="ml-auto text-sm underline">{t.remove}</button>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {lines.length > 0 ? (
        <>
          <Totals lang={lang} market={market} priced={priced} />
          {!priced.tracksuitDeal && lines.some((line) => line.productId.startsWith("tracksuit-")) ? <p className="text-sm text-[#1a1714]/70">{t.tracksuitSoon}</p> : null}
          <button type="button" onClick={onCheckout} className="btn-brown w-fit rounded-full px-5 py-3">{actionLabel}</button>
        </>
      ) : null}
    </section>
  );
}

function Story({ lang }: { lang: Lang }) {
  const t = COPY[lang];
  return (
    <section id="marca" className="mx-auto max-w-3xl px-4 py-16">
      <h2 className="text-[11px] tracking-[0.28em] uppercase">{t.about}</h2>
      <p className="luv-title mt-4 max-w-xl text-3xl leading-tight font-medium sm:text-4xl">{t.storyTitle}</p>
      <p className="mt-4 max-w-xl text-lg leading-snug">{t.storyLead}</p>
      <div className="mt-10 divide-y divide-[#1a1714]/15">
        {t.founders.map((person) => (
          <article key={person.name} className="grid gap-3 py-8 sm:grid-cols-[16rem_1fr] sm:items-baseline sm:gap-10">
            <div>
              <p className="luv-title text-2xl font-medium tracking-tight sm:text-3xl">{person.name}</p>
              <p className="mt-1 text-[11px] tracking-[0.22em] uppercase">{person.role}</p>
            </div>
            <p className="max-w-md text-sm leading-relaxed">{person.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PayMark({ paid, done, wait }: { paid: boolean; done: string; wait: string }) {
  if (!paid) return <p className="text-sm text-[#1a1714]/70">{wait}</p>;
  return (
    <p className="flex items-center gap-2 font-bold text-[#1d6b3a]">
      <span aria-hidden className="grid size-6 place-items-center rounded-full bg-[#1d6b3a] text-sm text-white">✓</span>
      {done}
    </p>
  );
}

function PhoneField({ iso, local, label, error, onIso, onLocal }: { iso: string; local: string; label: string; error?: string; onIso: (iso: string) => void; onLocal: (value: string) => void }) {
  const dial = dialOf(iso);
  const prefix = `${dial} `;
  const country = DIALS.find((item) => item.iso === iso);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLSpanElement>(null);
  const list = DIALS.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function national(value: string) {
    if (value.startsWith(prefix)) return value.slice(prefix.length).replace(/\D/g, "");
    const code = dial.replace(/\D/g, "");
    const digits = value.replace(/\D/g, "");
    return digits.startsWith(code) ? digits.slice(code.length) : digits;
  }

  return (
    <label className="grid gap-1 text-sm font-bold">
      {label}
      <span className="flex gap-2">
        <span ref={box} className="relative w-[46%]">
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            onClick={() => setOpen((on) => !on)}
            className="flex w-full items-center gap-2 rounded-2xl border border-[#1a1714]/20 bg-white px-2 py-3 text-left font-normal text-[#1a1714]"
          >
            <Flag iso={iso} />
            <span className="min-w-0 flex-1 truncate">{country?.name ?? iso}</span>
          </button>
          {open ? (
            <span className="absolute z-30 mt-1 grid max-h-64 w-64 gap-1 overflow-auto rounded-2xl border border-[#1a1714]/15 bg-white p-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={country?.name ?? ""}
                className="rounded-xl border border-[#1a1714]/15 px-2 py-2 font-normal"
              />
              {list.map((item) => (
                <button
                  key={item.iso}
                  type="button"
                  onClick={() => { onIso(item.iso); setOpen(false); setQuery(""); }}
                  className="flex items-center gap-2 rounded-xl px-2 py-2 text-left font-normal hover:bg-[#f4f1ec]"
                >
                  <Flag iso={item.iso} />
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
            </span>
          ) : null}
        </span>
        <input
          value={prefix + local}
          inputMode="tel"
          autoComplete="tel"
          onChange={(event) => onLocal(national(event.target.value))}
          onKeyDown={(event) => {
            const input = event.currentTarget;
            const start = input.selectionStart ?? 0;
            const end = input.selectionEnd ?? 0;
            if (event.key === "Backspace" && end <= prefix.length) event.preventDefault();
            if (event.key === "Delete" && start < prefix.length) event.preventDefault();
            if ((event.key === "Backspace" || event.key === "Delete") && start < prefix.length && end > prefix.length) {
              event.preventDefault();
              onLocal(local.slice(end - prefix.length));
            }
          }}
          onSelect={(event) => {
            const input = event.currentTarget;
            if ((input.selectionStart ?? 0) < prefix.length) {
              const end = Math.max(prefix.length, input.selectionEnd ?? prefix.length);
              window.requestAnimationFrame(() => input.setSelectionRange(prefix.length, end));
            }
          }}
          className="min-w-0 flex-1 rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal text-[#1a1714]"
        />
      </span>
      {error ? <span className="font-normal text-[#1a1714]/70">{error}</span> : null}
    </label>
  );
}

function Flag({ iso }: { iso: string }) {
  return <img src={`https://flagcdn.com/24x18/${iso.toLowerCase()}.png`} alt="" width={24} height={18} className="h-[18px] w-6 shrink-0 rounded-sm object-cover" />;
}

function phoneBits(code: "AO" | "PT") {
  const number = WA[code].n;
  const shown = code === "AO"
    ? `+244 ${number.slice(3, 6)} ${number.slice(6, 9)} ${number.slice(9)}`
    : `+351 ${number.slice(3, 6)} ${number.slice(6, 9)} ${number.slice(9)}`;
  return (
    <>
      <a href={`tel:+${number}`} className="underline">{shown}</a>
      {" ("}
      <a href={`https://wa.me/${number}`} className="underline">WhatsApp</a>
      {")"}
    </>
  );
}

function contactLine(lang: Lang) {
  const ao = phoneBits("AO");
  const pt = phoneBits("PT");
  if (lang === "en") return <>Alessandro Arrulo and Kalyani Ngenohame both answer. In Angola, call or message {ao}. In Portugal, {pt}.</>;
  if (lang === "fr") return <>Alessandro Arrulo et Kalyani Ngenohame répondent tous les deux. En Angola, appelle ou écris au {ao}. Au Portugal, au {pt}.</>;
  return <>Alessandro Arrulo e Kalyani Ngenohame atendem os dois. Em Angola, liga ou escreve para {ao}. Em Portugal, para {pt}.</>;
}

function Faq({ lang, open, onToggle }: { lang: Lang; open: number | null; onToggle: (index: number) => void }) {
  const t = COPY[lang];
  return (
    <section id="contacto" className="mx-auto grid max-w-2xl gap-2 px-4 py-12">
      <h2 className="text-2xl font-bold">{t.faqTitle}</h2>
      {t.faqs.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.q} className="border-t border-[#1a1714]/15">
            <button type="button" aria-expanded={expanded} onClick={() => onToggle(index)} className="flex w-full items-center justify-between gap-3 py-3 text-left font-bold">
              {item.q}
              <span aria-hidden className={`${expanded ? "rotate-180" : ""}`}>⌄</span>
            </button>
            {expanded ? <p className="pb-3 text-[#1a1714]/75">{item.a}</p> : null}
          </div>
        );
      })}
      <div className="border-t border-[#1a1714]/15">
        <button type="button" aria-expanded={open === -1} onClick={() => onToggle(-1)} className="flex w-full items-center justify-between gap-3 py-3 text-left font-bold">
          {t.ask}
          <span aria-hidden className={`${open === -1 ? "rotate-180" : ""}`}>⌄</span>
        </button>
        {open === -1 ? <p className="pb-3 text-[#1a1714]/75">{contactLine(lang)}</p> : null}
      </div>
    </section>
  );
}


function HeartIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"
      />
    </svg>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path fill="currentColor" d="M4 9h3.2L12 5.2v13.6L7.2 15H4V9z" />
      {on ? (
        <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M15.5 9.2a3.4 3.4 0 0 1 0 5.6M17.8 7a6 6 0 0 1 0 10" />
      ) : (
        <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M16 10l4.5 4.5M20.5 10 16 14.5" />
      )}
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M6 8h12l-1 12H7L6 8zm3 0V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M5.5 19.2a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <circle cx="6" cy="12" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="6.5" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="17.5" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M8 11.2 14.8 7.6M8 12.8l6.8 3.6" />
    </svg>
  );
}

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path
        fill="currentColor"
        d="M20.5 3.5A11 11 0 0 0 2.1 17.2L1 23l5.9-1.1A11 11 0 0 0 12 23a11 11 0 0 0 8.5-19.5zM12 21a9 9 0 0 1-4.6-1.3l-.3-.2-3.5.7.7-3.4-.2-.3A9 9 0 1 1 12 21zm5-6.7c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a7.4 7.4 0 0 1-2.2-1.4 8 8 0 0 1-1.5-1.9c-.2-.3 0-.4.1-.5l.4-.5.2-.3a.5.5 0 0 0 0-.5c-.1-.1-.5-1.3-.7-1.7s-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3 2.6 2.6 0 0 0-.8 2 4.4 4.4 0 0 0 .9 2.3 10 10 0 0 0 3.8 3.4 4.6 4.6 0 0 0 2.7.8 2.4 2.4 0 0 0 1.6-.7 2 2 0 0 0 .4-1.3c.1-.1.1-.2-.1-.3z"
      />
    </svg>
  );
}
