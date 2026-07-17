/**
 * Tetel-megadas ertelmezese a --item kapcsolohoz. Formak:
 *   "OFF2021"        -> { sku: "OFF2021", qty: 1 }
 *   "OFF2021=3"      -> { sku: "OFF2021", qty: 3 }
 *   "id:123=2"       -> { productId: 123, qty: 2 }
 */

export interface ItemSpec {
  sku?: string;
  productId?: number;
  qty: number;
}

export function parseItemSpec(spec: string): ItemSpec {
  const raw = spec.trim();
  if (!raw) throw new Error("Üres tétel-megadás.");

  const eq = raw.lastIndexOf("=");
  const idPart = eq === -1 ? raw : raw.slice(0, eq);
  const qtyPart = eq === -1 ? "" : raw.slice(eq + 1);

  let qty = 1;
  if (qtyPart !== "") {
    qty = Number(qtyPart);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      throw new Error(
        `Érvénytelen darabszám: "${qtyPart}" (1-999 közötti egész szám kell).`,
      );
    }
  }

  if (idPart.toLowerCase().startsWith("id:")) {
    const productId = Number(idPart.slice(3));
    if (!Number.isInteger(productId) || productId < 1) {
      throw new Error(`Érvénytelen termék-azonosító: "${idPart}".`);
    }
    return { productId, qty };
  }

  if (idPart.length === 0) {
    throw new Error(`Hiányzó cikkszám a tételben: "${spec}".`);
  }
  return { sku: idPart, qty };
}
