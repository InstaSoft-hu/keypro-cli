/**
 * A DROPSHIPPING KAPUINAK EGYETLEN SZOVEGES FORRASA.
 *
 * MERT ELOZMENY (2026-09-15, R1-12). A "mikor utasitjuk el" mondat NEGY helyen
 * allt kulon-kulon kezzel megirva - `AGENT_DOCS`, `cli/API.md`, a CHANGELOG es a
 * ket MCP tool-leiras -, es a NEGYEDIK csuszott el: az MCP-leiras a
 * `keypro_order_preview` / `keypro_order_create` `dropshipping` mezojen meg
 * mindig azt allitotta, hogy "Physical shipments only, otherwise
 * dropshipping_requires_shipping (400)". Ez az uj szabaly ota TEVES ket iranyban
 * is: a `combine_free` rendeles FIZIKAI, megis elutasitjuk, es a hozza tartozo
 * `dropshipping_requires_own_parcel` kodot a leiras meg sem emlitette. A leiras
 * pedig pontosan az a szoveg, amit MINDEN csatlakozo modell olvas - egy teves
 * mondat ott nem kozlesi hiba, hanem rossz rendelesek sorozata.
 *
 * EZERT A MONDAT GENERALT. A tabla itt all, es minden felulet a SAJAT
 * kod-halmazara kerdez ra (`dropshippingRefusalSentence`). Egy uj elutasitasi
 * kod igy EGY helyen keletkezik, es a `dropshipping-contract.test.ts` allitja,
 * hogy mindket MCP-leiras ebbol a generatorbol jon - kezzel irt otodik peldany
 * nem keszulhet.
 *
 * A TENY tulajdonosa NEM itt van, hanem a shopban
 * (`src/lib/shipping/dropshipping.ts` enum-kulcsu `DROPSHIPPING_ELIGIBILITY_CODE`
 * tablaja es a `/api/v1` route). Ez a modul a MONDATOK tulajdonosa. A ketto
 * kotese a shop-oldali `dropshipping-codes.test.ts`, ami a route-ban dobott
 * kodokat veti ossze az itteni tablaval - a `cli/` ugyanis onallo npm csomag,
 * es szandekosan nem importal a `src/`-bol.
 *
 * A magyar `cli/API.md` nem ezt a stringet hasznalja (mas nyelv), de ugyanezt a
 * OT kodot kell hoznia; azt is a fenti teszt koti le.
 */

/**
 * A HAROM FELULET, ahol a jelzo egyaltalan elutasithato. A kod maga kozos, a
 * HTTP statusz viszont NEM: a rendelesfelvetel egy BEMENETET utasit vissza
 * (`400`), a ket utolagos vegpont pedig egy MAR LETEZO rendeles allapotaval
 * utkozik (`409`).
 */
export type DropshippingSurface = "order" | "toggle" | "payment";

/**
 * Egy elutasitas: a HTTP statusz FELULETENKENT + a "mikor" tagmondat (angolul,
 * a doksi nyelven).
 *
 * MIERT FELULETENKENT (2026-09-15, R1-15). Kodonkent EGY statusz allt itt,
 * holott a `dropshipping_requires_shipping` es a
 * `dropshipping_requires_own_parcel` a rendelesfelvetelen `400`, az utolagos
 * atallitason viszont `409` - a generalt mondat tehat a ket felulet egyiken
 * BIZTOSAN hazudott, mikozben a kezzel irt `cli/API.md` helyesen mondta
 * mindkettot. Egy modell a statusz szerint agazik el (ujraprobal-e, javitja-e a
 * bemenetet), tehat ez nem kozlesi hiba.
 *
 * A kulcsok halmaza EGYBEN azt is kimondja, MELYIK feluleten fordulhat elo a
 * kod - igy nincs masodik, kezzel irt felulet-lista, ami elavulhatna.
 */
export interface DropshippingRefusal {
  status: Partial<Record<DropshippingSurface, number>>;
  /** Kiegeszito tagmondat: "... because <when>". Pont nelkul. */
  when: string;
}

/**
 * Az OT elutasitasi kod. A sorrend a mondatba is atmegy, ezert
 * a leggyakoribbtol a legritkabbig all.
 */
export const DROPSHIPPING_REFUSALS = {
  dropshipping_requires_shipping: {
    status: { order: 400, toggle: 409 },
    when: "the order is digital only, so there is no parcel to post at all",
  },
  dropshipping_requires_own_parcel: {
    status: { order: 400, toggle: 409 },
    when:
      "the order is bundled (combine_free) into an EARLIER order's parcel, " +
      "so it has no parcel of its own - the posting runs on the PARENT order " +
      "and reads the PARENT's dropshipping flag",
  },
  dropshipping_excludes_cod: {
    status: { order: 400, toggle: 409, payment: 400 },
    when:
      "the order is cash on delivery (cod): the courier would collect the " +
      "order total - YOUR OWN purchase price - from your end customer, into " +
      "the shop's account, so they would learn what you paid and settle a debt " +
      "that is not theirs. The two can never be combined, in EITHER direction: " +
      "neither dropshipping on a cod order, nor switching an existing " +
      "dropshipping order to cod",
  },
  dropshipping_has_combined_orders: {
    status: { toggle: 409 },
    when:
      "another (combine_free) order already rides in THIS order's parcel, so " +
      "your own goods would go out to your end customer - that order has to " +
      "get a shipment of its own first",
  },
  dropshipping_locked: {
    status: { toggle: 409 },
    when:
      "the parcel is no longer open: the GLS label has been requested, the " +
      "order is closed, or it carries no shipment",
  },
} as const satisfies Record<string, DropshippingRefusal>;

export type DropshippingRefusalCode = keyof typeof DROPSHIPPING_REFUSALS;

/**
 * Egy felulet kod-halmaza a TABLABOL szarmaztatva, nem kezzel felsorolva: a
 * statusz-kulcs megleté MAGA a "ezen a feluleten elofordulhat" allitas, tehat
 * egy uj kod nem tud kimaradni egy kezzel karbantartott listabol.
 */
export function dropshippingRefusalCodesFor(
  surface: DropshippingSurface,
): DropshippingRefusalCode[] {
  const codes = Object.keys(DROPSHIPPING_REFUSALS) as DropshippingRefusalCode[];
  return codes.filter((code) => {
    // A szeles tipuson at indexelunk: az `as const` kulonben minden sort a
    // SAJAT statusz-kulcsaira szukit, es egy olyan feluletre valo rakerdezes,
    // amit az a sor nem ismer, typecheck-hiba lenne.
    const refusal: DropshippingRefusal = DROPSHIPPING_REFUSALS[code];
    return refusal.status[surface] !== undefined;
  });
}

/**
 * A RENDELESFELVETEL (preview / create) kodjai. `dropshipping_locked` es
 * `dropshipping_has_combined_orders` itt nem lehet: a rendeles most keletkezik,
 * tehat sem cimkeje, sem hozzacsomagolt gyereke nincs meg.
 */
export const DROPSHIPPING_ORDER_REFUSALS = dropshippingRefusalCodesFor("order");

/** Az UTOLAGOS ATALLITAS kodjai: mind a negy dropshipping-kod elofordulhat. */
export const DROPSHIPPING_TOGGLE_REFUSALS =
  dropshippingRefusalCodesFor("toggle");

/**
 * A FIZETESIMOD-VALTAS kodjai. Egyetlen kod all itt: a masik negy a dropshipping
 * JELZOROL szol, amit ez a vegpont nem is allit - ez a felulet a MASIK iranyt
 * zarja (cod-ra valtas egy mar dropshipping rendelesen).
 */
export const DROPSHIPPING_PAYMENT_REFUSALS =
  dropshippingRefusalCodesFor("payment");

/**
 * A "mikor utasitjuk el" mondat EGY feluletre.
 *
 * Mindig NEVESITI a kodot, a FELULET SAJAT statuszat ES az okot: a puszta kod
 * egy modellnek nem mondja meg, mit tegyen, a puszta ok pedig nem parositható a
 * valasz `error.code` mezojehez. A statusz a feluletbol jon, nem a kodbol -
 * ugyanaz a kod ket feluleten ket statusz.
 */
export function dropshippingRefusalSentence(
  surface: DropshippingSurface,
): string {
  const parts = dropshippingRefusalCodesFor(surface).map((code) => {
    const refusal: DropshippingRefusal = DROPSHIPPING_REFUSALS[code];
    return `${code} (${refusal.status[surface]}) when ${refusal.when}`;
  });
  return `Refused with ${parts.join("; ")}.`;
}

/**
 * A KOZOS bevezeto mondat - amit a jelzo JELENT. Minden felulet ezt hasznalja,
 * a sajat nevei (REST vegpont / MCP tool / CLI kapcsolo) korul.
 */
export const DROPSHIPPING_MEANING =
  "we post the parcel straight to YOUR end customer, IN YOUR NAME: your own " +
  "name and address on the label as sender, and nothing on or in the parcel " +
  "identifies KeyPro. Into the box go your own licence transfer documents " +
  "and, if you uploaded one, your own invoice.";
