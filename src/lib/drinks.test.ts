import assert from "node:assert/strict";
import test from "node:test";
import { drinkChoices } from "./drinks.ts";

const base = {
  categoryName: "Bebidas",
  subcategoryName: "Cervejas",
  name: "Cuca 33 cl",
  format: "33 cl",
  unit: "Garrafa",
  stockLeft: 30,
  availability: "ok",
};

test("small bottles offer unit and market packs", () => {
  assert.deepEqual(
    drinkChoices(base)?.map((item) => item.qty),
    [1, 6, 12, 24],
  );
});

test("stock hides packs we cannot fill", () => {
  assert.deepEqual(
    drinkChoices({ ...base, stockLeft: 10 })?.map((item) => item.qty),
    [1, 6],
  );
});

test("large bottles stop at a six-pack", () => {
  assert.deepEqual(
    drinkChoices({
      ...base,
      subcategoryName: "Refrigerantes",
      name: "Coca-Cola 1,5 L",
      format: "1,5 L",
      unit: "Garrafa",
    })?.map((item) => item.qty),
    [1, 6],
  );
});

test("a pack already on the shelf is one unit", () => {
  assert.deepEqual(
    drinkChoices({
      ...base,
      name: "Cuca caixa 24 × 33 cl",
      format: "caixa 24 × 33 cl",
      unit: "Caixa",
    })?.map((item) => item.qty),
    [1],
  );
});

test("spirits stay by the bottle", () => {
  assert.deepEqual(
    drinkChoices({
      ...base,
      subcategoryName: "Destilados e outras",
      name: "Gin 70 cl",
      format: "70 cl",
    })?.map((item) => item.qty),
    [1],
  );
});

test("other aisles are unchanged", () => {
  assert.equal(drinkChoices({ ...base, categoryName: "Mercearia" }), null);
});
