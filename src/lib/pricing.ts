export const STORE = { lat: -8.916, lng: 13.19 };
export const DELIVERY_RADIUS_KM = 18;
export const DELIVERY_FEE_AOA = 1500;
export const LOW_STOCK_AT = 6;

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Nine national digits, starting with 9. Strips a pasted +244. */
export function localMobileDigits(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00244")) digits = digits.slice(5);
  else if (digits.startsWith("244")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  digits = digits.slice(0, 9);
  if (digits.length > 0 && !digits.startsWith("9")) return "";
  return digits;
}

/** Angolan mobile: 9 digits starting with 9, stored as +2449XXXXXXXX. */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d]/g, "");
  if (digits.startsWith("00244")) digits = digits.slice(5);
  else if (digits.startsWith("244") && digits.length >= 12) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith("09")) digits = digits.slice(1);
  if (!/^9\d{8}$/.test(digits)) return null;
  return `+244${digits}`;
}

export function formatPhone(phone: string): string {
  const local = phone.replace(/\D/g, "").slice(-9);
  if (local.length !== 9) return phone;
  return `+244 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180) *
    Math.cos((bLat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s1 + s2)));
}

export function inDeliveryZone(lat: number, lng: number): boolean {
  return haversineKm(lat, lng, STORE.lat, STORE.lng) <= DELIVERY_RADIUS_KM;
}

export function etaMinutes(lat: number, lng: number): { start: number; end: number } {
  const km = haversineKm(lat, lng, STORE.lat, STORE.lng);
  const start = Math.max(25, Math.round(26 + km * 2.4));
  return { start, end: start + 18 };
}

export function etaLabel(lat: number, lng: number): string {
  const { start, end } = etaMinutes(lat, lng);
  return `${start}–${end} min`;
}

export function floorPrice(cost: number, minMarginPct: number): number {
  if (!(cost > 0)) return Number.POSITIVE_INFINITY;
  return Math.ceil(cost * (1 + minMarginPct / 100) - 1e-9);
}

export function withinMargin(price: number, cost: number, minMarginPct: number): boolean {
  if (!(price > 0) || !(cost > 0)) return false;
  return price >= floorPrice(cost, minMarginPct);
}

export function discountPrice(price: number, kind: "percent" | "amount", value: number): number {
  if (kind === "percent") {
    const pct = Math.min(100, Math.max(0, value));
    return Math.max(0, Math.round((price * (100 - pct)) / 100));
  }
  return Math.max(0, Math.round(price - value));
}

export function formatKz(amount: number, lang: "pt" | "fr" | "en"): string {
  const locale = lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "pt-PT";
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(amount),
  );
  return `${formatted} Kz`;
}
