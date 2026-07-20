/**
 * Megosztott MCP tool-registry: a KeyPro muveletek nativ MCP tool-kent, ugyanazon
 * a KeyproClient-en keresztul. Ezt hasznalja a CLI stdio szerver (mcp.ts) ES a
 * webes tavoli MCP route (src/app/mcp/route.ts) - igy a tool-definiciok nem
 * csusznak szet. A McpServer csak tipuskent kell (type-only import), igy ez a
 * modul nem huzza be a stdio transportot a webes buildbe.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KeyproApiError, type KeyproClient } from "./client.js";

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
export const KEYPRO_MCP_VERSION = "0.1.6";

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
    .enum(["bacs", "cheque", "cod", "wallet", "stripe"])
    .describe(
      "bacs=bank transfer (proforma first), cheque=8-day terms (+5%), cod=cash on delivery, wallet=KEP balance, stripe=saved card",
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
    "Separate shipping address (omit to ship to the billing address)",
  ),
  taxNumber: z.string().optional(),
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
      description:
        "The authenticated KeyPro account (email, company, role, KEP wallet balance, API key scopes).",
      inputSchema: {},
    },
    () => run(() => client.me()),
  );

  server.registerTool(
    "keypro_exchange_rate",
    {
      description:
        "Current EUR->HUF exchange rate the shop uses and displays (ECB daily reference + 3% markup). Product net prices are stored in EUR; the HUF price = round(EUR * rate) to whole forint (EUR shown with 2 decimals). Call this to price products accurately in both currencies.",
      inputSchema: {},
    },
    () => run(() => client.exchangeRate()),
  );

  server.registerTool(
    "keypro_products_search",
    {
      description:
        "Search the KeyPro product catalog by name or SKU. Returns id, sku, name, net EUR price.",
      inputSchema: {
        q: z.string().optional().describe("Search text (name or SKU)"),
        category: z.string().optional().describe("Category slug filter"),
        onSale: z.boolean().optional().describe("Only discounted products"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    (args) =>
      run(() =>
        client.productsSearch({
          q: args.q,
          category: args.category,
          onSale: args.onSale,
          limit: args.limit,
        }),
      ),
  );

  server.registerTool(
    "keypro_product_get",
    {
      description:
        "Product details by id, slug or SKU, including the caller's effective unit price with discounts.",
      inputSchema: { key: z.string().describe("Product id, slug or SKU") },
    },
    (args) => run(() => client.productGet(args.key)),
  );

  server.registerTool(
    "keypro_order_preview",
    {
      description:
        "Preview an order WITHOUT placing it: priced lines, fees, shipping, totals, and a confirmToken (valid 15 minutes). ALWAYS show the returned totals to the user and get their approval before calling keypro_order_create.",
      inputSchema: orderRequestShape,
    },
    (args) => run(() => client.orderPreview(args)),
  );

  server.registerTool(
    "keypro_order_create",
    {
      description:
        "Place an order. Requires the confirmToken from keypro_order_preview (same items, payment method and total). If the response contains payment.paymentUrl, give that link to the user to finish paying in a browser. Pass idempotencyKey to make retries safe.",
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
      description: "List the user's orders (newest first), optional status filter.",
      inputSchema: {
        status: z.string().optional().describe("e.g. pending, processing, completed"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    (args) => run(() => client.ordersList({ status: args.status, limit: args.limit })),
  );

  server.registerTool(
    "keypro_order_get",
    {
      description:
        "Order details: items, totals, status, invoices, and a payment link if the order is awaiting card payment.",
      inputSchema: { orderId: z.number().int().positive() },
    },
    (args) => run(() => client.orderGet(args.orderId)),
  );

  server.registerTool(
    "keypro_order_keys",
    {
      description:
        "License keys delivered for one order. COD orders release keys only after completion.",
      inputSchema: { orderId: z.number().int().positive() },
    },
    (args) => run(() => client.orderKeys(args.orderId)),
  );

  server.registerTool(
    "keypro_order_cancel",
    {
      description:
        "Cancel an UNPAID order. Only orders awaiting payment can be cancelled: bacs (bank transfer / proforma), stripe (card checkout not completed), and cod (cash on delivery, still processing). 8-day-deferred (cheque) and already-paid orders CANNOT be cancelled. Idempotent.",
      inputSchema: { orderId: z.number().int().positive() },
    },
    (args) => run(() => client.orderCancel(args.orderId)),
  );

  server.registerTool(
    "keypro_order_change_payment_preview",
    {
      description:
        "Preview changing an UNPAID order's payment method (only on-hold=bacs / pending=stripe orders qualify). Returns the recomputed totals for the new method (cheque adds +5%, cod adds a fixed fee; bacs/wallet/stripe add none) and a confirmToken. ALWAYS show the new totals to the user, then call keypro_order_change_payment.",
      inputSchema: {
        orderId: z.number().int().positive(),
        newMethod: z.enum(["bacs", "cheque", "cod", "wallet", "stripe"]),
      },
    },
    (args) => run(() => client.orderPaymentPreview(args.orderId, args.newMethod)),
  );

  server.registerTool(
    "keypro_order_change_payment",
    {
      description:
        "Change an UNPAID order's payment method. Requires the confirmToken from keypro_order_change_payment_preview. wallet debits the KEP balance now and fulfils; cheque/cod add their fee and fulfil (final invoice + keys where due); bacs issues a proforma (awaits transfer); stripe charges the saved card or returns a payment link in payment.paymentUrl. Pass cardId (pm_...) to pick a specific card for stripe.",
      inputSchema: {
        orderId: z.number().int().positive(),
        newMethod: z.enum(["bacs", "cheque", "cod", "wallet", "stripe"]),
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
      description: "All delivered license keys of the user, grouped by product.",
      inputSchema: {},
    },
    () => run(() => client.licenseKeys()),
  );

  server.registerTool(
    "keypro_invoices_list",
    {
      description:
        "List invoices/proformas (each has a public downloadUrl PDF link). Optional order filter.",
      inputSchema: {
        orderId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    (args) => run(() => client.invoicesList({ orderId: args.orderId, limit: args.limit })),
  );

  server.registerTool(
    "keypro_invoice_get",
    {
      description: "One invoice with totals and public downloadUrl.",
      inputSchema: { invoiceId: z.number().int().positive() },
    },
    (args) => run(() => client.invoiceGet(args.invoiceId)),
  );

  server.registerTool(
    "keypro_profile_get",
    {
      description: "The account profile: contact data, billing and shipping address.",
      inputSchema: {},
    },
    () => run(() => client.profileGet()),
  );

  server.registerTool(
    "keypro_profile_update",
    {
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
      description:
        "KEP wallet balance (net EUR) and transaction history (topup/payment/refund/bonus with running balance).",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("History length"),
      },
    },
    (args) => run(() => client.wallet({ limit: args.limit })),
  );

  server.registerTool(
    "keypro_cards_list",
    {
      description:
        "Saved bank cards (brand, last4, default flag). New cards can only be added on the website.",
      inputSchema: {},
    },
    () => run(() => client.cardsList()),
  );

  server.registerTool(
    "keypro_parcelshops_search",
    {
      description:
        "Search GLS pickup points (city, zip prefix or name). Use the returned id as parcelshopId for gls_parcelshop shipping.",
      inputSchema: {
        q: z.string().describe("City, zip prefix or name"),
        type: z.enum(["parcel-shop", "parcel-locker", "all"]).optional(),
      },
    },
    (args) => run(() => client.parcelshopsSearch(args.q, args.type)),
  );
}
