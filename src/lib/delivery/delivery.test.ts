import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDispatchSlot,
  codAllows,
  createProviders,
  decideWebhook,
  localQuote,
  locateZone,
  maskPhone,
  mapExternalStatus,
  needsFallback,
  pickQuote,
  priceZone,
  sanitizeError,
  signBody,
  simulatedStatus,
  waText,
  withRetry,
  DEFAULT_ZONES,
} from "./core.ts";
import type { DeliveryOrder } from "./types.ts";

const order: DeliveryOrder = {
  orderId: "o1",
  number: 1100,
  attempt: 1,
  customerName: "Lina",
  phone: "+244923000111",
  lat: -8.916,
  lng: 13.184,
  addressLabel: "Talatona",
  complement: "portão azul",
  paymentMethod: "multicaixa",
  codKz: null,
  subtotalKz: 8000,
  volumes: 1,
  weightKg: 2,
  declaredKz: 8000,
};

test("zonas de Luanda e taxa independente do custo da transportadora", () => {
  assert.equal(locateZone(DEFAULT_ZONES, -8.916, 13.184)?.id, "talatona");
  assert.equal(locateZone(DEFAULT_ZONES, -8.998, 13.266)?.id, "kilamba");
  assert.equal(locateZone(DEFAULT_ZONES, -8.827, 13.234)?.id, "maianga");
  assert.equal(locateZone(DEFAULT_ZONES, -8.905, 13.22)?.id, "nova-vida");
  assert.equal(locateZone(DEFAULT_ZONES, -8.9, 13.36)?.id, "viana");
  assert.equal(locateZone(DEFAULT_ZONES, -8.783, 13.37), null);
  const talatona = priceZone(DEFAULT_ZONES, -8.916, 13.184, 8000);
  assert.equal(talatona.fee, 1200);
  assert.equal(priceZone(DEFAULT_ZONES, -8.916, 13.184, 25000).fee, 0);
  const viana = priceZone(DEFAULT_ZONES, -8.9, 13.36, 1000);
  assert.equal(viana.inZone, true);
  assert.equal(viana.fee, 2500);
});

test("regra de despacho: mais barata, mais rápida, preferida com tecto", () => {
  const now = 1_000;
  const quotes = [
    localQuote("internal", order, now),
    localQuote("yango", order, now),
    localQuote("manual", order, now),
  ];
  assert.equal(pickQuote(quotes, "cheapest")?.providerId, "internal");
  assert.equal(pickQuote(quotes, "fastest")?.providerId, "yango");
  assert.equal(pickQuote(quotes, "preferred", "yango", 5000)?.providerId, "yango");
  assert.equal(pickQuote(quotes, "preferred", "yango", 1000)?.providerId, "internal");
  assert.equal(pickQuote([{ providerId: "yango", error: "timeout" }], "cheapest"), null);
});

test("numerário só nas transportadoras que cobram na entrega", () => {
  const now = 1;
  const yango = localQuote("yango", order, now);
  const fleet = localQuote("internal", { ...order, paymentMethod: "cash", codKz: 9000 }, now);
  assert.equal(codAllows(yango, "cash"), false);
  assert.equal(codAllows(fleet, "cash"), true);
  assert.equal(codAllows(yango, "multicaixa"), true);
});

test("mapeamento de estados Yango e frota", () => {
  assert.equal(mapExternalStatus("yango", "performer_found"), "estafeta_atribuido");
  assert.equal(mapExternalStatus("yango", "delivering"), "a_caminho_do_cliente");
  assert.equal(mapExternalStatus("yango", "returned"), "devolvido_a_loja");
  assert.equal(mapExternalStatus("yango", "nope"), null);
  assert.equal(
    simulatedStatus({
      kind: "yango",
      dispatchedAt: 0,
      now: 10_000,
      assignAfterMs: 180_000,
      cancelled: false,
      manualEstado: null,
    }),
    "a_procurar_estafeta",
  );
  assert.equal(
    simulatedStatus({
      kind: "internal",
      dispatchedAt: 0,
      now: 40_000,
      assignAfterMs: 0,
      cancelled: false,
      manualEstado: null,
    }),
    "a_caminho_do_cliente",
  );
});

test("webhook sem assinatura é recusado e o evento repetido não duplica", () => {
  const secret = "segredo-teste";
  const raw = JSON.stringify({
    event_id: "evt-1",
    claim_id: "YG-1",
    status: "performer_found",
    courier: { name: "João", phone: "+244923000999" },
  });
  assert.equal(decideWebhook({ rawBody: raw, signature: undefined, secret, seen: new Set() }).ok, false);
  assert.deepEqual(
    decideWebhook({ rawBody: raw, signature: "00", secret, seen: new Set() }),
    { ok: false, error: "bad_signature" },
  );
  const signature = signBody(secret, raw);
  const first = decideWebhook({ rawBody: raw, signature, secret, seen: new Set() });
  assert.equal(first.ok && first.duplicate, false);
  assert.equal(first.ok && first.estado, "estafeta_atribuido");
  const again = decideWebhook({ rawBody: raw, signature, secret, seen: new Set(["evt-1"]) });
  assert.equal(again.ok && again.duplicate, true);
});

test("não cria duas entregas activas para a mesma encomenda", () => {
  assert.equal(
    assertDispatchSlot([{ orderId: "o1", attempt: 1, estado: "estafeta_atribuido" }], "o1", 2),
    "active",
  );
  assert.equal(
    assertDispatchSlot([{ orderId: "o1", attempt: 1, estado: "cancelado" }], "o1", 1),
    "duplicate",
  );
  assert.equal(
    assertDispatchSlot([{ orderId: "o1", attempt: 1, estado: "cancelado" }], "o1", 2),
    "ok",
  );
});

test("fallback quando o estafeta não aparece a tempo", () => {
  assert.equal(
    needsFallback({ estado: "a_procurar_estafeta", dispatchedAt: 0, now: 60_000, fallbackMin: 1 }),
    true,
  );
  assert.equal(
    needsFallback({ estado: "estafeta_atribuido", dispatchedAt: 0, now: 999_000, fallbackMin: 1 }),
    false,
  );
});

test("retries com timeout e sucesso à terceira", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error("timeout");
        },
        { attempts: 3, timeoutMs: 50, baseDelayMs: 0, sleep: async () => undefined },
      ),
    /timeout/,
  );
  assert.equal(calls, 3);
  let tries = 0;
  const value = await withRetry(
    async () => {
      tries += 1;
      if (tries < 3) throw new Error("falhou");
      return "ok";
    },
    { attempts: 3, timeoutMs: 50, baseDelayMs: 0, sleep: async () => undefined },
  );
  assert.equal(value, "ok");
  assert.equal(tries, 3);
});

test("Yango sandbox desligado não é cotado e a chave não aparece no erro", async () => {
  const secret = "super-secret-key";
  const off = createProviders({ now: () => 0, yangoEnabled: false, sandbox: true, apiKey: secret });
  await assert.rejects(() => off.yango.getQuote(order), /disabled/);
  const on = createProviders({
    now: () => 5,
    yangoEnabled: true,
    sandbox: false,
    apiKey: secret,
    fetchImpl: async () => {
      throw new Error(`boom ${secret}`);
    },
  });
  await assert.rejects(() => on.yango.getQuote(order), (err: Error) => {
    assert.equal(err.message.includes(secret), false);
    assert.match(err.message, /redigido|boom/);
    return true;
  });
  const sandbox = createProviders({ now: () => 5, yangoEnabled: true, sandbox: true });
  const quote = await sandbox.yango.getQuote(order);
  assert.equal(quote.providerId, "yango");
  assert.equal(quote.codOk, false);
});

test("telefone mascarado nos textos e no log", () => {
  assert.equal(maskPhone("+244945407841"), "+244 945 *** 841");
  assert.equal(maskPhone("+244923000111").includes("000111"), false);
  const leaked = sanitizeError("authorization: Bearer abcdefghijkl", ["abcdefghijkl"]);
  assert.equal(leaked.includes("abcdefghijkl"), false);
  const text = waText("atribuido", 1100, "4821", "Sara");
  assert.match(text, /CT-1100/);
  assert.match(text, /4821/);
  assert.equal(text.includes("+244923"), false);
});

test("provider manual e frota devolvem estados iniciais diferentes", async () => {
  const providers = createProviders({ now: () => 10, yangoEnabled: false, sandbox: true });
  const fleet = await providers.internal.createDelivery(order, "q");
  const manual = await providers.manual.createDelivery(order, "q");
  assert.equal(fleet.estado, "estafeta_atribuido");
  assert.equal(manual.estado, "a_procurar_estafeta");
  assert.equal(fleet.externalId.startsWith("FL-"), true);
});
