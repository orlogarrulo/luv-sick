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
  market: string;
  pay: string;
  totalLabel: string;
  coupon: string;
  lines: Need[];
};

function allowed(code: string) {
  const a = Buffer.from(code);
  const b = Buffer.from(DESK_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ensureStock() {
  const sql = await getSql();
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

export async function luvPlace(input: {
  lines: Need[];
  name: string;
  phone: string;
  address: string;
  city: string;
  market: string;
  pay: string;
  coupon: string;
}) {
  const lines = input.lines.filter((line) => line.qty > 0 && SIZES.includes(line.size as (typeof SIZES)[number]) && PRODUCTS.some((item) => item.id === line.productId));
  if (!lines.length || !input.name.trim() || !input.phone.trim()) return { ok: false as const, error: "stock" as const };
  const market: Market = input.market === "AO" ? "AO" : "PT";
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
       insert into luv_orders (id, ref, customer_name, phone, address, city, market, pay, total_label, lines, coupon)
       select $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
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
    market: String(row.market),
    pay: String(row.pay),
    totalLabel: String(row.total_label),
    coupon: String(row.coupon ?? ""),
    lines,
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
  return {
    ok: true as const,
    stock,
    orders: orders.map(mapOrder),
    visits,
    coupons: coupons.map((row) => ({ code: row.code, percent: Number(row.percent), active: Boolean(row.active) })),
  };
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
