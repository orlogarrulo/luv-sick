import assert from "node:assert/strict";
import test from "node:test";
import { entregaCentavosToKz, mapEntregaStatus, mapFleetStatus, summarizeTrackPayload } from "./tracking-apis.ts";

test("estados Fleet e Entrega traduzem para o percurso da loja", () => {
  assert.equal(mapFleetStatus("picked_up"), "recolhido");
  assert.equal(mapFleetStatus("in_transit"), "a_caminho_do_cliente");
  assert.equal(mapFleetStatus("nope"), null);
  assert.equal(mapEntregaStatus("out_for_delivery"), "a_caminho_do_cliente");
  assert.equal(mapEntregaStatus("stalled"), "a_procurar_estafeta");
  assert.equal(entregaCentavosToKz(450000), 4500);
});

test("o corpo da Yango expõe posição e ligação, sem inventar estado", () => {
  const summary = summarizeTrackPayload("yango", {
    position: { lat: -8.9, lon: 13.2 },
    route_points: [{ type: "destination", sharing_link: "https://yango.example/t/1" }],
  });
  assert.equal(summary.lat, -8.9);
  assert.equal(summary.lng, 13.2);
  assert.equal(summary.trackingUrl, "https://yango.example/t/1");
  assert.equal(summary.mapped, null);
});

test("o corpo da Fleet lê estado, página e condutor", () => {
  const summary = summarizeTrackPayload("fleet", {
    data: {
      status: "in_transit",
      tracking_url: "https://fleet.ao/t/F75",
      driver: { location: { lat: -8.84, lng: 13.23 } },
    },
  });
  assert.equal(summary.mapped, "a_caminho_do_cliente");
  assert.equal(summary.trackingUrl, "https://fleet.ao/t/F75");
  assert.equal(summary.lat, -8.84);
});

test("o seguimento público da Entrega não finge coordenadas", () => {
  const summary = summarizeTrackPayload("entrega", {
    status: "delivered",
    reference: "DLV-1",
    events: [{ event_type: "delivery.delivered", occurred_at: "2026-11-17T12:00:00Z" }],
  });
  assert.equal(summary.mapped, "entregue");
  assert.equal(summary.lat, null);
  assert.match(summary.note, /1 eventos/);
});
