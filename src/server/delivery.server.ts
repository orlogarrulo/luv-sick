import { createHash, randomBytes, randomInt } from "node:crypto";
import { dbSource, getPglite, getSql } from "@/lib/db";
import {
  assertDispatchSlot,
  courierSpot,
  createProviders,
  decideWebhook,
  localQuote,
  maskPhone,
  milestoneFor,
  needsFallback,
  pickQuote,
  priceZone,
  sanitizeError,
  signBody,
  simulatedStatus,
  waText,
  DEFAULT_ZONES,
} from "@/lib/delivery/core";
import type {
  AnyQuote,
  DeliveryEstado,
  DeliveryOrder,
  DeskData,
  DetailData,
  DispatchRule,
  ProviderKind,
  ProviderView,
  QuoteOffer,
  ReconcileRow,
  ReportData,
  SettingsView,
  TrackView,
  ZoneDef,
  ZoneView,
} from "@/lib/delivery/types";
import { TERMINAL_STATES } from "@/lib/delivery/types";

type Row = Record<string, unknown>;
type Runner = (text: string, params?: unknown[]) => Promise<Row[]>;

const SANDBOX_WEBHOOK_SECRET = "sandbox-yango-nao-usar-em-producao";
const SECRETS = () => [process.env.YANGO_API_KEY ?? "", process.env.YANGO_WEBHOOK_SECRET ?? "", SANDBOX_WEBHOOK_SECRET];

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function str(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function flag(v: unknown): boolean {
  return v === true || v === "true" || v === "t" || v === 1;
}
function time(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = new Date(str(v)).getTime();
  return Number.isFinite(t) ? t : null;
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function newId(): string {
  return randomBytes(16).toString("hex");
}

async function db(): Promise<Runner> {
  const sql = await getSql();
  return (text, params = []) => sql.query<Row>(text, params);
}

async function withTx<T>(fn: (q: Runner) => Promise<T>): Promise<T> {
  if (dbSource === "pglite") {
    const pg = await getPglite();
    return pg.transaction(async (tx) => {
      const q: Runner = async (text, params = []) => {
        const res = await tx.query<Row>(text, params);
        return res.rows;
      };
      return fn(q);
    });
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    const q: Runner = async (text, params = []) => {
      const res = await client.query(text, params);
      return res.rows as Row[];
    };
    const result = await fn(q);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* already aborted */
    }
    throw err;
  } finally {
    await client.end();
  }
}

type Staff = { id: string; email: string; name: string; role: string };

async function staffFromToken(token: string): Promise<Staff | null> {
  if (!token) return null;
  const q = await db();
  const rows = await q(
    `select u.id, u.email, u.name, u.role
     from staff_sessions s join staff_users u on u.id = s.staff_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: str(row.id), email: str(row.email), name: str(row.name), role: str(row.role) };
}

function allow(staff: Staff | null, roles: string[]): staff is Staff {
  return !!staff && roles.includes(staff.role);
}

async function audit(q: Runner, actor: string, action: string, entityId: string, after: unknown): Promise<void> {
  await q(
    `insert into audit_logs (id, actor, action, entity, entity_id, before_json, after_json)
     values ($1,$2,$3,'deliveries',$4,null,$5)`,
    [newId(), actor, action, entityId, JSON.stringify(after)],
  );
}

let seedPromise: Promise<void> | null = null;

export function ensureDeliverySeed(): Promise<void> {
  seedPromise ??= seedDelivery().catch((err) => {
    seedPromise = null;
    throw err;
  });
  return seedPromise;
}

async function seedDelivery(): Promise<void> {
  const q = await db();
  const providers = [
    ["internal", "Frota própria", "internal", true, 1, JSON.stringify({ supportsCod: true, supportsWebhook: false, sandbox: false })],
    ["yango", "Yango Delivery", "yango", false, 2, JSON.stringify({ sandbox: true, supportsCod: false, supportsWebhook: true, assignAfterSec: 180, note: "Confirmar a API com a Yango Angola antes de produção. Sandbox, desligada por defeito." })],
    ["manual", "Manual", "manual", true, 3, JSON.stringify({ supportsCod: true, supportsWebhook: false, sandbox: false, note: "O operador pede pela app da plataforma e marca os estados aqui." })],
  ] as const;
  for (const row of providers) {
    await q(
      `insert into delivery_providers (id, nome, tipo, ativo, prioridade, config_json)
       values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
      [...row],
    );
  }
  for (const zone of DEFAULT_ZONES) {
    await q(
      `insert into delivery_zones (id, nome, polygon_json, taxa_cliente_kz, free_above_kz, providers_json)
       values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
      [zone.id, zone.nome, JSON.stringify(zone.polygon), zone.feeKz, zone.freeAboveKz, JSON.stringify(zone.providers)],
    );
  }
  await q(
    `insert into delivery_settings (id, mode, rule, preferred_provider, price_cap_kz, fallback_min, show_carrier)
     values ('default','manual','cheapest','internal',null,1,false)
     on conflict (id) do nothing`,
  );
  const couriers = [
    ["Sara Mendes", "+244923100001", -8.91, 13.18],
    ["Joel Kapapelo", "+244923100003", -8.93, 13.2],
    ["Nádia Costa", "+244923100004", -8.9, 13.17],
  ] as const;
  for (const courier of couriers) {
    const found = await q(`select id from couriers where telefone = $1`, [courier[1]]);
    if (found.length) continue;
    await q(
      `insert into couriers (id, nome, telefone, ativo, lat, lng) values ($1,$2,$3,true,$4,$5)`,
      [newId(), courier[0], courier[1], courier[2], courier[3]],
    );
  }
}

function parseZone(row: Row): ZoneDef {
  let polygon: [number, number][] = [];
  let providers: string[] = [];
  try {
    polygon = JSON.parse(str(row.polygon_json)) as [number, number][];
  } catch {
    polygon = [];
  }
  try {
    providers = JSON.parse(str(row.providers_json)) as string[];
  } catch {
    providers = [];
  }
  return {
    id: str(row.id),
    nome: str(row.nome),
    feeKz: num(row.taxa_cliente_kz),
    freeAboveKz: row.free_above_kz == null ? null : num(row.free_above_kz),
    providers,
    polygon,
  };
}

export async function loadZones(): Promise<ZoneDef[]> {
  await ensureDeliverySeed();
  const q = await db();
  const rows = await q(`select * from delivery_zones order by nome`);
  return rows.map(parseZone);
}

async function loadSettings(q: Runner): Promise<SettingsView> {
  const rows = await q(`select * from delivery_settings where id = 'default'`);
  const row = rows[0];
  const rule = str(row?.rule);
  const mode = str(row?.mode);
  return {
    mode: mode === "auto" ? "auto" : "manual",
    rule: rule === "fastest" || rule === "preferred" ? rule : "cheapest",
    preferredProvider: row?.preferred_provider == null ? null : str(row.preferred_provider),
    priceCapKz: row?.price_cap_kz == null ? null : num(row.price_cap_kz),
    fallbackMin: Math.max(1, num(row?.fallback_min) || 1),
    showCarrier: flag(row?.show_carrier),
  };
}

function providerView(row: Row): ProviderView {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(str(row.config_json)) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const tipo = str(row.tipo);
  return {
    id: str(row.id),
    nome: str(row.nome),
    tipo,
    ativo: flag(row.ativo),
    prioridade: num(row.prioridade),
    sandbox: tipo === "yango" ? config.sandbox !== false : false,
    supportsCod: config.supportsCod !== false && tipo !== "yango",
    supportsWebhook: config.supportsWebhook === true || tipo === "yango",
    apiConfigured: tipo === "yango" ? Boolean(process.env.YANGO_API_KEY) : false,
    lastOkAt: row.last_ok_at == null ? null : str(row.last_ok_at),
    lastError: row.last_error == null ? null : str(row.last_error),
    note: typeof config.note === "string" ? config.note : "",
  };
}

function ctxFrom(row: ProviderView, assignAfterSec = 180) {
  return createProviders({
    now: () => Date.now(),
    yangoEnabled: row.ativo,
    sandbox: row.sandbox,
    apiKey: process.env.YANGO_API_KEY || undefined,
    webhookSecret: process.env.YANGO_WEBHOOK_SECRET || (row.sandbox ? SANDBOX_WEBHOOK_SECRET : ""),
    assignAfterMs: assignAfterSec * 1000,
  });
}

async function orderSnapshot(q: Runner, orderId: string, attempt: number): Promise<DeliveryOrder | null> {
  const rows = await q(
    `select o.*, c.name as customer_name, c.phone,
            (select coalesce(sum(oi.qty), 1)::int from order_items oi where oi.order_id = o.id) as qty
     from orders o
     join customers c on c.id = o.customer_id
     where o.id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) return null;
  const qty = Math.max(1, num(row.qty));
  const cash = str(row.payment_method) === "cash";
  return {
    orderId,
    number: num(row.number),
    attempt,
    customerName: str(row.customer_name),
    phone: str(row.phone),
    lat: num(row.lat),
    lng: num(row.lng),
    addressLabel: str(row.address_label),
    complement: str(row.complement),
    paymentMethod: str(row.payment_method),
    codKz: cash ? num(row.total_aoa) : null,
    subtotalKz: num(row.subtotal_aoa),
    volumes: Math.max(1, Math.ceil(qty / 4)),
    weightKg: Math.round(qty * 0.4 * 10) / 10,
    declaredKz: num(row.subtotal_aoa),
  };
}

async function rememberProvider(q: Runner, id: string, ok: boolean, error?: string): Promise<void> {
  if (ok) {
    await q(`update delivery_providers set last_ok_at = now(), last_error = null, updated_at = now() where id = $1`, [id]);
  } else {
    await q(
      `update delivery_providers set last_error = $2, updated_at = now() where id = $1`,
      [id, sanitizeError(error ?? "falhou", SECRETS())],
    );
  }
}

async function collectQuotes(q: Runner, order: DeliveryOrder, zone: ZoneDef | null, includeInactiveManual = false): Promise<AnyQuote[]> {
  const rows = await q(`select * from delivery_providers order by prioridade`);
  const views = rows.map(providerView);
  const allowed = new Set(zone ? zone.providers : views.map((v) => v.id));
  const offers: AnyQuote[] = [];
  const bundle = ctxFrom(views.find((v) => v.id === "yango") ?? views[0]);
  for (const view of views) {
    if (!allowed.has(view.id) && !(includeInactiveManual && view.id === "manual")) continue;
    if (!view.ativo && !(includeInactiveManual && view.id === "manual")) continue;
    const kind = view.tipo as ProviderKind;
    const provider = bundle[kind];
    if (!provider) continue;
    if (order.paymentMethod === "cash" && !view.supportsCod) {
      offers.push({ providerId: view.id, error: "cod" });
      continue;
    }
    try {
      const quote = view.tipo === "yango" && !view.ativo ? null : await provider.getQuote(order);
      if (!quote) continue;
      offers.push(quote);
      await q(
        `insert into delivery_quotes (id, order_id, provider_id, preco_kz, eta_min, expira_em)
         values ($1,$2,$3,$4,$5, to_timestamp($6 / 1000.0))`,
        [newId(), order.orderId, view.id, quote.priceKz, quote.etaMin, quote.expiresAt],
      );
      await rememberProvider(q, view.id, true);
    } catch (err) {
      const message = sanitizeError(err instanceof Error ? err.message : "falhou", SECRETS());
      offers.push({ providerId: view.id, error: message });
      await q(
        `insert into delivery_quotes (id, order_id, provider_id, preco_kz, eta_min, expira_em, erro)
         values ($1,$2,$3,null,null, now() + interval '10 minutes', $4)`,
        [newId(), order.orderId, view.id, message],
      );
      await rememberProvider(q, view.id, false, message);
    }
  }
  return offers;
}

async function addEvent(q: Runner, orderId: string, estado: string, origem: string, note: string | null, dedupe: string): Promise<void> {
  await q(
    `insert into delivery_events (id, delivery_order_id, estado, origem, payload, dedupe_key)
     select $1,$2,$3,$4,$5,$6
     where not exists (select 1 from delivery_events where dedupe_key = $6)`,
    [newId(), orderId, estado, origem, note, dedupe],
  );
}

async function queueWhatsapp(q: Runner, order: DeliveryOrder, estado: DeliveryEstado, pin: string, courier: string | null): Promise<void> {
  const kind = milestoneFor(estado);
  if (!kind || !pin) return;
  const body = waText(kind, order.number, pin, courier);
  await q(
    `insert into whatsapp_outbox (id, order_id, kind, to_masked, body)
     values ($1,$2,$3,$4,$5)
     on conflict (order_id, kind) do nothing`,
    [newId(), order.orderId, kind, maskPhone(order.phone), body],
  );
  await q(
    `insert into notifications (id, customer_id, title, body)
     select $1, customer_id, $2, $3 from orders where id = $4`,
    [newId(), kind, body, order.orderId],
  );
}

async function mirrorOrder(q: Runner, orderId: string, estado: DeliveryEstado): Promise<void> {
  let next: string | null = null;
  if (estado === "a_caminho_do_cliente") next = "on_the_way";
  else if (estado === "entregue") next = "delivered";
  else if (estado === "estafeta_atribuido" || estado === "a_caminho_da_loja" || estado === "recolhido") next = "preparing";
  if (!next) return;
  const rows = await q(`select status, customer_id, number, eta_label from orders where id = $1`, [orderId]);
  const row = rows[0];
  if (!row) return;
  const current = str(row.status);
  if (current === next || current === "delivered" || current === "cancelled") return;
  if (current === "on_the_way" && next === "preparing") return;
  await q(`update orders set status = $2, updated_at = now() where id = $1`, [orderId, next]);
  await q(
    `insert into order_events (id, order_id, status, note, actor) values ($1,$2,$3,$4,'entrega')`,
    [newId(), orderId, next, null],
  );
  if (next === "delivered") {
    await q(`update deliveries set entregue_em = coalesce(entregue_em, now()), confirmed_at = coalesce(confirmed_at, now()) where order_id = $1`, [orderId]);
  }
}

async function applyEstado(
  q: Runner,
  order: DeliveryOrder,
  estado: DeliveryEstado,
  origem: string,
  patch: { courierName?: string | null; courierPhone?: string | null; lat?: number | null; lng?: number | null; lock?: boolean },
): Promise<void> {
  const current = await q(`select estado, pin_entrega, estafeta_nome from deliveries where order_id = $1`, [order.orderId]);
  const prev = str(current[0]?.estado || "pendente");
  const pin = str(current[0]?.pin_entrega);
  const name = patch.courierName ?? (current[0]?.estafeta_nome == null ? null : str(current[0]?.estafeta_nome));
  await q(
    `update deliveries set estado = $2,
       estafeta_nome = coalesce($3, estafeta_nome),
       estafeta_telefone = coalesce($4, estafeta_telefone),
       courier_name = coalesce($3, courier_name),
       courier_lat = coalesce($5, courier_lat),
       courier_lng = coalesce($6, courier_lng),
       status_lock = case when $7 then true else status_lock end,
       entregue_em = case when $2 = 'entregue' then coalesce(entregue_em, now()) else entregue_em end,
       fallback_alert = case when $2 = 'a_procurar_estafeta' then fallback_alert else false end
     where order_id = $1`,
    [order.orderId, estado, name, patch.courierPhone ?? null, patch.lat ?? null, patch.lng ?? null, patch.lock === true],
  );
  if (prev !== estado) {
    await addEvent(q, order.orderId, estado, origem, null, `${order.orderId}:${estado}`);
    await queueWhatsapp(q, order, estado, pin, name);
    await mirrorOrder(q, order.orderId, estado);
  }
}

export async function onOrderPlaced(orderId: string): Promise<void> {
  await ensureDeliverySeed();
  const q = await db();
  const zones = (await q(`select * from delivery_zones`)).map(parseZone);
  const snap = await orderSnapshot(q, orderId, 1);
  if (!snap) return;
  const priced = priceZone(zones, snap.lat, snap.lng, snap.subtotalKz);
  await q(
    `update deliveries set zone_id = $2, taxa_cliente_kz = $3, cod_kz = $4, volumes = $5, estado = coalesce(estado, 'pendente')
     where order_id = $1`,
    [orderId, priced.zone?.id ?? null, priced.fee, snap.codKz, snap.volumes],
  );
  const settings = await loadSettings(q);
  if (settings.mode === "auto") {
    await dispatchDelivery({ token: "", orderId, providerId: "auto", actor: "sistema" });
  }
}

export async function tickOrder(orderId: string): Promise<void> {
  await ensureDeliverySeed();
  const q = await db();
  await tickRows(q, await q(`select * from deliveries where order_id = $1`, [orderId]));
}

export async function tickCustomer(customerId: string): Promise<void> {
  await ensureDeliverySeed();
  const q = await db();
  const rows = await q(
    `select d.* from deliveries d join orders o on o.id = d.order_id
     where o.customer_id = $1 and d.estado not in ('entregue','cancelado','falhou','devolvido_a_loja')`,
    [customerId],
  );
  await tickRows(q, rows);
}

async function tickRows(q: Runner, rows: Row[]): Promise<void> {
  const settings = await loadSettings(q);
  const providers = (await q(`select * from delivery_providers`)).map(providerView);
  const yango = providers.find((p) => p.id === "yango");
  let assignAfter = 180;
  if (yango) {
    const raw = await q(`select config_json from delivery_providers where id = 'yango'`);
    try {
      const cfg = JSON.parse(str(raw[0]?.config_json)) as { assignAfterSec?: number };
      if (cfg.assignAfterSec) assignAfter = cfg.assignAfterSec;
    } catch {
      /* keep default */
    }
  }
  const now = Date.now();
  for (const row of rows) {
    const estado = str(row.estado) as DeliveryEstado;
    if (TERMINAL_STATES.includes(estado) && estado !== "cancelado") continue;
    if (TERMINAL_STATES.includes(estado)) continue;
    const order = await orderSnapshot(q, str(row.order_id), num(row.attempt) || 1);
    if (!order) continue;
    const dispatchedAt = time(row.dispatched_at);
    const kind = (str(row.provider_id) || "manual") as ProviderKind;
    if (num(row.attempt) > 0 && dispatchedAt && needsFallback({ estado, dispatchedAt, now, fallbackMin: settings.fallbackMin })) {
      await q(`update deliveries set fallback_alert = true where order_id = $1 and estado in ('pendente','a_procurar_estafeta')`, [order.orderId]);
    }
    if (flag(row.status_lock) || num(row.attempt) === 0) continue;
    const next = simulatedStatus({
      kind: kind === "yango" || kind === "internal" || kind === "manual" ? kind : "manual",
      dispatchedAt: dispatchedAt ?? now,
      now,
      assignAfterMs: assignAfter * 1000,
      cancelled: false,
      manualEstado: kind === "manual" ? estado : null,
    });
    const spot = courierSpot(next, order.lat, order.lng);
    let courierName: string | null = null;
    let courierPhone: string | null = null;
    if (kind === "yango" && next !== "a_procurar_estafeta" && next !== "pendente") {
      courierName = "Estafeta Yango";
      courierPhone = "+244923100002";
    }
    await applyEstado(q, order, next, "polling", {
      courierName,
      courierPhone,
      lat: spot?.lat ?? null,
      lng: spot?.lng ?? null,
    });
  }
}

export async function publicTrack(orderId: string): Promise<TrackView | null> {
  await ensureDeliverySeed();
  const q = await db();
  const rows = await q(
    `select d.*, z.nome as zone_nome, p.nome as provider_nome,
            (select count(*) from whatsapp_outbox w where w.order_id = d.order_id) as wa_count
     from deliveries d
     left join delivery_zones z on z.id = d.zone_id
     left join delivery_providers p on p.id = d.provider_id
     where d.order_id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) return null;
  const settings = await loadSettings(q);
  const fee = row.taxa_cliente_kz == null ? 0 : num(row.taxa_cliente_kz);
  return {
    estado: str(row.estado || "pendente"),
    pin: row.pin_entrega == null ? null : str(row.pin_entrega),
    courierName: row.estafeta_nome == null ? null : str(row.estafeta_nome),
    courierPhone: row.estafeta_telefone == null ? null : str(row.estafeta_telefone),
    courierLat: row.courier_lat == null ? null : num(row.courier_lat),
    courierLng: row.courier_lng == null ? null : num(row.courier_lng),
    etaMin: row.eta_min == null ? null : num(row.eta_min),
    zoneName: row.zone_nome == null ? null : str(row.zone_nome),
    feeKz: fee,
    rating: row.rating == null ? null : num(row.rating),
    carrierName: settings.showCarrier && row.provider_nome ? str(row.provider_nome) : null,
    whatsappSent: num(row.wa_count) > 0,
    fallback: flag(row.fallback_alert),
  };
}

async function writeDispatch(
  q: Runner,
  order: DeliveryOrder,
  providerId: string,
  quote: QuoteOffer | null,
  estado: DeliveryEstado,
  externalId: string,
  actor: string,
  degraded: boolean,
): Promise<{ ok: true; attempt: number } | { ok: false; error: string }> {
  const prev = await q(`select attempt, estado from delivery_dispatches where order_id = $1`, [order.orderId]);
  const slot = assertDispatchSlot(
    prev.map((row) => ({ orderId: order.orderId, attempt: num(row.attempt), estado: str(row.estado) as DeliveryEstado })),
    order.orderId,
    order.attempt,
  );
  if (slot !== "ok") return { ok: false, error: slot };
  const couriers = await q(`select nome, telefone from couriers where ativo order by nome`);
  const courier = providerId === "internal" && couriers.length ? couriers[(order.attempt - 1) % couriers.length] : null;
  const pin = randomInt(0, 10000).toString().padStart(4, "0");
  const spot = courierSpot(estado, order.lat, order.lng);
  try {
    await q(
      `insert into delivery_dispatches (id, order_id, attempt, provider_id, external_id, estado, custo_kz, quote_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [newId(), order.orderId, order.attempt, providerId, externalId, estado, quote?.priceKz ?? null, quote?.quoteId ?? null],
    );
  } catch {
    return { ok: false, error: "duplicate" };
  }
  await q(
    `update deliveries set provider_id = $2, external_id = $3, estado = $4, custo_kz = $5, pin_entrega = $6,
       estafeta_nome = $7, estafeta_telefone = $8, courier_name = $7, attempt = $9, eta_min = $10,
       dispatched_at = now(), fallback_alert = false, degraded = $11, status_lock = $12,
       courier_lat = $13, courier_lng = $14
     where order_id = $1`,
    [
      order.orderId,
      providerId,
      externalId,
      estado,
      quote?.priceKz ?? null,
      pin,
      courier ? str(courier.nome) : null,
      courier ? str(courier.telefone) : null,
      order.attempt,
      quote?.etaMin ?? null,
      degraded,
      providerId === "manual",
      spot?.lat ?? null,
      spot?.lng ?? null,
    ],
  );
  await addEvent(
    q,
    order.orderId,
    estado,
    actor === "sistema" ? "sistema" : "operador",
    JSON.stringify({ providerId, externalId, phone: maskPhone(order.phone), degraded }),
    `${order.orderId}:${order.attempt}:${estado}`,
  );
  await queueWhatsapp(q, order, estado, pin, courier ? str(courier.nome) : null);
  await mirrorOrder(q, order.orderId, estado);
  await audit(q, actor, "dispatch", order.orderId, { providerId, attempt: order.attempt, externalId, degraded });
  return { ok: true, attempt: order.attempt };
}

export async function dispatchDelivery(input: {
  token: string;
  orderId: string;
  providerId: string;
  actor?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  let actor = input.actor ?? "";
  if (!actor) {
    const staff = await staffFromToken(input.token);
    if (!allow(staff, ["admin", "operator"])) return { ok: false, error: "forbidden" };
    actor = staff.email;
  }
  const q = await db();
  const existing = await q(`select attempt, estado from deliveries where order_id = $1`, [input.orderId]);
  if (!existing[0]) return { ok: false, error: "missing" };
  const currentEstado = str(existing[0].estado || "pendente") as DeliveryEstado;
  if (num(existing[0].attempt) > 0 && !TERMINAL_STATES.includes(currentEstado)) return { ok: false, error: "active" };
  const maxRows = await q(`select coalesce(max(attempt), 0)::int as n from delivery_dispatches where order_id = $1`, [input.orderId]);
  const attempt = num(maxRows[0]?.n) + 1;
  const order = await orderSnapshot(q, input.orderId, attempt);
  if (!order) return { ok: false, error: "missing" };
  const zones = (await q(`select * from delivery_zones`)).map(parseZone);
  const zone = priceZone(zones, order.lat, order.lng, order.subtotalKz).zone;
  const quotes = await collectQuotes(q, order, zone, true);
  const settings = await loadSettings(q);
  const viable = quotes.filter((item): item is QuoteOffer => !("error" in item));
  let chosen: QuoteOffer | null = null;
  let degraded = false;
  if (input.providerId === "auto") {
    chosen = pickQuote(
      viable.filter((item) => codAllowsPayment(item, order.paymentMethod)),
      settings.rule,
      settings.preferredProvider,
      settings.priceCapKz,
    );
    if (!chosen) {
      chosen = localQuote("manual", order, Date.now());
      degraded = true;
    }
  } else {
    chosen = viable.find((item) => item.providerId === input.providerId) ?? null;
    if (!chosen && input.providerId === "manual") chosen = localQuote("manual", order, Date.now());
    if (!chosen) return { ok: false, error: quotes.some((item) => "error" in item && item.error === "cod") ? "cod" : "quote" };
    if (!codAllowsPayment(chosen, order.paymentMethod)) return { ok: false, error: "cod" };
  }
  const views = (await q(`select * from delivery_providers`)).map(providerView);
  const view = views.find((item) => item.id === chosen!.providerId) ?? views[0];
  const providers = ctxFrom(view);
  const kind = (chosen.providerId === "yango" || chosen.providerId === "manual" ? chosen.providerId : "internal") as ProviderKind;
  let created: { externalId: string; estado: DeliveryEstado };
  try {
    created = await providers[kind].createDelivery(order, chosen.quoteId);
    await rememberProvider(q, kind, true);
  } catch (err) {
    const message = sanitizeError(err instanceof Error ? err.message : "falhou", SECRETS());
    await rememberProvider(q, kind, false, message);
    if (kind !== "manual") {
      chosen = localQuote("manual", order, Date.now());
      created = await providers.manual.createDelivery(order, chosen.quoteId);
      degraded = true;
    } else {
      return { ok: false, error: message };
    }
  }
  const written = await writeDispatch(q, order, chosen.providerId, chosen, created.estado, created.externalId, actor, degraded);
  if (!written.ok) return written;
  if (degraded) await q(`update deliveries set fallback_alert = true where order_id = $1`, [order.orderId]);
  return { ok: true };
}

function codAllowsPayment(offer: QuoteOffer, payment: string): boolean {
  return payment !== "cash" || offer.codOk;
}

export async function requestQuotes(token: string, orderId: string): Promise<{ ok: true; quotes: QuoteOffer[] } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin", "operator", "finance"])) return { ok: false, error: "forbidden" };
  const q = await db();
  const order = await orderSnapshot(q, orderId, 1);
  if (!order) return { ok: false, error: "missing" };
  const zones = (await q(`select * from delivery_zones`)).map(parseZone);
  const zone = priceZone(zones, order.lat, order.lng, order.subtotalKz).zone;
  const quotes = await collectQuotes(q, order, zone, false);
  return { ok: true, quotes: quotes.filter((item): item is QuoteOffer => !("error" in item)) };
}

export async function cancelDelivery(token: string, orderId: string, motivo: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin", "operator"])) return { ok: false, error: "forbidden" };
  const reason = motivo.trim();
  if (reason.length < 3) return { ok: false, error: "reason" };
  const q = await db();
  const rows = await q(`select * from deliveries where order_id = $1`, [orderId]);
  const row = rows[0];
  if (!row || num(row.attempt) === 0) return { ok: false, error: "missing" };
  const estado = str(row.estado) as DeliveryEstado;
  if (TERMINAL_STATES.includes(estado)) return { ok: false, error: "status" };
  const order = await orderSnapshot(q, orderId, num(row.attempt));
  if (!order) return { ok: false, error: "missing" };
  await q(
    `update deliveries set estado = 'cancelado', status_lock = true, fallback_alert = false where order_id = $1`,
    [orderId],
  );
  await q(`update delivery_dispatches set estado = 'cancelado' where order_id = $1 and attempt = $2`, [orderId, num(row.attempt)]);
  await addEvent(q, orderId, "cancelado", "operador", reason, `${orderId}:cancelado:${num(row.attempt)}`);
  await audit(q, staff.email, "cancel_delivery", orderId, { motivo: reason });
  return { ok: true };
}

export async function setDeliveryStatus(input: {
  token: string;
  orderId: string;
  estado: string;
  pin?: string;
  courierName?: string;
  courierPhone?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(input.token);
  if (!allow(staff, ["admin", "operator"])) return { ok: false, error: "forbidden" };
  if (!isEstadoSafe(input.estado)) return { ok: false, error: "status" };
  const q = await db();
  const rows = await q(`select * from deliveries where order_id = $1`, [input.orderId]);
  const row = rows[0];
  if (!row || num(row.attempt) === 0) return { ok: false, error: "missing" };
  if (input.estado === "entregue") {
    const pin = (input.pin ?? "").replace(/\D/g, "");
    if (pin !== str(row.pin_entrega)) return { ok: false, error: "pin" };
  }
  const order = await orderSnapshot(q, input.orderId, num(row.attempt));
  if (!order) return { ok: false, error: "missing" };
  const name = input.courierName?.trim().slice(0, 80) || null;
  const phone = input.courierPhone?.trim().slice(0, 20) || null;
  await applyEstado(q, order, input.estado, "operador", { courierName: name, courierPhone: phone, lock: true });
  await q(`update delivery_dispatches set estado = $3 where order_id = $1 and attempt = $2`, [input.orderId, num(row.attempt), input.estado]);
  await audit(q, staff.email, "delivery_status", input.orderId, { estado: input.estado });
  return { ok: true };
}

function isEstadoSafe(value: string): value is DeliveryEstado {
  return (
    value === "pendente" ||
    value === "a_procurar_estafeta" ||
    value === "estafeta_atribuido" ||
    value === "a_caminho_da_loja" ||
    value === "recolhido" ||
    value === "a_caminho_do_cliente" ||
    value === "entregue" ||
    value === "falhou" ||
    value === "cancelado" ||
    value === "devolvido_a_loja"
  );
}

export async function syncOrderStatus(orderId: string, next: string, courierName?: string): Promise<void> {
  await ensureDeliverySeed();
  const q = await db();
  const rows = await q(`select * from deliveries where order_id = $1`, [orderId]);
  const row = rows[0];
  if (!row) return;
  if (next === "cancelled" && num(row.attempt) > 0 && !TERMINAL_STATES.includes(str(row.estado) as DeliveryEstado)) {
    await q(`update deliveries set estado = 'cancelado', status_lock = true where order_id = $1`, [orderId]);
    await addEvent(q, orderId, "cancelado", "operador", "Encomenda cancelada", `${orderId}:cancelado:order`);
  }
  if (next === "on_the_way" && num(row.attempt) === 0) {
    await dispatchDelivery({ token: "", orderId, providerId: "internal", actor: "sistema" });
    if (courierName?.trim()) {
      await q(
        `update deliveries set estafeta_nome = $2, courier_name = $2 where order_id = $1`,
        [orderId, courierName.trim().slice(0, 80)],
      );
    }
  }
  if (next === "delivered" && str(row.estado) !== "entregue") {
    const order = await orderSnapshot(q, orderId, Math.max(1, num(row.attempt)));
    if (!order) return;
    if (num(row.attempt) === 0) {
      await dispatchDelivery({ token: "", orderId, providerId: "internal", actor: "sistema" });
    }
    await q(
      `update deliveries set estado = 'entregue', status_lock = true, entregue_em = coalesce(entregue_em, now()), confirmed_at = coalesce(confirmed_at, now()) where order_id = $1`,
      [orderId],
    );
    await addEvent(q, orderId, "entregue", "operador", null, `${orderId}:entregue`);
    const pin = str((await q(`select pin_entrega from deliveries where order_id = $1`, [orderId]))[0]?.pin_entrega);
    const fresh = await orderSnapshot(q, orderId, Math.max(1, num(row.attempt)));
    if (fresh && pin) await queueWhatsapp(q, fresh, "entregue", pin, courierName ?? null);
  }
}

function listItem(row: Row): DeskData["deliveries"][number] {
  const fee = num(row.taxa_cliente_kz ?? row.delivery_aoa);
  const cost = row.custo_kz == null ? null : num(row.custo_kz);
  return {
    orderId: str(row.order_id ?? row.id),
    number: num(row.number),
    estado: str(row.estado || "pendente"),
    providerId: row.provider_id == null ? null : str(row.provider_id),
    providerName: row.provider_nome == null ? null : str(row.provider_nome),
    externalId: row.external_id == null ? null : str(row.external_id),
    zoneId: row.zone_id == null ? null : str(row.zone_id),
    zoneName: row.zone_nome == null ? null : str(row.zone_nome),
    costKz: cost,
    feeKz: fee,
    marginKz: cost == null ? null : fee - cost,
    courierName: row.estafeta_nome == null ? null : str(row.estafeta_nome),
    courierPhone: row.estafeta_telefone == null ? null : str(row.estafeta_telefone),
    courierLat: row.courier_lat == null ? null : num(row.courier_lat),
    courierLng: row.courier_lng == null ? null : num(row.courier_lng),
    customerLat: num(row.lat),
    customerLng: num(row.lng),
    addressLabel: str(row.address_label),
    etaMin: row.eta_min == null ? null : num(row.eta_min),
    fallback: flag(row.fallback_alert),
    degraded: flag(row.degraded),
    pin: row.pin_entrega == null ? null : str(row.pin_entrega),
    attempt: num(row.attempt),
    paymentMethod: str(row.payment_method),
    codKz: row.cod_kz == null ? null : num(row.cod_kz),
    createdAt: str(row.created_at),
    rating: row.rating == null ? null : num(row.rating),
  };
}

const LIST_SQL = `select o.id as order_id, o.number, o.payment_method, o.address_label, o.lat, o.lng, o.created_at, o.delivery_aoa,
  d.estado, d.provider_id, d.external_id, d.zone_id, d.custo_kz, d.taxa_cliente_kz, d.estafeta_nome, d.estafeta_telefone,
  d.courier_lat, d.courier_lng, d.eta_min, d.fallback_alert, d.degraded, d.pin_entrega, d.attempt, d.cod_kz, d.rating,
  z.nome as zone_nome, p.nome as provider_nome
  from orders o
  left join deliveries d on d.order_id = o.id
  left join delivery_zones z on z.id = d.zone_id
  left join delivery_providers p on p.id = d.provider_id`;

export async function deliveryDesk(token: string): Promise<{ ok: true; desk: DeskData } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin", "operator", "finance"])) return { ok: false, error: "forbidden" };
  const q = await db();
  await tickRows(
    q,
    await q(
      `select d.* from deliveries d where d.attempt > 0 and d.estado not in ('entregue','cancelado','falhou','devolvido_a_loja')`,
    ),
  );
  const settings = await loadSettings(q);
  const providers = (await q(`select * from delivery_providers order by prioridade`)).map(providerView);
  const zones: ZoneView[] = (await q(`select * from delivery_zones order by nome`)).map((row) => {
    const zone = parseZone(row);
    return { id: zone.id, nome: zone.nome, feeKz: zone.feeKz, freeAboveKz: zone.freeAboveKz, providers: zone.providers };
  });
  const deliveries = (await q(`${LIST_SQL} order by o.created_at desc limit 60`)).map(listItem);
  return { ok: true, desk: { settings, providers, zones, deliveries, role: staff.role } };
}

export async function deliveryDetail(token: string, orderId: string): Promise<{ ok: true; detail: DetailData } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin", "operator", "finance"])) return { ok: false, error: "forbidden" };
  await tickOrder(orderId);
  const q = await db();
  const items = await q(`${LIST_SQL} where o.id = $1`, [orderId]);
  if (!items[0]) return { ok: false, error: "missing" };
  const quotes = await q(
    `select distinct on (provider_id) dq.*, dp.nome as provider_nome
     from delivery_quotes dq join delivery_providers dp on dp.id = dq.provider_id
     where dq.order_id = $1
     order by provider_id, criado_em desc`,
    [orderId],
  );
  const events = await q(
    `select id, estado, origem, payload, created_at from delivery_events where delivery_order_id = $1 order by created_at`,
    [orderId],
  );
  const messages = await q(
    `select kind, body, to_masked, created_at from whatsapp_outbox where order_id = $1 order by created_at`,
    [orderId],
  );
  return {
    ok: true,
    detail: {
      item: listItem(items[0]),
      quotes: quotes.map((row) => ({
        id: str(row.id),
        providerId: str(row.provider_id),
        providerName: str(row.provider_nome),
        priceKz: row.preco_kz == null ? null : num(row.preco_kz),
        etaMin: row.eta_min == null ? null : num(row.eta_min),
        error: row.erro == null ? null : str(row.erro),
        expiresAt: str(row.expira_em),
      })),
      events: events.map((row) => ({
        id: str(row.id),
        estado: str(row.estado),
        origem: str(row.origem),
        at: str(row.created_at),
        note: row.payload == null ? null : str(row.payload),
      })),
      messages: messages.map((row) => ({
        kind: str(row.kind),
        body: str(row.body),
        toMasked: str(row.to_masked),
        at: str(row.created_at),
      })),
    },
  };
}

export async function saveDeliverySettings(input: {
  token: string;
  mode: "manual" | "auto";
  rule: DispatchRule;
  preferredProvider: string | null;
  priceCapKz: number | null;
  fallbackMin: number;
  showCarrier: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(input.token);
  if (!allow(staff, ["admin"])) return { ok: false, error: "forbidden" };
  const fallback = Math.min(120, Math.max(1, Math.round(input.fallbackMin)));
  const cap = input.priceCapKz == null || input.priceCapKz <= 0 ? null : Math.round(input.priceCapKz);
  const q = await db();
  await q(
    `update delivery_settings set mode = $1, rule = $2, preferred_provider = $3, price_cap_kz = $4, fallback_min = $5, show_carrier = $6
     where id = 'default'`,
    [input.mode === "auto" ? "auto" : "manual", input.rule, input.preferredProvider, cap, fallback, input.showCarrier],
  );
  await audit(q, staff.email, "delivery_settings", "default", input);
  return { ok: true };
}

export async function toggleDeliveryProvider(token: string, providerId: string, ativo: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin"])) return { ok: false, error: "forbidden" };
  const q = await db();
  const rows = await q(`update delivery_providers set ativo = $2, updated_at = now() where id = $1 returning id`, [providerId, ativo]);
  if (!rows[0]) return { ok: false, error: "missing" };
  await audit(q, staff.email, "provider_toggle", providerId, { ativo });
  return { ok: true };
}

export async function updateDeliveryZone(
  token: string,
  zoneId: string,
  feeKz: number,
  freeAboveKz: number | null,
  providers: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin"])) return { ok: false, error: "forbidden" };
  const allowed = providers.filter((id) => id === "internal" || id === "yango" || id === "manual");
  const q = await db();
  const rows = await q(
    `update delivery_zones set taxa_cliente_kz = $2, free_above_kz = $3, providers_json = $4 where id = $1 returning id`,
    [zoneId, Math.max(0, Math.round(feeKz)), freeAboveKz == null ? null : Math.max(0, Math.round(freeAboveKz)), JSON.stringify(allowed)],
  );
  if (!rows[0]) return { ok: false, error: "missing" };
  await audit(q, staff.email, "zone_fee", zoneId, { feeKz, freeAboveKz, providers: allowed });
  return { ok: true };
}

export async function pingDeliveryProvider(token: string, providerId: string): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin", "operator"])) return { ok: false, error: "forbidden" };
  const q = await db();
  const rows = await q(`select * from delivery_providers where id = $1`, [providerId]);
  if (!rows[0]) return { ok: false, error: "missing" };
  const view = providerView(rows[0]);
  if (!view.ativo) return { ok: false, error: "disabled" };
  const sample: DeliveryOrder = {
    orderId: "ping",
    number: 0,
    attempt: 1,
    customerName: "Teste",
    phone: "+244900000000",
    lat: -8.916,
    lng: 13.184,
    addressLabel: "Talatona",
    complement: "",
    paymentMethod: "multicaixa",
    codKz: null,
    subtotalKz: 1000,
    volumes: 1,
    weightKg: 1,
    declaredKz: 1000,
  };
  try {
    const quote = await ctxFrom(view)[view.tipo as ProviderKind].getQuote(sample);
    await rememberProvider(q, view.id, true);
    return { ok: true, detail: `${quote.priceKz} Kz · ${quote.etaMin} min` };
  } catch (err) {
    const message = sanitizeError(err instanceof Error ? err.message : "falhou", SECRETS());
    await rememberProvider(q, view.id, false, message);
    return { ok: false, error: message };
  }
}

export async function deliveryReport(token: string): Promise<{ ok: true; report: ReportData } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin", "finance"])) return { ok: false, error: "forbidden" };
  const q = await db();
  const rows = await q(
    `select d.*, z.nome as zone_nome, p.nome as provider_nome, o.created_at as order_created
     from deliveries d
     join orders o on o.id = d.order_id
     left join delivery_zones z on z.id = d.zone_id
     left join delivery_providers p on p.id = d.provider_id
     where d.attempt > 0`,
  );
  const byProvider = new Map<string, { nome: string; count: number; ok: number; cost: number[]; mins: number[] }>();
  const byZone = new Map<string, { nome: string; count: number; cost: number[]; fee: number[]; complaints: number }>();
  const byDay = new Map<string, number>();
  let delivered = 0;
  let active = 0;
  let complaints = 0;
  for (const row of rows) {
    const estado = str(row.estado);
    const day = str(row.order_created).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (estado === "entregue") delivered += 1;
    else if (!TERMINAL_STATES.includes(estado as DeliveryEstado)) active += 1;
    if (row.rating != null && num(row.rating) <= 2) complaints += 1;
    const pid = str(row.provider_id || "—");
    const bucket = byProvider.get(pid) ?? { nome: str(row.provider_nome || pid), count: 0, ok: 0, cost: [], mins: [] };
    bucket.count += 1;
    if (estado === "entregue") bucket.ok += 1;
    if (row.custo_kz != null) bucket.cost.push(num(row.custo_kz));
    const start = time(row.dispatched_at);
    const end = time(row.entregue_em);
    if (start && end && end >= start) bucket.mins.push((end - start) / 60000);
    byProvider.set(pid, bucket);
    const zid = str(row.zone_id || "fora");
    const zone = byZone.get(zid) ?? { nome: str(row.zone_nome || "Fora das zonas nomeadas"), count: 0, cost: [], fee: [], complaints: 0 };
    zone.count += 1;
    if (row.custo_kz != null) zone.cost.push(num(row.custo_kz));
    if (row.taxa_cliente_kz != null) zone.fee.push(num(row.taxa_cliente_kz));
    if (row.rating != null && num(row.rating) <= 2) zone.complaints += 1;
    byZone.set(zid, zone);
  }
  const avg = (list: number[]) => (list.length ? Math.round(list.reduce((s, n) => s + n, 0) / list.length) : null);
  return {
    ok: true,
    report: {
      delivered,
      active,
      complaints,
      byProvider: [...byProvider.entries()].map(([id, bucket]) => ({
        id,
        nome: bucket.nome,
        count: bucket.count,
        successPct: bucket.count ? Math.round((bucket.ok / bucket.count) * 100) : 0,
        avgCost: avg(bucket.cost),
        avgMin: avg(bucket.mins),
      })),
      byZone: [...byZone.entries()].map(([id, bucket]) => ({
        id,
        nome: bucket.nome,
        count: bucket.count,
        avgCost: avg(bucket.cost),
        avgFee: avg(bucket.fee),
        complaints: bucket.complaints,
      })),
      byDay: [...byDay.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
    },
  };
}

export async function reconcileDeliveries(token: string, csv: string): Promise<{ ok: true; rows: ReconcileRow[] } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin", "finance"])) return { ok: false, error: "forbidden" };
  const q = await db();
  const period = new Date().toISOString().slice(0, 7);
  const parsed: { externalId: string; billed: number }[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const [a, b] = line.split(/[,;]/).map((part) => part.trim());
    if (!a || !b || !/^\d+$/.test(b)) continue;
    parsed.push({ externalId: a.slice(0, 80), billed: Number(b) });
  }
  if (!parsed.length) return { ok: false, error: "csv" };
  const rows: ReconcileRow[] = [];
  for (const line of parsed) {
    await q(
      `insert into delivery_invoice_lines (id, provider_id, external_id, billed_kz, period) values ($1,'import',$2,$3,$4)`,
      [newId(), line.externalId, line.billed, period],
    );
    const found = await q(`select provider_id, custo_kz from deliveries where external_id = $1`, [line.externalId]);
    const recorded = found[0]?.custo_kz == null ? null : num(found[0]?.custo_kz);
    rows.push({
      externalId: line.externalId,
      billedKz: line.billed,
      recordedKz: recorded,
      deltaKz: recorded == null ? null : line.billed - recorded,
      providerId: found[0] ? str(found[0].provider_id) : null,
    });
  }
  await audit(q, staff.email, "reconcile", period, { lines: rows.length });
  return { ok: true, rows };
}

export async function ingestDeliveryWebhook(
  providerId: string,
  raw: string,
  signature: string | undefined,
): Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const q = await db();
  const rows = await q(`select * from delivery_providers where id = $1`, [providerId]);
  const view = rows[0] ? providerView(rows[0]) : null;
  const secret = process.env.YANGO_WEBHOOK_SECRET || (view?.sandbox ? SANDBOX_WEBHOOK_SECRET : "");
  let eventId = "";
  try {
    eventId = str((JSON.parse(raw) as { event_id?: string }).event_id);
  } catch {
    return { ok: false, error: "payload" };
  }
  const seenRows = eventId ? await q(`select event_id from delivery_webhook_events where event_id = $1`, [eventId]) : [];
  const decision = decideWebhook({ rawBody: raw, signature, secret, seen: new Set(seenRows.map((row) => str(row.event_id))) });
  if (!decision.ok) return { ok: false, error: decision.error };
  if (decision.duplicate) return { ok: true, duplicate: true };
  const inserted = await q(
    `insert into delivery_webhook_events (event_id, provider_id) values ($1,$2) on conflict (event_id) do nothing returning event_id`,
    [decision.eventId, providerId],
  );
  if (!inserted[0]) return { ok: true, duplicate: true };
  if (!decision.externalId || !decision.estado) return { ok: true, duplicate: false };
  const found = await q(`select order_id, attempt from deliveries where external_id = $1`, [decision.externalId]);
  if (!found[0]) return { ok: true, duplicate: false };
  const order = await orderSnapshot(q, str(found[0].order_id), num(found[0].attempt) || 1);
  if (!order) return { ok: true, duplicate: false };
  await applyEstado(q, order, decision.estado, "webhook", {
    courierName: decision.courierName,
    courierPhone: decision.courierPhone,
    lat: decision.lat,
    lng: decision.lng,
    lock: true,
  });
  await rememberProvider(q, providerId, true);
  return { ok: true, duplicate: false };
}

export async function sendTestWebhook(token: string, orderId: string, status: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const staff = await staffFromToken(token);
  if (!allow(staff, ["admin", "operator"])) return { ok: false, error: "forbidden" };
  const q = await db();
  const rows = await q(`select external_id, provider_id from deliveries where order_id = $1`, [orderId]);
  const externalId = str(rows[0]?.external_id);
  if (!externalId) return { ok: false, error: "missing" };
  const raw = JSON.stringify({
    event_id: newId(),
    claim_id: externalId,
    status,
    courier: { name: "Estafeta Yango", phone: "+244923100002" },
    lat: -8.92,
    lng: 13.19,
  });
  const secret = process.env.YANGO_WEBHOOK_SECRET || SANDBOX_WEBHOOK_SECRET;
  const result = await ingestDeliveryWebhook(str(rows[0]?.provider_id || "yango"), raw, signBody(secret, raw));
  if (!result.ok) return result;
  return { ok: true };
}

export async function rateDelivery(input: {
  token: string;
  orderId: string;
  rating: number;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDeliverySeed();
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) return { ok: false, error: "rating" };
  const q = await db();
  const sessions = await q(
    `select c.id from customer_sessions s join customers c on c.id = s.customer_id
     where s.token_hash = $1 and s.expires_at > now() and c.deleted_at is null`,
    [sha256(input.token)],
  );
  if (!sessions[0]) return { ok: false, error: "auth" };
  const rows = await q(
    `select d.estado from deliveries d join orders o on o.id = d.order_id
     where d.order_id = $1 and o.customer_id = $2`,
    [input.orderId, str(sessions[0].id)],
  );
  if (!rows[0]) return { ok: false, error: "missing" };
  if (str(rows[0].estado) !== "entregue") return { ok: false, error: "status" };
  await q(`update deliveries set rating = $2, rating_note = $3 where order_id = $1 and rating is null`, [
    input.orderId,
    rating,
    (input.note ?? "").trim().slice(0, 180),
  ]);
  return { ok: true };
}
