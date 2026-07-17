/**
 * Vekony HTTP kliens a KeyPro /api/v1 vegpontokhoz (nativ fetch).
 * Minden uzleti logika a szerveren el; itt csak a boritek ({ ok, data |
 * error }) kibontasa es a hibak tipusositasa tortenik. A parancsok ES az
 * MCP szerver is ezt a klienst hasznalja.
 */

export class KeyproApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "KeyproApiError";
  }
}

export interface OrderItemInput {
  sku?: string;
  productId?: number;
  qty: number;
}

export interface AddressInput {
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  postcode?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface OrderRequestInput {
  items: OrderItemInput[];
  paymentMethod: "bacs" | "cheque" | "cod" | "wallet" | "stripe";
  shippingMethodId?: "gls_hd" | "gls_parcelshop" | "combine_free";
  parcelshopId?: string;
  couponCode?: string;
  currency?: "EUR" | "HUF";
  billing?: AddressInput;
  shipping?: AddressInput;
  taxNumber?: string;
  cardId?: string;
}

export interface KeyproClientOptions {
  apiBase: string;
  apiKey?: string | null;
}

export class KeyproClient {
  constructor(private readonly opts: KeyproClientOptions) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...extraHeaders,
    };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(`${this.opts.apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new KeyproApiError(
        0,
        "network_error",
        `Nem sikerült elérni a szervert (${this.opts.apiBase}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new KeyproApiError(
        response.status,
        "invalid_response",
        `A szerver nem JSON választ adott (HTTP ${response.status}). Jó az api-base beállítás?`,
      );
    }

    const envelope = payload as {
      ok?: boolean;
      data?: T;
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (envelope.ok === true && envelope.data !== undefined) {
      return envelope.data;
    }
    const error = envelope.error ?? {};
    throw new KeyproApiError(
      response.status,
      error.code ?? "unknown_error",
      error.message ?? `Ismeretlen hiba (HTTP ${response.status}).`,
      error.details,
    );
  }

  // --- Auth / kulcsok ---

  login(email: string, password: string, name?: string) {
    return this.request<{
      token: string;
      keyId: number;
      prefix: string;
      scopes: string[];
      name: string;
    }>("POST", "/api/v1/auth/login", { email, password, name });
  }

  me() {
    return this.request<{
      id: number;
      email: string;
      companyName: string | null;
      firstName: string | null;
      role: string;
      walletBalanceEurNet: number;
      key: { id: number; prefix: string; name: string; scopes: string[] };
    }>("GET", "/api/v1/me");
  }

  keysList() {
    return this.request<{ keys: Array<Record<string, unknown>> }>(
      "GET",
      "/api/v1/keys",
    );
  }

  keyRevoke(keyId: number) {
    return this.request<{ revoked: boolean; keyId: number }>(
      "DELETE",
      `/api/v1/keys/${keyId}`,
    );
  }

  // --- Termekek ---

  productsSearch(params: {
    q?: string;
    category?: string;
    onSale?: boolean;
    sort?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.category) qs.set("category", params.category);
    if (params.onSale) qs.set("on_sale", "true");
    if (params.sort) qs.set("sort", params.sort);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    const suffix = qs.size > 0 ? `?${qs}` : "";
    return this.request<{
      total: number;
      products: Array<Record<string, unknown>>;
    }>("GET", `/api/v1/products${suffix}`);
  }

  productGet(key: string) {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/v1/products/${encodeURIComponent(key)}`,
    );
  }

  // --- Rendelesek ---

  orderPreview(req: OrderRequestInput) {
    return this.request<{
      lines: Array<Record<string, unknown>>;
      totals: Record<string, number>;
      payment: Record<string, unknown>;
      shipping: Record<string, unknown> | null;
      coupon: Record<string, unknown> | null;
      currency: string;
      eurRate: number;
      displayGrossTotal: number;
      wallet: { balanceEurNet: number; sufficient: boolean } | null;
      confirmToken: string;
      confirmTokenExpiresAt: string;
    }>("POST", "/api/v1/orders/preview", req);
  }

  orderCreate(
    req: OrderRequestInput & { confirmToken: string },
    idempotencyKey?: string,
  ) {
    return this.request<{
      order: Record<string, unknown>;
      invoices: Array<Record<string, unknown>>;
      deliveredKeyCount: number;
      payment: {
        method: string;
        charged: boolean;
        paymentUrl?: string;
        declineCode?: string | null;
        walletBalanceAfterEur?: number;
        note: string;
      };
      idempotentReplay: boolean;
    }>(
      "POST",
      "/api/v1/orders",
      req,
      idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
    );
  }

  ordersList(params: { status?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    const suffix = qs.size > 0 ? `?${qs}` : "";
    return this.request<{ orders: Array<Record<string, unknown>> }>(
      "GET",
      `/api/v1/orders${suffix}`,
    );
  }

  orderGet(id: number) {
    return this.request<{
      order: Record<string, unknown>;
      invoices: Array<Record<string, unknown>>;
      paymentUrl: string | null;
    }>("GET", `/api/v1/orders/${id}`);
  }

  orderKeys(id: number) {
    return this.request<{
      orderId: number;
      orderStatus: string;
      keys: Array<{
        productId: number;
        productName: string;
        keyValue: string;
        deliveredAt: string | null;
      }>;
      licenses: Array<Record<string, unknown>>;
    }>("GET", `/api/v1/orders/${id}/keys`);
  }

  orderCancel(id: number) {
    return this.request<{
      order: Record<string, unknown>;
      invoices: Array<Record<string, unknown>>;
      cancelled: boolean;
      alreadyCancelled: boolean;
      note: string;
    }>("POST", `/api/v1/orders/${id}/cancel`);
  }

  orderPaymentPreview(id: number, newMethod: string) {
    return this.request<{
      currentMethod: string;
      newMethod: string;
      newTotals: { netTotalEur: number; grossTotalEur: number };
      feeDeltaEur: number;
      fees: Array<{ label: string; netEur: number }>;
      confirmToken: string;
      confirmTokenExpiresAt: string;
      wallet: { balanceEurNet: number; sufficient: boolean } | null;
    }>("POST", `/api/v1/orders/${id}/payment/preview`, { newMethod });
  }

  orderChangePayment(
    id: number,
    body: { newMethod: string; confirmToken: string; cardId?: string },
  ) {
    return this.request<{
      order: Record<string, unknown>;
      invoices: Array<Record<string, unknown>>;
      payment: Record<string, unknown>;
    }>("POST", `/api/v1/orders/${id}/payment`, body);
  }

  licenseKeys() {
    return this.request<{
      products: Array<{
        productId: number;
        productName: string;
        keys: Array<Record<string, unknown>>;
      }>;
    }>("GET", "/api/v1/license-keys");
  }

  // --- Szamlak ---

  invoicesList(params: { orderId?: number; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params.orderId) qs.set("order_id", String(params.orderId));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    const suffix = qs.size > 0 ? `?${qs}` : "";
    return this.request<{ invoices: Array<Record<string, unknown>> }>(
      "GET",
      `/api/v1/invoices${suffix}`,
    );
  }

  invoiceGet(id: number) {
    return this.request<{ invoice: Record<string, unknown> }>(
      "GET",
      `/api/v1/invoices/${id}`,
    );
  }

  // --- Profil / wallet / kartyak / csomagpontok ---

  profileGet() {
    return this.request<{ profile: Record<string, unknown> }>(
      "GET",
      "/api/v1/profile",
    );
  }

  profileUpdate(patch: Record<string, unknown>) {
    return this.request<{
      updated: string[];
      profile: Record<string, unknown>;
    }>("PATCH", "/api/v1/profile", patch);
  }

  wallet(params: { limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    const suffix = qs.size > 0 ? `?${qs}` : "";
    return this.request<{
      balanceEurNet: number;
      transactions: Array<Record<string, unknown>>;
    }>("GET", `/api/v1/wallet${suffix}`);
  }

  cardsList() {
    return this.request<{
      stripeEnabled: boolean;
      cards: Array<{
        id: string;
        brand: string;
        last4: string;
        expMonth: number;
        expYear: number;
        isDefault: boolean;
      }>;
    }>("GET", "/api/v1/cards");
  }

  parcelshopsSearch(q: string, type?: string) {
    const qs = new URLSearchParams({ q });
    if (type) qs.set("type", type);
    return this.request<{
      truncated: boolean;
      parcelshops: Array<Record<string, unknown>>;
    }>("GET", `/api/v1/shipping/parcelshops?${qs}`);
  }

  exchangeRate() {
    return this.request<{
      base: string;
      quote: string;
      rate: number;
      eurToHuf: number;
      hufToEur: number;
      referenceRate: number;
      markupPct: number;
      source: string;
      rounding: { HUF: number; EUR: number };
      note: string;
    }>("GET", "/api/v1/exchange-rate");
  }
}

export function createClient(opts: KeyproClientOptions): KeyproClient {
  return new KeyproClient(opts);
}
