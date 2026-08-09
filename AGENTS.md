# KeyPro CLI - AI agent guide

Magyar: ez a KeyPro.hu B2B licencshop parancssori eszkoze; az alabbi angol
utmutato AI-agenteknek (ChatGPT, Claude, Gemini, Codex, OpenCode) szol.

## Setup

1. The user needs a KeyPro account (approved reseller) and an API key. Easiest:
   `keypro setup` - interactive wizard (asks the server, then API key [default]
   or email+password). Alternatives:
   - `keypro login` (email + password, mints + stores a fresh key)
   - a key made on the website under "API, MCP és CLI" (https://keypro.hu/api), stored via
     `keypro config set api-key kp_live_...`, the KEYPRO_API_KEY env var
     (recommended for agents), or ~/.config/keypro/config.json
2. API base URL: production is the default. For the dev site use `keypro setup`,
   KEYPRO_API_BASE=https://dev.keypro.hu, or `keypro config set api-base ...`.
3. Verify with: `keypro whoami --json`

## Output contract

- Every command supports `--json`: machine-readable data on stdout.
- Errors go to stderr; in --json mode they are JSON with a stable
  `error.code` (snake_case English). Key on `code`, not on the Hungarian
  `message`.
- Exit codes: 0 success, 1 API/business error, 2 usage error, 3 auth error.

## Ordering flow (IMPORTANT)

Ordering is a two-step preview + confirm flow to prevent accidental orders:

1. `keypro order preview --item SKU=QTY --payment bacs --json`
   Returns priced lines, fees, shipping, totals and a `confirmToken`
   (valid 15 minutes, bound to items + payment method + gross total).
   ALWAYS show the totals to the user before ordering.
2. `keypro order create --item SKU=QTY --payment bacs --yes --json`
   Without `--yes` the command only prints the preview and exits with
   code 1. With `--yes` it re-runs the preview and submits with the fresh
   confirmToken. If prices changed between preview and create, the server
   rejects with `confirm_token_invalid` and returns the new totals in
   `error.details` - re-run preview and show the user the new total.
3. Retries: pass `--idempotency-key <any-unique-string>` - the same key
   never creates a second order (the response has `idempotentReplay: true`).

Payment methods (`--payment`):
- `bacs`   bank transfer: order goes on-hold, a proforma invoice
  (dijbekero) is issued; keys are delivered after payment arrives.
- `cheque` 8-day payment terms (+5% fee on net product total).
- `cod`    cash on delivery (physical shipments only, +1.5 EUR fee).
- `wallet` KEP balance (net total deducted immediately).
- `card`   saved bank card (Stripe, off-session). If the bank requires
  3DS or there is no saved card, the response contains `payment.paymentUrl`
  - give this link to the user to open in a browser (valid ~1 hour).
  Select a specific card with `--card pm_...` (see `keypro cards list`).

Physical products need `--shipping gls_hd|gls_parcelshop|combine_free`;
for gls_parcelshop also `--parcelshop <ID>`
(search: `keypro parcelshops search <city|zip>`).

## Variable products (tiers, editions)

Some catalog entries are GROUPS (`type: "variable"`): a family of tiers or
editions. A group is NOT orderable - its listed price is only the MINIMUM of
its variants, so ordering it would undercharge.

- `keypro products get <group>` returns `notPurchasable: true` plus a
  `variants` array; every entry has its own `productId`, `sku`,
  `attributes` (e.g. device count, pack size) and `yourUnitNetEur`.
  `keypro products search` also lists the variants of a group row, but with
  FEWER fields (no `yourUnitNetEur`): its `netPriceEur` is the catalog price,
  so read the caller's own price from `keypro products get` or the order
  preview.
- Order a VARIANT, never the group: `--item <variant-sku>=<qty>` or
  `--item id:<variant-productId>=<qty>`.
- If a group slips into an order, the server rejects it with
  `variant_required`; `error.details.variants` lists the selectable variants,
  so you can retry in a single hop.
- If a SKU matches more than one product, the server rejects it with
  `ambiguous_sku` (`error.details.ambiguousSkus`) instead of guessing - pass
  the `productId` instead.

## Product images

Every product AND every variant entry carries an `images` array: ordered,
always present (empty when the product has no picture, never null). Each entry
is `{ url, alt, position }`, the url is ABSOLUTE and directly fetchable, and
the FIRST element is the featured image AMONG THE SERVED ONES: a stored image
the shop cannot serve is left out of the array (the server logs it), so on such
a product the next image becomes the first. There is no separate `image` field.

- `keypro products images <sku|id>` prints ONE absolute URL per line and
  nothing else, so mirroring the pictures into your own webshop is one line:
  `keypro products images 123 | xargs -n1 curl -O`.
  With `--json` it returns the structured array.
- A product with no image prints nothing and still exits 0: a missing picture
  is not an error, so a `set -e` mirroring loop is never stopped by it.
- `keypro products get <sku|id>` shows the image count and the featured URL;
  its `--json` (and that of `products search`) carries the whole array.
- An older shop deployment that does not send the field yet degrades to
  "no images"; the CLI never fails on it.

## Queries

- `keypro products search <query>` / `keypro products get <sku|id>` /
  `keypro products images <sku|id>`
- `keypro rate` - current EUR/HUF rate the shop uses (net prices are stored in
  EUR; HUF price = round(EUR * rate) to whole forint, EUR to 2 decimals)
- `keypro order list [--status <status>]` / `keypro order get <id>`
- `keypro order cancel <id>` - cancel an UNPAID order (bacs / stripe / cod;
  NOT 8-day cheque or already-paid orders)
- `keypro order change-payment <id> --payment <method> [--yes]` - change an
  unpaid order's payment method (preview first; wallet/stripe move money)
- `keypro keys list [--order <id>]` - delivered license keys
- `keypro invoices list [--order <id>]` / `keypro invoices get <id>`
  (each invoice has a public `downloadUrl` PDF link)
- `keypro wallet` / `keypro wallet transactions` - KEP balance + history
- `keypro profile get` / `keypro profile set billing.city=Budapest ...`
  (sections: contact.*, billing.*, shipping.*)
- `keypro cards list` - saved cards (add new cards on the website only)

## MCP server mode

Register the CLI as a native MCP server for any MCP client (Claude, ChatGPT, Codex, Gemini, OpenCode, Antigravity):

    claude mcp add keypro -- npx -y @keypro/cli mcp

Auth comes from KEYPRO_API_KEY / config; there is no login tool over MCP.
The keypro_order_create tool requires the confirmToken from
keypro_order_preview - same safety flow as the CLI.

## REST API without the CLI

The CLI and the MCP server are thin wrappers over a public REST API, so an
agent that cannot install npm packages can call it directly.

- Base URL: `https://keypro.hu/api/v1` (dev: `https://dev.keypro.hu/api/v1`).
- Auth: `Authorization: Bearer kp_live_...` on every endpoint except
  `GET /api/v1` (discovery) and `POST /api/v1/auth/login`.
- Envelope: `{ "ok": true, "data": ... }` or
  `{ "ok": false, "error": { "code", "message", "details"? } }`. Key on
  `error.code`, never on the Hungarian `message`.
- Scopes: `read`, `orders:write`, `profile:write`. No implicit widening -
  every endpoint demands exactly one. The `admin` scope is never issued as an
  API key and satisfies nothing under /api/v1.
- Rate limit: 120 requests / minute per key (HTTP 429 + `Retry-After`).
- Paging: ONLY four endpoints take `limit` (1-100) + `offset`:
  `GET /products`, `GET /orders`, `GET /invoices`, `GET /wallet`. Only
  `GET /products` returns a `total`; on the other three page until the array
  is shorter than `limit`. Every OTHER list endpoint (`GET /keys`,
  `GET /cards`, `GET /license-keys`, `GET /shipping/parcelshops`,
  `GET /orders/{id}/keys`) IGNORES those parameters silently and returns the
  whole list at once - never page them, it is an endless loop.
- Money is EUR as a JSON number. EVERY amount is NET, with three named
  exceptions: the `...GrossEur` fields plus `displayGrossTotal` and
  `feeDeltaEur` are gross, and `taxTotalEur` / `lineTaxEur` / `vatEur` are
  the VAT itself, not a gross amount. Dates are ISO 8601 strings.
- Prices are net EUR, and `GET /products` returns CATALOG prices
  (`netPriceEur`, `listNetPriceEur`) WITHOUT the caller's contracted
  discount. The caller's own unit price is `yourUnitNetEur` on
  `GET /products/{key}` (and on its `variants[]`); the BINDING amount is
  always the one returned by `POST /orders/preview`.
- Ordering is the same two-step flow as in the CLI:
  `POST /orders/preview` -> `confirmToken` (15 min) -> `POST /orders`,
  optionally with an `Idempotency-Key` header.
- `images` behaves exactly as described above on every product and variant
  object of `GET /products` and `GET /products/{key}`.

Full field-level reference (every endpoint, every response field, every error
code): the `API.md` shipped in this package, and https://keypro.hu/api

## Error codes

unauthorized, forbidden_scope, rate_limited, validation_failed, not_found,
unknown_product, variant_required, ambiguous_sku, coupon_invalid,
shipping_required, invalid_parcelshop, cod_requires_physical,
combine_parent_unavailable, insufficient_wallet_balance,
wallet_payment_disabled, topup_method_not_allowed, same_payment_method,
confirm_required, confirm_token_invalid, invalid_card, stripe_unavailable,
order_not_cancelable, order_not_changeable, account_pending, account_inactive,
invalid_credentials, network_error, internal

`network_error` is produced by the CLI itself (the shop was unreachable); all
the others come from the server.
