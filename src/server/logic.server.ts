import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import catalogFile from "@/data/catalog.json";
import { dbSource, getPglite, getSql } from "@/lib/db";
import { priceZone } from "@/lib/delivery/core";
import { loadZones, onOrderPlaced, publicTrack, syncOrderStatus, tickCustomer, tickOrder } from "@/server/delivery.server";
import { deliverOtp } from "@/server/otp-send.server";
import {
  LOW_STOCK_AT,
  discountPrice,
  etaLabel,
  floorPrice,
  normalizePhone,
  slugify,
  withinMargin,
} from "@/lib/pricing";
import type {
  AdminProduct,
  AuditRow,
  CategoryRow,
  Customer,
  Notice,
  OrderSummary,
  ProductCard,
  PromoSuggestion,
  Quote,
  QuoteLine,
  Staff,
  StaffRole,
  SubcategoryRow,
} from "@/lib/shop-types";

type Row = Record<string, unknown>;
type Runner = (text: string, params?: unknown[]) => Promise<Row[]>;

type CatalogItem = {
  sku: string;
  category: string;
  subcategory: string;
  name: string;
  brand: string;
  format: string;
  unit: string;
  description: string;
  keywords: string;
  photoSource: string;
  photoFile: string;
  priority: string;
  priceAoa: number;
  costAoa: number;
  minMarginPct: number;
  stock: number;
  expiry: string | null;
  avgDaily: number;
};

const PEPPER = "compra-tudo-otp-v1";

function staffPassword(): string | null {
  const fromEnv = process.env.STAFF_PASSWORD?.trim();
  if (fromEnv) return fromEnv;
  try {
    const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("STAFF_PASSWORD=")) continue;
      const value = trimmed.slice("STAFF_PASSWORD=".length).trim().replace(/^"|"$/g, "");
      return value || null;
    }
  } catch {
    /* sem ficheiro local; em produção a variável vem do servidor */
  }
  return null;
}

const STAFF_SEED: { email: string; name: string; role: StaffRole }[] = [
  { email: "gestao@compratudo.ao", name: "Ana Gestão", role: "admin" },
  { email: "stock@compratudo.ao", name: "Paulo Stock", role: "stock_manager" },
  { email: "financeiro@compratudo.ao", name: "Marta Finanças", role: "finance" },
  { email: "operacao@compratudo.ao", name: "Dinis Operação", role: "operator" },
];

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
function nullableNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  return num(v);
}
function dateOnly(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = str(v);
  return s.slice(0, 10);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function hashCode(code: string): string {
  return sha256(`${PEPPER}:${code}`);
}
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hex] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hex) return false;
  const hash = scryptSync(password, salt, 32);
  const a = Buffer.from(hex, "hex");
  if (a.length !== hash.length) return false;
  return timingSafeEqual(a, hash);
}
function newId(): string {
  return randomBytes(16).toString("hex");
}
function sixDigits(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
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

let seedPromise: Promise<void> | null = null;

async function seed(): Promise<void> {
  const q = await db();
  const existing = await q(`select value from app_meta where key = 'catalog_seed'`);
  if (existing[0]?.value === "v1") {
    await ensureStaff(q);
    await ensureShowcasePromos(q);
    await ensureDeliveryWindows(q);
    await ensureFruitAisle(q);
    return;
  }
  const items = (catalogFile as { items: CatalogItem[] }).items;
  const catNames: string[] = [];
  const subKeys: { id: string; categoryId: string; name: string }[] = [];
  const seenCat = new Set<string>();
  const seenSub = new Set<string>();
  for (const item of items) {
    const categoryId = slugify(item.category);
    if (!seenCat.has(categoryId)) {
      seenCat.add(categoryId);
      catNames.push(item.category);
    }
    const subId = `${categoryId}__${slugify(item.subcategory)}`;
    if (!seenSub.has(subId)) {
      seenSub.add(subId);
      subKeys.push({ id: subId, categoryId, name: item.subcategory });
    }
  }
  for (let i = 0; i < catNames.length; i += 1) {
    const name = catNames[i];
    const id = slugify(name);
    await q(
      `insert into categories (id, name, sort_order) values ($1, $2, $3)
       on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order`,
      [id, name, i],
    );
  }
  for (let i = 0; i < subKeys.length; i += 1) {
    const sub = subKeys[i];
    await q(
      `insert into subcategories (id, category_id, name, sort_order) values ($1, $2, $3, $4)
       on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order`,
      [sub.id, sub.categoryId, sub.name, i],
    );
  }
  const chunkSize = 40;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((item, idx) => {
      const base = idx * 18;
      const categoryId = slugify(item.category);
      const subId = `${categoryId}__${slugify(item.subcategory)}`;
      values.push(
        item.sku,
        categoryId,
        subId,
        item.name,
        item.brand,
        item.format,
        item.unit,
        item.description,
        item.keywords,
        item.photoSource,
        item.photoFile,
        item.priority,
        item.costAoa,
        item.priceAoa,
        item.minMarginPct,
        item.stock,
        item.expiry,
        item.avgDaily,
      );
      const ph = Array.from({ length: 18 }, (_, n) => `$${base + n + 1}`).join(", ");
      return `(${ph})`;
    });
    await q(
      `insert into products (
        sku, category_id, subcategory_id, name, brand, format, unit, description, keywords,
        photo_source, photo_file, priority, cost_aoa, price_aoa, min_margin_pct, stock,
        expiry_date, avg_daily
      ) values ${tuples.join(", ")}
      on conflict (sku) do update set
        name = excluded.name,
        brand = excluded.brand,
        format = excluded.format,
        unit = excluded.unit,
        description = excluded.description,
        keywords = excluded.keywords,
        photo_source = excluded.photo_source,
        photo_file = excluded.photo_file,
        priority = excluded.priority,
        category_id = excluded.category_id,
        subcategory_id = excluded.subcategory_id`,
      values,
    );
  }
  await ensureStaff(q);
  await q(
    `insert into app_meta (key, value) values ('catalog_seed', 'v1')
     on conflict (key) do update set value = excluded.value`,
  );
  await q(
    `insert into app_meta (key, value) values ('auto_promos', 'off')
     on conflict (key) do nothing`,
  );
  await ensureShowcasePromos(q);
  await ensureDeliveryWindows(q);
  await ensureFruitAisle(q);
}

async function ensureShowcasePromos(q: Runner): Promise<void> {
  await mixShowcaseDiscounts(q);
  const existing = await q(
    `select count(*)::int as n from promotions where status = 'active' and ends_at > now()`,
  );
  if (num(existing[0]?.n) > 0) return;
  const rows = await q(
    `select sku, price_aoa, cost_aoa, min_margin_pct, stock
     from products
     where active and priority = 'A' and stock > 6
     order by name
     limit 20`,
  );
  const ladder = [8, 12, 15, 18, 10, 25, 30, 22];
  let cursor = 0;
  let made = 0;
  for (const row of rows) {
    if (made >= 8) break;
    const price = num(row.price_aoa);
    const cost = num(row.cost_aoa);
    const margin = num(row.min_margin_pct) || 15;
    const percent = firstPercent(price, cost, margin, ladder, cursor);
    cursor += 1;
    if (percent == null) continue;
    await q(
      `insert into promotions (
        id, sku, kind, value, starts_at, ends_at, unit_limit, min_stock_cutoff, origin, status, created_by
      ) values ($1, $2, 'percent', $3, now(), now() + interval '14 days', $4, 2, 'showcase', 'active', 'sistema')`,
      [newId(), str(row.sku), percent, Math.max(num(row.stock), 1)],
    );
    made += 1;
  }
}

function firstPercent(price: number, cost: number, margin: number, ladder: number[], cursor: number): number | null {
  for (let attempt = 0; attempt < ladder.length; attempt += 1) {
    const percent = ladder[(cursor + attempt) % ladder.length];
    const next = discountPrice(price, "percent", percent);
    if (next < price && withinMargin(next, cost, margin)) return percent;
  }
  return null;
}

async function mixShowcaseDiscounts(q: Runner): Promise<void> {
  const flag = await q(`select value from app_meta where key = 'showcase_mix'`);
  if (str(flag[0]?.value) === "v2") return;
  const rows = await q(
    `select p.id, pr.price_aoa, pr.cost_aoa, pr.min_margin_pct
     from promotions p
     join products pr on pr.sku = p.sku
     where p.status = 'active' and p.kind = 'percent' and p.ends_at > now()
     order by p.sku`,
  );
  const ladder = [8, 10, 12, 15, 18, 22, 25, 30, 35, 5];
  let cursor = 0;
  for (const row of rows) {
    const percent = firstPercent(num(row.price_aoa), num(row.cost_aoa), num(row.min_margin_pct) || 15, ladder, cursor);
    cursor += 1;
    if (percent == null) continue;
    await q(`update promotions set value = $2 where id = $1`, [str(row.id), percent]);
  }
  await q(
    `insert into app_meta (key, value) values ('showcase_mix', 'v2')
     on conflict (key) do update set value = excluded.value`,
  );
}

const DAY_WINDOWS: [number, number, number, number, string][] = [
  [7, 9 * 60, 11 * 60, 10, "09:00–11:00"],
  [7, 11 * 60, 13 * 60, 10, "11:00–13:00"],
  [7, 14 * 60, 16 * 60, 8, "14:00–16:00"],
  [7, 16 * 60, 18 * 60, 8, "16:00–18:00"],
  [7, 18 * 60, 20 * 60, 8, "18:00–20:00"],
];

async function ensureFruitAisle(q: Runner): Promise<void> {
  const fresh = await q(`select sort_order from categories where id = 'frescos'`);
  const sort = fresh[0] ? num(fresh[0].sort_order) : 2;
  const aisles: { id: string; name: string; subs: string[] }[] = [
    { id: "frutas", name: "Frutas", subs: ["frescos__frutas"] },
    { id: "carne", name: "Carne", subs: ["frescos__talho", "congelados__carne-congelada"] },
    { id: "peixe", name: "Peixe", subs: ["frescos__peixaria", "congelados__peixe-e-marisco-congelado"] },
  ];
  for (const aisle of aisles) {
    await q(
      `insert into categories (id, name, sort_order) values ($1, $2, $3)
       on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order`,
      [aisle.id, aisle.name, sort],
    );
    for (const sub of aisle.subs) {
      await q(`update subcategories set category_id = $2 where id = $1`, [sub, aisle.id]);
      await q(`update products set category_id = $2 where subcategory_id = $1`, [sub, aisle.id]);
    }
  }
}

async function ensureDeliveryWindows(q: Runner): Promise<void> {
  const existing = await q(`select count(*)::int as n from delivery_windows`);
  if (num(existing[0]?.n) > 0) return;
  for (const [weekday, startMin, endMin, capacity, label] of DAY_WINDOWS) {
    await q(
      `insert into delivery_windows (id, label, weekday, start_min, end_min, capacity, active)
       values ($1, $2, $3, $4, $5, $6, true)`,
      [newId(), label, weekday, startMin, endMin, capacity],
    );
  }
}

async function ensureStaff(q: Runner): Promise<void> {
  const password = staffPassword();
  for (const staff of STAFF_SEED) {
    const found = await q(`select id from staff_users where email = $1`, [staff.email]);
    if (found.length === 0) {
      if (!password) continue;
      await q(
        `insert into staff_users (id, email, name, password_hash, role) values ($1, $2, $3, $4, $5)`,
        [newId(), staff.email, staff.name, hashPassword(password), staff.role],
      );
      continue;
    }
    if (!password) continue;
    await q(
      `update staff_users set password_hash = $2, failed_attempts = 0, locked_until = null where email = $1`,
      [staff.email, hashPassword(password)],
    );
  }
}

export function ensureSeeded(): Promise<void> {
  seedPromise ??= seed().catch((err) => {
    seedPromise = null;
    throw err;
  });
  return seedPromise;
}

async function audit(
  q: Runner,
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await q(
    `insert into audit_logs (id, actor, action, entity, entity_id, before_json, after_json)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newId(),
      actor,
      action,
      entity,
      entityId,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ],
  );
}

async function customerFromToken(token: string): Promise<Customer | null> {
  if (!token) return null;
  const q = await db();
  const rows = await q(
    `select c.id, c.name, c.phone
     from customer_sessions s
     join customers c on c.id = s.customer_id
     where s.token_hash = $1 and s.expires_at > now() and c.deleted_at is null`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: str(row.id), name: str(row.name), phone: str(row.phone) };
}

async function staffFromToken(token: string): Promise<Staff | null> {
  if (!token) return null;
  const q = await db();
  const rows = await q(
    `select u.id, u.email, u.name, u.role
     from staff_sessions s
     join staff_users u on u.id = s.staff_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: str(row.id),
    email: str(row.email),
    name: str(row.name),
    role: str(row.role) as StaffRole,
  };
}

function assertRole(staff: Staff | null, roles: StaffRole[]): Staff {
  if (!staff || !roles.includes(staff.role)) {
    const err = new Error("forbidden");
    err.name = "Forbidden";
    throw err;
  }
  return staff;
}

type Promo = {
  id: string;
  sku: string;
  kind: "percent" | "amount";
  value: number;
  endsAt: string;
  unitLimit: number | null;
  unitsSold: number;
  minStock: number;
};

async function sweepPromos(q: Runner): Promise<void> {
  await q(
    `update promotions p
     set status = 'ended'
     from products pr
     where p.sku = pr.sku
       and p.status = 'active'
       and (
         p.ends_at <= now()
         or (p.unit_limit is not null and p.units_sold >= p.unit_limit)
         or pr.stock <= p.min_stock_cutoff
       )`,
  );
}

async function loadPromos(q: Runner, skus: string[]): Promise<Map<string, Promo>> {
  const map = new Map<string, Promo>();
  if (skus.length === 0) return map;
  const ph = skus.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await q(
    `select id, sku, kind, value, ends_at::text as ends_at, unit_limit, units_sold, min_stock_cutoff
     from promotions
     where status = 'active' and starts_at <= now() and sku in (${ph})`,
    skus,
  );
  for (const row of rows) {
    map.set(str(row.sku), {
      id: str(row.id),
      sku: str(row.sku),
      kind: str(row.kind) === "amount" ? "amount" : "percent",
      value: num(row.value),
      endsAt: str(row.ends_at),
      unitLimit: row.unit_limit == null ? null : num(row.unit_limit),
      unitsSold: num(row.units_sold),
      minStock: num(row.min_stock_cutoff),
    });
  }
  return map;
}

function publicProduct(
  row: Row,
  promo: Promo | undefined,
  favorite: boolean,
): ProductCard | null {
  const price = nullableNum(row.price_aoa);
  const cost = nullableNum(row.cost_aoa);
  const margin = num(row.min_margin_pct) || 15;
  const stock = num(row.stock);
  if (price == null || cost == null || !withinMargin(price, cost, margin)) return null;
  if (str(row.active) === "false" || row.active === false) return null;
  let unit = price;
  let compare: number | null = null;
  let promoEnds: string | null = null;
  if (
    promo &&
    stock > promo.minStock &&
    (promo.unitLimit == null || promo.unitsSold < promo.unitLimit)
  ) {
    const next = discountPrice(price, promo.kind, promo.value);
    if (next < price && withinMargin(next, cost, margin)) {
      unit = next;
      compare = price;
      promoEnds = promo.endsAt.slice(0, 10);
    }
  }
  const availability = stock <= 0 ? "out" : stock <= LOW_STOCK_AT ? "low" : "ok";
  return {
    sku: str(row.sku),
    name: str(row.name),
    brand: str(row.brand),
    format: str(row.format),
    unit: str(row.unit),
    description: str(row.description),
    keywords: str(row.keywords),
    categoryId: str(row.category_id),
    categoryName: str(row.category_name),
    subcategoryId: str(row.subcategory_id),
    subcategoryName: str(row.subcategory_name),
    photoFile: str(row.photo_file),
    priority: str(row.priority),
    priceAoa: unit,
    compareAtAoa: compare,
    promoEnds,
    availability,
    stockLeft: stock,
    favorite,
  };
}

const PRODUCT_SELECT = `
  select p.*, c.name as category_name, s.name as subcategory_name
  from products p
  join categories c on c.id = p.category_id
  join subcategories s on s.id = p.subcategory_id
`;

export async function warmup(): Promise<{ ok: true; products: number }> {
  await ensureSeeded();
  const q = await db();
  const rows = await q(`select count(*)::int as n from products`);
  return { ok: true, products: num(rows[0]?.n) };
}

export async function requestOtp(input: {
  name: string;
  phone: string;
  channel: "sms" | "whatsapp";
}): Promise<
  | { ok: true; phone: string; channel: "sms" | "whatsapp"; retryIn: number }
  | { ok: false; error: string; retryIn?: number }
> {
  await ensureSeeded();
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "phone" };
  const q = await db();
  let name = input.name.trim();
  if (name.length < 2) {
    const known = await q(
      `select name from customers where phone = $1 and deleted_at is null`,
      [phone],
    );
    name = str(known[0]?.name);
  }
  if (name.length < 2 || name.length > 80) return { ok: false, error: "name" };
  const channel = input.channel === "whatsapp" ? "whatsapp" : "sms";
  const recent = await q(
    `select count(*)::int as n,
            extract(epoch from (max(created_at) + interval '30 seconds' - now())) as wait
     from otp_codes
     where phone = $1 and created_at > now() - interval '15 minutes'`,
    [phone],
  );
  const n = num(recent[0]?.n);
  if (n >= 5) return { ok: false, error: "rate" };
  const wait = num(recent[0]?.wait);
  if (n > 0 && wait > 0) return { ok: false, error: "wait", retryIn: Math.ceil(wait) };
  await q(`update otp_codes set used = true where phone = $1 and used = false`, [phone]);
  const code = sixDigits();
  const id = newId();
  await q(
    `insert into otp_codes (id, phone, name, channel, code_hash, expires_at)
     values ($1, $2, $3, $4, $5, now() + interval '5 minutes')`,
    [id, phone, name, channel, hashCode(code)],
  );
  const sent = await deliverOtp(channel, phone, code);
  if (!sent.ok) {
    await q(`delete from otp_codes where id = $1`, [id]);
    return { ok: false, error: "send" };
  }
  return { ok: true, phone, channel, retryIn: 30 };
}

export async function verifyOtp(input: {
  phone: string;
  code: string;
}): Promise<{ ok: true; token: string; customer: Customer } | { ok: false; error: string }> {
  await ensureSeeded();
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "phone" };
  const code = input.code.replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "code" };
  const q = await db();
  const rows = await q(
    `select id, name, channel, code_hash, attempts
     from otp_codes
     where phone = $1 and used = false and expires_at > now()
     order by created_at desc
     limit 1`,
    [phone],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "code" };
  const attempts = num(row.attempts) + 1;
  const match = hashCode(code) === str(row.code_hash);
  if (!match) {
    await q(
      `update otp_codes set attempts = $2, used = $3 where id = $1`,
      [str(row.id), attempts, attempts >= 5],
    );
    return { ok: false, error: "code" };
  }
  await q(`update otp_codes set used = true, attempts = $2 where id = $1`, [str(row.id), attempts]);
  const existing = await q(
    `select id from customers where phone = $1 and deleted_at is null`,
    [phone],
  );
  let id = str(existing[0]?.id);
  if (!id) {
    id = newId();
    await q(
      `insert into customers (id, name, phone, otp_channel) values ($1, $2, $3, $4)`,
      [id, str(row.name), phone, str(row.channel)],
    );
  } else {
    await q(`update customers set name = $2, otp_channel = $3 where id = $1`, [
      id,
      str(row.name),
      str(row.channel),
    ]);
  }
  const token = randomBytes(32).toString("hex");
  await q(
    `insert into customer_sessions (token_hash, customer_id, expires_at)
     values ($1, $2, now() + interval '30 days')`,
    [sha256(token), id],
  );
  return { ok: true, token, customer: { id, name: str(row.name), phone } };
}

export async function saveAddress(token: string, address: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const customer = await customerFromToken(token);
  if (!customer) return { ok: false, error: "auth" };
  const line = address.trim().slice(0, 180);
  if (line.length < 3) return { ok: false, error: "address" };
  const q = await db();
  await q(`update customers set address = $2 where id = $1`, [customer.id, line]);
  return { ok: true };
}

export async function getMe(token: string): Promise<{ customer: Customer | null }> {
  await ensureSeeded();
  return { customer: await customerFromToken(token) };
}

export async function logout(token: string): Promise<{ ok: true }> {
  const q = await db();
  if (token) await q(`delete from customer_sessions where token_hash = $1`, [sha256(token)]);
  return { ok: true };
}

export async function deleteAccount(input: {
  token: string;
  confirm: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const word = input.confirm.trim().toUpperCase();
  if (word !== "ELIMINAR" && word !== "SUPPRIMER" && word !== "DELETE") {
    return { ok: false, error: "confirm" };
  }
  const customer = await customerFromToken(input.token);
  if (!customer) return { ok: false, error: "auth" };
  const q = await db();
  await q(`delete from favorites where customer_id = $1`, [customer.id]);
  await q(`delete from restock_alerts where customer_id = $1`, [customer.id]);
  await q(`delete from addresses where customer_id = $1`, [customer.id]);
  await q(`delete from customer_sessions where customer_id = $1`, [customer.id]);
  await q(`delete from notifications where customer_id = $1`, [customer.id]);
  await q(
    `update customers set name = 'Conta eliminada', phone = $2, deleted_at = now() where id = $1`,
    [customer.id, `deleted-${customer.id}`],
  );
  return { ok: true };
}

export async function listCategories(token: string): Promise<
  | { ok: true; categories: CategoryRow[] }
  | { ok: false; error: string }
> {
  await ensureSeeded();
  const q = await db();
  const rows = await q(
    `select c.id, c.name, count(p.sku)::int as n
     from categories c
     join products p on p.category_id = c.id
     where p.active and p.price_aoa is not null and p.cost_aoa is not null
     group by c.id, c.name, c.sort_order
     order by c.sort_order, c.name`,
  );
  return {
    ok: true,
    categories: rows.map((r) => ({ id: str(r.id), name: str(r.name), count: num(r.n) })),
  };
}

export async function listSubcategories(
  token: string,
  categoryId: string,
): Promise<{ ok: true; subcategories: SubcategoryRow[] } | { ok: false; error: string }> {
  const q = await db();
  const rows = await q(
    `select s.id, s.name, count(p.sku)::int as n
     from subcategories s
     join products p on p.subcategory_id = s.id
     where s.category_id = $1 and p.active and p.price_aoa is not null
     group by s.id, s.name, s.sort_order
     order by s.sort_order`,
    [categoryId],
  );
  return {
    ok: true,
    subcategories: rows.map((r) => ({ id: str(r.id), name: str(r.name), count: num(r.n) })),
  };
}

async function mapProducts(rows: Row[], customerId: string | null): Promise<ProductCard[]> {
  const q = await db();
  await sweepPromos(q);
  const skus = rows.map((r) => str(r.sku));
  const promos = await loadPromos(q, skus);
  const favs = new Set<string>();
  if (customerId && skus.length) {
    const ph = skus.map((_, i) => `$${i + 2}`).join(", ");
    const favRows = await q(
      `select sku from favorites where customer_id = $1 and sku in (${ph})`,
      [customerId, ...skus],
    );
    for (const fav of favRows) favs.add(str(fav.sku));
  }
  const out: ProductCard[] = [];
  for (const row of rows) {
    const card = publicProduct(row, promos.get(str(row.sku)), favs.has(str(row.sku)));
    if (card) out.push(card);
  }
  return out;
}

export async function searchProducts(input: {
  token: string;
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
  favoritesOnly?: boolean;
  priorityA?: boolean;
  limit?: number;
}): Promise<{ ok: true; products: ProductCard[] } | { ok: false; error: string }> {
  const customer = input.token ? await customerFromToken(input.token) : null;
  if (input.favoritesOnly && !customer) return { ok: false, error: "auth" };
  await ensureSeeded();
  const q = await db();
  const where: string[] = [`p.active = true`, `p.price_aoa is not null`, `p.cost_aoa is not null`];
  const params: unknown[] = [];
  if (input.categoryId) {
    params.push(input.categoryId);
    where.push(`p.category_id = $${params.length}`);
  }
  if (input.subcategoryId) {
    params.push(input.subcategoryId);
    where.push(`p.subcategory_id = $${params.length}`);
  }
  if (input.priorityA) where.push(`p.priority = 'A'`);
  if (input.favoritesOnly && customer) {
    params.push(customer.id);
    where.push(
      `exists (select 1 from favorites f where f.sku = p.sku and f.customer_id = $${params.length})`,
    );
  }
  const query = (input.q ?? "").trim().toLowerCase();
  if (query) {
    const words = query.split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      params.push(`%${word}%`);
      const p = `$${params.length}`;
      where.push(
        `(lower(p.name) like ${p} or lower(p.brand) like ${p} or lower(p.keywords) like ${p} or lower(p.sku) like ${p})`,
      );
    }
  }
  const limit = Math.min(240, Math.max(1, input.limit ?? 40));
  params.push(limit);
  const rows = await q(
    `${PRODUCT_SELECT}
     where ${where.join(" and ")}
     order by case p.priority when 'A' then 0 when 'B' then 1 else 2 end, p.name
     limit $${params.length}`,
    params,
  );
  return { ok: true, products: await mapProducts(rows, customer?.id ?? null) };
}

export async function getProduct(
  token: string,
  sku: string,
): Promise<{ ok: true; product: ProductCard } | { ok: false; error: string }> {
  const customer = token ? await customerFromToken(token) : null;
  const q = await db();
  const rows = await q(`${PRODUCT_SELECT} where p.sku = $1`, [sku]);
  const products = await mapProducts(rows, customer?.id ?? null);
  if (!products[0]) return { ok: false, error: "missing" };
  return { ok: true, product: products[0] };
}

export async function toggleFavorite(input: {
  token: string;
  sku: string;
}): Promise<{ ok: true; favorite: boolean } | { ok: false; error: string }> {
  const customer = await customerFromToken(input.token);
  if (!customer) return { ok: false, error: "auth" };
  const q = await db();
  const existing = await q(`select 1 as x from favorites where customer_id = $1 and sku = $2`, [
    customer.id,
    input.sku,
  ]);
  if (existing.length) {
    await q(`delete from favorites where customer_id = $1 and sku = $2`, [customer.id, input.sku]);
    return { ok: true, favorite: false };
  }
  await q(`insert into favorites (customer_id, sku) values ($1, $2)`, [customer.id, input.sku]);
  return { ok: true, favorite: true };
}

export async function requestRestock(input: {
  token: string;
  sku: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const customer = await customerFromToken(input.token);
  if (!customer) return { ok: false, error: "auth" };
  const q = await db();
  await q(
    `insert into restock_alerts (customer_id, sku) values ($1, $2) on conflict do nothing`,
    [customer.id, input.sku],
  );
  return { ok: true };
}

type Built = {
  lines: (QuoteLine & { cost: number; margin: number; promoId: string | null; categoryId: string })[];
  adjustments: { sku: string; name: string; qty: number }[];
  subtotal: number;
  discount: number;
  discountNote: string | null;
  couponError: string | null;
  couponId: string | null;
};

async function buildQuote(
  q: Runner,
  customerId: string,
  items: { sku: string; qty: number }[],
  couponCode: string | undefined,
  forUpdate: boolean,
): Promise<Built> {
  await sweepPromos(q);
  const wanted = items
    .map((item) => ({ sku: item.sku, qty: Math.max(0, Math.floor(item.qty)) }))
    .filter((item) => item.qty > 0)
    .slice(0, 40);
  const skus = [...new Set(wanted.map((i) => i.sku))];
  if (skus.length === 0) {
    return {
      lines: [],
      adjustments: [],
      subtotal: 0,
      discount: 0,
      discountNote: null,
      couponError: couponCode ? "invalid" : null,
      couponId: null,
    };
  }
  const ph = skus.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await q(
    `select sku, name, category_id, price_aoa, cost_aoa, min_margin_pct, stock, active
     from products where sku in (${ph}) ${forUpdate ? "for update" : ""}`,
    skus,
  );
  const bySku = new Map(rows.map((r) => [str(r.sku), r]));
  const promos = await loadPromos(q, skus);
  const adjustments: Built["adjustments"] = [];
  const lines: Built["lines"] = [];
  for (const item of wanted) {
    const row = bySku.get(item.sku);
    if (!row || row.active === false) {
      adjustments.push({ sku: item.sku, name: item.sku, qty: 0 });
      continue;
    }
    const price = nullableNum(row.price_aoa);
    const cost = nullableNum(row.cost_aoa);
    const margin = num(row.min_margin_pct) || 15;
    const stock = num(row.stock);
    if (price == null || cost == null || !withinMargin(price, cost, margin)) {
      adjustments.push({ sku: item.sku, name: str(row.name), qty: 0 });
      continue;
    }
    const qty = Math.min(item.qty, stock);
    if (qty !== item.qty) adjustments.push({ sku: item.sku, name: str(row.name), qty });
    if (qty <= 0) continue;
    const promo = promos.get(item.sku);
    let unit = price;
    let compare: number | null = null;
    let promoId: string | null = null;
    if (promo && stock > promo.minStock && (promo.unitLimit == null || promo.unitsSold + qty <= promo.unitLimit)) {
      const next = discountPrice(price, promo.kind, promo.value);
      if (next < price && withinMargin(next, cost, margin)) {
        unit = next;
        compare = price;
        promoId = promo.id;
      }
    }
    lines.push({
      sku: item.sku,
      name: str(row.name),
      qty,
      unitPrice: unit,
      compareAt: compare,
      lineTotal: unit * qty,
      cost,
      margin,
      promoId,
      categoryId: str(row.category_id),
    });
  }
  let discount = 0;
  let discountNote: string | null = null;
  const discounts = await q(
    `select id, kind, value, scope, scope_ref, single_use, reason
     from customer_discounts
     where customer_id = $1 and used = false and starts_at <= now() and ends_at > now()
     order by created_at desc`,
    [customerId],
  );
  const discountRow = discounts[0];
  if (discountRow && lines.length) {
    const applied = applyOffer(
      lines,
      str(discountRow.kind) === "amount" ? "amount" : "percent",
      num(discountRow.value),
      str(discountRow.scope),
      discountRow.scope_ref == null ? null : str(discountRow.scope_ref),
    );
    if (applied > 0) {
      discount += applied;
      discountNote = str(discountRow.reason);
    }
  }
  let couponError: string | null = null;
  let couponId: string | null = null;
  const code = (couponCode ?? "").trim().toUpperCase();
  if (code) {
    const coupons = await q(
      `select id, customer_id, kind, value, scope, scope_ref, single_use, ends_at
       from coupons
       where upper(code) = $1 and starts_at <= now() and ends_at > now()`,
      [code],
    );
    const coupon = coupons[0];
    const owner = coupon?.customer_id == null ? null : str(coupon.customer_id);
    let redeemed = false;
    if (coupon && (str(coupon.single_use) === "true" || coupon.single_use === true)) {
      const red = await q(
        `select 1 as x from coupon_redemptions where coupon_id = $1 and customer_id = $2`,
        [str(coupon.id), customerId],
      );
      redeemed = red.length > 0;
    }
    if (!coupon || redeemed || (owner && owner !== customerId)) {
      couponError = "invalid";
    } else {
      const applied = applyOffer(
        lines,
        str(coupon.kind) === "amount" ? "amount" : "percent",
        num(coupon.value),
        str(coupon.scope),
        coupon.scope_ref == null ? null : str(coupon.scope_ref),
      );
      if (applied <= 0) couponError = "invalid";
      else {
        discount += applied;
        couponId = str(coupon.id);
      }
    }
  }
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  return { lines, adjustments, subtotal, discount, discountNote, couponError, couponId };
}

function lineFloor(line: { cost: number; margin: number }): number {
  return floorPrice(line.cost, line.margin);
}

function applyOffer(
  lines: Built["lines"],
  kind: "percent" | "amount",
  value: number,
  scope: string,
  scopeRef: string | null,
): number {
  const eligible = lines.filter((line) => {
    if (scope === "product") return line.sku === scopeRef;
    if (scope === "category") return line.categoryId === scopeRef;
    return true;
  });
  if (eligible.length === 0) return 0;
  if (kind === "percent") {
    let saved = 0;
    for (const line of eligible) {
      const next = discountPrice(line.unitPrice, "percent", value);
      const safe = Math.max(next, lineFloor(line));
      const cut = (line.unitPrice - safe) * line.qty;
      if (cut > 0) {
        line.unitPrice = safe;
        line.lineTotal = safe * line.qty;
        saved += cut;
      }
    }
    return saved;
  }
  const room = eligible.reduce(
    (sum, line) => sum + Math.max(0, line.unitPrice - lineFloor(line)) * line.qty,
    0,
  );
  const cut = Math.min(Math.max(0, value), room);
  return cut;
}

export async function quoteCart(input: {
  token: string;
  items: { sku: string; qty: number }[];
  couponCode?: string;
  lat: number;
  lng: number;
}): Promise<{ ok: true; quote: Quote } | { ok: false; error: string }> {
  const customer = await customerFromToken(input.token);
  if (!customer) return { ok: false, error: "auth" };
  const q = await db();
  const built = await buildQuote(q, customer.id, input.items, input.couponCode, false);
  const goods = Math.max(0, built.subtotal - built.discount);
  const zones = await loadZones();
  const priced = priceZone(zones, input.lat, input.lng, goods);
  const delivery = built.lines.length && priced.inZone ? priced.fee : 0;
  const quote: Quote = {
    lines: built.lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      unitPrice: line.unitPrice,
      compareAt: line.compareAt,
      lineTotal: line.lineTotal,
    })),
    adjustments: built.adjustments,
    subtotal: built.subtotal,
    delivery,
    discount: built.discount,
    total: Math.max(0, built.subtotal - built.discount + delivery),
    discountNote: built.discountNote,
    couponError: built.couponError,
    eta: etaLabel(input.lat, input.lng),
    inZone: priced.inZone,
    zoneName: priced.zone?.nome ?? null,
  };
  return { ok: true, quote };
}

class SlotClosed extends Error {
  constructor() {
    super("slot");
  }
}

class StockClash extends Error {
  adjustments: { sku: string; name: string; qty: number }[];
  constructor(adjustments: { sku: string; name: string; qty: number }[]) {
    super("stock");
    this.adjustments = adjustments;
  }
}

export async function placeOrder(input: {
  token: string;
  items: { sku: string; qty: number }[];
  couponCode?: string;
  lat: number;
  lng: number;
  label: string;
  complement: string;
  paymentMethod: "multicaixa" | "unitel_money" | "appypay" | "cash";
  slotStart: string;
  slotEnd: string;
  slotLabel: string;
}): Promise<
  | { ok: true; order: OrderSummary; simulatedPayment: boolean }
  | { ok: false; error: string; adjustments?: { sku: string; name: string; qty: number }[] }
> {
  const customer = await customerFromToken(input.token);
  if (!customer) return { ok: false, error: "auth" };
  const zones = await loadZones();
  if (!priceZone(zones, input.lat, input.lng, 0).inZone) return { ok: false, error: "zone" };
  const methods = ["multicaixa", "unitel_money", "appypay", "cash"] as const;
  if (!methods.includes(input.paymentMethod)) return { ok: false, error: "payment" };
  const label = input.label.trim().slice(0, 80) || "Luanda";
  const complement = input.complement.trim().slice(0, 180);
  try {
    const orderId = await withTx(async (q) => {
      const built = await buildQuote(q, customer.id, input.items, input.couponCode, true);
      if (built.adjustments.length) throw new StockClash(built.adjustments);
      if (built.lines.length === 0) throw new StockClash([]);
      const goods = Math.max(0, built.subtotal - built.discount);
      const priced = priceZone(zones, input.lat, input.lng, goods);
      const nums = await q(`select coalesce(max(number), 1042)::int as n from orders`);
      const number = num(nums[0]?.n) + 1;
      const id = newId();
      const delivery = priced.fee;
      const total = Math.max(0, built.subtotal - built.discount + delivery);
      const eta = etaLabel(input.lat, input.lng);
      const slot = await claimSlot(q, input.slotStart, input.slotEnd, input.slotLabel);
      if (!slot) throw new SlotClosed();
      const payStatus = input.paymentMethod === "cash" ? "due_on_delivery" : "simulated_authorized";
      await q(
        `insert into orders (
          id, number, customer_id, status, payment_method, payment_status,
          subtotal_aoa, delivery_aoa, discount_aoa, total_aoa, eta_label,
          address_label, lat, lng, complement, slot_label, slot_start, slot_end
        ) values (
          $1,$2,$3,'received',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
        )`,
        [
          id,
          number,
          customer.id,
          input.paymentMethod,
          payStatus,
          built.subtotal,
          delivery,
          built.discount,
          total,
          eta,
          label,
          input.lat,
          input.lng,
          complement,
          slot.label,
          slot.start,
          slot.end,
        ],
      );
      for (const line of built.lines) {
        await q(
          `insert into order_items (id, order_id, sku, name, qty, unit_price_aoa, compare_at_aoa, line_total_aoa)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [newId(), id, line.sku, line.name, line.qty, line.unitPrice, line.compareAt, line.lineTotal],
        );
        await q(`update products set stock = stock - $2, updated_at = now() where sku = $1`, [
          line.sku,
          line.qty,
        ]);
        await q(
          `insert into inventory_movements (id, sku, delta, reason, actor) values ($1,$2,$3,$4,$5)`,
          [newId(), line.sku, -line.qty, `order:${number}`, customer.id],
        );
        if (line.promoId) {
          await q(`update promotions set units_sold = units_sold + $2 where id = $1`, [
            line.promoId,
            line.qty,
          ]);
        }
      }
      await q(
        `insert into payments (id, order_id, provider, external_ref, status, amount_aoa)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          newId(),
          id,
          input.paymentMethod,
          input.paymentMethod === "cash" ? null : `demo-${id.slice(0, 8)}`,
          payStatus,
          total,
        ],
      );
      await q(`insert into deliveries (order_id) values ($1)`, [id]);
      await q(
        `insert into order_events (id, order_id, status, note, actor) values ($1,$2,'received',$3,$4)`,
        [newId(), id, null, customer.id],
      );
      await q(
        `insert into addresses (id, customer_id, label, lat, lng, complement) values ($1,$2,$3,$4,$5,$6)`,
        [newId(), customer.id, label, input.lat, input.lng, complement],
      );
      if (built.couponId) {
        await q(
          `insert into coupon_redemptions (id, coupon_id, customer_id, order_id) values ($1,$2,$3,$4)`,
          [newId(), built.couponId, customer.id, id],
        );
      }
      const usedDiscount = await q(
        `select id, single_use from customer_discounts
         where customer_id = $1 and used = false and starts_at <= now() and ends_at > now()
         order by created_at desc limit 1`,
        [customer.id],
      );
      if (usedDiscount[0] && (usedDiscount[0].single_use === true || str(usedDiscount[0].single_use) === "true") && built.discount > 0) {
        await q(`update customer_discounts set used = true where id = $1`, [str(usedDiscount[0].id)]);
      }
      await q(
        `insert into notifications (id, customer_id, title, body) values ($1,$2,$3,$4)`,
        [
          newId(),
          customer.id,
          "order_confirmed",
          JSON.stringify({ number, eta, total }),
        ],
      );
      await sweepPromos(q);
      return id;
    });
    await onOrderPlaced(orderId);
    const order = await loadOrder(customer.id, orderId);
    if (!order) return { ok: false, error: "missing" };
    return { ok: true, order, simulatedPayment: input.paymentMethod !== "cash" };
  } catch (err) {
    if (err instanceof StockClash) return { ok: false, error: "stock", adjustments: err.adjustments };
    if (err instanceof SlotClosed) return { ok: false, error: "slot" };
    throw err;
  }
}

function luandaNow(base = new Date()) {
  return new Date(base.getTime() + 60 * 60 * 1000 + base.getTimezoneOffset() * 60 * 1000);
}

function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function slotStamp(year: number, month: number, day: number, minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return new Date(Date.UTC(year, month - 1, day, hour - 1, minute, 0));
}

async function openSlots(q: Runner) {
  const windows = await q(
    `select label, weekday, start_min, end_min, capacity from delivery_windows where active order by start_min`,
  );
  const now = new Date();
  const local = luandaNow(now);
  const slots: { start: string; end: string; label: string; left: number }[] = [];
  for (let offset = 0; offset < 2; offset += 1) {
    const day = new Date(local);
    day.setHours(12, 0, 0, 0);
    day.setDate(local.getDate() + offset);
    const weekday = day.getDay();
    const when = offset === 0 ? "Hoje" : "Amanhã";
    for (const row of windows) {
      const wd = num(row.weekday);
      if (wd !== 7 && wd !== weekday) continue;
      const start = slotStamp(day.getFullYear(), day.getMonth() + 1, day.getDate(), num(row.start_min));
      const end = slotStamp(day.getFullYear(), day.getMonth() + 1, day.getDate(), num(row.end_min));
      if (start.getTime() < now.getTime() + 20 * 60 * 1000) continue;
      const booked = await q(
        `select count(*)::int as n from orders where slot_start = $1 and status <> 'cancelled'`,
        [start.toISOString()],
      );
      const left = num(row.capacity) - num(booked[0]?.n);
      if (left <= 0) continue;
      const range = str(row.label) || `${clock(num(row.start_min))}–${clock(num(row.end_min))}`;
      slots.push({ start: start.toISOString(), end: end.toISOString(), label: `${when}, ${range}`, left });
    }
  }
  return slots;
}

async function claimSlot(q: Runner, start: string, end: string, label: string) {
  const when = new Date(start);
  if (Number.isNaN(when.getTime())) return null;
  const open = await openSlots(q);
  const found = open.find((slot) => slot.start === when.toISOString());
  if (!found) return null;
  return { start: found.start, end: found.end || end, label: found.label || label };
}

export async function listOpenSlots(token: string) {
  const customer = await customerFromToken(token);
  if (!customer) return { ok: false as const, error: "auth" };
  const q = await db();
  await ensureDeliveryWindows(q);
  return { ok: true as const, slots: await openSlots(q) };
}

export async function listDeliveryWindows(token: string) {
  const staff = await staffFromToken(token);
  try {
    assertRole(staff, ["admin", "operator"]);
  } catch {
    return { ok: false as const, error: "forbidden" };
  }
  const q = await db();
  const rows = await q(`select id, label, weekday, start_min, end_min, capacity, active from delivery_windows order by weekday, start_min`);
  return {
    ok: true as const,
    windows: rows.map((row) => ({
      id: str(row.id),
      label: str(row.label),
      weekday: num(row.weekday),
      startMin: num(row.start_min),
      endMin: num(row.end_min),
      capacity: num(row.capacity),
      active: row.active === true || str(row.active) === "true" || str(row.active) === "t",
    })),
  };
}

export async function saveDeliveryWindow(input: {
  token: string;
  id?: string;
  label: string;
  weekday: number;
  startMin: number;
  endMin: number;
  capacity: number;
  active: boolean;
}) {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin", "operator"]);
  } catch {
    return { ok: false as const, error: "forbidden" };
  }
  const weekday = Math.round(input.weekday);
  const startMin = Math.round(input.startMin);
  const endMin = Math.round(input.endMin);
  const capacity = Math.round(input.capacity);
  if (weekday < 0 || weekday > 7 || startMin < 0 || endMin > 24 * 60 || endMin <= startMin || capacity < 1 || capacity > 200) {
    return { ok: false as const, error: "window" };
  }
  const q = await db();
  const id = input.id || newId();
  const label = input.label.trim().slice(0, 40) || `${clock(startMin)}–${clock(endMin)}`;
  await q(
    `insert into delivery_windows (id, label, weekday, start_min, end_min, capacity, active)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do update set
       label = excluded.label,
       weekday = excluded.weekday,
       start_min = excluded.start_min,
       end_min = excluded.end_min,
       capacity = excluded.capacity,
       active = excluded.active`,
    [id, label, weekday, startMin, endMin, capacity, input.active],
  );
  await audit(q, staff!.email, "delivery_window", "delivery_windows", id, null, { label, weekday, startMin, endMin, capacity });
  return { ok: true as const };
}

export async function deleteDeliveryWindow(token: string, id: string) {
  const staff = await staffFromToken(token);
  try {
    assertRole(staff, ["admin", "operator"]);
  } catch {
    return { ok: false as const, error: "forbidden" };
  }
  const q = await db();
  await q(`delete from delivery_windows where id = $1`, [id]);
  await audit(q, staff!.email, "delivery_window_delete", "delivery_windows", id, null, {});
  return { ok: true as const };
}

const STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "com", "para", "sem", "pack", "unidade", "unidades"]);
let dictionaryCache: string[] | null = null;

export async function searchDictionary() {
  if (!dictionaryCache) {
    const q = await db();
    const rows = await q(`select name from products where active`);
    const words = new Set<string>();
    for (const row of rows) {
      for (const part of str(row.name).split(/[^A-Za-zÀ-ÿ0-9]+/)) {
        const clean = part.trim();
        if (clean.length < 3 || /^\d+$/.test(clean) || STOP_WORDS.has(clean.toLowerCase())) continue;
        words.add(clean);
      }
    }
    dictionaryCache = [...words].sort((a, b) => a.localeCompare(b, "pt"));
  }
  return { ok: true as const, words: dictionaryCache };
}

export async function submitFeedback(input: {
  kind: "complaint" | "suggestion";
  orderRef: string;
  name: string;
  phone: string;
  body: string;
}) {
  const name = input.name.trim().slice(0, 80);
  const body = input.body.trim().slice(0, 1200);
  const phone = normalizePhone(input.phone);
  if ((input.kind !== "complaint" && input.kind !== "suggestion") || !name || !phone || body.length < 5) {
    return { ok: false as const, error: "fields" };
  }
  const q = await db();
  await q(
    `insert into feedback (id, kind, order_ref, name, phone, body) values ($1, $2, $3, $4, $5, $6)`,
    [newId(), input.kind, input.orderRef.trim().slice(0, 40), name, phone, body],
  );
  return { ok: true as const };
}

export async function listFeedback(token: string) {
  const staff = await staffFromToken(token);
  try {
    assertRole(staff, ["admin", "operator"]);
  } catch {
    return { ok: false as const, error: "forbidden" };
  }
  const q = await db();
  const rows = await q(
    `select id, kind, order_ref, name, phone, body, created_at from feedback order by created_at desc limit 80`,
  );
  return {
    ok: true as const,
    items: rows.map((row) => ({
      id: str(row.id),
      kind: str(row.kind),
      orderRef: str(row.order_ref),
      name: str(row.name),
      phone: str(row.phone),
      body: str(row.body),
      createdAt: str(row.created_at),
    })),
  };
}

async function loadOrder(customerId: string, orderId: string): Promise<OrderSummary | null> {
  const q = await db();
  const rows = await q(
    `select o.*, d.courier_name
     from orders o
     left join deliveries d on d.order_id = o.id
     where o.id = $1 and o.customer_id = $2`,
    [orderId, customerId],
  );
  const row = rows[0];
  if (!row) return null;
  return hydrateOrder(q, row);
}

async function hydrateOrder(q: Runner, row: Row): Promise<OrderSummary> {
  const items = await q(
    `select sku, name, qty, unit_price_aoa, line_total_aoa from order_items where order_id = $1`,
    [str(row.id)],
  );
  const events = await q(
    `select status, note, created_at::text as created_at from order_events where order_id = $1 order by created_at`,
    [str(row.id)],
  );
  return {
    id: str(row.id),
    number: num(row.number),
    status: str(row.status),
    paymentMethod: str(row.payment_method),
    paymentStatus: str(row.payment_status),
    totalAoa: num(row.total_aoa),
    etaLabel: str(row.eta_label),
    addressLabel: str(row.address_label),
    lat: num(row.lat),
    lng: num(row.lng),
    complement: str(row.complement),
    cancelReason: row.cancel_reason == null ? null : str(row.cancel_reason),
    createdAt: str(row.created_at),
    items: items.map((item) => ({
      sku: str(item.sku),
      name: str(item.name),
      qty: num(item.qty),
      unitPrice: num(item.unit_price_aoa),
      lineTotal: num(item.line_total_aoa),
    })),
    events: events.map((event) => ({
      status: str(event.status),
      note: event.note == null ? null : str(event.note),
      createdAt: str(event.created_at),
    })),
    courierName: row.courier_name == null ? null : str(row.courier_name),
    delivery: await publicTrack(str(row.id)),
  };
}

export async function listOrders(token: string): Promise<
  | { ok: true; orders: OrderSummary[] }
  | { ok: false; error: string }
> {
  const customer = await customerFromToken(token);
  if (!customer) return { ok: false, error: "auth" };
  await tickCustomer(customer.id);
  const q = await db();
  const rows = await q(
    `select o.*, d.courier_name
     from orders o left join deliveries d on d.order_id = o.id
     where o.customer_id = $1
     order by o.created_at desc
     limit 30`,
    [customer.id],
  );
  const orders: OrderSummary[] = [];
  for (const row of rows) orders.push(await hydrateOrder(q, row));
  return { ok: true, orders };
}

export async function getOrder(
  token: string,
  orderId: string,
): Promise<{ ok: true; order: OrderSummary } | { ok: false; error: string }> {
  const customer = await customerFromToken(token);
  if (!customer) return { ok: false, error: "auth" };
  await tickOrder(orderId);
  const order = await loadOrder(customer.id, orderId);
  if (!order) return { ok: false, error: "missing" };
  return { ok: true, order };
}

export async function bestsellers(token: string): Promise<
  | { ok: true; products: ProductCard[] }
  | { ok: false; error: string }
> {
  const customer = token ? await customerFromToken(token) : null;
  const q = await db();
  const rows = await q(
    `select p.*, c.name as category_name, s.name as subcategory_name, sum(oi.qty)::int as sold
     from order_items oi
     join orders o on o.id = oi.order_id
     join products p on p.sku = oi.sku
     join categories c on c.id = p.category_id
     join subcategories s on s.id = p.subcategory_id
     where o.status <> 'cancelled' and o.created_at > now() - interval '7 days'
     group by p.sku, c.name, s.name
     having sum(oi.qty) >= 3
     order by sold desc
     limit 8`,
  );
  return { ok: true, products: await mapProducts(rows, customer?.id ?? null) };
}

export async function listNotices(token: string): Promise<
  | { ok: true; notices: Notice[] }
  | { ok: false; error: string }
> {
  const customer = await customerFromToken(token);
  if (!customer) return { ok: false, error: "auth" };
  const q = await db();
  const rows = await q(
    `select id, title, body, created_at::text as created_at
     from notifications where customer_id = $1
     order by created_at desc limit 20`,
    [customer.id],
  );
  return {
    ok: true,
    notices: rows.map((r) => ({
      id: str(r.id),
      title: str(r.title),
      body: str(r.body),
      createdAt: str(r.created_at),
    })),
  };
}

export async function staffLogin(input: {
  email: string;
  password: string;
}): Promise<
  | { ok: true; challengeId: string; demoCode: string }
  | { ok: false; error: string }
> {
  await ensureSeeded();
  const email = input.email.trim().toLowerCase();
  const q = await db();
  const rows = await q(
    `select id, password_hash, failed_attempts, locked_until::text as locked_until
     from staff_users where email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "login" };
  if (row.locked_until && new Date(str(row.locked_until)).getTime() > Date.now()) {
    return { ok: false, error: "locked" };
  }
  if (!verifyPassword(input.password, str(row.password_hash))) {
    const attempts = num(row.failed_attempts) + 1;
    await q(
      `update staff_users set failed_attempts = $2, locked_until = $3 where id = $1`,
      [str(row.id), attempts, attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null],
    );
    return { ok: false, error: attempts >= 5 ? "locked" : "login" };
  }
  await q(`update staff_users set failed_attempts = 0, locked_until = null where id = $1`, [str(row.id)]);
  await q(`update staff_challenges set used = true where staff_id = $1 and used = false`, [str(row.id)]);
  const code = sixDigits();
  const challengeId = newId();
  await q(
    `insert into staff_challenges (id, staff_id, code_hash, expires_at) values ($1,$2,$3, now() + interval '5 minutes')`,
    [challengeId, str(row.id), hashCode(code)],
  );
  return { ok: true, challengeId, demoCode: code };
}

export async function staffVerify(input: {
  challengeId: string;
  code: string;
}): Promise<{ ok: true; token: string; staff: Staff } | { ok: false; error: string }> {
  const q = await db();
  const rows = await q(
    `select c.staff_id, c.code_hash, u.email, u.name, u.role
     from staff_challenges c
     join staff_users u on u.id = c.staff_id
     where c.id = $1 and c.used = false and c.expires_at > now()`,
    [input.challengeId],
  );
  const row = rows[0];
  if (!row || hashCode(input.code.replace(/\D/g, "")) !== str(row.code_hash)) {
    return { ok: false, error: "code" };
  }
  await q(`update staff_challenges set used = true where id = $1`, [input.challengeId]);
  const token = randomBytes(32).toString("hex");
  await q(
    `insert into staff_sessions (token_hash, staff_id, expires_at) values ($1,$2, now() + interval '12 hours')`,
    [sha256(token), str(row.staff_id)],
  );
  await audit(q, str(row.email), "staff_login", "staff_users", str(row.staff_id), null, { role: str(row.role) });
  return {
    ok: true,
    token,
    staff: {
      id: str(row.staff_id),
      email: str(row.email),
      name: str(row.name),
      role: str(row.role) as StaffRole,
    },
  };
}

export async function staffMe(token: string): Promise<{ staff: Staff | null }> {
  await ensureSeeded();
  return { staff: await staffFromToken(token) };
}

export async function staffLogout(token: string): Promise<{ ok: true }> {
  const q = await db();
  if (token) await q(`delete from staff_sessions where token_hash = $1`, [sha256(token)]);
  return { ok: true };
}

function adminProduct(row: Row): AdminProduct {
  const cost = nullableNum(row.cost_aoa);
  const margin = num(row.min_margin_pct) || 15;
  const avg = num(row.avg_daily);
  const stock = num(row.stock);
  return {
    sku: str(row.sku),
    name: str(row.name),
    brand: str(row.brand),
    format: str(row.format),
    categoryName: str(row.category_name),
    subcategoryName: str(row.subcategory_name),
    priority: str(row.priority),
    stock,
    priceAoa: nullableNum(row.price_aoa),
    costAoa: cost,
    minMarginPct: margin,
    floorAoa: cost == null ? null : floorPrice(cost, margin),
    expiry: dateOnly(row.expiry_date),
    avgDaily: avg,
    active: row.active !== false && str(row.active) !== "false",
    coverageDays: avg > 0 ? Math.round((stock / avg) * 10) / 10 : null,
  };
}

export async function adminProducts(input: {
  token: string;
  q?: string;
  offset?: number;
}): Promise<{ ok: true; products: AdminProduct[]; total: number } | { ok: false; error: string }> {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin", "stock_manager", "finance", "operator"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  await ensureSeeded();
  const q = await db();
  const params: unknown[] = [];
  const where: string[] = ["true"];
  const query = (input.q ?? "").trim().toLowerCase();
  if (query) {
    params.push(`%${query}%`);
    where.push(
      `(lower(p.name) like $1 or lower(p.sku) like $1 or lower(p.brand) like $1 or lower(c.name) like $1)`,
    );
  }
  const offset = Math.max(0, input.offset ?? 0);
  params.push(40, offset);
  const rows = await q(
    `${PRODUCT_SELECT}
     where ${where.join(" and ")}
     order by p.sku
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const countParams = params.slice(0, params.length - 2);
  const totalRows = await q(
    `select count(*)::int as n from products p join categories c on c.id = p.category_id where ${where.join(" and ")}`,
    countParams,
  );
  return { ok: true, products: rows.map(adminProduct), total: num(totalRows[0]?.n) };
}

export async function updateStock(input: {
  token: string;
  sku: string;
  stock: number;
  reason: string;
}): Promise<{ ok: true; product: AdminProduct } | { ok: false; error: string }> {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin", "stock_manager"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const stock = Math.floor(input.stock);
  const reason = input.reason.trim();
  if (!Number.isFinite(stock) || stock < 0 || stock > 100000) return { ok: false, error: "stock" };
  if (reason.length < 3) return { ok: false, error: "reason" };
  const q = await db();
  const beforeRows = await q(`${PRODUCT_SELECT} where p.sku = $1`, [input.sku]);
  const before = beforeRows[0];
  if (!before) return { ok: false, error: "missing" };
  const prev = num(before.stock);
  await q(`update products set stock = $2, updated_at = now() where sku = $1`, [input.sku, stock]);
  await q(
    `insert into inventory_movements (id, sku, delta, reason, actor) values ($1,$2,$3,$4,$5)`,
    [newId(), input.sku, stock - prev, reason, staff!.email],
  );
  await audit(q, staff!.email, "stock_update", "products", input.sku, { stock: prev }, { stock, reason });
  if (prev <= 0 && stock > 0) {
    const alerts = await q(`select customer_id from restock_alerts where sku = $1`, [input.sku]);
    for (const alert of alerts) {
      await q(
        `insert into notifications (id, customer_id, title, body) values ($1,$2,'restock',$3)`,
        [newId(), str(alert.customer_id), JSON.stringify({ sku: input.sku, name: str(before.name) })],
      );
    }
    await q(`delete from restock_alerts where sku = $1`, [input.sku]);
  }
  const after = await q(`${PRODUCT_SELECT} where p.sku = $1`, [input.sku]);
  return { ok: true, product: adminProduct(after[0]) };
}

export async function updatePrice(input: {
  token: string;
  sku: string;
  priceAoa: number;
  costAoa: number;
  minMarginPct: number;
}): Promise<{ ok: true; product: AdminProduct } | { ok: false; error: string; floor?: number }> {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin", "finance"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const price = Math.round(input.priceAoa);
  const cost = Math.round(input.costAoa);
  const margin = Math.round(input.minMarginPct);
  if (margin < 0 || margin > 80) return { ok: false, error: "margin" };
  if (!withinMargin(price, cost, margin)) {
    return { ok: false, error: "margin", floor: floorPrice(cost, margin) };
  }
  const q = await db();
  const beforeRows = await q(`select price_aoa, cost_aoa, min_margin_pct from products where sku = $1`, [
    input.sku,
  ]);
  if (!beforeRows[0]) return { ok: false, error: "missing" };
  await q(
    `update products set price_aoa = $2, cost_aoa = $3, min_margin_pct = $4, updated_at = now() where sku = $1`,
    [input.sku, price, cost, margin],
  );
  await audit(
    q,
    staff!.email,
    "price_update",
    "products",
    input.sku,
    beforeRows[0],
    { priceAoa: price, costAoa: cost, minMarginPct: margin },
  );
  const after = await q(`${PRODUCT_SELECT} where p.sku = $1`, [input.sku]);
  return { ok: true, product: adminProduct(after[0]) };
}

export async function adminOrders(token: string): Promise<
  | { ok: true; orders: OrderSummary[] }
  | { ok: false; error: string }
> {
  const staff = await staffFromToken(token);
  try {
    assertRole(staff, ["admin", "operator"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const q = await db();
  const rows = await q(
    `select o.*, d.courier_name from orders o
     left join deliveries d on d.order_id = o.id
     order by o.created_at desc limit 40`,
  );
  const orders: OrderSummary[] = [];
  for (const row of rows) orders.push(await hydrateOrder(q, row));
  return { ok: true, orders };
}

const NEXT: Record<string, string> = {
  received: "preparing",
  preparing: "on_the_way",
  on_the_way: "delivered",
};

export async function advanceOrder(input: {
  token: string;
  orderId: string;
  courierName?: string;
  cashReceived?: number;
  cancelReason?: string;
  cancel?: boolean;
}): Promise<{ ok: true; order: OrderSummary } | { ok: false; error: string }> {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin", "operator"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const q = await db();
  const rows = await q(`select * from orders where id = $1`, [input.orderId]);
  const row = rows[0];
  if (!row) return { ok: false, error: "missing" };
  const status = str(row.status);
  if (status === "delivered" || status === "cancelled") return { ok: false, error: "status" };
  if (input.cancel) {
    const reason = (input.cancelReason ?? "").trim();
    if (reason.length < 3) return { ok: false, error: "reason" };
  } else if (status === "on_the_way" && str(row.payment_method) === "cash") {
    const received = Math.round(input.cashReceived ?? 0);
    if (received < num(row.total_aoa)) return { ok: false, error: "cash" };
  } else if (!NEXT[status]) {
    return { ok: false, error: "status" };
  }
  let next = NEXT[status];
  let note: string | null = null;
  if (input.cancel) {
    const reason = (input.cancelReason ?? "").trim();
    next = "cancelled";
    note = reason;
    await q(`update orders set status = 'cancelled', cancel_reason = $2, updated_at = now() where id = $1`, [
      input.orderId,
      reason,
    ]);
    const items = await q(`select sku, qty from order_items where order_id = $1`, [input.orderId]);
    for (const item of items) {
      await q(`update products set stock = stock + $2, updated_at = now() where sku = $1`, [
        str(item.sku),
        num(item.qty),
      ]);
      await q(
        `insert into inventory_movements (id, sku, delta, reason, actor) values ($1,$2,$3,$4,$5)`,
        [newId(), str(item.sku), num(item.qty), `cancel:${str(row.number)}`, staff!.email],
      );
    }
  } else {
    if (!next) return { ok: false, error: "status" };
    await q(`update orders set status = $2, updated_at = now() where id = $1`, [input.orderId, next]);
    if (input.courierName && next === "on_the_way") {
      await q(`update deliveries set courier_name = $2 where order_id = $1`, [
        input.orderId,
        input.courierName.trim().slice(0, 80),
      ]);
      note = input.courierName.trim();
    }
    if (next === "delivered" && str(row.payment_method) === "cash") {
      const received = Math.round(input.cashReceived ?? 0);
      const total = num(row.total_aoa);
      await q(
        `update deliveries set cash_received_aoa = $2, change_aoa = $3, confirmed_at = now() where order_id = $1`,
        [input.orderId, received, received - total],
      );
      await q(`update payments set status = 'cash_received' where order_id = $1`, [input.orderId]);
      await q(`update orders set payment_status = 'cash_received' where id = $1`, [input.orderId]);
    }
    if (next === "delivered" && str(row.payment_method) !== "cash") {
      await q(`update deliveries set confirmed_at = now() where order_id = $1`, [input.orderId]);
    }
  }
  await q(
    `insert into order_events (id, order_id, status, note, actor) values ($1,$2,$3,$4,$5)`,
    [newId(), input.orderId, next, note, staff!.email],
  );
  await audit(q, staff!.email, "order_status", "orders", input.orderId, { status }, { status: next, note });
  await q(
    `insert into notifications (id, customer_id, title, body) values ($1,$2,'order_status',$3)`,
    [newId(), str(row.customer_id), JSON.stringify({ number: num(row.number), status: next, eta: str(row.eta_label) })],
  );
  await syncOrderStatus(input.orderId, next, input.courierName);
  const updated = await q(
    `select o.*, d.courier_name from orders o left join deliveries d on d.order_id = o.id where o.id = $1`,
    [input.orderId],
  );
  return { ok: true, order: await hydrateOrder(q, updated[0]) };
}

export async function suggestions(token: string): Promise<
  | { ok: true; suggestions: PromoSuggestion[]; auto: boolean }
  | { ok: false; error: string }
> {
  const staff = await staffFromToken(token);
  try {
    assertRole(staff, ["admin", "stock_manager", "finance"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const q = await db();
  await sweepPromos(q);
  const rows = await q(
    `select p.sku, p.name, p.stock, p.price_aoa, p.cost_aoa, p.min_margin_pct, p.avg_daily, p.expiry_date
     from products p
     where p.active and p.price_aoa is not null and p.cost_aoa is not null and p.stock > 0
       and not exists (
         select 1 from promotions pr
         where pr.sku = p.sku and pr.status in ('active', 'suggested')
       )`,
  );
  const today = new Date("2026-11-17T12:00:00Z").getTime();
  const list: PromoSuggestion[] = [];
  for (const row of rows) {
    const stock = num(row.stock);
    const avg = num(row.avg_daily);
    const coverage = avg > 0 ? stock / avg : null;
    const expiry = dateOnly(row.expiry_date);
    const expiryMs = expiry ? new Date(`${expiry}T00:00:00Z`).getTime() : null;
    const daysLeft = expiryMs == null ? null : Math.round((expiryMs - today) / 86_400_000);
    let origin: PromoSuggestion["origin"] | null = null;
    let suggestedPercent = 0;
    if (daysLeft != null && daysLeft <= 7) {
      origin = "near_expiry";
      suggestedPercent = 30;
    } else if (coverage != null && coverage >= 60) {
      origin = "overstock";
      suggestedPercent = 15;
    }
    if (!origin) continue;
    const price = num(row.price_aoa);
    const cost = num(row.cost_aoa);
    const margin = num(row.min_margin_pct) || 15;
    const next = discountPrice(price, "percent", suggestedPercent);
    list.push({
      sku: str(row.sku),
      name: str(row.name),
      stock,
      origin,
      suggestedPercent,
      coverageDays: coverage == null ? null : Math.round(coverage * 10) / 10,
      expiry,
      priceAoa: price,
      floorAoa: floorPrice(cost, margin),
      viable: withinMargin(next, cost, margin),
    });
  }
  const autoRow = await q(`select value from app_meta where key = 'auto_promos'`);
  const auto = str(autoRow[0]?.value) === "on";
  if (auto && staff!.role === "admin") {
    for (const item of list.filter((s) => s.viable)) {
      await activatePromoRow(q, staff!, item.sku, item.suggestedPercent, item.origin);
    }
  }
  const visible = auto && staff!.role === "admin" ? list.filter((s) => !s.viable) : list;
  return { ok: true, suggestions: visible.slice(0, 40), auto };
}

async function activatePromoRow(
  q: Runner,
  staff: Staff,
  sku: string,
  percent: number,
  origin: string,
): Promise<{ ok: true } | { ok: false; error: string; floor?: number }> {
  const rows = await q(
    `select price_aoa, cost_aoa, min_margin_pct, stock from products where sku = $1`,
    [sku],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "missing" };
  const price = num(row.price_aoa);
  const cost = num(row.cost_aoa);
  const margin = num(row.min_margin_pct) || 15;
  const next = discountPrice(price, "percent", percent);
  if (!withinMargin(next, cost, margin)) {
    return { ok: false, error: "margin", floor: floorPrice(cost, margin) };
  }
  const stock = num(row.stock);
  await q(
    `insert into promotions (
      id, sku, kind, value, starts_at, ends_at, unit_limit, min_stock_cutoff, origin, status, created_by
    ) values ($1,$2,'percent',$3, now(), now() + interval '7 days', $4, $5, $6, 'active', $7)`,
    [newId(), sku, percent, Math.max(stock, 1), Math.min(4, stock), origin, staff.email],
  );
  await audit(q, staff.email, "promo_activate", "promotions", sku, null, { percent, origin });
  return { ok: true };
}

export async function activatePromo(input: {
  token: string;
  sku: string;
  percent: number;
  origin: "overstock" | "near_expiry" | "manual";
}): Promise<{ ok: true } | { ok: false; error: string; floor?: number }> {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin", "finance"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const percent = Math.round(input.percent);
  if (percent < 1 || percent > 70) return { ok: false, error: "percent" };
  const q = await db();
  return activatePromoRow(q, staff!, input.sku, percent, input.origin);
}

export async function setAutoPromos(input: {
  token: string;
  on: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const q = await db();
  await q(
    `insert into app_meta (key, value) values ('auto_promos', $1)
     on conflict (key) do update set value = excluded.value`,
    [input.on ? "on" : "off"],
  );
  await audit(q, staff!.email, "auto_promos", "app_meta", "auto_promos", null, { on: input.on });
  return { ok: true };
}

export async function createDiscount(input: {
  token: string;
  phone: string;
  kind: "percent" | "amount";
  value: number;
  scope: "order" | "category" | "product";
  scopeRef?: string;
  singleUse: boolean;
  days: number;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string; floor?: number }> {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin", "finance"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "phone" };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "reason" };
  const q = await db();
  const customers = await q(`select id from customers where phone = $1 and deleted_at is null`, [phone]);
  if (!customers[0]) return { ok: false, error: "customer" };
  const value = Math.round(input.value);
  if (input.kind === "percent" && (value < 1 || value > 70)) return { ok: false, error: "value" };
  if (input.kind === "amount" && (value < 50 || value > 100000)) return { ok: false, error: "value" };
  if (input.scope !== "order") {
    const ref = (input.scopeRef ?? "").trim();
    if (!ref) return { ok: false, error: "scope" };
    if (input.scope === "product" && input.kind === "percent") {
      const rows = await q(`select price_aoa, cost_aoa, min_margin_pct from products where sku = $1`, [ref]);
      const row = rows[0];
      if (!row) return { ok: false, error: "missing" };
      const next = discountPrice(num(row.price_aoa), "percent", value);
      if (!withinMargin(next, num(row.cost_aoa), num(row.min_margin_pct) || 15)) {
        return { ok: false, error: "margin", floor: floorPrice(num(row.cost_aoa), num(row.min_margin_pct) || 15) };
      }
    }
  }
  const days = Math.min(90, Math.max(1, Math.round(input.days)));
  await q(
    `insert into customer_discounts (
      id, customer_id, kind, value, scope, scope_ref, single_use, starts_at, ends_at, reason, created_by
    ) values ($1,$2,$3,$4,$5,$6,$7, now(), now() + ($8 || ' days')::interval, $9, $10)`,
    [
      newId(),
      str(customers[0].id),
      input.kind,
      value,
      input.scope,
      input.scope === "order" ? null : (input.scopeRef ?? "").trim(),
      input.singleUse,
      String(days),
      reason,
      staff!.email,
    ],
  );
  await audit(q, staff!.email, "customer_discount", "customers", str(customers[0].id), null, {
    phone,
    kind: input.kind,
    value,
    scope: input.scope,
    reason,
  });
  return { ok: true };
}

export async function createCoupon(input: {
  token: string;
  code: string;
  phone?: string;
  kind: "percent" | "amount";
  value: number;
  days: number;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await staffFromToken(input.token);
  try {
    assertRole(staff, ["admin", "finance"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,16}$/.test(code)) return { ok: false, error: "code" };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "reason" };
  let customerId: string | null = null;
  const q = await db();
  if (input.phone && input.phone.trim()) {
    const phone = normalizePhone(input.phone);
    if (!phone) return { ok: false, error: "phone" };
    const customers = await q(`select id from customers where phone = $1 and deleted_at is null`, [phone]);
    if (!customers[0]) return { ok: false, error: "customer" };
    customerId = str(customers[0].id);
  }
  const value = Math.round(input.value);
  if (input.kind === "percent" && (value < 1 || value > 40)) return { ok: false, error: "value" };
  const days = Math.min(90, Math.max(1, Math.round(input.days)));
  try {
    await q(
      `insert into coupons (id, code, customer_id, kind, value, scope, single_use, starts_at, ends_at, reason, created_by)
       values ($1,$2,$3,$4,$5,'order', true, now(), now() + ($6 || ' days')::interval, $7, $8)`,
      [newId(), code, customerId, input.kind, value, String(days), reason, staff!.email],
    );
  } catch {
    return { ok: false, error: "code" };
  }
  await audit(q, staff!.email, "coupon_create", "coupons", code, null, { value, kind: input.kind, reason });
  return { ok: true };
}

export async function listAudit(token: string): Promise<
  | { ok: true; rows: AuditRow[] }
  | { ok: false; error: string }
> {
  const staff = await staffFromToken(token);
  try {
    assertRole(staff, ["admin", "finance"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const q = await db();
  const rows = await q(
    `select id, actor, action, entity, entity_id, created_at::text as created_at
     from audit_logs order by created_at desc limit 40`,
  );
  return {
    ok: true,
    rows: rows.map((r) => ({
      id: str(r.id),
      actor: str(r.actor),
      action: str(r.action),
      entity: str(r.entity),
      entityId: str(r.entity_id),
      createdAt: str(r.created_at),
    })),
  };
}

export async function report(token: string): Promise<
  | {
      ok: true;
      orders: number;
      revenue: number;
      margin: number;
      stockouts: number;
      top: { name: string; qty: number }[];
    }
  | { ok: false; error: string }
> {
  const staff = await staffFromToken(token);
  try {
    assertRole(staff, ["admin", "finance", "stock_manager", "operator"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const q = await db();
  const sales = await q(
    `select count(*)::int as n, coalesce(sum(total_aoa),0)::int as revenue
     from orders where status <> 'cancelled'`,
  );
  const margin = await q(
    `select coalesce(sum((oi.unit_price_aoa - p.cost_aoa) * oi.qty), 0)::int as m
     from order_items oi
     join orders o on o.id = oi.order_id
     join products p on p.sku = oi.sku
     where o.status <> 'cancelled' and p.cost_aoa is not null`,
  );
  const outs = await q(`select count(*)::int as n from products where active and stock <= 0`);
  const top = await q(
    `select oi.name, sum(oi.qty)::int as qty
     from order_items oi join orders o on o.id = oi.order_id
     where o.status <> 'cancelled'
     group by oi.name order by qty desc limit 5`,
  );
  return {
    ok: true,
    orders: num(sales[0]?.n),
    revenue: num(sales[0]?.revenue),
    margin: num(margin[0]?.m),
    stockouts: num(outs[0]?.n),
    top: top.map((r) => ({ name: str(r.name), qty: num(r.qty) })),
  };
}
