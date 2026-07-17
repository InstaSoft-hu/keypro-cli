import { describe, it, expect } from "vitest";
import { parseItemSpec } from "./items.js";

describe("parseItemSpec", () => {
  it("SKU darabszam nelkul: qty 1", () => {
    expect(parseItemSpec("OFF2021")).toEqual({ sku: "OFF2021", qty: 1 });
  });

  it("SKU=QTY", () => {
    expect(parseItemSpec("OFF2021=3")).toEqual({ sku: "OFF2021", qty: 3 });
  });

  it("id:N=QTY", () => {
    expect(parseItemSpec("id:123=2")).toEqual({ productId: 123, qty: 2 });
  });

  it("id:N darabszam nelkul", () => {
    expect(parseItemSpec("id:7")).toEqual({ productId: 7, qty: 1 });
  });

  it("SKU-ban lehet egyenlosegjel elotti kettospont", () => {
    expect(parseItemSpec("SKU:VALTOZAT=2")).toEqual({
      sku: "SKU:VALTOZAT",
      qty: 2,
    });
  });

  it("hibak: rossz qty, rossz id, ures", () => {
    expect(() => parseItemSpec("OFF2021=0")).toThrow();
    expect(() => parseItemSpec("OFF2021=1.5")).toThrow();
    expect(() => parseItemSpec("OFF2021=ezer")).toThrow();
    expect(() => parseItemSpec("id:abc=1")).toThrow();
    expect(() => parseItemSpec("")).toThrow();
    expect(() => parseItemSpec("=2")).toThrow();
  });
});
