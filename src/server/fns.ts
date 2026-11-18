import { createServerFn } from "@tanstack/react-start";

async function api() {
  return import("./logic.server");
}

export const warmup = createServerFn({ method: "POST" }).handler(async () => {
  return (await api()).warmup();
});

export const requestOtp = createServerFn({ method: "POST" })
  .validator((data: { name: string; phone: string; channel: "sms" | "whatsapp" }) => data)
  .handler(async ({ data }) => (await api()).requestOtp(data));

export const verifyOtp = createServerFn({ method: "POST" })
  .validator((data: { phone: string; code: string }) => data)
  .handler(async ({ data }) => (await api()).verifyOtp(data));

export const getMe = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).getMe(data.token));

export const saveAddress = createServerFn({ method: "POST" })
  .validator((data: { token: string; address: string }) => data)
  .handler(async ({ data }) => (await api()).saveAddress(data.token, data.address));

export const logout = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).logout(data.token));

export const deleteAccount = createServerFn({ method: "POST" })
  .validator((data: { token: string; confirm: string }) => data)
  .handler(async ({ data }) => (await api()).deleteAccount(data));

export const listCategories = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).listCategories(data.token));

export const listSubcategories = createServerFn({ method: "POST" })
  .validator((data: { token: string; categoryId: string }) => data)
  .handler(async ({ data }) => (await api()).listSubcategories(data.token, data.categoryId));

export const searchDictionary = createServerFn({ method: "POST" }).handler(async () => (await api()).searchDictionary());

export const submitFeedback = createServerFn({ method: "POST" })
  .validator(
    (data: { kind: "complaint" | "suggestion"; orderRef: string; name: string; phone: string; body: string }) => data,
  )
  .handler(async ({ data }) => (await api()).submitFeedback(data));

export const listFeedback = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).listFeedback(data.token));

export const searchProducts = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      q?: string;
      categoryId?: string;
      subcategoryId?: string;
      favoritesOnly?: boolean;
      priorityA?: boolean;
      limit?: number;
    }) => data,
  )
  .handler(async ({ data }) => (await api()).searchProducts(data));

export const getProduct = createServerFn({ method: "POST" })
  .validator((data: { token: string; sku: string }) => data)
  .handler(async ({ data }) => (await api()).getProduct(data.token, data.sku));

export const toggleFavorite = createServerFn({ method: "POST" })
  .validator((data: { token: string; sku: string }) => data)
  .handler(async ({ data }) => (await api()).toggleFavorite(data));

export const requestRestock = createServerFn({ method: "POST" })
  .validator((data: { token: string; sku: string }) => data)
  .handler(async ({ data }) => (await api()).requestRestock(data));

export const quoteCart = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      items: { sku: string; qty: number }[];
      couponCode?: string;
      lat: number;
      lng: number;
    }) => data,
  )
  .handler(async ({ data }) => (await api()).quoteCart(data));

export const placeOrder = createServerFn({ method: "POST" })
  .validator(
    (data: {
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
    }) => data,
  )
  .handler(async ({ data }) => (await api()).placeOrder(data));

export const listOpenSlots = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).listOpenSlots(data.token));

export const listDeliveryWindows = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).listDeliveryWindows(data.token));

export const saveDeliveryWindow = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      id?: string;
      label: string;
      weekday: number;
      startMin: number;
      endMin: number;
      capacity: number;
      active: boolean;
    }) => data,
  )
  .handler(async ({ data }) => (await api()).saveDeliveryWindow(data));

export const deleteDeliveryWindow = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: string }) => data)
  .handler(async ({ data }) => (await api()).deleteDeliveryWindow(data.token, data.id));

export const listOrders = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).listOrders(data.token));

export const getOrder = createServerFn({ method: "POST" })
  .validator((data: { token: string; orderId: string }) => data)
  .handler(async ({ data }) => (await api()).getOrder(data.token, data.orderId));

export const bestsellers = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).bestsellers(data.token));

export const listNotices = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).listNotices(data.token));

export const staffLogin = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => (await api()).staffLogin(data));

export const staffVerify = createServerFn({ method: "POST" })
  .validator((data: { challengeId: string; code: string }) => data)
  .handler(async ({ data }) => (await api()).staffVerify(data));

export const staffMe = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).staffMe(data.token));

export const staffLogout = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).staffLogout(data.token));

export const adminProducts = createServerFn({ method: "POST" })
  .validator((data: { token: string; q?: string; offset?: number }) => data)
  .handler(async ({ data }) => (await api()).adminProducts(data));

export const updateStock = createServerFn({ method: "POST" })
  .validator((data: { token: string; sku: string; stock: number; reason: string }) => data)
  .handler(async ({ data }) => (await api()).updateStock(data));

export const updatePrice = createServerFn({ method: "POST" })
  .validator(
    (data: { token: string; sku: string; priceAoa: number; costAoa: number; minMarginPct: number }) =>
      data,
  )
  .handler(async ({ data }) => (await api()).updatePrice(data));

export const adminOrders = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).adminOrders(data.token));

export const advanceOrder = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      orderId: string;
      courierName?: string;
      cashReceived?: number;
      cancelReason?: string;
      cancel?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => (await api()).advanceOrder(data));

export const suggestions = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).suggestions(data.token));

export const activatePromo = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      sku: string;
      percent: number;
      origin: "overstock" | "near_expiry" | "manual";
    }) => data,
  )
  .handler(async ({ data }) => (await api()).activatePromo(data));

export const setAutoPromos = createServerFn({ method: "POST" })
  .validator((data: { token: string; on: boolean }) => data)
  .handler(async ({ data }) => (await api()).setAutoPromos(data));

export const createDiscount = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      phone: string;
      kind: "percent" | "amount";
      value: number;
      scope: "order" | "category" | "product";
      scopeRef?: string;
      singleUse: boolean;
      days: number;
      reason: string;
    }) => data,
  )
  .handler(async ({ data }) => (await api()).createDiscount(data));

export const createCoupon = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      code: string;
      phone?: string;
      kind: "percent" | "amount";
      value: number;
      days: number;
      reason: string;
    }) => data,
  )
  .handler(async ({ data }) => (await api()).createCoupon(data));

export const listAudit = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).listAudit(data.token));

export const report = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await api()).report(data.token));

async function deliveryApi() {
  return import("./delivery.server");
}

export const deliveryDesk = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).deliveryDesk(data.token));

export const deliveryDetail = createServerFn({ method: "POST" })
  .validator((data: { token: string; orderId: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).deliveryDetail(data.token, data.orderId));

export const requestDeliveryQuotes = createServerFn({ method: "POST" })
  .validator((data: { token: string; orderId: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).requestQuotes(data.token, data.orderId));

export const dispatchDelivery = createServerFn({ method: "POST" })
  .validator((data: { token: string; orderId: string; providerId: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).dispatchDelivery(data));

export const cancelDelivery = createServerFn({ method: "POST" })
  .validator((data: { token: string; orderId: string; motivo: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).cancelDelivery(data.token, data.orderId, data.motivo));

export const setDeliveryStatus = createServerFn({ method: "POST" })
  .validator(
    (data: { token: string; orderId: string; estado: string; pin?: string; courierName?: string; courierPhone?: string }) =>
      data,
  )
  .handler(async ({ data }) => (await deliveryApi()).setDeliveryStatus(data));

export const saveDeliverySettings = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      mode: "manual" | "auto";
      rule: "cheapest" | "fastest" | "preferred";
      preferredProvider: string | null;
      priceCapKz: number | null;
      fallbackMin: number;
      showCarrier: boolean;
    }) => data,
  )
  .handler(async ({ data }) => (await deliveryApi()).saveDeliverySettings(data));

export const toggleDeliveryProvider = createServerFn({ method: "POST" })
  .validator((data: { token: string; providerId: string; ativo: boolean }) => data)
  .handler(async ({ data }) => (await deliveryApi()).toggleDeliveryProvider(data.token, data.providerId, data.ativo));

export const updateDeliveryZone = createServerFn({ method: "POST" })
  .validator(
    (data: { token: string; zoneId: string; feeKz: number; freeAboveKz: number | null; providers: string[] }) => data,
  )
  .handler(async ({ data }) =>
    (await deliveryApi()).updateDeliveryZone(data.token, data.zoneId, data.feeKz, data.freeAboveKz, data.providers),
  );

export const pingDeliveryProvider = createServerFn({ method: "POST" })
  .validator((data: { token: string; providerId: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).pingDeliveryProvider(data.token, data.providerId));

export const deliveryReport = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).deliveryReport(data.token));

export const reconcileDeliveries = createServerFn({ method: "POST" })
  .validator((data: { token: string; csv: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).reconcileDeliveries(data.token, data.csv));

export const sendTestWebhook = createServerFn({ method: "POST" })
  .validator((data: { token: string; orderId: string; status: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).sendTestWebhook(data.token, data.orderId, data.status));

export const rateDelivery = createServerFn({ method: "POST" })
  .validator((data: { token: string; orderId: string; rating: number; note?: string }) => data)
  .handler(async ({ data }) => (await deliveryApi()).rateDelivery(data));

async function luvApi() {
  return import("./luvsick.server");
}

export const luvStock = createServerFn({ method: "POST" }).handler(async () => (await luvApi()).luvStock());

export const luvPlace = createServerFn({ method: "POST" })
  .validator(
    (data: {
      lines: { productId: string; size: string; qty: number }[];
      name: string;
      phone: string;
      address: string;
      city: string;
      country: string;
      postal: string;
      market: string;
      pay: string;
      coupon: string;
    }) => data,
  )
  .handler(async ({ data }) => (await luvApi()).luvPlace(data));

export const luvDesk = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvDesk(data.code));

export const luvAckOrder = createServerFn({ method: "POST" })
  .validator((data: { code: string; id: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvAckOrder(data.code, data.id));

export const luvSetStock = createServerFn({ method: "POST" })
  .validator((data: { code: string; productId: string; size: string; qty: number }) => data)
  .handler(async ({ data }) => (await luvApi()).luvSetStock(data.code, data.productId, data.size, data.qty));

export const luvVisit = createServerFn({ method: "POST" })
  .validator((data: { visitor: string; country: string; city: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvVisit(data.visitor, data.country, data.city));

export const luvCheckCoupon = createServerFn({ method: "POST" })
  .validator((data: { coupon: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvCheckCoupon(data.coupon));

export const luvSaveCoupon = createServerFn({ method: "POST" })
  .validator((data: { code: string; coupon: string; percent: number }) => data)
  .handler(async ({ data }) => (await luvApi()).luvSaveCoupon(data.code, data.coupon, data.percent));



