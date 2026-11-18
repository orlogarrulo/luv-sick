import type { DeliveryEstado } from "@/lib/delivery/types";

export type TrackingApiId = "yango" | "fleet" | "entrega";

export type TrackingCard = {
  id: TrackingApiId;
  nome: string;
  base: string;
  docs: string;
  tracks: string;
  money: string;
  auth: string;
};

export const TRACKING_APIS: TrackingCard[] = [
  {
    id: "yango",
    nome: "Yango Delivery",
    base: "https://b2b.taxi.yandex.net",
    docs: "https://github.com/A1-x-Tech/mcp-yango-delivery",
    tracks: "Posição do estafeta, ligação pública de seguimento, ETA por ponto e telefone temporário.",
    money: "A cotação da Yango vem em moeda ISO, não em kwanzas fixos.",
    auth: "Authorization: Bearer com YANGO_API_KEY.",
  },
  {
    id: "fleet",
    nome: "Fleet.ao",
    base: "https://api.fleet.ao",
    docs: "https://developer.fleet.ao/openapi.json",
    tracks: "Estado da encomenda, código e página de seguimento, e posição do condutor no webhook.",
    money: "fee_aoa é um inteiro em kwanzas, sem cêntimos.",
    auth: "Authorization: Bearer com FLEET_API_KEY. Sandbox em sandbox-api.fleet.ao.",
  },
  {
    id: "entrega",
    nome: "Entrega.ao",
    base: "https://api.entrega.ao",
    docs: "https://developer.entrega.ao/pt",
    tracks: "Estado, eventos e página pública GET /v1/deliveries/{token}/tracking.",
    money: "price_aoa vem em cêntimos: 450000 são 4.500 Kz.",
    auth: "Authorization: Bearer com ENTREGA_SECRET_KEY. O seguimento público não leva chave.",
  },
];

const FLEET_STATUS: Record<string, DeliveryEstado> = {
  pending: "pendente",
  assigned: "estafeta_atribuido",
  accepted: "a_caminho_da_loja",
  picked_up: "recolhido",
  in_transit: "a_caminho_do_cliente",
  delivered: "entregue",
  cancelled: "cancelado",
  failed: "falhou",
};

const ENTREGA_STATUS: Record<string, DeliveryEstado> = {
  pending: "pendente",
  assigned: "estafeta_atribuido",
  pickup_ready: "a_caminho_da_loja",
  in_transit: "recolhido",
  out_for_delivery: "a_caminho_do_cliente",
  delivered: "entregue",
  cancelled: "cancelado",
  failed: "falhou",
  stalled: "a_procurar_estafeta",
};

export function mapFleetStatus(raw: string): DeliveryEstado | null {
  return FLEET_STATUS[raw] ?? null;
}

export function mapEntregaStatus(raw: string): DeliveryEstado | null {
  return ENTREGA_STATUS[raw] ?? null;
}

export function entregaCentavosToKz(centavos: number): number {
  return Math.round(centavos / 100);
}

export type TrackSummary = {
  status: string | null;
  mapped: DeliveryEstado | null;
  trackingUrl: string | null;
  lat: number | null;
  lng: number | null;
  note: string;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function summarizeTrackPayload(id: TrackingApiId, body: unknown): TrackSummary {
  const root = asRecord(body);
  const data = asRecord(root?.data) ?? root;
  const empty: TrackSummary = { status: null, mapped: null, trackingUrl: null, lat: null, lng: null, note: "" };
  if (!data && !Array.isArray(body)) return { ...empty, note: "A resposta não traz um objecto de seguimento." };

  if (id === "yango") {
    const position = asRecord(data?.position);
    const points = Array.isArray(data?.route_points) ? data.route_points : [];
    const link = points.map(asRecord).map((point) => str(point?.sharing_link)).find(Boolean) ?? null;
    return {
      status: str(data?.status),
      mapped: null,
      trackingUrl: link,
      lat: num(position?.lat),
      lng: num(position?.lon),
      note: position ? "Posição lida em claims/performer-position." : link ? "Ligação de seguimento para o destinatário." : "Sem posição nem ligação neste corpo.",
    };
  }

  if (id === "fleet") {
    const list = Array.isArray(root?.data) ? root.data : null;
    if (list) return { ...empty, note: `${list.length} encomenda(s) na lista. Indique um id para ler o seguimento.` };
    const driver = asRecord(data?.driver);
    const location = asRecord(driver?.location);
    const status = str(data?.status);
    return {
      status,
      mapped: status ? mapFleetStatus(status) : null,
      trackingUrl: str(data?.tracking_url),
      lat: num(location?.lat),
      lng: num(location?.lng),
      note: status ? `Estado Fleet ${status}.` : "Sem estado nesta resposta.",
    };
  }

  const list = Array.isArray(root?.data) ? root.data : null;
  if (list && !str(data?.status)) return { ...empty, note: `${list.length} transportadora(s) na rede Entrega.` };
  const status = str(data?.status);
  const events = Array.isArray(data?.events) ? data.events.length : 0;
  return {
    status,
    mapped: status ? mapEntregaStatus(status) : null,
    trackingUrl: str(data?.tracking_url),
    lat: null,
    lng: null,
    note: status ? `Estado Entrega ${status}${events ? `, ${events} eventos` : ""}.` : "Sem estado nesta resposta.",
  };
}
