/**
 * Catálogo dinâmico da Luv Sick (gestão → Produtos).
 * Tabela luv_products + câmbio em luv_flags('kz_rate'). Lido da BD em cada pedido (sem redeploy).
 * Os preços cobrados (encomendas, reservas, Stripe) saem sempre daqui, no servidor.
 */
import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import {
  ALL_PRODUCTS,
  BASE_PRODUCTS,
  DEFAULT_KZ_RATE,
  SIZES,
  setCatalog,
  type Catalog,
  type Detail,
  type Lang,
  type Product,
} from "@/lib/luvsick";

type Sql = Awaited<ReturnType<typeof getSql>>;
type Row = {
  id: string;
  sort: number;
  active: boolean;
  custom: boolean;
  price_eur: string | number;
  price_kz: number | null;
  name: string;
  material: string;
  blurb: string;
  alt: string;
  images: string;
  details: string | null;
  video: string;
  updated_at: string | Date;
};

const L3 = (pt: string, en: string, fr: string): Record<Lang, string> => ({ pt, en, fr });
const DT = (src: string, pt: string, en: string, fr: string): Detail => ({ src, label: L3(pt, en, fr) });
const P = "/luvsick/products/";
const DD = "/luvsick/details/";

function alts(pt: string, en: string, fr: string): Record<Lang, [string, string]> {
  return {
    pt: [`Frente: ${pt} Luv Sick, fundo branco de estúdio`, `Costas: ${pt} Luv Sick, fundo branco de estúdio`],
    en: [`Front: Luv Sick ${en.toLowerCase()}, white studio background`, `Back: Luv Sick ${en.toLowerCase()}, white studio background`],
    fr: [`Face : ${fr.toLowerCase()} Luv Sick, fond blanc de studio`, `Dos : ${fr.toLowerCase()} Luv Sick, fond blanc de studio`],
  };
}

/** Peças avulsas (pedido de 21/11/2026). Preço em Kz = câmbio (priceKz null). */
const PIECES: Product[] = [
  {
    id: "hoodie-preto",
    priceEur: 80,
    priceKz: null,
    images: [`${P}hoodie-preto-frente.jpg`, `${P}hoodie-preto-costas.jpg`],
    name: L3("Hoodie preto", "Black hoodie", "Hoodie noir"),
    material: L3(
      "Moletom de algodão. Coração da marca no peito e assinatura nas costas.",
      "Cotton fleece. Brand heart on the chest and signature on the back.",
      "Molleton de coton. Cœur de la marque sur la poitrine et signature au dos.",
    ),
    blurb: L3(
      "Hoodie preto Luv Sick, peça avulsa, com o coração da marca no peito e a assinatura nas costas.",
      "Black Luv Sick hoodie, sold on its own, with the brand heart on the chest and the signature on the back.",
      "Hoodie noir Luv Sick, pièce à l'unité, avec le cœur de la marque sur la poitrine et la signature au dos.",
    ),
    alt: alts("hoodie preto", "Black hoodie", "Hoodie noir"),
    details: {
      front: [DT(`${DD}hoodie-preto-coracao.jpg`, "Coração no peito", "Chest heart", "Cœur poitrine"), DT(`${DD}hoodie-preto-punho.jpg`, "Punho", "Cuff", "Poignet")],
      back: [
        DT(`${DD}hoodie-preto-capuz.jpg`, "Capuz", "Hood", "Capuche"),
        DT(`${DD}hoodie-preto-assinatura.jpg`, "Assinatura nas costas", "Back signature", "Signature au dos"),
        DT(`${DD}hoodie-preto-punho-costas.jpg`, "Punho", "Cuff", "Poignet"),
      ],
    },
  },
  {
    id: "hoodie-castanho",
    priceEur: 80,
    priceKz: null,
    images: [`${P}hoodie-castanho-frente.jpg`, `${P}hoodie-castanho-costas.jpg`],
    name: L3("Hoodie castanho", "Brown hoodie", "Hoodie marron"),
    material: L3(
      "Moletom de algodão. Coração da marca no peito e assinatura nas costas.",
      "Cotton fleece. Brand heart on the chest and signature on the back.",
      "Molleton de coton. Cœur de la marque sur la poitrine et signature au dos.",
    ),
    blurb: L3(
      "Hoodie castanho Luv Sick, peça avulsa, com o coração da marca no peito e a assinatura nas costas.",
      "Brown Luv Sick hoodie, sold on its own, with the brand heart on the chest and the signature on the back.",
      "Hoodie marron Luv Sick, pièce à l'unité, avec le cœur de la marque sur la poitrine et la signature au dos.",
    ),
    alt: alts("hoodie castanho", "Brown hoodie", "Hoodie marron"),
    details: {
      front: [DT(`${DD}hoodie-castanho-coracao.jpg`, "Coração no peito", "Chest heart", "Cœur poitrine"), DT(`${DD}hoodie-castanho-punho.jpg`, "Punho", "Cuff", "Poignet")],
      back: [
        DT(`${DD}hoodie-castanho-capuz.jpg`, "Capuz", "Hood", "Capuche"),
        DT(`${DD}hoodie-castanho-assinatura.jpg`, "Assinatura nas costas", "Back signature", "Signature au dos"),
        DT(`${DD}hoodie-castanho-punho-costas.jpg`, "Punho", "Cuff", "Poignet"),
      ],
    },
  },
  {
    id: "calcas-pretas",
    priceEur: 60,
    priceKz: null,
    images: [`${P}calcas-pretas-frente.jpg`, `${P}calcas-pretas-costas.jpg`],
    name: L3("Calças pretas", "Black trousers", "Pantalon noir"),
    material: L3(
      "Moletom de algodão. Coração da marca na coxa e assinatura na bainha.",
      "Cotton fleece. Brand heart on the thigh and signature on the hem.",
      "Molleton de coton. Cœur de la marque sur la cuisse et signature sur l'ourlet.",
    ),
    blurb: L3(
      "Calças pretas Luv Sick, peça avulsa, com o coração da marca na coxa e a assinatura na bainha.",
      "Black Luv Sick trousers, sold on their own, with the brand heart on the thigh and the signature on the hem.",
      "Pantalon noir Luv Sick, pièce à l'unité, avec le cœur de la marque sur la cuisse et la signature sur l'ourlet.",
    ),
    alt: alts("calças pretas", "Black trousers", "Pantalon noir"),
    details: {
      front: [
        DT(`${DD}black-pants-hd.jpg`, "Coração na coxa", "Thigh heart", "Cœur sur la cuisse"),
        DT(`${DD}calcas-pretas-assinatura.jpg`, "Assinatura na bainha", "Hem signature", "Signature sur l'ourlet"),
      ],
      back: [DT(`${DD}calcas-pretas-bainha-costas.jpg`, "Costas", "Back", "Dos")],
    },
  },
  {
    id: "calcas-castanhas",
    priceEur: 60,
    priceKz: null,
    images: [`${P}calcas-castanhas-frente.jpg`, `${P}calcas-castanhas-costas.jpg`],
    name: L3("Calças castanhas", "Brown trousers", "Pantalon marron"),
    material: L3(
      "Moletom de algodão. Coração da marca na coxa e assinatura na bainha.",
      "Cotton fleece. Brand heart on the thigh and signature on the hem.",
      "Molleton de coton. Cœur de la marque sur la cuisse et signature sur l'ourlet.",
    ),
    blurb: L3(
      "Calças castanhas Luv Sick, peça avulsa, com o coração da marca na coxa e a assinatura na bainha.",
      "Brown Luv Sick trousers, sold on their own, with the brand heart on the thigh and the signature on the hem.",
      "Pantalon marron Luv Sick, pièce à l'unité, avec le cœur de la marque sur la cuisse et la signature sur l'ourlet.",
    ),
    alt: alts("calças castanhas", "Brown trousers", "Pantalon marron"),
    details: {
      front: [
        DT(`${DD}brown-pants-hd.jpg`, "Coração na coxa", "Thigh heart", "Cœur sur la cuisse"),
        DT(`${DD}brown-hem-signature-hd.jpg`, "Assinatura na bainha", "Hem signature", "Signature sur l'ourlet"),
      ],
      back: [DT(`${DD}calcas-castanhas-bainha-costas.jpg`, "Costas", "Back", "Dos")],
    },
  },
  {
    id: "calcoes-castanhos",
    priceEur: 50,
    priceKz: null,
    images: [`${P}calcoes-castanhos-frente.jpg`, `${P}calcoes-castanhos-costas.jpg`],
    name: L3("Calções castanhos", "Brown shorts", "Short marron"),
    material: L3(
      "Moletom de algodão. Coração rosa Luv Sick na perna e assinatura nas costas.",
      "Cotton fleece. Pink Luv Sick heart on the leg and signature on the back.",
      "Molleton de coton. Cœur rose Luv Sick sur la jambe et signature au dos.",
    ),
    blurb: L3(
      "Calções castanhos Luv Sick, com o coração rosa na perna e a assinatura nas costas.",
      "Brown Luv Sick shorts, with the pink heart on the leg and the signature on the back.",
      "Short marron Luv Sick, avec le cœur rose sur la jambe et la signature au dos.",
    ),
    alt: alts("calções castanhos", "Brown shorts", "Short marron"),
    details: {
      front: [
        DT(`${DD}calcoes-castanhos-coracao.jpg`, "Coração na perna", "Leg heart", "Cœur sur la jambe"),
        DT(`${DD}calcoes-castanhos-cintura.jpg`, "Cintura e cordões", "Waist and drawstring", "Taille et cordons"),
      ],
      back: [
        DT(`${DD}calcoes-castanhos-assinatura.jpg`, "Assinatura", "Signature", "Signature"),
        DT(`${DD}calcoes-castanhos-bolsos.jpg`, "Bolsos traseiros", "Back pockets", "Poches arrière"),
      ],
    },
  },
];

const START_QTY = 5;
let tablesReady: Promise<void> | null = null;

function ensureTables(sql: Sql) {
  tablesReady ??= (async () => {
    await sql.query(
      `create table if not exists luv_products (
        id text primary key,
        sort integer not null default 0,
        active boolean not null default true,
        custom boolean not null default false,
        price_eur numeric(10,2) not null,
        price_kz integer,
        name text not null,
        material text not null default '{}',
        blurb text not null default '{}',
        alt text not null default '{}',
        images text not null default '[]',
        details text,
        video text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
    );
    await sql.query(`create table if not exists luv_flags (key text primary key, value text not null)`);
    await sql.query(`insert into luv_flags (key, value) values ('kz_rate', $1) on conflict (key) do nothing`, [String(DEFAULT_KZ_RATE)]);
    const seeded = await sql.query<{ value: string }>(`select value from luv_flags where key = 'catalog_seed'`);
    if (seeded[0]?.value !== "2") {
      // Semente única: os 3 conjuntos (detalhes = null → usa os do código) e as 5 peças avulsas.
      let sort = 0;
      for (const item of BASE_PRODUCTS) {
        await insertProduct(sql, { ...item, details: undefined }, sort++, false);
      }
      for (const item of PIECES) {
        await insertProduct(sql, item, sort++, true);
      }
      await sql.query(`insert into luv_flags (key, value) values ('catalog_seed', '2') on conflict (key) do update set value = excluded.value`);
    }
  })().catch((err) => {
    tablesReady = null;
    throw err;
  });
  return tablesReady;
}

async function insertProduct(sql: Sql, item: Product, sort: number, custom: boolean) {
  await sql.query(
    `insert into luv_products (id, sort, active, custom, price_eur, price_kz, name, material, blurb, alt, images, details, video)
     values ($1, $2, true, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (id) do nothing`,
    [
      item.id,
      sort,
      custom,
      item.priceEur,
      item.priceKz,
      JSON.stringify(item.name),
      JSON.stringify(item.material),
      JSON.stringify(item.blurb),
      JSON.stringify(item.alt),
      JSON.stringify(item.images),
      item.details ? JSON.stringify(item.details) : null,
      item.video ?? "",
    ],
  );
}

function parse<T>(raw: unknown, fallback: T): T {
  if (raw && typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function toProduct(row: Row): Product {
  const name = parse<Record<Lang, string>>(row.name, L3(row.id, row.id, row.id));
  return {
    id: row.id,
    priceEur: Number(row.price_eur),
    priceKz: row.price_kz == null ? null : Number(row.price_kz),
    images: parse<[string, string]>(row.images, ["", ""]),
    name,
    material: parse(row.material, L3("", "", "")),
    blurb: parse(row.blurb, L3("", "", "")),
    alt: parse(row.alt, alts(name.pt, name.en, name.fr)),
    details: row.details ? parse(row.details, undefined) : undefined,
    video: row.video || undefined,
    active: Boolean(row.active),
    sort: Number(row.sort),
    custom: Boolean(row.custom),
  };
}

/** Lê o catálogo da BD e atualiza PRODUCTS/RATE deste processo. Em caso de erro mantém o que já está. */
export async function loadCatalog(sqlIn?: Sql): Promise<Catalog | null> {
  try {
    const sql = sqlIn ?? (await getSql());
    await ensureTables(sql);
    const rows = await sql.query<Row>(`select * from luv_products order by sort, created_at`);
    const rate = await sql.query<{ value: string }>(`select value from luv_flags where key = 'kz_rate'`);
    const stamp = rows.reduce((max, row) => {
      const at = new Date(row.updated_at).toISOString();
      return at > max ? at : max;
    }, "");
    const catalog: Catalog = { products: rows.map(toProduct), rate: Number(rate[0]?.value) || DEFAULT_KZ_RATE, stamp };
    setCatalog(catalog);
    return catalog;
  } catch (err) {
    console.error("[catalog] load failed", err);
    return null;
  }
}

async function deskOk(code: string) {
  const { allowed } = await import("./luvsick.server");
  return allowed(String(code ?? ""));
}

/* ---------------- Gestão ---------------- */

export type ProductInput = {
  id?: string;
  name: Record<Lang, string>;
  material: Record<Lang, string>;
  blurb: Record<Lang, string>;
  priceEur: number;
  priceKz: number | null;
  images: [string, string];
  details: { front: { src: string; label: string }[]; back: { src: string; label: string }[] };
  video: string;
  active: boolean;
  stock?: number;
};

const URL_OK = /^(\/luvsick\/[\w./-]+|https:\/\/[\w.-]+\.public\.blob\.vercel-storage\.com\/[\w./%-]+)$/;

function cleanText(value: unknown, max = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanUrl(value: unknown) {
  const url = String(value ?? "").trim();
  return URL_OK.test(url) ? url : "";
}

function slug(text: string) {
  const base = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "peca";
}

function fill(record: Partial<Record<Lang, string>> | undefined, max = 400): Record<Lang, string> {
  const pt = cleanText(record?.pt, max);
  return { pt, en: cleanText(record?.en, max) || pt, fr: cleanText(record?.fr, max) || pt };
}

export async function luvDeskCatalog(code: string) {
  if (!(await deskOk(code))) return { ok: false as const };
  const catalog = await loadCatalog();
  if (!catalog) return { ok: false as const, error: "db" as const };
  return { ok: true as const, catalog, base: Object.fromEntries(ALL_PRODUCTS.map((item) => [item.id, item.details ?? null])), blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN) };
}

export async function luvSaveProduct(code: string, input: ProductInput) {
  if (!(await deskOk(code))) return { ok: false as const, error: "code" as const };
  const sql = await getSql();
  await ensureTables(sql);
  const name = fill(input.name, 80);
  const priceEur = Math.round(Number(input.priceEur) * 100) / 100;
  const kzRaw = input.priceKz == null || String(input.priceKz).trim() === "" ? null : Math.round(Number(input.priceKz));
  if (!name.pt) return { ok: false as const, error: "Falta o nome." };
  if (!Number.isFinite(priceEur) || priceEur < 1 || priceEur > 100000) return { ok: false as const, error: "Preço em € inválido." };
  if (kzRaw != null && (!Number.isFinite(kzRaw) || kzRaw < 100 || kzRaw > 100000000)) return { ok: false as const, error: "Preço em Kz inválido." };
  const images: [string, string] = [cleanUrl(input.images?.[0]), cleanUrl(input.images?.[1])];
  if (!images[0]) return { ok: false as const, error: "Falta a foto da frente." };
  if (!images[1]) images[1] = images[0];
  const side = (list: { src: string; label: string }[] | undefined): Detail[] =>
    (Array.isArray(list) ? list : [])
      .slice(0, 8)
      .map((item) => ({ src: cleanUrl(item?.src), label: fill({ pt: item?.label }, 60) }))
      .filter((item) => item.src);
  const details = { front: side(input.details?.front), back: side(input.details?.back) };
  const video = cleanUrl(input.video);
  const material = fill(input.material);
  const blurb = fill(input.blurb);
  const alt = alts(name.pt, name.en, name.fr);
  const existing = input.id ? await sql.query<{ id: string; custom: boolean }>(`select id, custom from luv_products where id = $1`, [input.id]) : [];
  if (existing.length) {
    await sql.query(
      `update luv_products set name = $2, material = $3, blurb = $4, alt = $5, price_eur = $6, price_kz = $7, images = $8, details = $9, video = $10, active = $11, updated_at = now() where id = $1`,
      [input.id, JSON.stringify(name), JSON.stringify(material), JSON.stringify(blurb), JSON.stringify(alt), priceEur, kzRaw, JSON.stringify(images), JSON.stringify(details), video, input.active !== false],
    );
    await loadCatalog(sql);
    return { ok: true as const, id: input.id };
  }
  let id = slug(name.pt);
  const taken = await sql.query(`select 1 from luv_products where id = $1`, [id]);
  if (taken.length) id = `${id}-${randomBytes(2).toString("hex")}`;
  const last = await sql.query<{ n: number }>(`select coalesce(max(sort), 0) + 1 as n from luv_products`);
  await insertProduct(sql, { id, priceEur, priceKz: kzRaw, images, name, material, blurb, alt, details, video }, Number(last[0]?.n ?? 0), true);
  if (input.active === false) await sql.query(`update luv_products set active = false where id = $1`, [id]);
  const qty = Math.max(0, Math.min(9999, Math.floor(Number(input.stock ?? START_QTY))));
  await sql.query(`alter table luv_stock add column if not exists received integer`);
  for (const size of SIZES) {
    await sql.query(`insert into luv_stock (product_id, size, qty, received) values ($1, $2, $3, $3) on conflict (product_id, size) do nothing`, [id, size, qty]);
  }
  await loadCatalog(sql);
  return { ok: true as const, id };
}

export async function luvDeleteProduct(code: string, id: string) {
  if (!(await deskOk(code))) return { ok: false as const, error: "code" as const };
  const sql = await getSql();
  await ensureTables(sql);
  const row = await sql.query<{ custom: boolean }>(`select custom from luv_products where id = $1`, [id]);
  if (!row.length) return { ok: false as const, error: "Item não encontrado." };
  if (!row[0].custom) return { ok: false as const, error: "Os conjuntos de origem não se apagam; pode desativá-los." };
  const like = `%"productId":"${id.replace(/[%_"\\]/g, "")}"%`;
  const used = await sql.query<{ n: number }>(
    `select (select count(*) from luv_orders where lines like $1) + (select count(*) from luv_reservations where lines like $1) as n`,
    [like],
  );
  if (Number(used[0]?.n ?? 0) > 0) return { ok: false as const, error: "Este item já tem encomendas ou reservas. Desative-o em vez de apagar." };
  await sql.query(`delete from luv_products where id = $1`, [id]);
  await sql.query(`delete from luv_stock where product_id = $1`, [id]);
  await loadCatalog(sql);
  return { ok: true as const };
}

export async function luvMoveProduct(code: string, id: string, dir: number) {
  if (!(await deskOk(code))) return { ok: false as const, error: "code" as const };
  const sql = await getSql();
  await ensureTables(sql);
  const rows = await sql.query<{ id: string }>(`select id from luv_products order by sort, created_at`);
  const ids = rows.map((row) => row.id);
  const at = ids.indexOf(id);
  const to = at + (dir < 0 ? -1 : 1);
  if (at < 0 || to < 0 || to >= ids.length) return { ok: true as const };
  [ids[at], ids[to]] = [ids[to], ids[at]];
  for (let index = 0; index < ids.length; index++) {
    await sql.query(`update luv_products set sort = $2, updated_at = case when sort <> $2 then now() else updated_at end where id = $1`, [ids[index], index]);
  }
  await loadCatalog(sql);
  return { ok: true as const };
}

export async function luvSetRate(code: string, rate: number) {
  if (!(await deskOk(code))) return { ok: false as const, error: "code" as const };
  const value = Math.round(Number(rate) * 100) / 100;
  if (!Number.isFinite(value) || value < 1 || value > 1000000) return { ok: false as const, error: "Câmbio inválido." };
  const sql = await getSql();
  await ensureTables(sql);
  await sql.query(`insert into luv_flags (key, value) values ('kz_rate', $1) on conflict (key) do update set value = excluded.value`, [String(value)]);
  await loadCatalog(sql);
  return { ok: true as const, rate: value };
}
