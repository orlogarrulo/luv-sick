type Body = Record<string, unknown>;

function str(value: unknown) {
  return typeof value === "string" ? value : "";
}

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function items(value: unknown) {
  if (!Array.isArray(value)) return [];
  const lines: { sku: string; qty: number }[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const sku = str((row as { sku?: unknown }).sku).slice(0, 40);
    const qty = Math.floor(num((row as { qty?: unknown }).qty));
    if (sku && qty > 0 && qty < 100) lines.push({ sku, qty });
  }
  return lines.slice(0, 40);
}

const PAYMENTS = ["multicaixa", "unitel_money", "appypay", "cash"] as const;

export async function mobileAction(body: Body) {
  const action = str(body.action);
  const logic = await import("./logic.server");
  const token = str(body.token);
  switch (action) {
    case "requestOtp":
      return logic.requestOtp({
        name: str(body.name),
        phone: str(body.phone),
        channel: body.channel === "whatsapp" ? "whatsapp" : "sms",
      });
    case "verifyOtp":
      return logic.verifyOtp({ phone: str(body.phone), code: str(body.code) });
    case "getMe":
      return logic.getMe(token);
    case "logout":
      return logic.logout(token);
    case "deleteAccount":
      return logic.deleteAccount({ token, confirm: str(body.confirm) });
    case "listCategories":
      return logic.listCategories(token);
    case "listSubcategories":
      return logic.listSubcategories(token, str(body.categoryId));
    case "searchProducts":
      return logic.searchProducts({
        token,
        q: str(body.q) || undefined,
        categoryId: str(body.categoryId) || undefined,
        subcategoryId: str(body.subcategoryId) || undefined,
        favoritesOnly: body.favoritesOnly === true,
        limit: Math.min(240, Math.max(1, Math.floor(num(body.limit) || 24))),
      });
    case "getProduct":
      return logic.getProduct(token, str(body.sku));
    case "toggleFavorite":
      return logic.toggleFavorite({ token, sku: str(body.sku) });
    case "requestRestock":
      return logic.requestRestock({ token, sku: str(body.sku) });
    case "bestsellers":
      return logic.bestsellers(token);
    case "quoteCart":
      return logic.quoteCart({
        token,
        items: items(body.items),
        couponCode: str(body.couponCode) || undefined,
        lat: num(body.lat),
        lng: num(body.lng),
      });
    case "placeOrder": {
      const payment = str(body.paymentMethod);
      if (!PAYMENTS.includes(payment as (typeof PAYMENTS)[number])) return { ok: false, error: "payment" };
      return logic.placeOrder({
        token,
        items: items(body.items),
        couponCode: str(body.couponCode) || undefined,
        lat: num(body.lat),
        lng: num(body.lng),
        label: str(body.label),
        complement: str(body.complement),
        paymentMethod: payment as (typeof PAYMENTS)[number],
        slotStart: str(body.slotStart),
        slotEnd: str(body.slotEnd),
        slotLabel: str(body.slotLabel),
      });
    }
    case "listOrders":
      return logic.listOrders(token);
    case "getOrder":
      return logic.getOrder(token, str(body.orderId));
    case "rateDelivery":
      return (await import("./delivery.server")).rateDelivery({
        token,
        orderId: str(body.orderId),
        rating: Math.round(num(body.rating)),
        note: str(body.note) || undefined,
      });
    default:
      return { ok: false, error: "action" };
  }
}
