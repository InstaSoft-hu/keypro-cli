/**
 * Vekony HTTP kliens a KeyPro /api/v1 vegpontokhoz (nativ fetch).
 * Minden uzleti logika a szerveren el; itt csak a boritek ({ ok, data |
 * error }) kibontasa es a hibak tipusositasa tortenik. A parancsok ES az
 * MCP szerver is ezt a klienst hasznalja.
 */

import { filenameFromContentDisposition } from "./download-name.js";

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

/**
 * A letoltheto licenc-dokumentum fajtak. EGY forras a CLI-ben: a `licdok pdf`
 * `--kind` kapuja es a kliens tipusa ugyanezt olvassa, tehat egy uj fajta nem
 * tud ugy megjelenni, hogy a parancssor elutasitja.
 *
 * MELYIK TARTOZIK EGY ADOTT DOKUMENTUMHOZ: a szerver mondja meg, a dokumentum
 * `licenseNature` mezojen es a `pdf` link-objektum KULCSAIN keresztul.
 */
export const LICENSE_DOCUMENT_KINDS = [
  "atruhazas",
  "megsemmisites",
  "licencigazolas",
  "elofizetes-igazolas",
] as const;

export type LicenseDocumentKind = (typeof LICENSE_DOCUMENT_KINDS)[number];

/**
 * A LICENC JELLEGE ember-olvashato cimkei a `products get` kiiratasahoz.
 *
 * A szerver a nyers ertéket adja (`used` / `new` / `subscription`), es a `--json`
 * is azt viszi tovabb - ez a tabla CSAK a magyar emberi kimenetet szolgalja.
 * ISMERETLEN ERTEKET NEM NYEL LE: a `?? nyers ertek` ag azt irja ki, amit a
 * szerver kuldott, mert egy uj negyedik jelleg eseten a "nem tudom" hasznosabb,
 * mint egy nema ures sor.
 */
const LICENSE_NATURE_LABELS: Record<string, string> = {
  used: "használt licenc",
  new: "új licenc",
  subscription: "előfizetés",
};

/** A jelleg magyar cimkeje; ismeretlen erteket valtozatlanul ad vissza. */
export function licenseNatureLabel(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return LICENSE_NATURE_LABELS[value] ?? value;
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
  paymentMethod: "bacs" | "cheque" | "cod" | "wallet" | "stripe" | "internal";
  shippingMethodId?: "gls_hd" | "gls_parcelshop" | "combine_free";
  parcelshopId?: string;
  couponCode?: string;
  currency?: "EUR" | "HUF";
  billing?: AddressInput;
  shipping?: AddressInput;
  taxNumber?: string;
  /** Sajat belso azonosito; rakerul a bizonylatok megjegyzes rovatara. */
  internalReference?: string;
  dropshipping?: boolean;
  cardId?: string;
}

export interface KeyproClientOptions {
  apiBase: string;
  apiKey?: string | null;
}

export interface OrderAttachment {
  id: number;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  /** Bejelentkezett (bongeszos) letoltesi ut; API kulccsal NEM hivhato. */
  downloadPath: string;
}

export interface OrderAttachmentsResponse {
  attachments: OrderAttachment[];
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

  /**
   * MULTIPART feltoltes. Sajat ut, mert a `request` JSON-t kuld, es ez az
   * EGYETLEN vegpont, aminek a KERESE nem JSON: base64-ben a bajtok ~33%-kal
   * nagyobbak lennenek, es MCP-n at a fajl TARTALMA a modell kontextusaba
   * kerulne. A `content-type` fejlecet SZANDEKOSAN nem allitjuk be: a `fetch` a
   * `FormData`-bol maga generalja a `boundary`-t, es egy kezzel irt fejlec
   * elrontana - a szerver nem tudna szetszedni a torzset.
   *
   * A valasz a szokasos `{ ok, data }` boritek, tehat a hiba-ag azonos a
   * `request`-evel.
   */
  private async requestMultipart<T>(
    method: string,
    path: string,
    form: FormData,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;

    let response: Response;
    try {
      response = await fetch(`${this.opts.apiBase}${path}`, {
        method,
        headers,
        body: form,
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
    if (envelope.ok === true && envelope.data !== undefined) return envelope.data;
    const error = envelope.error ?? {};
    throw new KeyproApiError(
      response.status,
      error.code ?? "unknown_error",
      error.message ?? `Ismeretlen hiba (HTTP ${response.status}).`,
      error.details,
    );
  }

  /**
   * BINARIS letoltes: a siker-ag bajtokat ad, a hiba-ag tovabbra is a JSON
   * boritekbol keszult `KeyproApiError`-t. A ket agat a `Content-Type` valtja
   * szet, nem a statusz - egy jovobeli binaris vegpont igy ugyanezt kapja.
   */
  private async requestBinary(
    path: string,
    expectedType: string,
  ): Promise<{ bytes: Uint8Array; filename: string | null }> {
    const headers: Record<string, string> = { accept: expectedType };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;

    let response: Response;
    try {
      response = await fetch(`${this.opts.apiBase}${path}`, { headers });
    } catch (err) {
      throw new KeyproApiError(
        0,
        "network_error",
        `Nem sikerült elérni a szervert (${this.opts.apiBase}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes(expectedType)) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new KeyproApiError(
          response.status,
          "invalid_response",
          `A szerver nem ${expectedType} és nem JSON választ adott (HTTP ${response.status}).`,
        );
      }
      const error =
        (payload as { error?: { code?: string; message?: string; details?: unknown } })
          .error ?? {};
      throw new KeyproApiError(
        response.status,
        error.code ?? "unknown_error",
        error.message ?? `Ismeretlen hiba (HTTP ${response.status}).`,
        error.details,
      );
    }

    // A fajlnev SZERVER-ADAT, es a hivo fajl-celkent hasznalja: a
    // `filenameFromContentDisposition` mar megtisztitva adja vissza (egy
    // konyvtarat elhagyo nev sosem jut ki innen). Lasd `download-name.ts`.
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      filename: filenameFromContentDisposition(
        response.headers.get("content-disposition"),
      ),
    };
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
    /** A valtozat-sorok onallo talalatkent is jojjenek (`include_variants`). */
    includeVariants?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.category) qs.set("category", params.category);
    if (params.onSale) qs.set("on_sale", "true");
    if (params.sort) qs.set("sort", params.sort);
    if (params.includeVariants) qs.set("include_variants", "true");
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

  /** DROPSHIPPING be-/kikapcsolasa (a GLS-cimke igenyleseig). */
  orderSetDropshipping(orderId: number, dropshipping: boolean) {
    return this.request<{
      orderId: number;
      dropshipping: boolean;
      changed: boolean;
    }>("POST", `/api/v1/orders/${orderId}/dropshipping`, { dropshipping });
  }

  /** A rendeleshez feltoltott fajlok listaja. */
  orderAttachments(orderId: number) {
    return this.request<OrderAttachmentsResponse>(
      "GET",
      `/api/v1/orders/${orderId}/attachments`,
    );
  }

  /**
   * Fajl(ok) feltoltese a rendeleshez. A hivo BAJTOKAT ad at, nem utvonalat: a
   * fajl beolvasasa a hivo dolga (a CLI es az MCP szerver is HELYBEN fut, tehat
   * lemezrol olvas) - igy a tartalom sosem utazik at a modellen.
   */
  orderAttachmentUpload(
    orderId: number,
    /**
     * A `Uint8Array<ArrayBuffer>` SZUKITES szandekos: a sima `Uint8Array`
     * `SharedArrayBuffer`-rel is hatterezheto, azt pedig a `Blob` nem fogadja
     * el. A hivo `new Uint8Array(readFileSync(path))`-sal pont ilyet ad.
     */
    files: readonly { filename: string; bytes: Uint8Array<ArrayBuffer> }[],
  ) {
    const form = new FormData();
    for (const file of files) {
      form.append(
        "attachments",
        new Blob([file.bytes], { type: "application/pdf" }),
        file.filename,
      );
    }
    return this.requestMultipart<OrderAttachmentsResponse>(
      "POST",
      `/api/v1/orders/${orderId}/attachments`,
      form,
    );
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
        totalUnits: number;
        allocatedUnits: number;
        remainingUnits: number;
        orderCount: number;
        keys: Array<Record<string, unknown>>;
      }>;
    }>("GET", "/api/v1/license-keys");
  }

  // --- Licenc-atruhazasi dokumentumok (viszontelado -> vegfelhasznalo) ---

  licenseDocumentsList(
    params: {
      productId?: number;
      orderId?: number;
      status?: "live" | "revoked" | "all";
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.productId) qs.set("productId", String(params.productId));
    if (params.orderId) qs.set("orderId", String(params.orderId));
    if (params.status) qs.set("status", params.status);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    const suffix = qs.size > 0 ? `?${qs}` : "";
    return this.request<{
      limit: number;
      offset: number;
      total: number;
      documents: Array<Record<string, unknown>>;
    }>("GET", `/api/v1/license-documents${suffix}`);
  }

  licenseDocumentGet(id: number) {
    return this.request<{ document: Record<string, unknown> }>(
      "GET",
      `/api/v1/license-documents/${id}`,
    );
  }

  /**
   * A dokumentum PDF-je NYERS BAJTKENT. Ez az egyetlen vegpont, aminek a
   * SIKERES valasza nem `{ ok, data }` boritek - a hibai viszont igen, ezert
   * a hibaag ugyanazt a `KeyproApiError`-t adja, mint minden mas hivas.
   *
   * A FAJTA A DOKUMENTUM LICENC-JELLEGEBOL kovetkezik, nem a hivo valasztasa:
   * hasznalt licencnel `atruhazas` + `megsemmisites`, uj licencnel
   * `licencigazolas`, elofizetesnel `elofizetes-igazolas`. Amit a dokumentum
   * `pdf` mezoje nem hirdet meg, arra a vegpont 404-et ad.
   */
  licenseDocumentPdf(id: number, kind: LicenseDocumentKind) {
    return this.requestBinary(
      `/api/v1/license-documents/${id}/pdf?kind=${kind}`,
      "application/pdf",
    );
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
