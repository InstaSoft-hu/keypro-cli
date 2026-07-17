# KeyPro CLI - AI agent guide

Magyar: ez a KeyPro.hu B2B licencshop parancssori eszkoze; az alabbi angol
utmutato AI-agenteknek (Claude Code, Codex) szol.

## Setup

1. The user needs a KeyPro account (approved reseller) and an API key.
   Either run `keypro login` (interactive email + password, stores a fresh
   key) or create a key on the website under "MCP és CLI" and store it:
   - env var: KEYPRO_API_KEY=kp_live_... (recommended for agents)
   - or config file: ~/.config/keypro/config.json
2. API base URL: production is the default. For the dev site use
   KEYPRO_API_BASE=https://dev.keypro.hu or `keypro config set api-base ...`.
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

## Queries

- `keypro products search <query>` / `keypro products get <sku|id>`
- `keypro order list [--status <status>]` / `keypro order get <id>`
- `keypro keys list [--order <id>]` - delivered license keys
- `keypro invoices list [--order <id>]` / `keypro invoices get <id>`
  (each invoice has a public `downloadUrl` PDF link)
- `keypro wallet` / `keypro wallet transactions` - KEP balance + history
- `keypro profile get` / `keypro profile set billing.city=Budapest ...`
  (sections: contact.*, billing.*, shipping.*)
- `keypro cards list` - saved cards (add new cards on the website only)

## MCP server mode

Register the CLI as a native MCP toolset (recommended for Claude Code):

    claude mcp add keypro -- keypro mcp

Auth comes from KEYPRO_API_KEY / config; there is no login tool over MCP.
The keypro_order_create tool requires the confirmToken from
keypro_order_preview - same safety flow as the CLI.

## Error codes

unauthorized, forbidden_scope, rate_limited, validation_failed, not_found,
unknown_product, coupon_invalid, shipping_required, invalid_parcelshop,
insufficient_wallet_balance, confirm_required, confirm_token_invalid,
invalid_card, stripe_unavailable, account_pending, account_inactive,
invalid_credentials, network_error, internal
