export type Lang = "pt" | "fr" | "en";

export type Availability = "ok" | "low" | "out";

export type Customer = {
  id: string;
  name: string;
  phone: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  count: number;
};

export type SubcategoryRow = {
  id: string;
  name: string;
  count: number;
};

export type ProductCard = {
  sku: string;
  name: string;
  brand: string;
  format: string;
  unit: string;
  description: string;
  keywords: string;
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  photoFile: string;
  priority: string;
  priceAoa: number;
  compareAtAoa: number | null;
  promoEnds: string | null;
  availability: Availability;
  stockLeft: number | null;
  favorite: boolean;
};

export type CartLine = {
  sku: string;
  qty: number;
};

export type QuoteLine = {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  compareAt: number | null;
  lineTotal: number;
};

export type Quote = {
  lines: QuoteLine[];
  adjustments: { sku: string; name: string; qty: number }[];
  subtotal: number;
  delivery: number;
  discount: number;
  total: number;
  discountNote: string | null;
  couponError: string | null;
  eta: string;
  inZone: boolean;
  zoneName: string | null;
};

export type OrderSummary = {
  id: string;
  number: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  totalAoa: number;
  etaLabel: string;
  addressLabel: string;
  lat: number;
  lng: number;
  complement: string;
  cancelReason: string | null;
  createdAt: string;
  items: { sku: string; name: string; qty: number; unitPrice: number; lineTotal: number }[];
  events: { status: string; note: string | null; createdAt: string }[];
  courierName: string | null;
  delivery: import("@/lib/delivery/types").TrackView | null;
};

export type StaffRole = "admin" | "stock_manager" | "finance" | "operator";

export type Staff = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
};

export type AdminProduct = {
  sku: string;
  name: string;
  brand: string;
  format: string;
  categoryName: string;
  subcategoryName: string;
  priority: string;
  stock: number;
  priceAoa: number | null;
  costAoa: number | null;
  minMarginPct: number;
  floorAoa: number | null;
  expiry: string | null;
  avgDaily: number;
  active: boolean;
  coverageDays: number | null;
};

export type PromoSuggestion = {
  sku: string;
  name: string;
  stock: number;
  origin: "overstock" | "near_expiry";
  suggestedPercent: number;
  coverageDays: number | null;
  expiry: string | null;
  priceAoa: number;
  floorAoa: number;
  viable: boolean;
};

export type AuditRow = {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
};

export type Notice = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};
