import { describe, expect, it, vi } from "vitest";

import { KeyproClient } from "./client.js";
import { filenameFromContentDisposition, safeDownloadName } from "./download-name.js";

/**
 * SZERVER-ADATBOL SOSEM LESZ UTVONAL.
 *
 * A `keypro licdok pdf` a `Content-Disposition` fejlecbol vett nevet hasznalja
 * iras-celkent. Az `api-base` atallithato (a README a dev cimet mutatja), tehat
 * a valaszolo szerver nem axiomatikusan megbizhato: egy
 * `filename="../../../home/user/.bashrc"` tisztitas nelkul a munkakonyvtaron
 * KIVULRE irna a bajtokat.
 *
 * A ket szint kulon merve: a tiszta fuggveny ES a KLIENS BEKOTESE
 * (`_gyoker-mintak` 6. pont) - a tiszta modul onmagaban zold maradna, ha a
 * `requestBinary` megsem rajta at fejtene ki a nevet.
 */

describe("safeDownloadName", () => {
  it("a konyvtarat elhagyo nev a puszta fajlnevre esik ossze", () => {
    expect(safeDownloadName("../../../home/schawo/.bashrc")).toBe(".bashrc");
    expect(safeDownloadName("/etc/cron.d/keypro")).toBe("keypro");
    expect(safeDownloadName("..%2F..%2Fx.pdf")).toBe("..%2F..%2Fx.pdf");
  });

  it("a visszaperjel is elvalaszto (a `basename` platformfuggo lenne)", () => {
    expect(safeDownloadName("..\\..\\Users\\admin\\evil.pdf")).toBe("evil.pdf");
  });

  it("SEMMILYEN kimenet nem tartalmaz utvonal-elvalasztot", () => {
    const hostile = [
      "../x.pdf",
      "../../../../etc/passwd",
      "/tmp/x.pdf",
      "a/b/c.pdf",
      "..\\..\\x.pdf",
      "dir/../../../x.pdf",
    ];
    for (const raw of hostile) {
      const name = safeDownloadName(raw);
      expect(name, raw).not.toBeNull();
      expect(name as string, raw).not.toMatch(/[/\\]/);
    }
  });

  it("a hasznalhatatlan nev `null`, hogy a hivo sajat nevet adhasson", () => {
    expect(safeDownloadName("..")).toBeNull();
    expect(safeDownloadName(".")).toBeNull();
    expect(safeDownloadName("/")).toBeNull();
    expect(safeDownloadName("   ")).toBeNull();
    expect(safeDownloadName("")).toBeNull();
    expect(safeDownloadName(null)).toBeNull();
  });

  it("az artalmatlan nev valtozatlan marad", () => {
    expect(safeDownloadName("licenc-atruhazasi-igazolas-LD-2026-01246.pdf")).toBe(
      "licenc-atruhazasi-igazolas-LD-2026-01246.pdf",
    );
  });

  it("a fejlec-kifejtes ES a tisztitas egy lepes", () => {
    expect(
      filenameFromContentDisposition(
        'attachment; filename="../../../home/schawo/.bashrc"',
      ),
    ).toBe(".bashrc");
    expect(filenameFromContentDisposition('attachment; filename="ok.pdf"')).toBe(
      "ok.pdf",
    );
    expect(filenameFromContentDisposition("attachment")).toBeNull();
    expect(filenameFromContentDisposition(null)).toBeNull();
  });
});

describe("a kliens bekotese: a letoltes neve mar tisztitva jon ki", () => {
  function clientWithDisposition(disposition: string): KeyproClient {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": disposition,
          },
        }),
    );
    return new KeyproClient({ apiBase: "https://keypro.hu", apiKey: "kp_live_x" });
  }

  it("a rosszindulatu fajlnev a munkakonyvtaron BELUL marad", async () => {
    const client = clientWithDisposition(
      'attachment; filename="../../../home/schawo/.bashrc"',
    );

    const { filename } = await client.licenseDocumentPdf(1246, "atruhazas");

    // Ez a nev megy tovabb a `writeFileSync(target, bytes)` hivasba.
    expect(filename).toBe(".bashrc");
    expect(filename as string).not.toMatch(/[/\\]/);
    vi.unstubAllGlobals();
  });

  it("a normalis fajlnev valtozatlanul jon at", async () => {
    const client = clientWithDisposition(
      'attachment; filename="licenc-atruhazasi-igazolas-LD-2026-01246.pdf"',
    );

    const { filename, bytes } = await client.licenseDocumentPdf(1246, "atruhazas");

    expect(filename).toBe("licenc-atruhazasi-igazolas-LD-2026-01246.pdf");
    expect(bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
    vi.unstubAllGlobals();
  });
});
