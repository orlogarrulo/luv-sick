import assert from "node:assert/strict";
import test from "node:test";
import {
  discountPrice,
  floorPrice,
  inDeliveryZone,
  localMobileDigits,
  normalizePhone,
  withinMargin,
} from "./pricing.ts";

test("angolan phone numbers", () => {
  assert.equal(normalizePhone("923 456 789"), "+244923456789");
  assert.equal(normalizePhone("+244 923456789"), "+244923456789");
  assert.equal(normalizePhone("00244923456789"), "+244923456789");
  assert.equal(normalizePhone("0923456789"), "+244923456789");
  assert.equal(normalizePhone("923456789"), "+244923456789");
  assert.match(normalizePhone("923456789") ?? "", /^\+2449\d{8}$/);
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("812345678"), null);
  assert.equal(normalizePhone("92345678"), null);
  assert.equal(normalizePhone("9234567890"), null);
  assert.equal(localMobileDigits("+244923456789"), "923456789");
  assert.equal(localMobileDigits("00244923456789"), "923456789");
  assert.equal(localMobileDigits("812345678"), "");
  assert.equal(localMobileDigits("9"), "9");
});

test("margin floor refuses a loss", () => {
  const cost = 1000;
  const floor = floorPrice(cost, 15);
  assert.equal(floor, 1150);
  assert.equal(withinMargin(1150, cost, 15), true);
  assert.equal(withinMargin(1149, cost, 15), false);
  assert.equal(withinMargin(discountPrice(2000, "percent", 50), cost, 15), false);
  assert.equal(withinMargin(discountPrice(2000, "percent", 15), cost, 15), true);
});

test("delivery zone around the Talatona dark store", () => {
  assert.equal(inDeliveryZone(-8.916, 13.184), true);
  assert.equal(inDeliveryZone(-8.783, 13.37), false);
});
