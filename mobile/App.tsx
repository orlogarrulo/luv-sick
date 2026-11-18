import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { call, photoUrl, readApiUrl, saveApiUrl, type CartLine, type Category, type Product } from "./src/api";

type Lang = "pt" | "fr" | "en";
type Pay = "multicaixa" | "unitel_money" | "appypay" | "cash";
type Screen =
  | { name: "boot" }
  | { name: "gate" }
  | { name: "otp"; phone: string; demoCode: string }
  | { name: "home" }
  | { name: "list"; title: string; categoryId?: string }
  | { name: "product"; sku: string }
  | { name: "cart" }
  | { name: "address" }
  | { name: "pay" }
  | { name: "done"; number: number; id: string }
  | { name: "orders" };

const SPOTS = [
  { lat: -8.916, lng: 13.184, label: "Talatona" },
  { lat: -8.998, lng: 13.266, label: "Kilamba" },
  { lat: -8.827, lng: 13.234, label: "Maianga" },
  { lat: -8.814, lng: 13.23, label: "Ingombota" },
  { lat: -8.888, lng: 13.178, label: "Patriota" },
];

const LOGO = require("./assets/logo-horizontal.png");
const LOGO_DARK = require("./assets/logo-horizontal-dark.png");
const LOGO_RATIO = 1066 / 262;

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

// Mesmas campanhas da loja web (src/components/shop-app.tsx → BUNDLES).
const BUNDLES = [
  { photo: "MER-0001.jpg", skus: ["MER-0001", "MER-0067", "MER-0049", "LAC-0063", "MER-0085"] },
  { photo: "FRE-0107.jpg", skus: ["FRE-0094", "FRE-0107", "FRE-0110", "PAD-0011"] },
  { photo: "FRE-0123.jpg", skus: ["FRE-0123", "MER-0001", "MER-0127", "BEB-0081"] },
  { photo: "PAD-0001.jpg", skus: ["PAD-0001", "LAC-0001", "LAC-0063", "LAC-0052"] },
  { photo: "BEB-0003.jpg", skus: ["BEB-0003", "BEB-0074", "BEB-0082"] },
  { photo: "FRE-0001.jpg", skus: ["FRE-0001", "FRE-0041", "FRE-0094", "FRE-0123"] },
  { photo: "LAC-0035.jpg", skus: ["LAC-0035", "PAD-0011", "BEB-0074"] },
];

function campaignUntil(lang: Lang) {
  const now = new Date();
  const day = now.getUTCDay();
  const end = new Date(now);
  end.setUTCDate(now.getUTCDate() + (day === 0 ? 0 : 7 - day));
  return end.toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "pt-PT", { day: "numeric", month: "short" });
}

const COPY = {
  pt: {
    title: "COMPRA TUDO",
    seeCart: "Ver o carrinho",
    repeatLast: "Repetir a última encomenda",
    allAisles: "Catálogo",
    homeLine: "O mercado chega hoje.",
    campaign: "Campanha",
    validUntil: "Válida até {date}",
    addBundle: "Levar este cabaz",
    cartTitle: "O seu carrinho",
    subtotal: "Subtotal",
    cartEmptySide: "O carrinho está vazio. Toque em + num produto.",
    prevOffer: "Sugestão anterior",
    nextOffer: "Sugestão seguinte",
    items: "{n} artigos",
    itemsOne: "1 artigo",
    bundles: [["Cabaz da semana", "Arroz, óleo, feijão, ovos e açúcar. A despensa de uma vez."], ["Grelha de domingo", "Peito, costeletas, chouriço e pão para a brasa."], ["Mesa de mar", "Camarão, arroz, tomate e uma Cuca."], ["Pequeno-almoço", "Pão, leite, ovos e manteiga."], ["Bebidas da casa", "Água, sumo e Cuca."], ["Frescos do dia", "Banana, tomate, peito e camarão."], ["Lanche rápido", "Queijo, pão de forma e sumo."]] as [string, string][],
    server: "Endereço do servidor",
    serverPh: "https://a-tua-loja.vercel.app",
    save: "Continuar",
    name: "O seu nome",
    phone: "Telemóvel",
    send: "Receber código",
    code: "Código",
    enter: "Entrar",
    demo: "Código de demonstração",
    search: "Procurar",
    cart: "Cesto",
    orders: "Encomendas",
    add: "Adicionar",
    checkout: "Pedir",
    address: "Onde deixamos",
    pay: "Como paga",
    place: "Confirmar",
    back: "Voltar",
    out: "Terminar sessão",
    night: "Noite",
    day: "Dia",
    empty: "O cesto está vazio.",
    sold: "Esgotado",
    low: "Poucas unidades",
    total: "Total",
    delivery: "Entrega",
    none: "Sem resultados.",
    net: "Não chegámos ao servidor. Confirme o endereço.",
    door: "Rua e porta",
    note: "Referência",
  },
  fr: {
    title: "COMPRA TUDO",
    seeCart: "Voir le panier",
    repeatLast: "Répéter la dernière commande",
    allAisles: "Catalogue",
    homeLine: "Le marché arrive aujourd'hui.",
    campaign: "Campagne",
    validUntil: "Valable jusqu'au {date}",
    addBundle: "Prendre ce panier",
    cartTitle: "Votre panier",
    subtotal: "Sous-total",
    cartEmptySide: "Le panier est vide. Touchez + sur un produit.",
    prevOffer: "Suggestion précédente",
    nextOffer: "Suggestion suivante",
    items: "{n} articles",
    itemsOne: "1 article",
    bundles: [["Panier de la semaine", "Riz, huile, haricots, œufs et sucre."], ["Grill du dimanche", "Blanc, côtelettes, chouriço et pain."], ["Table de la mer", "Crevettes, riz, tomate et une bière."], ["Petit-déjeuner", "Pain, lait, œufs et beurre."], ["Boissons de la maison", "Eau, jus et bière."], ["Frais du jour", "Banane, tomate, blanc et crevettes."], ["En-cas rapide", "Fromage, pain de mie et jus."]] as [string, string][],
    server: "Adresse du serveur",
    serverPh: "https://votre-boutique.vercel.app",
    save: "Continuer",
    name: "Votre nom",
    phone: "Mobile",
    send: "Recevoir le code",
    code: "Code",
    enter: "Entrer",
    demo: "Code de démonstration",
    search: "Chercher",
    cart: "Panier",
    orders: "Commandes",
    add: "Ajouter",
    checkout: "Commander",
    address: "Où livrer",
    pay: "Paiement",
    place: "Confirmer",
    back: "Retour",
    out: "Se déconnecter",
    night: "Nuit",
    day: "Jour",
    empty: "Le panier est vide.",
    sold: "Épuisé",
    low: "Peu d'unités",
    total: "Total",
    delivery: "Livraison",
    none: "Aucun résultat.",
    net: "Serveur injoignable. Vérifiez l'adresse.",
    door: "Rue et porte",
    note: "Repère",
  },
  en: {
    title: "COMPRA TUDO",
    seeCart: "View basket",
    repeatLast: "Repeat the last order",
    allAisles: "Catalog",
    homeLine: "The market arrives today.",
    campaign: "Campaign",
    validUntil: "Valid until {date}",
    addBundle: "Take this basket",
    cartTitle: "Your basket",
    subtotal: "Subtotal",
    cartEmptySide: "The cart is empty. Tap + on a product.",
    prevOffer: "Previous suggestion",
    nextOffer: "Next suggestion",
    items: "{n} items",
    itemsOne: "1 item",
    bundles: [["Week basket", "Rice, oil, beans, eggs and sugar."], ["Sunday grill", "Breast, chops, chouriço and bread."], ["Seafood table", "Prawns, rice, tomato and a beer."], ["Breakfast", "Bread, milk, eggs and butter."], ["Drinks for the house", "Water, juice and beer."], ["Today's fresh", "Banana, tomato, breast and prawns."], ["Quick snack", "Cheese, sliced bread and juice."]] as [string, string][],
    server: "Server address",
    serverPh: "https://your-shop.vercel.app",
    save: "Continue",
    name: "Your name",
    phone: "Mobile",
    send: "Get the code",
    code: "Code",
    enter: "Enter",
    demo: "Demo code",
    search: "Search",
    cart: "Basket",
    orders: "Orders",
    add: "Add",
    checkout: "Order",
    address: "Where we drop it",
    pay: "How you pay",
    place: "Confirm",
    back: "Back",
    out: "Sign out",
    night: "Night",
    day: "Day",
    empty: "The basket is empty.",
    sold: "Sold out",
    low: "Few left",
    total: "Total",
    delivery: "Delivery",
    none: "Nothing found.",
    net: "The server did not answer. Check the address.",
    door: "Street and door",
    note: "Landmark",
  },
} as const;

const PAYS: { id: Pay; label: string }[] = [
  { id: "multicaixa", label: "Multicaixa" },
  { id: "unitel_money", label: "Unitel Money" },
  { id: "appypay", label: "AppyPay" },
  { id: "cash", label: "Dinheiro" },
];

function kz(value: number) {
  return `${new Intl.NumberFormat("pt-AO").format(Math.round(value))} Kz`;
}

export default function App() {
  const [lang, setLang] = useState<Lang>("pt");
  const [night, setNight] = useState(false);
  const [api, setApi] = useState("");
  const [draftApi, setDraftApi] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [stack, setStack] = useState<Screen[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [spot, setSpot] = useState(SPOTS[0]);
  const [door, setDoor] = useState("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<{ delivery: number; total: number } | null>(null);
  const [pay, setPay] = useState<Pay>("multicaixa");
  const [slide, setSlide] = useState(0);
  const [bundleItems, setBundleItems] = useState<Product[]>([]);
  const { width: screenW } = useWindowDimensions();
  const [orders, setOrders] = useState<{ id: string; number: number; totalAoa: number; status: string; etaLabel: string }[]>([]);
  const t = COPY[lang];
  const colors = night
    ? { paper: "#07111f", ink: "#f4f7fb", card: "#102033", line: "#24364c", muted: "#9eb0c6", blue: "#3d7eff", on: "#ffffff", gold: "#e2b43a" }
    : { paper: "#f3f6f4", ink: "#102033", card: "#ffffff", line: "#d5e0dc", muted: "#5c6b78", blue: "#1E4FD8", on: "#ffffff", gold: "#c8960c" };

  useEffect(() => {
    (async () => {
      const saved = await readApiUrl();
      const savedToken = (await AsyncStorage.getItem("ct-token")) ?? "";
      const savedNight = (await AsyncStorage.getItem("ct-night")) === "1";
      const savedLang = (await AsyncStorage.getItem("ct-lang")) as Lang | null;
      setNight(savedNight);
      if (savedLang === "fr" || savedLang === "en" || savedLang === "pt") setLang(savedLang);
      setApi(saved);
      setDraftApi(saved);
      setToken(savedToken);
      setScreen(saved && savedToken ? { name: "home" } : { name: "gate" });
    })();
  }, []);

  function go(next: Screen) {
    setError("");
    setStack((prev) => [...prev, screen]);
    setScreen(next);
  }
  function back() {
    setError("");
    setStack((prev) => {
      const copy = [...prev];
      const last = copy.pop();
      if (last) setScreen(last);
      return copy;
    });
  }

  async function loadHome(nextToken = token, nextApi = api) {
    const cats = await call<{ ok: boolean; categories?: Category[]; error?: string }>(nextApi, "listCategories", { token: nextToken });
    if (!cats.ok) throw new Error(cats.error ?? "auth");
    setCategories(cats.categories ?? []);
    const list = await call<{ ok: boolean; products?: Product[] }>(nextApi, "searchProducts", { token: nextToken, limit: 12 });
    setProducts(list.products ?? []);
  }

  useEffect(() => {
    if (screen.name !== "home" || !token || !api) return;
    setBusy(true);
    loadHome().catch(() => setError(t.net)).finally(() => setBusy(false));
  }, [screen.name, token, api]);

  useEffect(() => {
    if (screen.name !== "home" || !token || !api) return;
    let cancel = false;
    const bundle = BUNDLES[slide] ?? BUNDLES[0];
    Promise.all(bundle.skus.map((sku) => call<{ ok: boolean; product?: Product }>(api, "getProduct", { token, sku }).catch(() => ({ ok: false }) as { ok: boolean; product?: Product })))
      .then((rows) => {
        if (!cancel) setBundleItems(rows.flatMap((row) => (row.ok && row.product ? [row.product] : [])));
      });
    return () => {
      cancel = true;
    };
  }, [screen.name, token, api, slide]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.paper },
        page: { padding: 16, gap: 12 },
        h1: { fontSize: 32, fontWeight: "700", color: colors.ink },
        p: { color: colors.ink, fontSize: 16 },
        muted: { color: colors.muted, fontSize: 14 },
        input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, color: colors.ink, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
        btn: { backgroundColor: colors.gold, borderRadius: 999, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
        btnText: { color: "#1a1400", fontWeight: "700", fontSize: 16 },
        ghost: { color: colors.blue, fontWeight: "700" },
        card: { backgroundColor: colors.card, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: colors.line, gap: 6 },
        row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
        chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
        chipOn: { backgroundColor: colors.blue, borderColor: colors.blue },
        chipText: { color: colors.ink, fontWeight: "600" },
        photo: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: colors.line },
        gridCard: { backgroundColor: colors.card, borderRadius: 24, padding: 8, borderWidth: 1, borderColor: colors.line },
        gridPhoto: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: "#ffffff" },
        plus: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#FFC700", alignItems: "center", justifyContent: "center" },
        plusText: { color: "#0B1F4D", fontSize: 24, fontWeight: "700", lineHeight: 26 },
        catChip: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, paddingLeft: 6, paddingRight: 12, paddingVertical: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
        bar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#0B1F4D", flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + (Platform.OS === "android" ? 24 : 0) },
        step: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
      }),
    [colors],
  );

  async function onSaveServer() {
    const next = draftApi.trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(next)) {
      setError(t.net);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${next}/api/mobile`);
      if (!res.ok) throw new Error("bad");
      await saveApiUrl(next);
      setApi(next);
    } catch {
      setError(t.net);
    } finally {
      setBusy(false);
    }
  }

  async function onOtp() {
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const full = /^\d{9}$/.test(phone) && phone.startsWith("9") ? `+244${phone}` : "";
      if (!full) {
        setError(t.phone);
        return;
      }
      const res = await call<{ ok: boolean; error?: string }>(api, "requestOtp", { name, phone: full, channel: "whatsapp" });
      if (!res.ok) {
        setError(t.net);
        return;
      }
      go({ name: "otp", phone: full, demoCode: "" });
    } catch {
      setError(t.net);
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(demoCode: string) {
    setBusy(true);
    try {
      const res = await call<{ ok: boolean; token?: string; error?: string }>(api, "verifyOtp", { phone, code: code || demoCode });
      if (!res.ok || !res.token) {
        setError(t.code);
        return;
      }
      await AsyncStorage.setItem("ct-token", res.token);
      setToken(res.token);
      setStack([]);
      setScreen({ name: "home" });
    } catch {
      setError(t.net);
    } finally {
      setBusy(false);
    }
  }

  function add(item: Product) {
    setCart((prev) => {
      const found = prev.find((line) => line.sku === item.sku);
      if (found) return prev.map((line) => (line.sku === item.sku ? { ...line, qty: line.qty + 1 } : line));
      return [...prev, { sku: item.sku, name: item.name, qty: 1, priceAoa: item.priceAoa }];
    });
  }

  async function openList(title: string, categoryId?: string) {
    go({ name: "list", title, categoryId });
    setBusy(true);
    try {
      const res = await call<{ ok: boolean; products?: Product[] }>(api, "searchProducts", {
        token,
        categoryId,
        q: categoryId ? undefined : q,
        limit: 24,
      });
      setProducts(res.products ?? []);
    } catch {
      setError(t.net);
    } finally {
      setBusy(false);
    }
  }

  async function openProduct(sku: string) {
    go({ name: "product", sku });
    setProduct(null);
    const res = await call<{ ok: boolean; product?: Product }>(api, "getProduct", { token, sku });
    if (res.ok && res.product) setProduct(res.product);
  }

  async function refreshQuote(nextSpot = spot) {
    const res = await call<{ ok: boolean; quote?: { delivery: number; total: number; inZone: boolean } }>(api, "quoteCart", {
      token,
      items: cart.map((line) => ({ sku: line.sku, qty: line.qty })),
      lat: nextSpot.lat,
      lng: nextSpot.lng,
    });
    if (res.ok && res.quote?.inZone) setQuote({ delivery: res.quote.delivery, total: res.quote.total });
    else setQuote(null);
  }

  async function place() {
    setBusy(true);
    setError("");
    try {
      const res = await call<{ ok: boolean; order?: { number: number; id: string }; error?: string }>(api, "placeOrder", {
        token,
        items: cart.map((line) => ({ sku: line.sku, qty: line.qty })),
        lat: spot.lat,
        lng: spot.lng,
        label: `${spot.label}, ${door}`.trim(),
        complement: note,
        paymentMethod: pay,
      });
      if (!res.ok || !res.order) {
        setError(res.error ?? t.net);
        return;
      }
      setCart([]);
      setStack([]);
      setScreen({ name: "done", number: res.order.number, id: res.order.id });
    } catch {
      setError(t.net);
    } finally {
      setBusy(false);
    }
  }

  async function openOrders() {
    go({ name: "orders" });
    const res = await call<{ ok: boolean; orders?: typeof orders }>(api, "listOrders", { token });
    setOrders(res.orders ?? []);
  }

  const count = cart.reduce((n, line) => n + line.qty, 0);
  const subtotal = cart.reduce((n, line) => n + line.priceAoa * line.qty, 0);
  const showBar = count > 0 && (screen.name === "home" || screen.name === "list" || screen.name === "product");
  const cardW = Math.floor((screenW - 32 - 12) / 2);
  const bundle = BUNDLES[slide] ?? BUNDLES[0];
  const [bundleTitle, bundleLine] = t.bundles[slide] ?? t.bundles[0];
  const bundlePromo = bundleItems.reduce((n, item) => n + item.priceAoa, 0);

  function setQty(sku: string, qty: number) {
    setCart((prev) => (qty <= 0 ? prev.filter((line) => line.sku !== sku) : prev.map((line) => (line.sku === sku ? { ...line, qty } : line))));
  }
  function addAll(items: Product[]) {
    setCart((prev) => {
      let next = [...prev];
      for (const item of items) {
        if (item.availability === "out") continue;
        const found = next.find((line) => line.sku === item.sku);
        next = found
          ? next.map((line) => (line.sku === item.sku ? { ...line, qty: line.qty + 1 } : line))
          : [...next, { sku: item.sku, name: item.name, qty: 1, priceAoa: item.priceAoa }];
      }
      return next;
    });
  }
  async function repeatLast() {
    const res = await call<{ ok: boolean; orders?: { status: string; items?: { sku: string; name: string; qty: number; unitPrice: number }[] }[] }>(api, "listOrders", { token });
    const list = res.orders ?? [];
    const order = list.find((item) => item.status !== "cancelled") ?? list[0];
    if (!order?.items?.length) {
      openOrders();
      return;
    }
    setCart(order.items.map((item) => ({ sku: item.sku, name: item.name, qty: item.qty, priceAoa: item.unitPrice })));
    go({ name: "cart" });
  }
  async function signOut() {
    try {
      await call(api, "logout", { token });
    } catch {
      /* a sessão local é apagada mesmo sem rede */
    }
    await AsyncStorage.removeItem("ct-token");
    setToken("");
    setCart([]);
    setName("");
    setPhone("");
    setCode("");
    setStack([]);
    setScreen({ name: "gate" });
  }

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: Platform.OS === "android" ? StatusBar.currentHeight ?? 24 : 0 }]}>
      <ExpoStatusBar style={night ? "light" : "dark"} />
      <StatusBar barStyle={night ? "light-content" : "dark-content"} />
      <ScrollView contentContainerStyle={[styles.page, showBar ? { paddingBottom: 120 } : { paddingBottom: 40 }]}>
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Image
              source={night ? LOGO_DARK : LOGO}
              accessibilityLabel={t.title}
              resizeMode="contain"
              style={{ height: 40, width: Math.min(40 * LOGO_RATIO, screenW - 200), maxWidth: "100%" }}
            />
          </View>
          {(["pt", "fr", "en"] as Lang[]).map((item) => (
            <Pressable
              key={item}
              onPress={() => {
                setLang(item);
                AsyncStorage.setItem("ct-lang", item);
              }}
            >
              <Text style={styles.ghost}>{item.toUpperCase()}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              const next = !night;
              setNight(next);
              AsyncStorage.setItem("ct-night", next ? "1" : "0");
            }}
          >
            <Text style={styles.ghost}>{night ? t.day : t.night}</Text>
          </Pressable>
        </View>

        {screen.name !== "boot" && screen.name !== "gate" && stack.length > 0 ? (
          <Pressable onPress={back}><Text style={styles.ghost}>{t.back}</Text></Pressable>
        ) : null}
        {error ? <Text style={{ color: "#b42318" }}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={colors.blue} /> : null}

        {screen.name === "gate" ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.p}>{t.server}</Text>
            <TextInput value={draftApi} onChangeText={setDraftApi} autoCapitalize="none" autoCorrect={false} placeholder={t.serverPh} placeholderTextColor={colors.muted} style={styles.input} />
            <Pressable style={styles.btn} onPress={onSaveServer}><Text style={styles.btnText}>{t.save}</Text></Pressable>
            {api ? (
              <>
                <TextInput value={name} onChangeText={setName} placeholder={t.name} placeholderTextColor={colors.muted} style={styles.input} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>+244</Text>
                  <TextInput
                    value={phone}
                    onChangeText={(value) => {
                      let digits = value.replace(/\D/g, "");
                      if (digits.startsWith("00244")) digits = digits.slice(5);
                      else if (digits.startsWith("244")) digits = digits.slice(3);
                      if (digits.startsWith("0")) digits = digits.slice(1);
                      digits = digits.slice(0, 9);
                      setPhone(digits.startsWith("9") || digits === "" ? digits : "");
                    }}
                    keyboardType="number-pad"
                    maxLength={9}
                    placeholder="9XXXXXXXX"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { flex: 1 }]}
                  />
                </View>
                <Pressable style={styles.btn} onPress={onOtp}><Text style={styles.btnText}>{t.send}</Text></Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {screen.name === "otp" ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.muted}>{t.demo}</Text>
            <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" placeholder={t.code} placeholderTextColor={colors.muted} style={styles.input} />
            <Pressable style={styles.btn} onPress={() => onVerify(screen.demoCode)}><Text style={styles.btnText}>{t.enter}</Text></Pressable>
          </View>
        ) : null}

        {screen.name === "home" || screen.name === "list" ? (
          <View style={{ gap: 12 }}>
            <View style={[styles.row, { flexWrap: "nowrap" }]}>
              <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => openList(q || t.search)} returnKeyType="search" placeholder={t.search} placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, minWidth: 0, borderRadius: 999 }]} />
              <Pressable style={styles.btn} onPress={() => openList(q || t.search)}><Text style={styles.btnText}>{t.search}</Text></Pressable>
            </View>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Pressable onPress={openOrders}><Text style={styles.ghost}>{t.orders}</Text></Pressable>
              <Pressable onPress={signOut}><Text style={styles.ghost}>{t.out}</Text></Pressable>
            </View>
            {screen.name === "home" ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                  <View style={[styles.catChip, styles.chipOn, { paddingLeft: 14 }]}>
                    <Text style={[styles.chipText, { color: colors.on }]}>{t.allAisles}</Text>
                  </View>
                  {categories.map((cat) => (
                    <Pressable key={cat.id} style={styles.catChip} onPress={() => openList(cat.name, cat.id)}>
                      <Image source={{ uri: photoUrl(api, CAT_PHOTO[cat.id] ?? "MER-0001.jpg") }} resizeMode="contain" style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: "#ffffff" }} />
                      <Text style={styles.chipText}>{cat.name}</Text>
                      <Text style={[styles.muted, { fontSize: 12 }]}>{cat.count}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={{ borderRadius: 24, overflow: "hidden", backgroundColor: "#1E4FD8" }}>
                  <Pressable onPress={() => addAll(bundleItems)} style={{ backgroundColor: "#ffffff" }}>
                    <Image source={{ uri: photoUrl(api, bundle.photo) }} resizeMode="contain" style={{ width: "100%", height: 180 }} />
                  </Pressable>
                  <View style={{ padding: 16, gap: 6 }}>
                    <Text style={{ color: "#FFC700", fontSize: 12 }}>{t.campaign} {slide + 1}/{BUNDLES.length}</Text>
                    <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "700" }}>{bundleTitle}</Text>
                    <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14 }}>{bundleLine}</Text>
                    <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 14 }}>{t.validUntil.replace("{date}", campaignUntil(lang))}</Text>
                    {bundlePromo > 0 ? <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "700" }}>{kz(bundlePromo)}</Text> : null}
                    <View style={[styles.row, { marginTop: 6 }]}>
                      <Pressable accessibilityLabel={t.prevOffer} onPress={() => setSlide((slide + BUNDLES.length - 1) % BUNDLES.length)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "#ffffff", fontSize: 20 }}>←</Text>
                      </Pressable>
                      <Pressable accessibilityLabel={t.nextOffer} onPress={() => setSlide((slide + 1) % BUNDLES.length)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "#ffffff", fontSize: 20 }}>→</Text>
                      </Pressable>
                      <Pressable onPress={() => addAll(bundleItems)} style={{ backgroundColor: "#FFC700", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 }}>
                        <Text style={{ color: "#0B1F4D", fontWeight: "700" }}>{t.addBundle}</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
                <Text style={[styles.h1, { fontSize: 26 }]}>{t.homeLine}</Text>
              </>
            ) : <Text style={styles.h1}>{screen.title}</Text>}
            {products.length === 0 && !busy ? <Text style={styles.muted}>{t.none}</Text> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {products.map((item) => (
                <View key={item.sku} style={[styles.gridCard, { width: cardW }]}>
                  <Pressable onPress={() => openProduct(item.sku)}>
                    {item.photoFile ? <Image source={{ uri: photoUrl(api, item.photoFile) }} resizeMode="contain" style={styles.gridPhoto} /> : <View style={styles.gridPhoto} />}
                    <Text numberOfLines={1} style={[styles.muted, { fontSize: 12, marginTop: 8 }]}>{item.brand}</Text>
                    <Text numberOfLines={2} style={[styles.p, { minHeight: 44, lineHeight: 22 }]}>{item.name}</Text>
                    <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>{item.format}</Text>
                  </Pressable>
                  <View style={{ flex: 1 }} />
                  {item.compareAtAoa ? <Text style={{ color: colors.blue, fontWeight: "700", fontSize: 13, marginTop: 6 }}>-{Math.round((1 - item.priceAoa / item.compareAtAoa) * 100)}%</Text> : <View style={{ height: 6 }} />}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 4 }}>
                    <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 17, fontWeight: "700", flexShrink: 1 }}>{kz(item.priceAoa)}</Text>
                    {item.availability === "out" ? null : (
                      <Pressable accessibilityLabel={t.add} onPress={() => add(item)} style={styles.plus}><Text style={styles.plusText}>+</Text></Pressable>
                    )}
                  </View>
                  {item.availability === "out" ? <Text style={[styles.muted, { fontSize: 12 }]}>{t.sold}</Text> : null}
                  {item.availability === "low" ? <Text style={[styles.muted, { fontSize: 12 }]}>{t.low}</Text> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {screen.name === "product" && product ? (
          <View style={styles.card}>
            {product.photoFile ? <Image source={{ uri: photoUrl(api, product.photoFile) }} style={styles.photo} /> : null}
            <Text style={styles.h1}>{product.name}</Text>
            <Text style={styles.muted}>{product.brand} · {product.format}</Text>
            <Text style={styles.p}>{product.description}</Text>
            {product.compareAtAoa ? <Text style={[styles.muted, { textDecorationLine: "line-through" }]}>{kz(product.compareAtAoa)}</Text> : null}
            <Text style={styles.h1}>{kz(product.priceAoa)}</Text>
            {product.availability === "out" ? <Text>{t.sold}</Text> : (
              <Pressable style={styles.btn} onPress={() => add(product)}><Text style={styles.btnText}>{t.add}</Text></Pressable>
            )}
          </View>
        ) : null}

        {screen.name === "cart" ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.h1}>{t.cart}</Text>
            {cart.length === 0 ? <Text style={styles.muted}>{t.empty}</Text> : cart.map((line) => (
              <View key={line.sku} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.p}>{line.name}</Text>
                  <Text style={styles.muted}>{kz(line.priceAoa * line.qty)}</Text>
                </View>
                <Pressable accessibilityLabel="-" style={styles.step} onPress={() => setQty(line.sku, line.qty - 1)}><Text style={styles.p}>−</Text></Pressable>
                <Text style={[styles.p, { width: 22, textAlign: "center" }]}>{line.qty}</Text>
                <Pressable accessibilityLabel="+" style={styles.step} onPress={() => setQty(line.sku, line.qty + 1)}><Text style={styles.p}>+</Text></Pressable>
              </View>
            ))}
            {cart.length > 0 ? <Text style={[styles.p, { fontWeight: "700" }]}>{t.subtotal}: {kz(subtotal)}</Text> : null}
            {cart.length > 0 ? <Pressable style={styles.btn} onPress={() => go({ name: "address" })}><Text style={styles.btnText}>{t.checkout}</Text></Pressable> : null}
            <Pressable onPress={repeatLast}><Text style={[styles.ghost, { textAlign: "center" }]}>{t.repeatLast}</Text></Pressable>
          </View>
        ) : null}

        {screen.name === "address" ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.h1}>{t.address}</Text>
            <View style={styles.row}>
              {SPOTS.map((item) => (
                <Pressable key={item.label} style={[styles.chip, spot.label === item.label && styles.chipOn]} onPress={() => { setSpot(item); refreshQuote(item); }}>
                  <Text style={[styles.chipText, spot.label === item.label && { color: colors.on }]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={door} onChangeText={setDoor} placeholder={t.door} placeholderTextColor={colors.muted} style={styles.input} />
            <TextInput value={note} onChangeText={setNote} placeholder={t.note} placeholderTextColor={colors.muted} style={styles.input} />
            <Pressable style={styles.btn} onPress={async () => { await refreshQuote(); go({ name: "pay" }); }}><Text style={styles.btnText}>{t.pay}</Text></Pressable>
          </View>
        ) : null}

        {screen.name === "pay" ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.h1}>{t.pay}</Text>
            {quote ? <Text style={styles.p}>{t.delivery}: {kz(quote.delivery)} · {t.total}: {kz(quote.total)}</Text> : <Text style={styles.muted}>{t.net}</Text>}
            {PAYS.map((item) => (
              <Pressable key={item.id} style={[styles.chip, pay === item.id && styles.chipOn]} onPress={() => setPay(item.id)}>
                <Text style={[styles.chipText, pay === item.id && { color: colors.on }]}>{item.label}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.btn} disabled={!quote || door.trim().length < 4} onPress={place}><Text style={styles.btnText}>{t.place}</Text></Pressable>
          </View>
        ) : null}

        {screen.name === "done" ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.h1}>CT-{screen.number}</Text>
            <Pressable onPress={() => { setStack([]); setScreen({ name: "home" }); }}><Text style={styles.ghost}>{t.back}</Text></Pressable>
          </View>
        ) : null}

        {screen.name === "orders" ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.h1}>{t.orders}</Text>
            {orders.map((order) => (
              <View key={order.id} style={styles.card}>
                <Text style={styles.p}>CT-{order.number}</Text>
                <Text style={styles.muted}>{order.status} · {order.etaLabel} · {kz(order.totalAoa)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      {showBar ? (
        <View style={styles.bar}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: "#ffffff", fontWeight: "700" }}>{count === 1 ? t.itemsOne : t.items.replace("{n}", String(count))} · {kz(subtotal)}</Text>
          </View>
          <Pressable onPress={() => go({ name: "cart" })} style={{ backgroundColor: "#ffffff", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: "#0B1F4D", fontWeight: "700" }}>{t.seeCart}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
