/**
 * Megosztott MCP tool-registry: a KeyPro muveletek nativ MCP tool-kent, ugyanazon
 * a KeyproClient-en keresztul. Ezt hasznalja a CLI stdio szerver (mcp.ts) ES a
 * webes tavoli MCP route (src/app/mcp/route.ts) - igy a tool-definiciok nem
 * csusznak szet. A McpServer csak tipuskent kell (type-only import), igy ez a
 * modul nem huzza be a stdio transportot a webes buildbe.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KeyproApiError, type KeyproClient } from "./client.js";
import {
  DROPSHIPPING_MEANING,
  dropshippingRefusalSentence,
} from "./dropshipping-contract.js";
import { priceContract } from "./price-contract.js";

// A webes tavoli MCP route (@keypro/cli/mcp-tools) innen kapja a klienst is,
// hogy a registry es a kliens UGYANABBOL a bundle-bol jojjon (kozos
// KeyproApiError -> az instanceof ellenorzes mukodik).
export { createClient, KeyproApiError } from "./client.js";
export type { KeyproClient, KeyproClientOptions } from "./client.js";

/**
 * A kiszolgalt MCP szerver verzioja - EGY helyen. A CLI stdio szerver, a webes
 * /mcp route es a `keypro --version` mind ezt hasznalja, igy nem csuszhat szet
 * (korabban a web 0.1.4-en ragadt). Kiadaskor a package.json-nal egyutt ez az
 * egy konstans valtozik.
 */
export const KEYPRO_MCP_VERSION = "0.1.17";

/**
 * A szerver `instructions` mezoje (MCP initialize). A kliens modellje ezt latja
 * a tool-lista mellett. Kell, mert kulonben a hivo modell azt hiszi, nincs
 * hozzaferese a fiokhoz, es a tool meghivasa helyett a weboldali bejelentkezest
 * ajanlja (a ChatGPT connector pontosan igy viselkedett).
 *
 * Az ar-bekezdes a KOZOS `priceContract(...)`-bol jon (`price-contract.ts`):
 * itt allt 2026-08-09-ig a hamis "already include the caller's own contracted
 * discounts" mondat, mikozben az `AGENT_DOCS` es az `API.md` mar az
 * ellenkezojet mondta. Kezzel irt masodik peldany ide nem kerulhet.
 */
export const KEYPRO_MCP_INSTRUCTIONS = `This server is already authenticated as ONE specific KeyPro.hu B2B customer account (OAuth or API key). Every tool acts on that account: there is no login step, no account or user id parameter, and no way to reach another account.

Never tell the user to log in on the website, and never claim you cannot access their account or orders. Call the tool instead. If you are unsure who the caller is, call keypro_whoami first.

${priceContract({
  catalog: "keypro_products_search",
  ownPrice: "keypro_product_get",
  preview: "keypro_order_preview",
})} keypro_exchange_rate gives the HUF rate the shop displays.

Ordering is preview-then-confirm: call keypro_order_preview (or keypro_order_change_payment_preview), show the returned totals to the user, get their approval, then call keypro_order_create (or keypro_order_change_payment) with the returned confirmToken.`;

/** Olvaso tool: nincs mellekhatas, es nem lep ki a KeyPro shopbol. */
const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Iro tool: a `destructive` / `idempotent` hint tool-onkent valtozik. */
function writeHints(opts: { destructive: boolean; idempotent: boolean }) {
  return {
    readOnlyHint: false,
    destructiveHint: opts.destructive,
    idempotentHint: opts.idempotent,
    openWorldHint: false,
  } as const;
}

const addressShape = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    company: z.string().optional(),
    address1: z.string().optional(),
    address2: z.string().optional(),
    city: z.string().optional(),
    postcode: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  })
  .optional();

const orderRequestShape = {
  items: z
    .array(
      z.object({
        sku: z.string().optional().describe("Product SKU (either sku or productId)"),
        productId: z.number().int().positive().optional(),
        qty: z.number().int().min(1).max(999).default(1),
      }),
    )
    .min(1)
    .describe("Order lines"),
  paymentMethod: z
    .enum(["bacs", "cheque", "cod", "wallet", "stripe", "internal"])
    .describe(
      "bacs=bank transfer (proforma first), cheque=8-day terms, available ONLY to accounts KeyPro has enabled for it (every other account gets payment_method_not_allowed, HTTP 403, already on the preview); settled on creation, so the key goes out before the money arrives and the order cannot be cancelled afterwards; +5% convenience fee on the net product total, waived on a few accounts by agreement, so read the fee from the preview's payment.fees[] (totals carries no fee line of its own), cod=cash on delivery, wallet=KEP balance (NO invoice for such an order, only a delivery note - the balance is invoiced when it is topped up), stripe=saved card, internal=internal settlement, available ONLY to the in-house partner account (every other account gets payment_method_not_allowed, HTTP 403, already on the preview): no payment is taken and NO document at all is issued for the order - no invoice, no proforma and no delivery note",
    ),
  shippingMethodId: z
    .enum(["gls_hd", "gls_parcelshop", "combine_free"])
    .optional()
    .describe("Required when the cart contains physical products"),
  parcelshopId: z
    .string()
    .optional()
    .describe("GLS pickup point id (required for gls_parcelshop)"),
  couponCode: z.string().optional(),
  currency: z.enum(["EUR", "HUF"]).default("EUR"),
  billing: addressShape.describe(
    "Per-field billing address overrides (defaults come from the user profile)",
  ),
  shipping: addressShape.describe(
    "Separate shipping address (omit to ship to the billing address). A key " +
      "you leave out is filled from your saved profile shipping address - " +
      "EXCEPT with dropshipping=true, where this block is your END CUSTOMER " +
      "and a missing key stays missing (lastName, address1, city, postcode, " +
      "country are required, otherwise validation_failed 400 naming them in " +
      "details.missing). With dropshipping=true email is stored on the order " +
      "(empty is fine, a malformed one is validation_failed 400) and counts " +
      "as the recipient's contact just like phone; on a normal order email is " +
      "ignored (GLS notifies your billing e-mail).",
  ),
  taxNumber: z.string().optional(),
  internalReference: z
    .string()
    .optional()
    .describe(
      // A MASODIK MONDAT SZO SZERINTI MASOLAT: a bolt oldalan a
      // `internalReferenceDocumentScope()` (`src/lib/invoicing/build.ts`)
      // GENERALJA ugyanezt abbol a tablabol, ami a bizonylat `comment` mezojet
      // tolti. Ez a csomag onalloan publikalt npm modul, innen az a modul nem
      // importalhato - ezert masolat, es ezert allitja a szerver oldali
      // `internal-reference.test.ts` SZO SZERINT az egyezoseget. Ha ezt a
      // mondatot atirod, a teszt PIROS lesz, es a forras a tabla, nem ez a sor.
      "Your own internal reference / PO number for this order, printed verbatim. It is printed in the comment field of the FINANCIAL documents (proforma, prepayment invoice, final invoice, invoice, correction, storno) and never on the delivery note; a KEP-balance (wallet) order gets no financial document at all, so on such an order the reference is printed on nothing.",
    ),
  dropshipping: z
    .boolean()
    .optional()
    // A MONDAT GENERALT (`dropshipping-contract.ts`), nem kezzel irt: a kezzel
    // irt valtozat a `combine_free` ag bevezetese utan TEVES maradt, es a
    // `dropshipping_requires_own_parcel` kodot meg sem emlitette.
    .describe(
      `true = ${DROPSHIPPING_MEANING} It needs an order with a parcel of ` +
        `its OWN (gls_hd or gls_parcelshop). ` +
        `${dropshippingRefusalSentence("order")} ` +
        "Can still be changed afterwards with keypro_order_set_dropshipping, " +
        "until the GLS label is requested.",
    ),
  cardId: z
    .string()
    .optional()
    .describe("Saved card id (pm_...) for stripe payments; omit for default card"),
};

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  const payload =
    err instanceof KeyproApiError
      ? { code: err.code, message: err.message, details: err.details }
      : { code: "cli_error", message: err instanceof Error ? err.message : String(err) };
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: payload }) }],
    isError: true,
  };
}

async function run<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

/** A KeyPro MCP tool-jait regisztralja a megadott McpServer-re. */
export function registerKeyproTools(server: McpServer, client: KeyproClient): void {
  server.registerTool(
    "keypro_whoami",
    {
      title: "Who am I",
      description:
        "The KeyPro account this connection is authenticated as (email, company, role, KEP wallet balance, API key scopes). Call this instead of asking the user to log in.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => run(() => client.me()),
  );

  server.registerTool(
    "keypro_exchange_rate",
    {
      title: "EUR to HUF rate",
      description:
        "Current EUR->HUF exchange rate the shop uses and displays (ECB daily reference + 3% markup). Product net prices are stored in EUR; the HUF price = round(EUR * rate) to whole forint (EUR shown with 2 decimals). Call this to price products accurately in both currencies.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => run(() => client.exchangeRate()),
  );

  server.registerTool(
    "keypro_products_search",
    {
      title: "Search products",
      description:
        "Search the catalog by name, SKU, MANUFACTURER part number, MANUFACTURER name or barcode (`q` matches all five as a case-insensitive fragment). Returns id, sku, name and the CATALOG net EUR price (netPriceEur, listNetPriceEur) - that price does NOT carry the caller's contracted discount, so never quote it as the caller's own price: use yourUnitNetEur from keypro_product_get, and the binding total from keypro_order_preview. A product with type='variable' is a GROUP that cannot be ordered directly - order one of the productIds listed in its `variants` array. Pass includeVariants=true to get variant rows in the flat list too. Every product and every variant entry carries `licenseNature` ('used' | 'new' | 'subscription'): what the buyer legally gets, and therefore which end-user document may be issued about it. It is SEPARATE from fulfillmentType (what the buyer receives) - a digitally delivered key can be a used licence or a new one - and it is readable here, BEFORE ordering. Every product and every variant entry also carries `manufacturerPartNumber`: the MANUFACTURER's own article number (MPN, e.g. DG7GMGF0PN5D), or null when the product has none. It is SEPARATE from `sku` - `sku` is KeyPro's identifier and is UNIQUE, so an order resolves by it, while the manufacturer number may repeat across variants and CANNOT be used to order. Use it to match the catalog against a manufacturer or supplier price list: `q` searches this field too, so a manufacturer number copied straight out of a price list answers 'do you carry this?' in one call. Every product and every variant entry also carries three more MANUFACTURER fields: `manufacturer` (the manufacturer's name / brand, e.g. 'Microsoft'), `gtin` (the product barcode - EAN / UPC / GTIN, digits only, and the check digit is verified before it is stored) and `manufacturerUrl` (the manufacturer's own product page, a full http(s) address). Each is null when the row has none. Use `manufacturer` to group or filter the catalog by vendor - the brand cannot be read out of the product name by machine ('Windows 11 Pro' does not say Microsoft) - and `gtin` to match against a webshop feed or a supplier list. None of them is unique and NONE of them can be used to order: that still needs the sku or the productId. A VARIANT WITH NO `manufacturer` OR `manufacturerUrl` OF ITS OWN IS SERVED ITS GROUP'S (the brand of a family member is necessarily the family's brand, and the manufacturer's page describes the family), but `gtin` and `manufacturerPartNumber` are NEVER inherited: those identify the exact article and package, which is precisely what the variants differ in, so an inherited value would name a DIFFERENT product. Every product and every variant entry also carries an `images` array of { url, alt, position }: ordered, always present (empty when the product has no picture, never null). The urls are ABSOLUTE and directly fetchable, so you can show or download them without building a link yourself. `images[0]` is the featured image AMONG THE SERVED ONES: a stored image the shop cannot serve is left out of the array (the server logs it), so on such a product the next image becomes `images[0]`. A VARIANT WITH NO OWN IMAGE INHERITS ITS GROUP'S: a variant that has at least one servable image of its own carries only that one, and a variant that has none is served the group's array unchanged (same filtering, same `images[0]` rule). Inheritance never runs the other way, so a picture on a variant may in fact depict the whole group - today the variants do not look different from each other. Every product and every variant entry also carries the product COPY in three fields: `shortDescriptionBullets` (the bullet list the shop prints next to the picture, e.g. 'Azonnali online aktiválás 1 PC-re'), `shortDescription` (the text under the bullets) and `description` (the long description). `shortDescriptionBullets` is ALWAYS an array, empty when the row has none, never null; the other two are a string or null, never an empty string. All three are PLAIN TEXT, not HTML, and their line breaks carry meaning: an empty line starts a paragraph and a line beginning with -, * or • is a bullet point. A VARIANT WITH NO COPY OF ITS OWN INHERITS ITS GROUP'S, FIELD BY FIELD: where the variant has its own value you get that one and the group's text is NOT appended to it, where it has none the group's value is served unchanged, and each of the three fields is decided separately. Inheritance never runs the other way, so the copy on a variant may describe the whole family - in the shop a variant has no page of its own, so the buyer reads the family's text as well.",
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe(
            "Search text: name, SKU, manufacturer part number (MPN), manufacturer name or barcode (EAN/GTIN); case-insensitive, matches anywhere in the value. On the BARCODE branch the spaces and hyphens are dropped from your text first (exactly as they are when a barcode is stored), so '590-1234 123457' finds the stored 5901234123457; a text that is not all digits is not matched against the barcode at all, while the other four fields are searched as usual.",
          ),
        category: z
          .string()
          .optional()
          .describe("Category slug filter (subcategories included)"),
        onSale: z.boolean().optional().describe("Only discounted products"),
        includeVariants: z
          .boolean()
          .optional()
          .describe(
            "List variant rows as separate results too (default: only group rows, with their variants nested)",
          ),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      run(() =>
        client.productsSearch({
          q: args.q,
          category: args.category,
          onSale: args.onSale,
          includeVariants: args.includeVariants,
          limit: args.limit,
        }),
      ),
  );

  server.registerTool(
    "keypro_product_get",
    {
      title: "Product details",
      description:
        "Product details plus YOUR effective unit price. For a type='variable' group the response has notPurchasable=true and a `variants` array, each entry with its own productId, attributes and yourUnitNetEur - order one of those. The product and every variant entry also carries `licenseNature` ('used' | 'new' | 'subscription'): what the buyer legally gets, and therefore which end-user document may be issued about it. It is SEPARATE from fulfillmentType (what the buyer receives), and a variant may differ from its group - the variant is the row that is actually bought. Every product and every variant entry also carries `manufacturerPartNumber`: the MANUFACTURER's own article number (MPN, e.g. DG7GMGF0PN5D), or null when the product has none. It is SEPARATE from `sku` - `sku` is KeyPro's identifier and is UNIQUE, so an order resolves by it, while the manufacturer number may repeat across variants and CANNOT be used to order. Use it to match the catalog against a manufacturer or supplier price list. Every product and every variant entry also carries three more MANUFACTURER fields: `manufacturer` (the manufacturer's name / brand, e.g. 'Microsoft'), `gtin` (the product barcode - EAN / UPC / GTIN, digits only, and the check digit is verified before it is stored) and `manufacturerUrl` (the manufacturer's own product page, a full http(s) address). Each is null when the row has none. Use `manufacturer` to group or filter the catalog by vendor - the brand cannot be read out of the product name by machine ('Windows 11 Pro' does not say Microsoft) - and `gtin` to match against a webshop feed or a supplier list. None of them is unique and NONE of them can be used to order: that still needs the sku or the productId. A VARIANT WITH NO `manufacturer` OR `manufacturerUrl` OF ITS OWN IS SERVED ITS GROUP'S (the brand of a family member is necessarily the family's brand, and the manufacturer's page describes the family), but `gtin` and `manufacturerPartNumber` are NEVER inherited: those identify the exact article and package, which is precisely what the variants differ in, so an inherited value would name a DIFFERENT product. The product and every variant entry carries an `images` array of { url, alt, position }: ordered, always present (empty when the product has no picture, never null). The urls are ABSOLUTE and directly fetchable, so you can show or download them without building a link yourself. `images[0]` is the featured image AMONG THE SERVED ONES: a stored image the shop cannot serve is left out of the array (the server logs it), so on such a product the next image becomes `images[0]`. A VARIANT WITH NO OWN IMAGE INHERITS ITS GROUP'S: a variant that has at least one servable image of its own carries only that one, and a variant that has none is served the group's array unchanged (same filtering, same `images[0]` rule). Inheritance never runs the other way, so a picture on a variant may in fact depict the whole group - today the variants do not look different from each other. Every product and every variant entry also carries the product COPY in three fields: `shortDescriptionBullets` (the bullet list the shop prints next to the picture, e.g. 'Azonnali online aktiválás 1 PC-re'), `shortDescription` (the text under the bullets) and `description` (the long description). `shortDescriptionBullets` is ALWAYS an array, empty when the row has none, never null; the other two are a string or null, never an empty string. All three are PLAIN TEXT, not HTML, and their line breaks carry meaning: an empty line starts a paragraph and a line beginning with -, * or • is a bullet point. A VARIANT WITH NO COPY OF ITS OWN INHERITS ITS GROUP'S, FIELD BY FIELD: where the variant has its own value you get that one and the group's text is NOT appended to it, where it has none the group's value is served unchanged, and each of the three fields is decided separately. Inheritance never runs the other way, so the copy on a variant may describe the whole family - in the shop a variant has no page of its own, so the buyer reads the family's text as well.",
      inputSchema: { key: z.string().describe("Product id, slug or SKU") },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.productGet(args.key)),
  );

  server.registerTool(
    "keypro_order_preview",
    {
      title: "Preview an order",
      description:
        "Preview an order WITHOUT placing it: priced lines, fees, shipping, totals, and a confirmToken (valid 15 minutes). ALWAYS show the returned totals to the user and get their approval before calling keypro_order_create. The `stock` block says what ships immediately and what has to be procured first (`backordered > 0`): the order is never blocked for stock, but tell the user before placing it.",
      inputSchema: orderRequestShape,
      annotations: READ_ONLY,
    },
    (args) => run(() => client.orderPreview(args)),
  );

  server.registerTool(
    "keypro_order_create",
    {
      title: "Place an order",
      description:
        "Place an order. Requires the confirmToken from keypro_order_preview (same items, payment method and total). If the response contains payment.paymentUrl, give that link to the user to finish paying in a browser. Pass idempotencyKey to make retries safe.",
      annotations: writeHints({ destructive: false, idempotent: false }),
      inputSchema: {
        ...orderRequestShape,
        confirmToken: z.string().describe("Token from keypro_order_preview"),
        idempotencyKey: z
          .string()
          .optional()
          .describe("Unique retry-dedup key; the same key never creates a second order"),
      },
    },
    (args) =>
      run(() => {
        const { idempotencyKey, ...request } = args;
        return client.orderCreate(request, idempotencyKey);
      }),
  );

  server.registerTool(
    "keypro_orders_list",
    {
      title: "List my orders",
      description:
        "List the orders of the authenticated account (newest first), optional status filter. This is the caller's own order history; no login or extra permission is needed.",
      inputSchema: {
        status: z.string().optional().describe("e.g. pending, processing, completed"),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.ordersList({ status: args.status, limit: args.limit })),
  );

  server.registerTool(
    "keypro_order_get",
    {
      title: "Order details",
      description:
        "Order details: items, totals, status, invoices, and a payment link if the order is awaiting card payment.",
      inputSchema: { orderId: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.orderGet(args.orderId)),
  );

  server.registerTool(
    "keypro_order_keys",
    {
      title: "Keys of an order",
      description:
        "License keys delivered for one order. COD orders release keys only after completion.",
      inputSchema: { orderId: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.orderKeys(args.orderId)),
  );

  server.registerTool(
    "keypro_order_set_dropshipping",
    {
      title: "Turn dropshipping on/off for an order",
      // A "mikor utasitjuk el" mondat GENERALT (`dropshipping-contract.ts`):
      // kezzel irva itt is elavult, amint uj kapu keletkezett.
      description:
        `Switch DROPSHIPPING on or off for one of YOUR orders. With ` +
        `dropshipping=true ${DROPSHIPPING_MEANING} Switching it ON needs an ` +
        `order whose parcel is still open and carries nothing else. ` +
        `${dropshippingRefusalSentence("toggle")} ` +
        "Switching it OFF is always allowed while the parcel is open - that " +
        "is the safe direction. Whether the parcel is still open is a FACT " +
        "check, not a status check: an admin can set prepared-shipping by hand " +
        "with no label, and then the box is still open; but once the label is " +
        "requested the SENDER NAME is already decided, so a later switch would " +
        "be a lie. Every change is recorded as an internal order note naming " +
        "the actor.",
      inputSchema: {
        orderId: z.number().int().positive(),
        dropshipping: z.boolean(),
      },
      annotations: writeHints({ destructive: false, idempotent: true }),
    },
    (args) =>
      run(() => client.orderSetDropshipping(args.orderId, args.dropshipping)),
  );

  server.registerTool(
    "keypro_order_attachments",
    {
      title: "Files attached to an order",
      description:
        "List the files uploaded to one order (today: the partner's own invoice, which we print into the parcel on a dropshipping shipment). downloadPath is a logged-in browser path and is NOT callable with an API key - the file holds the end customer's data.",
      inputSchema: { orderId: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.orderAttachments(args.orderId)),
  );

  server.registerTool(
    "keypro_order_attach_file",
    {
      title: "Attach your own invoice (PDF) to an order",
      description:
        "Upload the partner's OWN invoice - the one issued to the end customer - to an order. On a dropshipping shipment we print it and put it in the parcel; we never read or process its contents. PASS A LOCAL FILE PATH, never the file content: this server runs on the user's machine and reads the file from disk itself, so the bytes never enter the conversation. PDF only (the server checks the %PDF- signature on the content, not the declared type), at most 5 files per order, 8 MB each, 16 MB together, 10 uploads per minute. Only accepted while the parcel has not left: a physical shipment with no GLS label requested yet, otherwise order_not_attachable (409).",
      inputSchema: {
        orderId: z.number().int().positive(),
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            "Local paths of the PDF files on THIS machine. Never the file content.",
          ),
      },
      annotations: writeHints({ destructive: false, idempotent: false }),
    },
    (args) =>
      run(() =>
        client.orderAttachmentUpload(
          args.orderId,
          args.paths.map((path) => ({
            filename: basename(path),
            bytes: new Uint8Array(readFileSync(path)),
          })),
        ),
      ),
  );

  server.registerTool(
    "keypro_order_cancel",
    {
      title: "Cancel an order",
      description:
        "Cancel an UNPAID order. Only orders awaiting payment can be cancelled: bacs (bank transfer / proforma), stripe (card checkout not completed), and cod (cash on delivery, still processing). 8-day-deferred (cheque) and already-paid orders CANNOT be cancelled. Idempotent.",
      inputSchema: { orderId: z.number().int().positive() },
      annotations: writeHints({ destructive: true, idempotent: true }),
    },
    (args) => run(() => client.orderCancel(args.orderId)),
  );

  server.registerTool(
    "keypro_order_change_payment_preview",
    {
      title: "Preview a payment change",
      description:
        "Preview changing an UNPAID order's payment method (only on-hold=bacs / pending=stripe orders qualify). Returns the recomputed totals for the new method (cheque and cod add a fee, bacs/wallet/stripe add none) and a confirmToken. Read every fee from newTotals/fees, never compute it: the cheque fee is +5% on most accounts and waived on a few by agreement. cheque and internal are account-gated - an account without permission is refused with payment_method_not_allowed (HTTP 403) already here. ALWAYS show the new totals to the user, then call keypro_order_change_payment. " +
        // A mondat GENERALT (`dropshipping-contract.ts`), UGYANAZ, mint a
        // megerosites leirasan: az elonezet 2026-09-16 ota ugyanazzal a koddal
        // es statusszal utasit el, tehat a ket leiras nem mondhat mast.
        `Refused here already, before any confirmToken is issued: ${dropshippingRefusalSentence("payment")}`,
      inputSchema: {
        orderId: z.number().int().positive(),
        newMethod: z.enum(["bacs", "cheque", "cod", "wallet", "stripe", "internal"]),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.orderPaymentPreview(args.orderId, args.newMethod)),
  );

  server.registerTool(
    "keypro_order_change_payment",
    {
      title: "Change payment method",
      annotations: writeHints({ destructive: true, idempotent: false }),
      description:
        "Change an UNPAID order's payment method. Requires the confirmToken from keypro_order_change_payment_preview. wallet debits the KEP balance now and fulfils, and raises NO invoice for the order (the balance was already invoiced when it was topped up; the only document is the delivery note at fulfilment); cheque/cod add their fee and fulfil (invoice + keys where due), and cheque is account-gated (payment_method_not_allowed, HTTP 403, without permission); bacs issues a proforma (awaits transfer); stripe charges the saved card or returns a payment link in payment.paymentUrl. Pass cardId (pm_...) to pick a specific card for stripe. " +
        // A mondat GENERALT (`dropshipping-contract.ts`): a cod-tiltas MASIK
        // iranya (egy mar dropshipping rendelest allitanank cod-ra) ezen a
        // vegponton keletkezik, es kezzel irva pont ugy avulna el, mint a
        // rendelesfelvetel mondata avult el a `combine_free` ag bevezetesekor.
        `${dropshippingRefusalSentence("payment")}`,
      inputSchema: {
        orderId: z.number().int().positive(),
        newMethod: z.enum(["bacs", "cheque", "cod", "wallet", "stripe", "internal"]),
        confirmToken: z
          .string()
          .describe("Token from keypro_order_change_payment_preview"),
        cardId: z.string().optional().describe("Saved card id (pm_...) for stripe"),
      },
    },
    (args) =>
      run(() =>
        client.orderChangePayment(args.orderId, {
          newMethod: args.newMethod,
          confirmToken: args.confirmToken,
          cardId: args.cardId,
        }),
      ),
  );

  server.registerTool(
    "keypro_license_keys",
    {
      title: "My license keys",
      description:
        "All license keys delivered to the authenticated account, grouped by product, WITH the reseller allocation numbers. Per product: totalUnits / allocatedUnits / remainingUnits and orderCount; per key: keyId, keyValue, quantity (a volume/MAK key carries several activations), allocated (already handed on via an issued transfer document), remaining, orderId, orderNumber and orderCreatedAt. keyValue can be null when the licence service is momentarily unreachable - the counts are still correct, and a null is never a placeholder string. There is no deliveredAt: the source table has no date column at all, so orderCreatedAt (the source order's date) is what exists. COST: one call resolves every key of the account against the licence service one by one, so this tool has its own tighter rate limit (6 calls / minute per API key, HTTP 429 above it). The answer only changes when a key is delivered or a transfer document is issued - keep it instead of calling again in a loop.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => run(() => client.licenseKeys()),
  );

  server.registerTool(
    "keypro_license_documents_list",
    {
      title: "My issued licence transfer documents",
      description:
        "List the licence transfer documents this reseller account has issued to its own end customers (newest first). SUMMARY rows only: id, documentNumber, orderId, status (live/revoked), customerName, totalQty, items (productId, productName, qty), createdAt, revokedAt. Product keys are deliberately NOT on the list - fetch one document with keypro_license_document_get to get them. Filter by productId, by orderId (the order may be the document's primary source or appear in a key allocation) and by status.",
      inputSchema: {
        productId: z.number().int().positive().optional(),
        orderId: z.number().int().positive().optional(),
        status: z
          .enum(["live", "revoked", "all"])
          .optional()
          .describe("Default: live (revoked documents are hidden)"),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      run(() =>
        client.licenseDocumentsList({
          productId: args.productId,
          orderId: args.orderId,
          status: args.status,
          limit: args.limit,
          offset: args.offset,
        }),
      ),
  );

  server.registerTool(
    "keypro_license_document_get",
    {
      title: "One issued licence transfer document",
      description:
        "The FULL snapshot of one issued licence transfer document: the end customer's data (name, tax number, address, contact) as recorded at issue time, and items[] with keys[] carrying the FULL, unmasked keyValue plus its orderId / orderNumber. The keys come from the stored snapshot, never re-resolved from the licence service, so they never move and never go null. The `pdf` field holds the download URLs that ACTUALLY belong to this document; its keys follow from `licenseNature` (`used` -> transfer certificate + decommission statement, `new` -> licence certificate, `subscription` -> subscription certificate), so never assume the two old names. They need the same API key, they are not capability links. A document belonging to another account answers not_found, never 403.",
      inputSchema: { documentId: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.licenseDocumentGet(args.documentId)),
  );

  server.registerTool(
    "keypro_invoices_list",
    {
      title: "List my invoices",
      description:
        "List the invoices/proformas of the authenticated account (each has a public downloadUrl PDF link). Optional order filter.",
      inputSchema: {
        orderId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.invoicesList({ orderId: args.orderId, limit: args.limit })),
  );

  server.registerTool(
    "keypro_invoice_get",
    {
      title: "Invoice details",
      description: "One invoice with totals and public downloadUrl.",
      inputSchema: { invoiceId: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.invoiceGet(args.invoiceId)),
  );

  server.registerTool(
    "keypro_profile_get",
    {
      title: "My profile",
      description:
        "The profile of the authenticated account: contact data, billing and shipping address.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => run(() => client.profileGet()),
  );

  server.registerTool(
    "keypro_profile_update",
    {
      title: "Update my profile",
      annotations: writeHints({ destructive: false, idempotent: true }),
      description:
        "Update profile fields (partial). Allowed keys: firstName, phone, website, companyName, taxNumber, billingFirstName, billingLastName, billingCompany, billingAddress1, billingAddress2, billingCity, billingPostcode, billingState, billingCountry, billingEmail, billingPhone, and the same shipping* fields (no shippingEmail). Empty string clears a field.",
      inputSchema: {
        fields: z
          .record(z.string(), z.string())
          .describe("Field name -> new value map (flat API field names)"),
      },
    },
    (args) => run(() => client.profileUpdate(args.fields)),
  );

  server.registerTool(
    "keypro_wallet",
    {
      title: "My KEP wallet",
      description:
        "KEP wallet balance (net EUR) and transaction history (topup/payment/refund/bonus with running balance) of the authenticated account.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("History length"),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.wallet({ limit: args.limit })),
  );

  server.registerTool(
    "keypro_cards_list",
    {
      title: "My saved cards",
      description:
        "Saved bank cards of the authenticated account (brand, last4, default flag). New cards can only be added on the website.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => run(() => client.cardsList()),
  );

  server.registerTool(
    "keypro_parcelshops_search",
    {
      title: "Search GLS pickup points",
      description:
        "Search GLS pickup points (city, zip prefix or name). Use the returned id as parcelshopId for gls_parcelshop shipping.",
      inputSchema: {
        q: z.string().describe("City, zip prefix or name"),
        type: z.enum(["parcel-shop", "parcel-locker", "all"]).optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => client.parcelshopsSearch(args.q, args.type)),
  );
}
