import { createServerFn } from "@tanstack/react-start";

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
      email?: string;
      lang?: string;
    }) => data,
  )
  .handler(async ({ data }) => (await luvApi()).luvPlace(data));

export const luvDesk = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvDesk(data.code));

export const luvAckOrder = createServerFn({ method: "POST" })
  .validator((data: { code: string; id: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvAckOrder(data.code, data.id));

export const luvIssueReceipt = createServerFn({ method: "POST" })
  .validator((data: { code: string; id: string; nif: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvIssueReceipt(data.code, data.id, data.nif));

export const luvReceipt = createServerFn({ method: "POST" })
  .validator((data: { ref: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvReceipt(data.ref));

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




export const luvMode = createServerFn({ method: "POST" }).handler(async () => (await luvApi()).luvMode());

export const luvAskCode = createServerFn({ method: "POST" })
  .validator((data: { email: string; lang: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvAskCode(data.email, data.lang));

export const luvEnter = createServerFn({ method: "POST" })
  .validator((data: { email: string; code: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvEnter(data.email, data.code));

export const luvAccount = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvAccount(data.token));

export const luvSaveAddress = createServerFn({ method: "POST" })
  .validator((data: { token: string; address: string; city: string; country: string; postal: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvSaveAddress(data.token, data));


export const luvReserve = createServerFn({ method: "POST" })
  .validator((data: { name: string; phone: string; email: string; pay: string; market: string; lang?: string; lines: { productId: string; size: string; qty: number }[] }) => data)
  .handler(async ({ data }) => (await luvApi()).luvReserve(data));

export const luvSetStockIn = createServerFn({ method: "POST" })
  .validator((data: { code: string; stockIn: boolean }) => data)
  .handler(async ({ data }) => (await luvApi()).luvSetStockIn(data.code, data.stockIn));

export const luvConfirmReserve = createServerFn({ method: "POST" })
  .validator((data: { code: string; id: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvConfirmReserve(data.code, data.id));

export const luvMarkReservations = createServerFn({ method: "POST" })
  .validator((data: { code: string; kind: string; ids: string[] }) => data)
  .handler(async ({ data }) => (await luvApi()).luvMarkReservations(data.code, data.kind, data.ids));

export const luvReservePaper = createServerFn({ method: "POST" })
  .validator((data: { ref: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvReservePaper(data.ref));

export const luvResendReserve = createServerFn({ method: "POST" })
  .validator((data: { code: string; id: string }) => data)
  .handler(async ({ data }) => (await luvApi()).luvResendReserve(data.code, data.id));

