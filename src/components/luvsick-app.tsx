import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  COPY,
  LANGS,
  PAY,
  PRODUCTS,
  SHOP_EMAIL,
  SIZES,
  WA,
  formatAmount,
  formatMoney,
  kzAmount,
  productById,
  quote,
  type Lang,
  type Market,
  type Product,
} from "@/lib/luvsick";
import { luvCheckCoupon, luvPlace, luvStock, luvVisit } from "@/server/fns";

type Line = { productId: string; size: string; qty: number };
type View = "splash" | "shop" | "product" | "bag" | "checkout" | "sent";
type Form = { name: string; phone: string; address: string; city: string; country: "AO" | "PT"; postal: string };

const BAG_KEY = "luvsick-bag";
const LANG_KEY = "luvsick-lang";
const MARKET_KEY = "luvsick-market";
const VISITOR_KEY = "luvsick-visitor";
const SOUND_KEY = "luvsick-sound";

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
    const savedLang = localStorage.getItem(LANG_KEY);
    if (savedLang === "pt" || savedLang === "en" || savedLang === "fr") setLang(savedLang);
    const savedMarket = localStorage.getItem(MARKET_KEY);
    if (savedMarket === "PT" || savedMarket === "AO") {
      setMarket(savedMarket);
      setForm((current) => ({ ...current, country: savedMarket }));
    } else detectMarket(setMarket);
    setLines(readBag());
    setReady(true);
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

  function chooseLang(next: Lang) {
    setLang(next);
    localStorage.setItem(LANG_KEY, next);
  }

  function chooseMarket(next: Market) {
    setMarket(next);
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

  function addCurrent() {
    if (available(product.id, size) - inBag(product.id, size) < 1) {
      setOrderError(t.noStock);
      return;
    }
    setOrderError("");
    setLines((current) => {
      const found = current.find((line) => line.productId === product.id && line.size === size);
      if (found) return current.map((line) => (line === found ? { ...line, qty: line.qty + 1 } : line));
      return [...current, { productId: product.id, size, qty: 1 }];
    });
    setView("bag");
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
        return `- ${item.name[lang]} · ${line.size} · ${line.qty} × ${formatMoney(item, market)} = ${formatMoney(item, market, line.qty)}`;
      })
      .filter(Boolean)
      .join("\n");
    return [
      `${t.ref}: ${code}`,
      `${t.name}: ${form.name.trim()}`,
      `${t.phone}: ${form.phone.trim()}`,
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

  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Form> = {};
    (["name", "phone", "address", "city"] as const).forEach((key) => {
      if (!form[key].trim()) next[key] = t.required;
    });
    if (!postalOk(form.country, form.postal)) next.postal = t.postalBad;
    setErrors(next);
    const known = PAY[market].some((item) => item.id === pay);
    setPayError(known ? "" : t.pickPay);
    if (Object.keys(next).length || !known || lines.length === 0) return;
    const placed = await luvPlace({
      data: {
        lines,
        name: form.name,
        phone: form.phone,
        address: form.address,
        city: form.city,
        country: form.country,
        postal: form.postal,
        market,
        pay,
        coupon: couponPercent ? coupon : "",
      },
    });
    if (!placed.ok) {
      setOrderError(placed.error === "coupon" ? t.couponBad : placed.error === "form" ? t.postalBad : t.noStock);
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
    setOrderError("");
    setView("sent");
  }

  return (
    <div className="min-h-dvh bg-[#f4f1ec] text-[#1a1714]">
      {view === "splash" ? (
        <section className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden">
          <img src="/luvsick/brand/hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[center_30%]" />
          <div className="absolute inset-0 bg-[#2a211c]/45" />
          <div className="relative z-10 flex flex-col items-center px-6">
            <img src="/luvsick/brand/logo-white.svg" alt="Luv Sick" className="h-44 w-44 object-contain sm:h-56 sm:w-56" />
            <button type="button" onClick={() => { if (localStorage.getItem(SOUND_KEY) !== "off") playSound(); setView("shop"); }} className="mt-8 rounded-full bg-white px-10 py-3 text-xs font-medium tracking-[0.28em] text-[#1a1714] uppercase">
              {t.enter}
            </button>
          </div>
        </section>
      ) : (
        <>
          <header className="sticky top-0 z-20 border-b border-[#e4ddd4] bg-[#f4f1ec]/95 backdrop-blur">
            <div className="flex items-center gap-2 px-3 py-2">
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
              <button type="button" onClick={() => setView("bag")} className="relative grid size-11 place-items-center" aria-label={`${t.bag}${pieces ? ` ${pieces}` : ""}`}>
                <BagIcon />
                {pieces > 0 ? <span className="absolute top-0 right-0 grid min-w-5 place-items-center rounded-full bg-[#1a1714] px-1 text-[10px] font-bold text-white">{pieces}</span> : null}
              </button>
            </div>
            {view === "shop" ? (
              <nav className="flex gap-4 overflow-x-auto px-4 pb-2 text-[11px] tracking-[0.18em] uppercase" aria-label={t.shop}>
                {[
                  ["inicio", t.home],
                  ["loja", t.shop],
                  ["marca", t.about],
                  ["contacto", t.contact],
                ].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })} className="shrink-0 py-1">
                    {label}
                  </button>
                ))}
              </nav>
            ) : null}
          </header>

          {view === "shop" ? (
            <>
              <section id="inicio" className="relative overflow-hidden">
                <video
                  src="/luvsick/brand/hero-walk.mp4"
                  poster="/luvsick/brand/hero.jpg"
                  className="h-[78vh] min-h-[28rem] w-full object-cover object-center"
                  autoPlay
                  muted
                  loop
                  playsInline
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1c1917]/70 to-transparent px-5 pt-24 pb-8 sm:px-10">
                  <p className="text-[11px] tracking-[0.28em] text-white uppercase">{t.newIn}</p>
                  <h1 className="mt-2 max-w-[12ch] text-4xl leading-none font-medium tracking-tight text-white sm:text-5xl">{t.heroTitle}</h1>
                  <button type="button" onClick={() => document.getElementById("loja")?.scrollIntoView({ behavior: "smooth" })} className="mt-5 rounded-full bg-white px-6 py-3 text-[11px] tracking-[0.22em] text-[#1a1714] uppercase">
                    {t.shop}
                  </button>
                </div>
              </section>
              <Catalog market={market} lang={lang} stock={stock} known={stockKnown} onOpen={(id) => { setProductId(id); setShot(0); setSize("M"); setView("product"); window.scrollTo(0, 0); }} />
              <DetailReel lang={lang} onOpen={(id) => { setProductId(id); setShot(0); setSize("M"); setView("product"); window.scrollTo(0, 0); }} />
            </>
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
            />
          ) : null}
          {view === "bag" ? <BagView lines={lines} lang={lang} market={market} priced={priced} onQty={setQty} onCheckout={() => setView("checkout")} /> : null}
          {view === "checkout" ? (
            <form onSubmit={submitOrder} className="mx-auto grid max-w-lg gap-3 px-4 py-6">
              <h1 className="text-3xl font-bold">{t.checkout}</h1>
              {(["name", "phone", "address", "city"] as const).map((key) => (
                <label key={key} className="grid gap-1 text-sm font-bold">
                  {t[key]}
                  <input
                    value={form[key]}
                    onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                    className="rounded-2xl border border-[#1a1714]/20 bg-white px-3 py-3 font-normal text-[#1a1714]"
                    autoComplete={key === "name" ? "name" : key === "phone" ? "tel" : "off"}
                  />
                  {errors[key] ? <span className="font-normal text-[#1a1714]/70">{errors[key]}</span> : null}
                </label>
              ))}
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
                  <button type="button" onClick={applyCoupon} className="rounded-full bg-[#1a1714] px-4 font-bold text-white">{t.apply}</button>
                </span>
                {couponNote ? <span className="font-normal text-[#1a1714]/70">{couponNote}</span> : null}
              </label>
              {orderError ? <p className="text-sm text-[#1a1714]/70">{orderError}</p> : null}
              <fieldset className="grid gap-2">
                <legend className="text-sm font-bold">{t.pay}</legend>
                {PAY[market].map((item) => (
                  <label key={item.id} className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${pay === item.id ? "border-[#1a1714] bg-[#1a1714] text-white" : "border-[#1a1714]/25"}`}>
                    <input
                      type="radio"
                      name="pay"
                      checked={pay === item.id}
                      onChange={() => { setPay(item.id); setPayError(""); }}
                    />
                    <span className="font-bold">{item.label}</span>
                  </label>
                ))}
                {payError ? <span className="text-sm text-[#1a1714]/70">{payError}</span> : null}
              </fieldset>
              <button className="rounded-full bg-[#1a1714] px-4 py-3 font-bold text-white">{t.send}</button>
            </form>
          ) : null}
          {view === "sent" ? (
            <section className="mx-auto grid max-w-lg gap-4 px-4 py-8">
              <p className="text-sm font-bold tracking-[0.18em] uppercase text-[#1a1714]/70">{t.successTitle}</p>
              <h1 className="text-4xl font-bold">{refCode}</h1>
              <p>{t.thanks}</p>
              <div className="grid gap-3 rounded-[2rem] bg-white p-5 text-black">
                <p className="font-bold">{form.name.trim()}</p>
                <p className="text-sm">{form.phone.trim()}</p>
                <p className="text-sm">{form.address.trim()}, {form.postal.trim()} {form.city.trim()}, {form.country === "AO" ? "Angola" : "Portugal"}</p>
                <ul className="grid gap-2 border-t border-black/10 pt-3">
                  {lines.map((line) => {
                    const item = productById(line.productId);
                    if (!item) return null;
                    return (
                      <li key={`${line.productId}-${line.size}`} className="flex items-center justify-between gap-3 text-sm">
                        <span>{item.name[lang]} · {line.size} · {line.qty}</span>
                        <span className="font-bold">{formatMoney(item, market, line.qty)}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="border-t border-black/10 pt-3 text-sm">{t.pay}: <span className="font-bold">{PAY[market].find((item) => item.id === pay)?.label}</span></p>
                <p className="text-lg font-bold">{t.total} {totalLabel}</p>
              </div>
              <p className="text-sm text-[#1a1714]/70">{t.sentNote}</p>
              <a href={waLink(market, orderText(refCode))} target="_blank" rel="noreferrer" className="rounded-full bg-[#1a1714] px-4 py-3 text-center font-bold text-white">
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
              <button type="button" onClick={() => { setLines([]); setView("shop"); }} className="text-sm underline">
                {t.continueShop}
              </button>
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
    stills: ["/luvsick/products/tracksuit-brown-1.jpg", "/luvsick/products/tracksuit-brown-2.jpg"],
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
    stills: ["/luvsick/products/tracksuit-black-1.jpg", "/luvsick/products/tracksuit-black-2.jpg"],
    a: "/luvsick/details/black-hoodie.jpg",
    b: "/luvsick/details/black-pants.jpg",
    la: { pt: "Hoodie", en: "Hoodie", fr: "Hoodie" },
    lb: { pt: "Calças", en: "Trousers", fr: "Pantalon" },
  },
};

function DetailReel({ lang, onOpen }: { lang: Lang; onOpen: (id: string) => void }) {
  const ids = ["tracksuit-brown", "long-sleeve", "tracksuit-black"];
  const [index, setIndex] = useState(0);
  const drag = useRef({ x: 0, moved: false });
  const id = ids[index];
  const spin = SPIN[id];
  const product = productById(id);
  const line = product?.material[lang].split(".")[0] ?? "";
  const [turn, setTurn] = useState(0);

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
      <div className="relative h-[72dvh] w-full bg-white">
        {spin.video ? (
          <video
            key={spin.video}
            src={spin.video}
            className="h-full w-full object-contain"
            autoPlay
            muted
            playsInline
            onEnded={() => setIndex((current) => (current + 1) % ids.length)}
          />
        ) : (
          <img src={spin.stills?.[turn]} alt="" className="h-full w-full object-contain" />
        )}
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
      <div className="grid grid-cols-2">
        {([{ src: spin.a, label: spin.la[lang] }, { src: spin.b, label: spin.lb[lang] }] as const).map((item) => (
          <button key={item.src} type="button" onClick={() => onOpen(id)} className="text-left">
            <img src={item.src} alt={item.label} className="aspect-square w-full object-cover" />
            <span className="block px-4 py-3 text-[11px] tracking-[0.22em] uppercase">{item.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Catalog({ market, lang, stock, known, onOpen }: { market: Market; lang: Lang; stock: Record<string, number>; known: boolean; onOpen: (id: string) => void }) {
  const t = COPY[lang];
  return (
    <main id="loja" className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-3">
      <h2 className="text-xs tracking-[0.28em] uppercase sm:col-span-3">{t.arrivals}</h2>
      {PRODUCTS.map((item) => {
        const gone = known && SIZES.every((size) => (stock[`${item.id}|${size}`] ?? 0) <= 0);
        return (
          <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="grid bg-[#f4f1ec] text-left text-[#1a1714]">
            <span className="aspect-[3/4] overflow-hidden bg-[#ebe4da]">
              <img src={item.images[0]} alt={item.alt[lang][0]} className="h-full w-full object-cover object-[center_12%] scale-110" />
            </span>
            <span className="grid gap-1 py-3">
              <span className="text-sm tracking-wide">{item.name[lang]}</span>
              <span className="text-sm">{gone ? t.soldOut : formatMoney(item, market)}</span>
            </span>
          </button>
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
}) {
  const t = COPY[lang];
  return (
    <article className="mx-auto grid max-w-3xl gap-4 px-4 py-4">
      <div className="aspect-[3/4] overflow-hidden bg-[#ebe4da]">
        <img src={product.images[shot]} alt={product.alt[lang][shot]} className="h-full w-full object-cover object-[center_16%]" />
      </div>
      {SPIN[product.id] ? (
        <div className="grid grid-cols-2 gap-2">
          <img src={SPIN[product.id].a} alt={SPIN[product.id].la[lang]} className="aspect-square w-full object-cover" />
          <img src={SPIN[product.id].b} alt={SPIN[product.id].lb[lang]} className="aspect-square w-full object-cover" />
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
      <button type="button" onClick={onAdd} disabled={left < 1} className="rounded-full bg-[#1a1714] px-4 py-3 font-bold text-white disabled:bg-[#1a1714]/30">{left < 1 ? t.soldOut : t.add}</button>
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
}: {
  lines: Line[];
  lang: Lang;
  market: Market;
  priced: ReturnType<typeof quote>;
  onQty: (index: number, qty: number) => void;
  onCheckout: () => void;
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
          return (
            <li key={`${line.productId}-${line.size}`} className="grid grid-cols-[72px_1fr] gap-3 rounded-[1.5rem] bg-white p-2 text-black">
              <img src={item.images[0]} alt="" className="size-[72px] object-contain" />
              <span className="grid gap-1">
                <span className="font-bold">{item.name[lang]}</span>
                <span className="text-sm">
                  {line.size} · {deal ? <s>{formatAmount(unit, market)}</s> : null} {formatAmount(deal ? Math.round(unit * 0.9) : unit, market)}
                </span>
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
          <button type="button" onClick={onCheckout} className="rounded-full bg-[#1a1714] px-4 py-3 font-bold text-white">{t.checkout}</button>
        </>
      ) : null}
    </section>
  );
}

function Story({ lang }: { lang: Lang }) {
  const t = COPY[lang];
  return (
    <section id="marca" className="mx-auto grid max-w-3xl gap-6 px-4 py-16">
      <h2 className="text-[11px] tracking-[0.28em] uppercase">{t.about}</h2>
      <p className="max-w-xl text-3xl leading-tight font-medium sm:text-4xl">🖤 {t.storyTitle}</p>
      <p className="max-w-xl text-lg leading-snug">{t.storyLead}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {t.founders.map((person) => {
          const age = person.role.match(/\d+/)?.[0] ?? "";
          const craft = person.role.split("·").slice(1).join("·").trim();
          return (
            <article key={person.name} className="grid content-start gap-3 rounded-[2rem] bg-white p-6 text-[#1a1714]">
              <p className="text-5xl leading-none font-medium tracking-tight">{person.mark} {age}</p>
              <div>
                <p className="text-lg font-medium">{person.name}</p>
                <p className="text-[11px] tracking-[0.22em] uppercase">{craft}</p>
              </div>
              <p className="text-sm leading-relaxed">{person.text}</p>
            </article>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm tracking-wide">
        {t.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </p>
    </section>
  );
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
