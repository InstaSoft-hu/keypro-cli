/**
 * Az ar-szerzodes EGYETLEN forrasa.
 *
 * Harom allitas, es mind a harom PENZROL szol egy partnernek (illetve egy
 * partner nevegen eljaro modellnek) szant feluleten:
 *
 *  1. a katalogus ara NEM tartalmazza a hivo szerzodeses kedvezmenyet,
 *  2. a hivo sajat egysegara a `yourUnitNetEur`,
 *  3. kotelezo ervenyu osszeg mindig az elonezete.
 *
 * Ugyanez a mondat HAROM helyen allt (`AGENT_DOCS`, a belole generalt
 * `AGENTS.md`, es a `KEYPRO_MCP_INSTRUCTIONS`), es a harmadik elcsuszott:
 * elesben azt tanitotta MINDEN csatlakozo modellnek, hogy az ar "already
 * includes the caller's own contracted discounts" - pontosan az ellenkezojet
 * annak, amit a masik ketto mond. Egy ilyen csuszas nem kozlesi hiba, hanem
 * rossz ar a vegfelhasznalonak.
 *
 * Ezert a szoveg itt EGYSZER all, es a felulet csak a SAJAT neveit adja hozza
 * (REST vegpont vagy MCP tool). A mezonevek (`netPriceEur`,
 * `listNetPriceEur`, `yourUnitNetEur`) mindket feluleten azonosak, mert az MCP
 * ugyanazt a `/api/v1` valaszt adja tovabb.
 *
 * A magyar `cli/API.md` nem ezt a stringet hasznalja (mas nyelv), de a harom
 * allitast neki is hoznia kell: azt a `price-contract.test.ts` koti le.
 */

export type PriceContractSurface = {
  /** A katalogus-arat ado felulet (`GET /products`, `keypro_products_search`). */
  catalog: string;
  /** A hivo sajat egysegarat ado felulet (`GET /products/{key}`, `keypro_product_get`). */
  ownPrice: string;
  /** A kotelezo ervenyu osszeget ado felulet (`POST /orders/preview`, `keypro_order_preview`). */
  preview: string;
};

export type PriceContractWrap = {
  /** Maximalis sorhossz, az elotagokkal egyutt. */
  width: number;
  /** Az ELSO sor elotagja (pl. `"- "` egy markdown felsorolasban). */
  firstPrefix?: string;
  /** A tobbi sor elotagja (pl. `"  "`). */
  prefix?: string;
};

/**
 * Szohatarnal tordel, sorhosszra es elotagokra. Tiszta fuggveny.
 *
 * Egy kodreszlet (`` `GET /products/{key}` ``) NEM torheto ket sorba: a
 * markdown ugyan meg osszerakna, de az MCP-leiras nyers szoveg, es a
 * `\`GET\n  /products/{key}\`` alak ott egyszeruen olvashatatlan. Ezert a
 * paratlan darabszamu backtick nyitva tartja a darabot a zaroig.
 */
export function wrapText(text: string, wrap: PriceContractWrap): string {
  const firstPrefix = wrap.firstPrefix ?? "";
  const prefix = wrap.prefix ?? "";
  const lines: string[] = [];
  let current = firstPrefix;
  let empty = true;

  const words: string[] = [];
  let open = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    open = open ? `${open} ${word}` : word;
    if ((open.match(/`/g) ?? []).length % 2 === 0) {
      words.push(open);
      open = "";
    }
  }
  if (open) words.push(open);

  for (const word of words) {
    const candidate = empty ? current + word : `${current} ${word}`;
    if (!empty && candidate.length > wrap.width) {
      lines.push(current);
      current = prefix + word;
    } else {
      current = candidate;
    }
    empty = false;
  }
  if (!empty) lines.push(current);
  return lines.join("\n");
}

/**
 * Az ar-szerzodes szovege az adott felulet sajat neveivel. Ezt a fuggvenyt
 * hivja az `AGENT_DOCS` es a `KEYPRO_MCP_INSTRUCTIONS` is - masodik, kezzel
 * irt peldany nem keszulhet (`price-contract.test.ts`).
 */
export function priceContract(
  surface: PriceContractSurface,
  wrap?: PriceContractWrap,
): string {
  const text =
    `Prices are net EUR, and ${surface.catalog} returns CATALOG prices ` +
    "(`netPriceEur`, `listNetPriceEur`) WITHOUT the caller's contracted " +
    "discount. The caller's own unit price is `yourUnitNetEur` on " +
    `${surface.ownPrice} (and on its \`variants[]\`); the BINDING amount is ` +
    `always the one returned by ${surface.preview}.`;
  return wrap ? wrapText(text, wrap) : text;
}

/**
 * A HAMIS allitas ALAKJA, ami 2026-08-09-ig elesben futott ("prices ... already
 * include the caller's own contracted discounts"). Egyetlen szallitott angol
 * szoveg sem mondhat ilyet - ezt a `price-contract.test.ts` minden feluletre
 * ellenorzi. A `\b` hatarok miatt az `includeVariants` / `include_variants`
 * parameternev nem illeszkedik ra.
 */
export const FALSE_PRICE_CLAIM =
  /\b(?:already|includes?|including|contains?)\b[^.]{0,80}\bdiscounts?\b/i;
