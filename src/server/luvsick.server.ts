import { randomBytes, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";
import { PRODUCTS, SIZES, formatAmount, quote, type Market } from "@/lib/luvsick";

const START_QTY = 5;
const DESK_CODE = process.env.LUVSICK_DESK_CODE?.trim() || "LuvSick-1847";

type Need = { productId: string; size: string; qty: number };

export type StockRow = { productId: string; size: string; qty: number };
export type DeskOrder = {
  id: string;
  ref: string;
  createdAt: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postal: string;
  market: string;
  pay: string;
  totalLabel: string;
  coupon: string;
  lines: Need[];
  seen: boolean;
  paidAt: string;
  nif: string;
  receiptNo: string;
};

function allowed(code: string) {
  const a = Buffer.from(code);
  const b = Buffer.from(DESK_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ensureReservationTables(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql.query(
    `create table if not exists luv_reservations (
      id text primary key,
      ref text not null,
      created_at timestamptz not null default now(),
      customer_name text not null,
      phone text not null,
      email text not null,
      lines text not null,
      received_sent boolean not null default false,
      stock_sent boolean not null default false
    )`,
  );
  await sql.query(`create table if not exists luv_flags (key text primary key, value text not null)`);
  await sql.query(`insert into luv_flags (key, value) values ('stock_in', '0') on conflict (key) do nothing`);
}

async function ensureStock() {
  const sql = await getSql();
  await ensureReservationTables(sql);
  for (const product of PRODUCTS) {
    for (const size of SIZES) {
      await sql.query(
        `insert into luv_stock (product_id, size, qty) values ($1, $2, $3) on conflict (product_id, size) do nothing`,
        [product.id, size, START_QTY],
      );
    }
  }
  return sql;
}

export async function luvStock(): Promise<StockRow[]> {
  const sql = await ensureStock();
  const rows = await sql.query<{ product_id: string; size: string; qty: number }>(
    `select product_id, size, qty from luv_stock order by product_id, size`,
  );
  return rows.map((row) => ({ productId: row.product_id, size: row.size, qty: Number(row.qty) }));
}

function postalOk(country: string, postal: string) {
  const value = postal.trim();
  if (country === "PT") return /^\d{4}-\d{3}$/.test(value);
  return value.length >= 3 && value.length <= 10;
}

export async function luvPlace(input: {
  lines: Need[];
  name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postal: string;
  market: string;
  pay: string;
  coupon: string;
}) {
  const lines = input.lines.filter((line) => line.qty > 0 && SIZES.includes(line.size as (typeof SIZES)[number]) && PRODUCTS.some((item) => item.id === line.productId));
  const country = input.country === "AO" || input.country === "PT" ? input.country : "";
  if (!lines.length || !input.name.trim() || !input.phone.trim() || !country || !postalOk(country, input.postal)) {
    return { ok: false as const, error: "form" as const };
  }
  const market: Market = country;
  const sql = await ensureStock();
  const asked = input.coupon.trim().toUpperCase();
  let percent = 0;
  if (asked) {
    const found = await sql.query<{ percent: number }>(`select percent from luv_coupons where code = $1 and active`, [asked]);
    if (!found.length) return { ok: false as const, error: "coupon" as const };
    percent = Number(found[0].percent);
  }
  const priced = quote(lines, market, percent);
  const ref = `LS-${randomBytes(2).toString("hex").toUpperCase()}`;
  const id = randomBytes(8).toString("hex");
  const placed = await sql.query<{ ref: string }>(
    `with need as (
       select product_id, size, qty from jsonb_to_recordset($1::jsonb) as x(product_id text, size text, qty int)
     ),
     gate as (
       select (count(*) = (select count(*) from need) and bool_and(s.qty >= n.qty)) as good
       from need n
       join luv_stock s on s.product_id = n.product_id and s.size = n.size
     ),
     upd as (
       update luv_stock s
       set qty = s.qty - n.qty
       from need n, gate g
       where g.good and s.product_id = n.product_id and s.size = n.size
       returning 1
     ),
     ins as (
       insert into luv_orders (id, ref, customer_name, phone, address, city, country, postal, market, pay, total_label, lines, coupon)
       select $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       from gate where good
       returning ref
     )
     select ref from ins`,
    [
      JSON.stringify(lines.map((line) => ({ product_id: line.productId, size: line.size, qty: line.qty }))),
      id,
      ref,
      input.name.trim(),
      input.phone.trim(),
      input.address.trim(),
      input.city.trim(),
      country,
      input.postal.trim(),
      market,
      input.pay,
      formatAmount(priced.total, market),
      JSON.stringify(lines),
      asked,
    ],
  );
  if (!placed.length) return { ok: false as const, error: "stock" as const };
  return { ok: true as const, ref: placed[0].ref, totalLabel: formatAmount(priced.total, market) };
}

function mapOrder(row: Record<string, unknown>): DeskOrder {
  let lines: Need[] = [];
  try {
    const parsed = JSON.parse(String(row.lines));
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    lines = [];
  }
  return {
    id: String(row.id),
    ref: String(row.ref),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    name: String(row.customer_name),
    phone: String(row.phone),
    address: String(row.address),
    city: String(row.city),
    country: String(row.country ?? ""),
    postal: String(row.postal ?? ""),
    market: String(row.market),
    pay: String(row.pay),
    totalLabel: String(row.total_label),
    coupon: String(row.coupon ?? ""),
    lines,
    seen: Boolean(row.seen),
    paidAt: row.paid_at ? (row.paid_at instanceof Date ? row.paid_at.toISOString() : String(row.paid_at)) : "",
    nif: String(row.nif ?? ""),
    receiptNo: String(row.receipt_no ?? ""),
  };
}

export async function luvDesk(code: string) {
  if (!allowed(code)) return { ok: false as const };
  const sql = await ensureStock();
  const stock = await luvStock();
  const orders = await sql.query(`select * from luv_orders order by created_at desc limit 40`);
  const visits = await luvVisitReport();
  const coupons = await sql.query<{ code: string; percent: number; active: boolean }>(
    `select code, percent, active from luv_coupons order by created_at desc`,
  );
  const reservations = await sql.query(`select * from luv_reservations order by created_at desc limit 200`);
  const flag = await sql.query<{ value: string }>(`select value from luv_flags where key = 'stock_in'`);
  return {
    ok: true as const,
    stock,
    orders: orders.map(mapOrder),
    visits,
    coupons: coupons.map((row) => ({ code: row.code, percent: Number(row.percent), active: Boolean(row.active) })),
    reservations: reservations.map(mapReservation),
    stockIn: flag[0]?.value === "1",
  };
}

export type DeskReservation = {
  id: string;
  ref: string;
  createdAt: string;
  name: string;
  phone: string;
  email: string;
  lines: Need[];
  receivedSent: boolean;
  stockSent: boolean;
};

function mapReservation(row: Record<string, unknown>): DeskReservation {
  let lines: Need[] = [];
  try {
    const parsed = JSON.parse(String(row.lines));
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    lines = [];
  }
  return {
    id: String(row.id),
    ref: String(row.ref),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    name: String(row.customer_name),
    phone: String(row.phone),
    email: String(row.email),
    lines,
    receivedSent: Boolean(row.received_sent),
    stockSent: Boolean(row.stock_sent),
  };
}

function emailOk(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function luvMode() {
  const sql = await ensureStock();
  const flag = await sql.query<{ value: string }>(`select value from luv_flags where key = 'stock_in'`);
  return { stockIn: flag[0]?.value === "1" };
}

export async function luvReserve(input: { name: string; phone: string; email: string; lines: Need[] }) {
  const lines = input.lines.filter((line) => line.qty > 0 && SIZES.includes(line.size as (typeof SIZES)[number]) && PRODUCTS.some((item) => item.id === line.productId));
  const email = input.email.trim().toLowerCase();
  if (!lines.length || !input.name.trim() || input.phone.trim().length < 6 || !emailOk(email)) {
    return { ok: false as const, error: "form" as const };
  }
  const sql = await ensureStock();
  const flag = await sql.query<{ value: string }>(`select value from luv_flags where key = 'stock_in'`);
  if (flag[0]?.value === "1") return { ok: false as const, error: "closed" as const };
  const ref = `LR-${randomBytes(2).toString("hex").toUpperCase()}`;
  const id = randomBytes(8).toString("hex");
  await sql.query(
    `insert into luv_reservations (id, ref, customer_name, phone, email, lines) values ($1, $2, $3, $4, $5, $6)`,
    [id, ref, input.name.trim(), input.phone.trim(), email, JSON.stringify(lines)],
  );
  return { ok: true as const, ref };
}

export async function luvSetStockIn(code: string, stockIn: boolean) {
  if (!allowed(code)) return { ok: false as const };
  const sql = await ensureStock();
  await sql.query(`insert into luv_flags (key, value) values ('stock_in', $1) on conflict (key) do update set value = excluded.value`, [
    stockIn ? "1" : "0",
  ]);
  return { ok: true as const, stockIn };
}

export async function luvMarkReservations(code: string, kind: string, ids: string[]) {
  if (!allowed(code)) return { ok: false as const };
  const column = kind === "stock" ? "stock_sent" : kind === "received" ? "received_sent" : "";
  const clean = ids.map((id) => id.replace(/[^a-f0-9]/g, "")).filter((id) => id.length >= 8);
  if (!column || !clean.length) return { ok: false as const };
  const sql = await ensureStock();
  await sql.query(`update luv_reservations set ${column} = true where id = any($1::text[])`, [clean]);
  return { ok: true as const };
}

export async function luvAckOrder(code: string, id: string) {
  if (!allowed(code)) return { ok: false as const };
  const sql = await ensureStock();
  await sql.query(`update luv_orders set seen = true where id = $1`, [id]);
  return { ok: true as const };
}

export async function luvIssueReceipt(code: string, id: string, nif: string) {
  if (!allowed(code)) return { ok: false as const, error: "code" as const };
  const clean = nif.replace(/\D/g, "");
  if (nif.trim() && !/^\d{9,14}$/.test(clean)) return { ok: false as const, error: "nif" as const };
  const sql = await ensureStock();
  const rows = await sql.query<{ ref: string; receipt_no: string }>(`select ref, receipt_no from luv_orders where id = $1`, [id]);
  if (!rows.length) return { ok: false as const, error: "missing" as const };
  const receiptNo = rows[0].receipt_no || `TL-${rows[0].ref.replace(/^LS-/, "")}`;
  await sql.query(
    `update luv_orders set paid_at = coalesce(paid_at, now()), nif = $2, receipt_no = $3, seen = true where id = $1`,
    [id, clean, receiptNo],
  );
  return { ok: true as const, ref: rows[0].ref, receiptNo, nif: clean };
}

export async function luvReceipt(ref: string) {
  const asked = ref.trim().toUpperCase();
  if (!/^LS-[A-Z0-9]{4}$/.test(asked)) return { ok: false as const };
  const sql = await ensureStock();
  const rows = await sql.query(`select * from luv_orders where ref = $1`, [asked]);
  if (!rows.length) return { ok: false as const };
  const order = mapOrder(rows[0]);
  if (!order.paidAt) return { ok: true as const, paid: false as const, ref: order.ref };
  return { ok: true as const, paid: true as const, order };
}

export async function luvSetStock(code: string, productId: string, size: string, qty: number) {
  if (!allowed(code)) return { ok: false as const };
  if (!PRODUCTS.some((item) => item.id === productId) || !SIZES.includes(size as (typeof SIZES)[number])) return { ok: false as const };
  const next = Math.max(0, Math.floor(qty));
  const sql = await ensureStock();
  await sql.query(`update luv_stock set qty = $3 where product_id = $1 and size = $2`, [productId, size, next]);
  return { ok: true as const, qty: next };
}

export async function luvCheckCoupon(coupon: string) {
  const asked = coupon.trim().toUpperCase();
  if (!asked) return { ok: false as const };
  const sql = await ensureStock();
  const found = await sql.query<{ percent: number }>(`select percent from luv_coupons where code = $1 and active`, [asked]);
  if (!found.length) return { ok: false as const };
  return { ok: true as const, code: asked, percent: Number(found[0].percent) };
}

export async function luvSaveCoupon(code: string, coupon: string, percent: number) {
  if (!allowed(code)) return { ok: false as const };
  const asked = coupon.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const next = Math.round(percent);
  if (asked.length < 3 || next < 1 || next > 90) return { ok: false as const };
  const sql = await ensureStock();
  await sql.query(
    `insert into luv_coupons (code, percent, active) values ($1, $2, true)
     on conflict (code) do update set percent = excluded.percent, active = true`,
    [asked, next],
  );
  return { ok: true as const, code: asked, percent: next };
}

export async function luvVisit(visitor: string, country: string, city: string) {
  const id = visitor.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (id.length < 8) return { ok: false as const };
  const sql = await ensureStock();
  const countryName = country.trim().slice(0, 80) || "Desconhecido";
  const cityName = city.trim().slice(0, 80) || "Desconhecida";
  const found = await sql.query(`select id from luv_visits where visitor = $1 and created_at > now() - interval '1 day' limit 1`, [id]);
  if (found.length) return { ok: true as const };
  await sql.query(`insert into luv_visits (id, visitor, country, city) values ($1, $2, $3, $4)`, [
    randomBytes(8).toString("hex"),
    id,
    countryName,
    cityName,
  ]);
  return { ok: true as const };
}

export async function luvVisitReport() {
  const sql = await ensureStock();
  const total = await sql.query<{ n: number }>(`select count(*)::int as n from luv_visits`);
  const countries = await sql.query<{ country: string; n: number }>(
    `select country, count(*)::int as n from luv_visits group by country order by n desc, country`,
  );
  const cities = await sql.query<{ country: string; city: string; n: number }>(
    `select country, city, count(*)::int as n from luv_visits group by country, city order by n desc, city`,
  );
  return {
    total: Number(total[0]?.n ?? 0),
    countries: countries.map((row) => ({ country: row.country, n: Number(row.n) })),
    cities: cities.map((row) => ({ country: row.country, city: row.city, n: Number(row.n) })),
  };
}
