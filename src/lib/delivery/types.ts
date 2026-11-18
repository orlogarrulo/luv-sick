export const DELIVERY_STATES = [
  "pendente",
  "a_procurar_estafeta",
  "estafeta_atribuido",
  "a_caminho_da_loja",
  "recolhido",
  "a_caminho_do_cliente",
  "entregue",
  "falhou",
  "cancelado",
  "devolvido_a_loja",
] as const;

export type DeliveryEstado = (typeof DELIVERY_STATES)[number];

export const PROGRESS_STATES: DeliveryEstado[] = [
  "pendente",
  "a_procurar_estafeta",
  "estafeta_atribuido",
  "a_caminho_da_loja",
  "recolhido",
  "a_caminho_do_cliente",
  "entregue",
];

export const TERMINAL_STATES: DeliveryEstado[] = ["entregue", "falhou", "cancelado", "devolvido_a_loja"];

export const STATUS_LABEL: Record<DeliveryEstado, string> = {
  pendente: "Pendente",
  a_procurar_estafeta: "A procurar estafeta",
  estafeta_atribuido: "Estafeta atribuído",
  a_caminho_da_loja: "A caminho da loja",
  recolhido: "Recolhido",
  a_caminho_do_cliente: "A caminho do cliente",
  entregue: "Entregue",
  falhou: "Falhou",
  cancelado: "Cancelado",
  devolvido_a_loja: "Devolvido à loja",
};

export type ProviderKind = "internal" | "yango" | "manual";

export type ZoneDef = {
  id: string;
  nome: string;
  feeKz: number;
  freeAboveKz: number | null;
  providers: string[];
  polygon: [number, number][];
};

export type DispatchRule = "cheapest" | "fastest" | "preferred";

export type QuoteOffer = {
  providerId: string;
  quoteId: string;
  priceKz: number;
  etaMin: number;
  expiresAt: number;
  codOk: boolean;
};

export type QuoteFailure = {
  providerId: string;
  error: string;
};

export type AnyQuote = QuoteOffer | QuoteFailure;

export type DeliveryOrder = {
  orderId: string;
  number: number;
  attempt: number;
  customerName: string;
  phone: string;
  lat: number;
  lng: number;
  addressLabel: string;
  complement: string;
  paymentMethod: string;
  codKz: number | null;
  subtotalKz: number;
  volumes: number;
  weightKg: number;
  declaredKz: number;
};

export type CarrierStatus = {
  estado: DeliveryEstado;
  courierName: string | null;
  courierPhone: string | null;
  lat: number | null;
  lng: number | null;
};

export const STORE_POINT = { lat: -8.916, lng: 13.19 };
export const STORE_WHATSAPP = "+244945407841";
export const STORE_WHATSAPP_LINK = "https://wa.me/244945407841";
export const DEFAULT_RADIUS_FEE_KZ = 1500;
export const DEFAULT_FREE_ABOVE_KZ = 25000;

export type TrackView = {
  estado: DeliveryEstado | string;
  pin: string | null;
  courierName: string | null;
  courierPhone: string | null;
  courierLat: number | null;
  courierLng: number | null;
  etaMin: number | null;
  zoneName: string | null;
  feeKz: number;
  rating: number | null;
  carrierName: string | null;
  whatsappSent: boolean;
  fallback: boolean;
};

export type DeliveryListItem = {
  orderId: string;
  number: number;
  estado: string;
  providerId: string | null;
  providerName: string | null;
  externalId: string | null;
  zoneId: string | null;
  zoneName: string | null;
  costKz: number | null;
  feeKz: number;
  marginKz: number | null;
  courierName: string | null;
  courierPhone: string | null;
  courierLat: number | null;
  courierLng: number | null;
  customerLat: number;
  customerLng: number;
  addressLabel: string;
  etaMin: number | null;
  fallback: boolean;
  degraded: boolean;
  pin: string | null;
  attempt: number;
  paymentMethod: string;
  codKz: number | null;
  createdAt: string;
  rating: number | null;
};

export type QuoteView = {
  id: string;
  providerId: string;
  providerName: string;
  priceKz: number | null;
  etaMin: number | null;
  error: string | null;
  expiresAt: string;
};

export type EventView = {
  id: string;
  estado: string;
  origem: string;
  at: string;
  note: string | null;
};

export type ProviderView = {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  prioridade: number;
  sandbox: boolean;
  supportsCod: boolean;
  supportsWebhook: boolean;
  apiConfigured: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  note: string;
};

export type ZoneView = {
  id: string;
  nome: string;
  feeKz: number;
  freeAboveKz: number | null;
  providers: string[];
};

export type SettingsView = {
  mode: "manual" | "auto";
  rule: DispatchRule;
  preferredProvider: string | null;
  priceCapKz: number | null;
  fallbackMin: number;
  showCarrier: boolean;
};

export type DeskData = {
  settings: SettingsView;
  providers: ProviderView[];
  zones: ZoneView[];
  deliveries: DeliveryListItem[];
  role: string;
};

export type DetailData = {
  item: DeliveryListItem;
  quotes: QuoteView[];
  events: EventView[];
  messages: { kind: string; body: string; toMasked: string; at: string }[];
};

export type ReportData = {
  delivered: number;
  active: number;
  complaints: number;
  byProvider: { id: string; nome: string; count: number; successPct: number; avgCost: number | null; avgMin: number | null }[];
  byZone: { id: string; nome: string; count: number; avgCost: number | null; avgFee: number | null; complaints: number }[];
  byDay: { day: string; count: number }[];
};

export type ReconcileRow = {
  externalId: string;
  billedKz: number;
  recordedKz: number | null;
  deltaKz: number | null;
  providerId: string | null;
};
