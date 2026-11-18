export type DrinkChoice = { qty: number; kind: "unit" | "pack" | "crate" };

type DrinkInput = {
  categoryName: string;
  subcategoryName: string;
  name: string;
  format: string;
  unit: string;
  stockLeft: number | null;
  availability: string;
};

function litres(text: string) {
  const cl = text.match(/(\d+(?:[.,]\d+)?)\s*cl\b/i);
  if (cl) return Number(cl[1].replace(",", ".")) / 100;
  const l = text.match(/(\d+(?:[.,]\d+)?)\s*l\b/i);
  if (l) return Number(l[1].replace(",", "."));
  return null;
}

function isPack(product: DrinkInput) {
  const blob = `${product.name} ${product.format} ${product.unit}`.toLowerCase();
  return /\b(pack|caixa|bag-in-box)\b/.test(blob) || ["pack", "caixa", "box"].includes(product.unit.toLowerCase());
}

export function drinkChoices(product: DrinkInput): DrinkChoice[] | null {
  if (product.categoryName !== "Bebidas") return null;
  if (product.availability === "out") return [];
  const stock = product.stockLeft;
  const allow = (qty: number) => stock == null || qty <= stock;
  const pack = isPack(product);
  if (pack) return allow(1) ? [{ qty: 1, kind: "unit" }] : [];

  const volume = litres(`${product.format} ${product.name}`);
  const sub = product.subcategoryName.toLowerCase();
  let sizes = [1, 6, 12, 24];
  if (sub.includes("destil")) sizes = [1];
  else if (sub.includes("vinho") || sub.includes("vinhos")) sizes = [1, 6];
  else if (volume != null && volume >= 5) sizes = [1];
  else if (volume != null && volume >= 3) sizes = [1];
  else if (volume != null && volume >= 1) sizes = [1, 6];

  return sizes.filter(allow).map((qty) => ({
    qty,
    kind: qty === 1 ? "unit" : qty >= 24 ? "crate" : "pack",
  }));
}
