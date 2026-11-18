import { createHmac, timingSafeEqual } from "node:crypto";
import { haversineKm, inDeliveryZone } from "../pricing.ts";
import {
  DEFAULT_FREE_ABOVE_KZ,
  DEFAULT_RADIUS_FEE_KZ,
  PROGRESS_STATES,
  STATUS_LABEL,
  STORE_POINT,
  TERMINAL_STATES,
  type AnyQuote,
  type CarrierStatus,
  type DeliveryEstado,
  type DeliveryOrder,
  type DispatchRule,
  type ProviderKind,
  type QuoteOffer,
  type ZoneDef,
} from "./types.ts";

export const DEFAULT_ZONES: ZoneDef[] = [
  {
    id: "talatona",
    nome: "Talatona",
    feeKz: 1200,
    freeAboveKz: 25000,
    providers: ["internal", "yango", "manual"],
    polygon: [
      [13.14, -8.97],
      [13.2, -8.97],
      [13.2, -8.89],
      [13.14, -8.89],
      [13.14, -8.97],
    ],
  },
  {
    id: "nova-vida",
    nome: "Nova Vida",
    feeKz: 1400,
    freeAboveKz: 25000,
    providers: ["internal", "yango", "manual"],
    polygon: [
      [13.2, -8.93],
      [13.25, -8.93],
      [13.25, -8.88],
      [13.2, -8.88],
      [13.2, -8.93],
    ],
  },
  {
    id: "kilamba",
    nome: "Kilamba",
    feeKz: 1800,
    freeAboveKz: 30000,
    providers: ["internal", "yango"],
    polygon: [
      [13.22, -9.05],
      [13.32, -9.05],
      [13.32, -8.96],
      [13.22, -8.96],
      [13.22, -9.05],
    ],
  },
  {
    id: "maianga",
    nome: "Maianga",
    feeKz: 2000,
    freeAboveKz: 35000,
    providers: ["internal", "manual"],
    polygon: [
      [13.21, -8.85],
      [13.26, -8.85],
      [13.26, -8.8],
      [13.21, -8.8],
      [13.21, -8.85],
    ],
  },
  {
    id: "viana",
    nome: "Viana",
    feeKz: 2500,
    freeAboveKz: 40000,
    providers: ["manual", "internal"],
    polygon: [
      [13.32, -8.95],
      [13.42, -8.95],
      [13.42, -8.85],
      [13.32, -8.85],
      [13.32, -8.95],
    ],
  },
];

const YANGO_STATUS: Record<string, DeliveryEstado> = {
  new: "pendente",
  estimating: "a_procurar_estafeta",
  ready_for_approval: "a_procurar_estafeta",
  performer_lookup: "a_procurar_estafeta",
  accepted: "estafeta_atribuido",
  performer_found: "estafeta_atribuido",
  pickup_arrived: "a_caminho_da_loja",
  arriving: "a_caminho_da_loja",
  pickuped: "recolhido",
  delivering: "a_caminho_do_cliente",
  delivered: "entregue",
  delivered_finish: "entregue",
  failed: "falhou",
  performer_not_found: "falhou",
  cancelled: "cancelado",
  canceled: "cancelado",
  returning: "devolvido_a_loja",
  returned: "devolvido_a_loja",
  return_arrived: "devolvido_a_loja",
};

const INTERNAL_STEPS: [number, DeliveryEstado][] = [
  [0, "estafeta_atribuido"],
  [12_000, "a_caminho_da_loja"],
  [24_000, "recolhido"],
  [36_000, "a_caminho_do_cliente"],
  [72_000, "entregue"],
];

export function isEstado(value: string): value is DeliveryEstado {
  return (PROGRESS_STATES as string[]).includes(value) || (TERMINAL_STATES as string[]).includes(value);
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} *** ${digits.slice(-3)}`;
}

export function sanitizeError(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret && secret.length > 3) out = out.split(secret).join("[redigido]");
  }
  out = out.replace(/\b(api[_-]?key|token|secret|authorization)[=: ]+\S+/gi, "$1=[redigido]");
  return out.slice(0, 180);
}

export function pointInPolygon(lng: number, lat: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function locateZone(zones: ZoneDef[], lat: number, lng: number): ZoneDef | null {
  for (const zone of zones) {
    if (pointInPolygon(lng, lat, zone.polygon)) return zone;
  }
  return null;
}

export function priceZone(
  zones: ZoneDef[],
  lat: number,
  lng: number,
  subtotal: number,
): { inZone: boolean; fee: number; zone: ZoneDef | null } {
  const zone = locateZone(zones, lat, lng);
  if (zone) {
    const free = zone.freeAboveKz != null && subtotal >= zone.freeAboveKz;
    return { inZone: true, fee: free ? 0 : zone.feeKz, zone };
  }
  if (!inDeliveryZone(lat, lng)) return { inZone: false, fee: 0, zone: null };
  const free = subtotal >= DEFAULT_FREE_ABOVE_KZ;
  return { inZone: true, fee: free ? 0 : DEFAULT_RADIUS_FEE_KZ, zone: null };
}

export function mapExternalStatus(kind: ProviderKind, raw: string): DeliveryEstado | null {
  if (kind === "yango") return YANGO_STATUS[raw] ?? null;
  if (isEstado(raw)) return raw;
  return null;
}

export function statusLabel(estado: string): string {
  return isEstado(estado) ? STATUS_LABEL[estado] : estado;
}

function kmOf(order: DeliveryOrder): number {
  return haversineKm(order.lat, order.lng, STORE_POINT.lat, STORE_POINT.lng);
}

export function localQuote(kind: ProviderKind, order: DeliveryOrder, now: number): QuoteOffer {
  const km = kmOf(order);
  if (kind === "yango") {
    return {
      providerId: "yango",
      quoteId: `yg-q-${order.orderId}-${order.attempt}`,
      priceKz: Math.round(1400 + km * 110),
      etaMin: Math.max(18, Math.round(12 + km * 1.3)),
      expiresAt: now + 10 * 60_000,
      codOk: false,
    };
  }
  if (kind === "manual") {
    return {
      providerId: "manual",
      quoteId: `man-q-${order.orderId}-${order.attempt}`,
      priceKz: 1600,
      etaMin: Math.max(45, Math.round(40 + km * 2)),
      expiresAt: now + 30 * 60_000,
      codOk: true,
    };
  }
  return {
    providerId: "internal",
    quoteId: `fl-q-${order.orderId}-${order.attempt}`,
    priceKz: Math.round(700 + km * 60),
    etaMin: Math.max(28, Math.round(24 + km * 2.2)),
    expiresAt: now + 10 * 60_000,
    codOk: true,
  };
}

export function pickQuote(
  quotes: AnyQuote[],
  rule: DispatchRule,
  preferredId?: string | null,
  capKz?: number | null,
): QuoteOffer | null {
  const offers = quotes.filter((quote): quote is QuoteOffer => !("error" in quote));
  if (offers.length === 0) return null;
  const cheapest = (list: QuoteOffer[]) =>
    [...list].sort((a, b) => a.priceKz - b.priceKz || a.etaMin - b.etaMin)[0];
  const fastest = (list: QuoteOffer[]) =>
    [...list].sort((a, b) => a.etaMin - b.etaMin || a.priceKz - b.priceKz)[0];
  if (rule === "fastest") return fastest(offers);
  if (rule === "preferred" && preferredId) {
    const pref = offers.find((q) => q.providerId === preferredId);
    if (pref && (capKz == null || pref.priceKz <= capKz)) return pref;
    const under = capKz == null ? offers : offers.filter((q) => q.priceKz <= capKz);
    return cheapest(under.length ? under : offers);
  }
  return cheapest(offers);
}

export function codAllows(offer: QuoteOffer, paymentMethod: string): boolean {
  if (paymentMethod !== "cash") return true;
  return offer.codOk;
}

export function needsFallback(input: {
  estado: DeliveryEstado;
  dispatchedAt: number | null;
  now: number;
  fallbackMin: number;
}): boolean {
  if (input.estado !== "a_procurar_estafeta" && input.estado !== "pendente") return false;
  if (input.dispatchedAt == null) return false;
  return input.now - input.dispatchedAt >= input.fallbackMin * 60_000;
}

export function assertDispatchSlot(
  rows: { orderId: string; attempt: number; estado: DeliveryEstado }[],
  orderId: string,
  attempt: number,
): "ok" | "duplicate" | "active" {
  if (rows.some((row) => row.orderId === orderId && row.attempt === attempt)) return "duplicate";
  if (rows.some((row) => row.orderId === orderId && !TERMINAL_STATES.includes(row.estado) && row.attempt > 0)) {
    return "active";
  }
  return "ok";
}

export function simulatedStatus(input: {
  kind: ProviderKind;
  dispatchedAt: number;
  now: number;
  assignAfterMs: number;
  cancelled: boolean;
  manualEstado: DeliveryEstado | null;
}): DeliveryEstado {
  if (input.cancelled) return "cancelado";
  if (input.kind === "manual") return input.manualEstado ?? "a_procurar_estafeta";
  let elapsed = input.now - input.dispatchedAt;
  if (input.kind === "yango") {
    if (elapsed < input.assignAfterMs) return "a_procurar_estafeta";
    elapsed -= input.assignAfterMs;
  }
  let estado: DeliveryEstado = "estafeta_atribuido";
  for (const [at, step] of INTERNAL_STEPS) {
    if (elapsed >= at) estado = step;
  }
  return estado;
}

export function courierSpot(
  estado: DeliveryEstado,
  destLat: number,
  destLng: number,
): { lat: number; lng: number } | null {
  const mix = (t: number) => ({
    lat: STORE_POINT.lat + (destLat - STORE_POINT.lat) * t,
    lng: STORE_POINT.lng + (destLng - STORE_POINT.lng) * t,
  });
  if (estado === "estafeta_atribuido") return { lat: STORE_POINT.lat + 0.01, lng: STORE_POINT.lng - 0.012 };
  if (estado === "a_caminho_da_loja") return { lat: STORE_POINT.lat + 0.004, lng: STORE_POINT.lng - 0.004 };
  if (estado === "recolhido") return { lat: STORE_POINT.lat, lng: STORE_POINT.lng };
  if (estado === "a_caminho_do_cliente") return mix(0.55);
  if (estado === "entregue") return { lat: destLat, lng: destLng };
  return null;
}

export function signBody(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export type WebhookDecision =
  | { ok: false; error: "unsigned" | "bad_signature" | "payload" }
  | {
      ok: true;
      duplicate: boolean;
      eventId: string;
      externalId?: string;
      estado?: DeliveryEstado;
      courierName?: string | null;
      courierPhone?: string | null;
      lat?: number | null;
      lng?: number | null;
    };

export function decideWebhook(input: {
  rawBody: string;
  signature: string | undefined;
  secret: string;
  seen: ReadonlySet<string>;
}): WebhookDecision {
  if (!input.signature || !input.secret) return { ok: false, error: "unsigned" };
  const expected = signBody(input.secret, input.rawBody);
  if (!safeEqualHex(expected, input.signature.trim())) return { ok: false, error: "bad_signature" };
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, error: "payload" };
  }
  if (!payload || typeof payload !== "object") return { ok: false, error: "payload" };
  const body = payload as Record<string, unknown>;
  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const externalId = typeof body.claim_id === "string" ? body.claim_id : "";
  const rawStatus = typeof body.status === "string" ? body.status : "";
  if (!eventId || !externalId) return { ok: false, error: "payload" };
  if (input.seen.has(eventId)) return { ok: true, duplicate: true, eventId };
  const estado = mapExternalStatus("yango", rawStatus);
  if (!estado) return { ok: false, error: "payload" };
  const courier = body.courier && typeof body.courier === "object" ? (body.courier as Record<string, unknown>) : null;
  return {
    ok: true,
    duplicate: false,
    eventId,
    externalId,
    estado,
    courierName: courier && typeof courier.name === "string" ? courier.name : null,
    courierPhone: courier && typeof courier.phone === "string" ? courier.phone : null,
    lat: typeof body.lat === "number" ? body.lat : null,
    lng: typeof body.lng === "number" ? body.lng : null,
  };
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: {
    attempts?: number;
    timeoutMs?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const timeoutMs = opts?.timeoutMs ?? 4000;
  const base = opts?.baseDelayMs ?? 80;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTimeout(fn(attempt), timeoutMs);
    } catch (err) {
      last = err;
      if (attempt < attempts) await sleep(base * 2 ** (attempt - 1));
    }
  }
  throw last instanceof Error ? last : new Error("falhou");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error("falhou"));
      },
    );
  });
}

export type ProviderContext = {
  now: () => number;
  yangoEnabled: boolean;
  sandbox: boolean;
  apiKey?: string;
  webhookSecret?: string;
  assignAfterMs?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type DeliveryProvider = {
  id: string;
  kind: ProviderKind;
  supportsCod: boolean;
  supportsWebhook: boolean;
  getQuote: (order: DeliveryOrder) => Promise<QuoteOffer>;
  createDelivery: (order: DeliveryOrder, quoteId: string) => Promise<{ externalId: string; estado: DeliveryEstado }>;
  getStatus: (externalId: string, ctx: { dispatchedAt: number; manualEstado: DeliveryEstado | null; cancelled: boolean; destLat: number; destLng: number }) => Promise<CarrierStatus>;
  cancelDelivery: (externalId: string, motivo: string) => Promise<{ ok: true; feeKz: number }>;
  handleWebhook: (payload: string, headers: Record<string, string>, seen: ReadonlySet<string>) => WebhookDecision;
};

async function yangoRemoteQuote(ctx: ProviderContext, order: DeliveryOrder): Promise<QuoteOffer> {
  const key = ctx.apiKey ?? "";
  const base = ctx.baseUrl ?? "https://b2b.taxi.yandex.net";
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const data = await withRetry(
    async () => {
      const res = await fetchImpl(`${base}/b2b/cargo/integration/v2/offers/calculate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          route_points: [
            { coordinates: [STORE_POINT.lng, STORE_POINT.lat] },
            { coordinates: [order.lng, order.lat] },
          ],
        }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      return (await res.json()) as { price?: number; eta?: number; id?: string };
    },
    { attempts: 3, timeoutMs: 2500, baseDelayMs: 20, sleep: async () => undefined },
  );
  return {
    providerId: "yango",
    quoteId: data.id ?? `yg-live-${order.orderId}`,
    priceKz: Math.round(Number(data.price) || 0),
    etaMin: Math.round(Number(data.eta) || 30),
    expiresAt: ctx.now() + 10 * 60_000,
    codOk: false,
  };
}

export function createProviders(ctx: ProviderContext): Record<ProviderKind, DeliveryProvider> {
  const internal: DeliveryProvider = {
    id: "internal",
    kind: "internal",
    supportsCod: true,
    supportsWebhook: false,
    async getQuote(order) {
      return localQuote("internal", order, ctx.now());
    },
    async createDelivery(order) {
      return { externalId: `FL-${order.number}-${order.attempt}`, estado: "estafeta_atribuido" };
    },
    async getStatus(_externalId, snap) {
      const estado = simulatedStatus({
        kind: "internal",
        dispatchedAt: snap.dispatchedAt,
        now: ctx.now(),
        assignAfterMs: 0,
        cancelled: snap.cancelled,
        manualEstado: snap.manualEstado,
      });
      const spot = courierSpot(estado, snap.destLat, snap.destLng);
      return {
        estado,
        courierName: "Sara Mendes",
        courierPhone: "+244923100001",
        lat: spot?.lat ?? null,
        lng: spot?.lng ?? null,
      };
    },
    async cancelDelivery() {
      return { ok: true, feeKz: 0 };
    },
    handleWebhook() {
      return { ok: false, error: "unsigned" };
    },
  };

  const yango: DeliveryProvider = {
    id: "yango",
    kind: "yango",
    supportsCod: false,
    supportsWebhook: true,
    async getQuote(order) {
      if (!ctx.yangoEnabled) throw new Error("disabled");
      if (!ctx.apiKey) {
        if (!ctx.sandbox) throw new Error("sem chave");
        return localQuote("yango", order, ctx.now());
      }
      try {
        return await yangoRemoteQuote(ctx, order);
      } catch (err) {
        const message = err instanceof Error ? err.message : "falhou";
        throw new Error(sanitizeError(message, [ctx.apiKey ?? ""]));
      }
    },
    async createDelivery(order) {
      if (!ctx.yangoEnabled) throw new Error("disabled");
      return { externalId: `YG-${order.number}-${order.attempt}`, estado: "a_procurar_estafeta" };
    },
    async getStatus(_externalId, snap) {
      const estado = simulatedStatus({
        kind: "yango",
        dispatchedAt: snap.dispatchedAt,
        now: ctx.now(),
        assignAfterMs: ctx.assignAfterMs ?? 180_000,
        cancelled: snap.cancelled,
        manualEstado: snap.manualEstado,
      });
      const spot = courierSpot(estado, snap.destLat, snap.destLng);
      const assigned = estado !== "a_procurar_estafeta" && estado !== "pendente" && estado !== "cancelado";
      return {
        estado,
        courierName: assigned ? "Estafeta Yango" : null,
        courierPhone: assigned ? "+244923100002" : null,
        lat: spot?.lat ?? null,
        lng: spot?.lng ?? null,
      };
    },
    async cancelDelivery() {
      return { ok: true, feeKz: 0 };
    },
    handleWebhook(payload, headers, seen) {
      const signature = headers["x-delivery-signature"] ?? headers["X-Delivery-Signature"];
      return decideWebhook({
        rawBody: payload,
        signature,
        secret: ctx.webhookSecret ?? "",
        seen,
      });
    },
  };

  const manual: DeliveryProvider = {
    id: "manual",
    kind: "manual",
    supportsCod: true,
    supportsWebhook: false,
    async getQuote(order) {
      return localQuote("manual", order, ctx.now());
    },
    async createDelivery(order) {
      return { externalId: `MAN-${order.number}-${order.attempt}`, estado: "a_procurar_estafeta" };
    },
    async getStatus(_externalId, snap) {
      const estado = simulatedStatus({
        kind: "manual",
        dispatchedAt: snap.dispatchedAt,
        now: ctx.now(),
        assignAfterMs: 0,
        cancelled: snap.cancelled,
        manualEstado: snap.manualEstado,
      });
      return { estado, courierName: null, courierPhone: null, lat: null, lng: null };
    },
    async cancelDelivery() {
      return { ok: true, feeKz: 0 };
    },
    handleWebhook() {
      return { ok: false, error: "unsigned" };
    },
  };

  return { internal, yango, manual };
}

export function waText(kind: "atribuido" | "a_caminho" | "entregue", number: number, pin: string, courier: string | null): string {
  if (kind === "atribuido") {
    const who = courier ? ` O estafeta é ${courier}.` : "";
    return `COMPRA TUDO: a encomenda CT-${number} já tem estafeta.${who} Código de entrega: ${pin}.`;
  }
  if (kind === "a_caminho") {
    return `COMPRA TUDO: a encomenda CT-${number} está a caminho. Código de entrega: ${pin}.`;
  }
  return `COMPRA TUDO: a encomenda CT-${number} foi entregue. Obrigado. Apoio no WhatsApp +244 945 407 841.`;
}

export function milestoneFor(estado: DeliveryEstado): "atribuido" | "a_caminho" | "entregue" | null {
  if (estado === "estafeta_atribuido") return "atribuido";
  if (estado === "a_caminho_do_cliente") return "a_caminho";
  if (estado === "entregue") return "entregue";
  return null;
}
