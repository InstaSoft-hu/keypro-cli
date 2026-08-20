/**
 * A termek-szoveg beolvasasa es a `keypro products get` szoveg-blokkja.
 *
 * Ket szint: a tiszta fuggvenyek (beolvasas + blokk), majd a HUZALOZAS egy
 * valodi futtatassal, helyi hamis kiszolgalo ellen - ugyanaz a minta, mint a
 * kep-blokknal (`products-images.test.ts`), es ugyanazert: a `parseProductText`
 * unit-tesztje nem bizonyitja, hogy a parancs ki is irja, amit beolvasott, es
 * epp a REGI KISZOLGALO elleni degradacio a lenyeg (a CLI tavoli, akar ezt a
 * harom mezot nem is kuldo telepitest hiv).
 */

import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProductText, productTextBlock } from "./product-text.js";

describe("parseProductText", () => {
  it("a felsorolas mindig tomb, a hianyzo mezokbol `null` lesz", () => {
    expect(parseProductText({ id: 1 })).toEqual({
      bullets: [],
      shortDescription: null,
      description: null,
    });
    // Barmilyen varatlan alak ugyanaz a "nincs szoveg".
    expect(parseProductText(null)).toEqual({
      bullets: [],
      shortDescription: null,
      description: null,
    });
    expect(
      parseProductText({ shortDescriptionBullets: null, description: 42 }),
    ).toEqual({ bullets: [], shortDescription: null, description: null });
  });

  it("a nem-string es az ures elem kiesik a felsorolasbol", () => {
    const text = parseProductText({
      shortDescriptionBullets: ["  Elso  ", "", "   ", 7, null, "Masodik"],
    });

    expect(text.bullets).toEqual(["Elso", "Masodik"]);
  });

  it("a hosszu leiras SORTORESEI megmaradnak, a felsorolas-ponte nem", () => {
    const text = parseProductText({
      description: "Elso bekezdes.\n\nMasodik bekezdes.",
      shortDescriptionBullets: ["Elso sor\nmasodik sor"],
    });

    expect(text.description).toBe("Elso bekezdes.\n\nMasodik bekezdes.");
    expect(text.bullets).toEqual(["Elso sor masodik sor"]);
  });

  /**
   * A CLI a kapott szoveget a TERMINALRA irja, ahol egy ESC-szekvencia nem
   * szoveg, hanem parancs. Ugyanaz a szigor, mint a kep-URL-eknel: a mai
   * kiszolgalo ilyet nem kuld, de a CLI tavoli - akar regebbi vagy idegen -
   * telepitest hiv, es a sajat kimenete akkor sem rajzolhato at.
   */
  it("a vezerlo karakterek kiesnek (a terminal nem rajzolhato at)", () => {
    const text = parseProductText({
      description: "Elso\u001b[2Jmasodik\r\nharmadik",
      shortDescriptionBullets: ["Pont\u001b[1m egy"],
      shortDescription: "\u001b[31mPiros",
    });

    expect(text.description).toBe("Elso[2Jmasodik\nharmadik");
    expect(text.bullets).toEqual(["Pont[1m egy"]);
    expect(text.shortDescription).toBe("[31mPiros");
  });
});

describe("productTextBlock", () => {
  it("szoveg nelkul URES string (a parancs igy semmit nem ir ki)", () => {
    expect(productTextBlock({ bullets: [], shortDescription: null, description: null })).toBe(
      "",
    );
  });

  it("pontok soronkent egy `- ` jellel, alattuk a rovid, majd a hosszu leiras", () => {
    const block = productTextBlock({
      bullets: ["Elso pont", "Masodik pont"],
      shortDescription: "Rovid.",
      description: "Hosszu.",
    });

    expect(block).toBe("- Elso pont\n- Masodik pont\n\nRovid.\n\nHosszu.\n");
  });
});

// --- a huzalozas, valodi futtatassal ---------------------------------------

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));

/** A CLI configja soha ne a fejlesztoi gepen levo valodi fajl legyen. */
const CONFIG_HOME = mkdtempSync(join(tmpdir(), "keypro-cli-text-test-"));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const servers: Server[] = [];

/** Hamis /api/v1/products/{key} kiszolgalo a megadott termek-objektummal. */
async function startStub(product: unknown): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/v1/products/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: product }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { code: "not_found", message: "nincs" } }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("nincs port");
  return `http://127.0.0.1:${address.port}`;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: CONFIG_HOME };
    delete env.KEYPRO_API_KEY;
    delete env.KEYPRO_API_BASE;
    execFile(
      TSX,
      [ENTRY, ...args, "--api-key", "kp_live_teszt"],
      { env, encoding: "utf8" },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? (err as { code: number }).code
            : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("keypro products get - a szoveg-blokk", () => {
  const COMMON = {
    id: 29,
    name: "Windows 11 Pro VL",
    sku: "WIN11P-MAKVL",
    listNetPriceEur: "10.00",
    onSale: false,
    yourUnitNetEur: "10.00",
    yourDiscountPercent: 0,
    isVirtual: true,
  };

  it("kiirja a felsorolas-pontokat es a leirast", async () => {
    const base = await startStub({
      ...COMMON,
      shortDescriptionBullets: [
        "Újratelepíthető, örökös ESD termékkulcs",
        "Azonnali online aktiválás 1 PC-re",
      ],
      shortDescription: "A kulcsot e-mailben küldjük.",
      description: "Hosszú leírás első bekezdése.",
    });

    const result = await runCli(["products", "get", "29", "--api-base", base]);

    expect(result.stdout).toContain("Leírás");
    expect(result.stdout).toContain("- Újratelepíthető, örökös ESD termékkulcs");
    expect(result.stdout).toContain("- Azonnali online aktiválás 1 PC-re");
    expect(result.stdout).toContain("A kulcsot e-mailben küldjük.");
    expect(result.stdout).toContain("Hosszú leírás első bekezdése.");
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  }, 30_000);

  it("REGI KISZOLGALO (nincs egyik szoveg-mezo sem): nincs blokk, 0 kilepesi kod", async () => {
    const base = await startStub(COMMON);

    const result = await runCli(["products", "get", "29", "--api-base", base]);

    expect(result.stdout).not.toContain("Leírás");
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  }, 30_000);

  it("`null` leiras es ures felsorolas ugyanaz, mint a hianyzo mezo", async () => {
    const base = await startStub({
      ...COMMON,
      shortDescriptionBullets: [],
      shortDescription: null,
      description: null,
    });

    const result = await runCli(["products", "get", "29", "--api-base", base]);

    expect(result.stdout).not.toContain("Leírás");
    expect(result.code).toBe(0);
  }, 30_000);

  it("--json: a nyers valasz megy tovabb, benne mindharom mezovel", async () => {
    const base = await startStub({
      ...COMMON,
      shortDescriptionBullets: ["Egy pont"],
      shortDescription: null,
      description: "Hosszu.",
    });

    const result = await runCli(["--json", "products", "get", "29", "--api-base", base]);
    const data = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(data.shortDescriptionBullets).toEqual(["Egy pont"]);
    expect(data.shortDescription).toBeNull();
    expect(data.description).toBe("Hosszu.");
    expect(result.code).toBe(0);
  }, 30_000);
});
