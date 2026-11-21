export type Lang = "pt" | "en" | "fr";
export type Market = "PT" | "AO";

export const LANGS: Lang[] = ["pt", "en", "fr"];
export const SIZES = ["XS", "S", "M", "L", "XL"] as const;
export const SHOP_EMAIL = "";
export const PRACTICE_EMAIL = "arrulo.orlog@gmail.com";
const UNIT_KZ = 1350;

export type Product = {
  id: string;
  priceEur: number;
  priceKz: number;
  images: [string, string];
  name: Record<Lang, string>;
  material: Record<Lang, string>;
  blurb: Record<Lang, string>;
  alt: Record<Lang, [string, string]>;
};

export const PRODUCTS: Product[] = [
  {
    id: "long-sleeve",
    priceEur: 70,
    priceKz: 100000,
    images: ["/luvsick/products/long-sleeve-1.jpg", "/luvsick/products/long-sleeve-2.jpg"],
    name: { pt: "Manga comprida", en: "Long sleeve", fr: "Manches longues" },
    material: {
      pt: "Algodão lavado. Gráfico do anjo na frente e lettering nas mangas.",
      en: "Washed cotton. Angel graphic on the front and lettering on the sleeves.",
      fr: "Coton lavé. Graphique d'ange devant et lettrage sur les manches.",
    },
    blurb: {
      pt: "Long sleeve Luv Sick com gráfico de anjo na frente e lettering nas mangas.",
      en: "Luv Sick long sleeve with the angel graphic on the front and lettering on the sleeves.",
      fr: "Manches longues Luv Sick, graphique d'ange devant et lettrage sur les manches.",
    },
    alt: {
      pt: ["Frente da manga comprida Luv Sick, fundo branco de estúdio", "Costas da manga comprida Luv Sick, fundo branco de estúdio"],
      en: ["Front of the Luv Sick long sleeve, white studio background", "Back of the Luv Sick long sleeve, white studio background"],
      fr: ["Face des manches longues Luv Sick, fond blanc de studio", "Dos des manches longues Luv Sick, fond blanc de studio"],
    },
  },
  {
    id: "tracksuit-black",
    priceEur: 120,
    priceKz: 160000,
    images: ["/luvsick/products/tracksuit-black-1.jpg", "/luvsick/products/tracksuit-black-back.jpg"],
    name: { pt: "Fato de treino preto", en: "Black tracksuit", fr: "Survêtement noir" },
    material: {
      pt: "Moletom de algodão. Hoodie e calças, com o coração da marca.",
      en: "Cotton fleece. Hoodie and trousers, with the brand heart.",
      fr: "Molleton de coton. Hoodie et pantalon, avec le cœur de la marque.",
    },
    blurb: {
      pt: "Fato de treino preto Luv Sick, conjunto completo (hoodie e calças) com o coração da marca.",
      en: "Black Luv Sick tracksuit, the full set (hoodie and trousers) with the brand heart.",
      fr: "Survêtement noir Luv Sick, ensemble complet (hoodie et pantalon) avec le cœur de la marque.",
    },
    alt: {
      pt: ["Frente do fato de treino preto Luv Sick, fundo branco de estúdio", "Costas do fato de treino preto Luv Sick, fundo branco de estúdio"],
      en: ["Front of the black Luv Sick tracksuit, white studio background", "Back of the black Luv Sick tracksuit, white studio background"],
      fr: ["Face du survêtement noir Luv Sick, fond blanc de studio", "Dos du survêtement noir Luv Sick, fond blanc de studio"],
    },
  },
  {
    id: "tracksuit-brown",
    priceEur: 120,
    priceKz: 160000,
    images: ["/luvsick/products/tracksuit-brown-1.jpg", "/luvsick/products/tracksuit-brown-back.jpg"],
    name: { pt: "Fato de treino castanho", en: "Brown tracksuit", fr: "Survêtement marron" },
    material: {
      pt: "Moletom de algodão. Hoodie e calças, com o coração da marca.",
      en: "Cotton fleece. Hoodie and trousers, with the brand heart.",
      fr: "Molleton de coton. Hoodie et pantalon, avec le cœur de la marque.",
    },
    blurb: {
      pt: "Fato de treino castanho Luv Sick, conjunto completo (hoodie e calças) com o coração da marca.",
      en: "Brown Luv Sick tracksuit, the full set (hoodie and trousers) with the brand heart.",
      fr: "Survêtement marron Luv Sick, ensemble complet (hoodie et pantalon) avec le cœur de la marque.",
    },
    alt: {
      pt: ["Frente do fato de treino castanho Luv Sick, fundo branco de estúdio", "Costas do fato de treino castanho Luv Sick, fundo branco de estúdio"],
      en: ["Front of the brown Luv Sick tracksuit, white studio background", "Back of the brown Luv Sick tracksuit, white studio background"],
      fr: ["Face du survêtement marron Luv Sick, fond blanc de studio", "Dos du survêtement marron Luv Sick, fond blanc de studio"],
    },
  },
];

export function productById(id: string) {
  return PRODUCTS.find((item) => item.id === id) ?? null;
}

export function kzAmount(product: Product) {
  if (Number.isFinite(product.priceKz)) return product.priceKz;
  return Math.round((product.priceEur * UNIT_KZ) / 1000) * 1000;
}

export function splitHalf(total: number) {
  const deposit = Math.round(total / 2);
  return { deposit, balance: total - deposit };
}

export function formatAmount(amount: number, market: Market) {
  if (market === "AO") return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} Kz`;
  return `${amount} €`;
}

export function quote(lines: { productId: string; qty: number }[], market: Market, couponPercent = 0) {
  let sub = 0;
  let tracksuit = 0;
  let tracksuitQty = 0;
  for (const line of lines) {
    const product = productById(line.productId);
    if (!product || line.qty < 1) continue;
    const row = (market === "AO" ? kzAmount(product) : product.priceEur) * line.qty;
    sub += row;
    if (product.id.startsWith("tracksuit-")) {
      tracksuit += row;
      tracksuitQty += line.qty;
    }
  }
  const tracksuitOff = tracksuitQty >= 2 ? Math.round(tracksuit * 0.1) : 0;
  const percent = Math.min(90, Math.max(0, Math.round(couponPercent)));
  const couponOff = percent ? Math.round(((sub - tracksuitOff) * percent) / 100) : 0;
  return { sub, tracksuitOff, couponOff, total: Math.max(0, sub - tracksuitOff - couponOff), tracksuitDeal: tracksuitQty >= 2 };
}

export function payUnit(product: Product, market: Market, deal: boolean) {
  const unit = market === "AO" ? kzAmount(product) : product.priceEur;
  return deal && product.id.startsWith("tracksuit-") ? Math.round(unit * 0.9) : unit;
}

export function formatMoney(product: Product, market: Market, qty = 1) {
  if (market === "AO") {
    const n = kzAmount(product) * qty;
    return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} Kz`;
  }
  return `${product.priceEur * qty} €`;
}

export type PayMethod = {
  id: string;
  label: string;
  /** phone = número para pagar; iban = transferência; card = carteira digital (Stripe). */
  kind: "phone" | "iban" | "card";
  /** Valor mostrado ao cliente (número ou IBAN formatado). */
  value: string;
};

export const PAY: Record<Market, PayMethod[]> = {
  AO: [
    { id: "multicaixa", label: "Multicaixa Express", kind: "phone", value: "924 498 009" },
    { id: "transfer", label: "Transferência bancária", kind: "iban", value: "AO06 0058 0000 0889 8681 1010 2" },
  ],
  PT: [
    { id: "mbway", label: "MB WAY", kind: "phone", value: "938 970 211" },
    { id: "applepay", label: "Apple Pay", kind: "card", value: "" },
    { id: "transfer", label: "Transferência bancária", kind: "iban", value: "PT50 3560 0001 9001 8662 6075 3" },
  ],
};

/** Métodos antigos que já não aparecem, mas podem existir em encomendas guardadas. */
const LEGACY_PAY: Record<string, string> = { unitel: "Unitel Money", applepay: "Apple Pay" };

/** Procura um método pelo id ou pelo nome (as reservas guardam o nome, as encomendas o id). */
export function payMethod(market: string, pay: string): PayMethod | null {
  const list = market === "AO" || market === "PT" ? PAY[market] : [...PAY.PT, ...PAY.AO];
  const asked = pay.trim().toLowerCase();
  return list.find((item) => item.id === asked || item.label.toLowerCase() === asked) ?? null;
}

export function payName(market: string, pay: string) {
  return payMethod(market, pay)?.label ?? LEGACY_PAY[pay] ?? pay;
}

/** Valor para copiar: sem espaços nem pontos. */
export function payCopyValue(value: string) {
  return value.replace(/[\s.]/g, "");
}

export const WA = {
  AO: { n: "244935523012", label: "Angola" },
  PT: { n: "351938970211", label: "Portugal" },
} as const;

type Dict = {
  enter: string;
  ask: string;
  skip: string;
  shop: string;
  bag: string;
  bagEmpty: string;
  close: string;
  front: string;
  back: string;
  size: string;
  add: string;
  buy: string;
  wish: string;
  wishOn: string;
  wishEmpty: string;
  share: string;
  shareLine: string;
  reserve: string;
  reserveOk: string;
  reserveWait: string;
  paidOk: string;
  awaitPay: string;
  halfNow: string;
  halfLater: string;
  receiptWord: string;
  invoiceWord: string;
  mailed: string;
  practice: string;
  account: string;
  codeSent: string;
  codeFail: string;
  codeWhatsapp: string;
  codeBad: string;
  codeLabel: string;
  myOrders: string;
  saveAddress: string;
  addressSaved: string;
  logout: string;
  sendCode: string;
  noOrders: string;
  email: string;
  emailBad: string;
  added: string;
  qty: string;
  remove: string;
  total: string;
  checkout: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postal: string;
  postalBad: string;
  send: string;
  required: string;
  phoneBad: string;
  pay: string;
  pickPay: string;
  soldOut: string;
  left: string;
  noStock: string;
  manage: string;
  coupon: string;
  apply: string;
  couponOk: string;
  couponBad: string;
  tracksuitDeal: string;
  tracksuitSoon: string;
  subtotal: string;
  successTitle: string;
  sentNote: string;
  itemsLabel: string;
  ref: string;
  thanks: string;
  whatsapp: string;
  otherNumber: string;
  continueShop: string;
  faqTitle: string;
  pieces: string;
  onePiece: string;
  manyPieces: string;
  langName: string;
  marketName: string;
  storyTitle: string;
  storyLead: string;
  home: string;
  about: string;
  lookbook: string;
  contact: string;
  newIn: string;
  arrivals: string;
  collection: string;
  explore: string;
  heroTitle: string;
  sound: string;
  mute: string;
  tags: string[];
  founders: { name: string; role: string; text: string; mark: string }[];
  orderLead: string;
  faqs: { q: string; a: string }[];
};

export const COPY: Record<Lang, Dict> = {
  pt: {
    enter: "Entrar",
    ask: "Como contactar?",
    skip: "Saltar",
    shop: "Loja",
    bag: "Saco",
    bagEmpty: "O saco está vazio.",
    close: "Fechar",
    front: "Frente",
    back: "Costas",
    size: "Tamanho",
    add: "Juntar ao saco",
    buy: "Comprar",
    wish: "Lista de desejos",
    wishOn: "Guardado",
    wishEmpty: "A lista de desejos está vazia.",
    share: "Partilhar",
    shareLine: "Olha esta peça da Luv Sick: {name}",
    reserve: "Reservar",
    reserveOk: "A reserva só fica confirmada depois do pagamento.",
    reserveWait: "Pedido recebido. O pagamento ainda não está confirmado.",
    paidOk: "Encomenda feita. Pagamento confirmado.",
    awaitPay: "À espera da confirmação do pagamento.",
    halfNow: "A pagar agora, 50%",
    halfLater: "Os outros 50% pagam-se no dia do envio.",
    receiptWord: "Recibo",
    invoiceWord: "Fatura",
    mailed: "Enviámos o recibo e a fatura para o teu email.",
    practice: "Conta de ensaio. O stock e os totais da loja não mudam.",
    account: "Conta",
    codeSent: "Enviámos um código para o teu email.",
    codeFail: "Não foi possível enviar o código. Tenta outra vez em Conta.",
    codeWhatsapp: "Vamos enviar-te o código por WhatsApp em breve. Depois escreve-o em Conta.",
    codeBad: "Código incorrecto ou expirado.",
    codeLabel: "Código",
    myOrders: "Encomendas",
    saveAddress: "Guardar morada",
    addressSaved: "Morada actualizada.",
    logout: "Sair",
    sendCode: "Enviar código",
    noOrders: "Ainda não há encomendas nesta conta.",
    email: "Email",
    emailBad: "Escreve um email válido.",
    added: "No saco",
    qty: "Quantidade",
    remove: "Tirar",
    total: "Total",
    checkout: "Encomendar",
    name: "Nome",
    phone: "Telefone",
    address: "Morada",
    city: "Cidade",
    country: "País",
    postal: "Código postal",
    postalBad: "Em Portugal o código é 0000-000. Em Angola, escreve o código que usas.",
    send: "Enviar encomenda",
    required: "Preenche este campo.",
    phoneBad: "Este número não pertence a uma operadora deste país.",
    pay: "Pagamento",
    pickPay: "Escolhe como queres pagar.",
    soldOut: "Esgotado",
    left: "Restam {n}",
    noStock: "Este tamanho já não tem stock.",
    manage: "Gestão",
    coupon: "Cupão",
    apply: "Aplicar",
    couponOk: "Cupão aplicado: {n}%",
    couponBad: "Este cupão não existe.",
    tracksuitDeal: "2 fatos de treino: −10%",
    tracksuitSoon: "Mais um fato de treino e o −10% entra sozinho.",
    subtotal: "Subtotal",
    successTitle: "Encomenda registada",
    sentNote: "Ficas nesta página. A encomenda ainda não foi enviada à loja: o WhatsApp abre a mensagem já escrita, com a referência.",
    itemsLabel: "Artigos",
    ref: "Referência",
    thanks: "A encomenda está escrita. Envia-a pelo WhatsApp para a acompanharmos.",
    whatsapp: "WhatsApp",
    otherNumber: "O outro número",
    continueShop: "Voltar à loja",
    faqTitle: "Perguntas",
    pieces: "artigos",
    onePiece: "1 artigo",
    manyPieces: "artigos",
    langName: "Idioma",
    marketName: "País",
    storyTitle: "Dois. Uma marca.",
    storyLead: "Não há balcão. Há dois. Alessandro Arrulo no corte, Kalyani Ngenohame na voz. A tua encomenda chega-lhes às mãos.",
    home: "Início",
    about: "A marca",
    lookbook: "Lookbook",
    contact: "Contacto",
    newIn: "Novidade",
    arrivals: "Novidades",
    collection: "Coleção 01",
    explore: "Ver",
    heroTitle: "Para todos os dias",
    sound: "Som",
    mute: "Sem som",
    tags: ["#LuvSick", "#FeitoPorNós", "#Angola", "#Moda"],
    founders: [
      { name: "Alessandro Arrulo", role: "Design", mark: "✂️", text: "O corte, o gráfico, o coração na peça. Se está na roupa, passou por ele. A encomenda também: responde ele." },
      { name: "Kalyani Ngenohame", role: "Marketing", mark: "📣", text: "A voz da marca é com ele. O que se diz e o que se vê lá fora. Quando compras, falas com ele." },
    ],
    orderLead: "Encomenda enviada pelo site Luv Sick. Fico a aguardar as instruções de pagamento.",
    faqs: [
      { q: "Como encomendo?", a: "Escolhe a peça e o tamanho, junta ao saco e segue os passos. No fim envias a encomenda pelo WhatsApp ou por email, já escrita, com uma referência para a acompanhares." },
      { q: "Que tamanho escolho?", a: "Há XS, S, M, L e XL em todas as peças. As peças vestem largas nas fotografias. Se estiveres entre dois tamanhos, fala connosco por WhatsApp antes de confirmares." },
      { q: "Como pago?", a: "Em Angola: Multicaixa Express para o 924 498 009 ou transferência bancária para o IBAN AO06 0058 0000 0889 8681 1010 2. Em Portugal: MB WAY para o 938 970 211, transferência bancária para o IBAN PT50 3560 0001 9001 8662 6075 3 ou Apple Pay (em breve). Põe a referência da encomenda no descritivo e, depois de pagar, envia o comprovativo na página do recibo ou pelo WhatsApp. O site nunca pede passwords, PINs nem dados de cartão. A encomenda só fica paga depois de verificarmos o comprovativo." },
      { q: "Como recebo a encomenda?", a: "Dás-nos a morada ao encomendar. Se a entrega for a combinar, confirmamos o custo contigo antes de pagares." },
      { q: "Posso comprar só uma peça?", a: "Sim. Podes encomendar só a manga comprida, só o fato de treino preto ou só o fato de treino castanho — não precisas de levar tudo. Cada fato de treino é o conjunto completo (hoodie e calças)." },
    ],
  },
  en: {
    enter: "Enter",
    ask: "How can I get in touch?",
    skip: "Skip",
    shop: "Shop",
    bag: "Bag",
    bagEmpty: "The bag is empty.",
    close: "Close",
    front: "Front",
    back: "Back",
    size: "Size",
    add: "Add to bag",
    buy: "Buy",
    wish: "Wishlist",
    wishOn: "Saved",
    wishEmpty: "Your wishlist is empty.",
    share: "Share",
    shareLine: "Look at this Luv Sick piece: {name}",
    reserve: "Reserve",
    reserveOk: "The reservation is only confirmed after payment.",
    reserveWait: "Request received. Payment is not confirmed yet.",
    paidOk: "Order complete. Payment confirmed.",
    awaitPay: "Waiting for payment confirmation.",
    halfNow: "Pay now, 50%",
    halfLater: "The other 50% is paid on the day the order is sent.",
    receiptWord: "Receipt",
    invoiceWord: "Invoice",
    mailed: "We sent the receipt and the invoice to your email.",
    practice: "Practice account. Stock and shop totals stay unchanged.",
    account: "Account",
    codeSent: "We sent a code to your email.",
    codeFail: "The code could not be sent. Try again in Account.",
    codeWhatsapp: "We will send you the code on WhatsApp shortly. Then enter it in Account.",
    codeBad: "Wrong or expired code.",
    codeLabel: "Code",
    myOrders: "Orders",
    saveAddress: "Save address",
    addressSaved: "Address updated.",
    logout: "Log out",
    sendCode: "Send code",
    noOrders: "There are no orders on this account yet.",
    email: "Email",
    emailBad: "Enter a valid email.",
    added: "In the bag",
    qty: "Quantity",
    remove: "Remove",
    total: "Total",
    checkout: "Checkout",
    name: "Name",
    phone: "Phone",
    address: "Address",
    city: "City",
    country: "Country",
    postal: "Postcode",
    postalBad: "In Portugal the postcode is 0000-000. In Angola, write the code you use.",
    send: "Send order",
    required: "Fill in this field.",
    phoneBad: "This number does not belong to an operator in this country.",
    pay: "Payment",
    pickPay: "Choose how you want to pay.",
    soldOut: "Sold out",
    left: "{n} left",
    noStock: "This size is out of stock.",
    manage: "Desk",
    coupon: "Coupon",
    apply: "Apply",
    couponOk: "Coupon applied: {n}%",
    couponBad: "This coupon does not exist.",
    tracksuitDeal: "2 tracksuits: −10%",
    tracksuitSoon: "One more tracksuit and the −10% applies on its own.",
    subtotal: "Subtotal",
    successTitle: "Order registered",
    sentNote: "You stay on this page. The order has not reached the shop yet: WhatsApp opens the message already written, with the reference.",
    itemsLabel: "Items",
    ref: "Reference",
    thanks: "The order is written. Send it on WhatsApp so we can follow it.",
    whatsapp: "WhatsApp",
    otherNumber: "The other number",
    continueShop: "Back to the shop",
    faqTitle: "Questions",
    pieces: "items",
    onePiece: "1 item",
    manyPieces: "items",
    langName: "Language",
    marketName: "Country",
    storyTitle: "Two. One brand.",
    storyLead: "No counter. Just two. Alessandro Arrulo on the cut, Kalyani Ngenohame on the voice. Your order lands in their hands.",
    home: "Home",
    about: "About",
    lookbook: "Lookbook",
    contact: "Contact",
    newIn: "New arrival",
    arrivals: "New arrivals",
    collection: "Collection 01",
    explore: "Explore",
    heroTitle: "Everyday pieces",
    sound: "Sound",
    mute: "Mute",
    tags: ["#LuvSick", "#MadeByUs", "#Angola", "#Fashion"],
    founders: [
      { name: "Alessandro Arrulo", role: "Design", mark: "✂️", text: "The cut, the graphic, the heart on the piece. If it's on the clothes, it went through him. Your order too: he answers." },
      { name: "Kalyani Ngenohame", role: "Marketing", mark: "📣", text: "The brand's voice is his. What gets said, and what you see out there. When you buy, you talk to him." },
    ],
    orderLead: "Order sent from the Luv Sick site. I'll wait for the payment instructions.",
    faqs: [
      { q: "How do I order?", a: "Pick the piece and the size, add it to the bag and follow the steps. At the end you send the order on WhatsApp or by email, already written, with a reference so you can follow it." },
      { q: "Which size?", a: "Every piece comes in XS, S, M, L and XL. They look loose in the photos. If you are between two sizes, message us on WhatsApp before you confirm." },
      { q: "How do I pay?", a: "In Angola: Multicaixa Express to 924 498 009 or a bank transfer to IBAN AO06 0058 0000 0889 8681 1010 2. In Portugal: MB WAY to 938 970 211, a bank transfer to IBAN PT50 3560 0001 9001 8662 6075 3 or Apple Pay (coming soon). Put the order reference in the payment description and, once you have paid, send the proof of payment on the receipt page or by WhatsApp. The site never asks for passwords, PINs or card details. The order is only paid once we have checked the proof." },
      { q: "How do I receive it?", a: "You give us the address when you order. If delivery is to be arranged, we confirm the cost with you before you pay." },
      { q: "Can I buy just one piece?", a: "Yes. You can order only the long sleeve, only the black tracksuit or only the brown tracksuit — you don't have to take everything. Each tracksuit is the full set (hoodie and trousers)." },
    ],
  },
  fr: {
    enter: "Entrer",
    ask: "Comment vous contacter ?",
    skip: "Passer",
    shop: "Boutique",
    bag: "Sac",
    bagEmpty: "Le sac est vide.",
    close: "Fermer",
    front: "Face",
    back: "Dos",
    size: "Taille",
    add: "Ajouter au sac",
    buy: "Acheter",
    wish: "Liste d'envies",
    wishOn: "Gardé",
    wishEmpty: "La liste d'envies est vide.",
    share: "Partager",
    shareLine: "Regarde cette pièce Luv Sick : {name}",
    reserve: "Réserver",
    reserveOk: "La réservation n'est confirmée qu'après le paiement.",
    reserveWait: "Demande reçue. Le paiement n'est pas encore confirmé.",
    paidOk: "Commande faite. Paiement confirmé.",
    awaitPay: "En attente de confirmation du paiement.",
    halfNow: "À payer maintenant, 50 %",
    halfLater: "Les autres 50 % se paient le jour de l'envoi.",
    receiptWord: "Reçu",
    invoiceWord: "Facture",
    mailed: "Nous avons envoyé le reçu et la facture à ton e-mail.",
    practice: "Compte d'essai. Le stock et les totaux de la boutique ne changent pas.",
    account: "Compte",
    codeSent: "Nous avons envoyé un code à ton e-mail.",
    codeFail: "Le code n'a pas pu être envoyé. Réessaie dans Compte.",
    codeWhatsapp: "Nous t'enverrons le code par WhatsApp très bientôt. Saisis-le ensuite dans Compte.",
    codeBad: "Code incorrect ou expiré.",
    codeLabel: "Code",
    myOrders: "Commandes",
    saveAddress: "Enregistrer l'adresse",
    addressSaved: "Adresse mise à jour.",
    logout: "Sortir",
    sendCode: "Envoyer le code",
    noOrders: "Il n'y a pas encore de commandes sur ce compte.",
    email: "E-mail",
    emailBad: "Écris un e-mail valide.",
    added: "Dans le sac",
    qty: "Quantité",
    remove: "Retirer",
    total: "Total",
    checkout: "Commander",
    name: "Nom",
    phone: "Téléphone",
    address: "Adresse",
    city: "Ville",
    country: "Pays",
    postal: "Code postal",
    postalBad: "Au Portugal, le code est 0000-000. En Angola, écris le code que tu utilises.",
    send: "Envoyer la commande",
    required: "Remplis ce champ.",
    phoneBad: "Ce numéro n'appartient pas à un opérateur de ce pays.",
    pay: "Paiement",
    pickPay: "Choisis comment tu veux payer.",
    soldOut: "Épuisé",
    left: "Il en reste {n}",
    noStock: "Cette taille n'a plus de stock.",
    manage: "Gestion",
    coupon: "Coupon",
    apply: "Appliquer",
    couponOk: "Coupon appliqué : {n} %",
    couponBad: "Ce coupon n'existe pas.",
    tracksuitDeal: "2 survêtements : −10 %",
    tracksuitSoon: "Un survêtement de plus et les −10 % s'appliquent tout seuls.",
    subtotal: "Sous-total",
    successTitle: "Commande enregistrée",
    sentNote: "Tu restes sur cette page. La commande n'est pas encore partie à la boutique : WhatsApp ouvre le message déjà rédigé, avec la référence.",
    itemsLabel: "Articles",
    ref: "Référence",
    thanks: "La commande est rédigée. Envoie-la par WhatsApp pour qu'on la suive.",
    whatsapp: "WhatsApp",
    otherNumber: "L'autre numéro",
    continueShop: "Retour à la boutique",
    faqTitle: "Questions",
    pieces: "articles",
    onePiece: "1 article",
    manyPieces: "articles",
    langName: "Langue",
    marketName: "Pays",
    storyTitle: "Deux. Une marque.",
    storyLead: "Pas de comptoir. Juste eux deux. Alessandro Arrulo à la coupe, Kalyani Ngenohame à la voix. Ta commande arrive entre leurs mains.",
    home: "Accueil",
    about: "La marque",
    lookbook: "Lookbook",
    contact: "Contact",
    newIn: "Nouveauté",
    arrivals: "Nouveautés",
    collection: "Collection 01",
    explore: "Voir",
    heroTitle: "Pour tous les jours",
    sound: "Son",
    mute: "Muet",
    tags: ["#LuvSick", "#FaitParNous", "#Angola", "#Mode"],
    founders: [
      { name: "Alessandro Arrulo", role: "Design", mark: "✂️", text: "La coupe, le graphique, le cœur sur la pièce. Si c'est sur le vêtement, c'est passé par lui. Ta commande aussi : c'est lui qui répond." },
      { name: "Kalyani Ngenohame", role: "Marketing", mark: "📣", text: "La voix de la marque, c'est lui. Ce qui se dit, et ce qui se voit dehors. Quand tu achètes, tu lui parles." },
    ],
    orderLead: "Commande envoyée depuis le site Luv Sick. J'attends les instructions de paiement.",
    faqs: [
      { q: "Comment je commande ?", a: "Choisis la pièce et la taille, ajoute-la au sac et suis les étapes. À la fin tu envoies la commande par WhatsApp ou par e-mail, déjà rédigée, avec une référence pour la suivre." },
      { q: "Quelle taille ?", a: "Il y a XS, S, M, L et XL sur toutes les pièces. Elles tombent larges sur les photos. Si tu hésites entre deux tailles, écris-nous sur WhatsApp avant de confirmer." },
      { q: "Comment je paie ?", a: "En Angola : Multicaixa Express au 924 498 009 ou virement bancaire sur l'IBAN AO06 0058 0000 0889 8681 1010 2. Au Portugal : MB WAY au 938 970 211, virement bancaire sur l'IBAN PT50 3560 0001 9001 8662 6075 3 ou Apple Pay (bientôt). Indique la référence de la commande dans le libellé du paiement et, une fois payé, envoie le justificatif sur la page du reçu ou par WhatsApp. Le site ne demande jamais de mots de passe, de codes PIN ni de données de carte. La commande n'est payée qu'une fois le justificatif vérifié." },
      { q: "Comment je reçois la commande ?", a: "Tu nous donnes l'adresse en commandant. Si la livraison est à convenir, on confirme le coût avec toi avant que tu paies." },
      { q: "Je peux acheter une seule pièce ?", a: "Oui. Tu peux commander seulement les manches longues, seulement le survêtement noir ou seulement le survêtement marron — tu n'as pas à tout prendre. Chaque survêtement est l'ensemble complet (hoodie et pantalon)." },
    ],
  },
};
