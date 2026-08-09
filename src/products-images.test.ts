/**
 * A `keypro products images` parancs KIMENETI SZERZODESE, valodi futtatassal:
 * a CLI-t egy helyi, hamis API-kiszolgalo ellen inditjuk el, es a stdout-ot,
 * a stderr-t es a kilepesi kodot merjuk. Csak egy tiszta fuggveny tesztje nem
 * lenne eleg: itt pontosan a huzalozas (parancs -> kliens -> kimenet) a
 * szerzodes, amire a partner szkriptje epul:
 *
 *     keypro products images 123 | xargs -n1 curl -O
 */

import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));

/** A CLI configja soha ne a fejlesztoi gepen levo valodi fajl legyen. */
const CONFIG_HOME = mkdtempSync(join(tmpdir(), "keypro-cli-test-"));

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

describe("keypro products images", () => {
  it("soronkent EGY abszolut URL, semmi mas, 0 kilepesi koddal", async () => {
    const base = await startStub({
      id: 123,
      name: "Windows 11 Pro",
      images: [
        { url: "https://keypro.hu/uploads/a.png", alt: "Doboz", position: 0 },
        { url: "https://keypro.hu/uploads/b.png", alt: null, position: 1 },
      ],
    });
    const result = await runCli(["products", "images", "123", "--api-base", base]);
    expect(result.stdout).toBe(
      "https://keypro.hu/uploads/a.png\nhttps://keypro.hu/uploads/b.png\n",
    );
    expect(result.code).toBe(0);
  }, 30_000);

  it("kep nelkuli termek: URES kimenet, megis 0 kilepesi kod (a hianyzo kep nem hiba)", async () => {
    const base = await startStub({ id: 5, name: "Kep nelkul", images: [] });
    const result = await runCli(["products", "images", "5", "--api-base", base]);
    expect(result.stdout).toBe("");
    expect(result.code).toBe(0);
  }, 30_000);

  it("REGI KISZOLGALO (nincs images mezo): ures kimenet, 0 kilepesi kod, nem omlik ossze", async () => {
    const base = await startStub({ id: 7, name: "Regi valasz" });
    const result = await runCli(["products", "images", "7", "--api-base", base]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  }, 30_000);

  it("--json: strukturalt tomb (regi kiszolgalonal is tomb, sosem null)", async () => {
    const base = await startStub({
      id: 9,
      images: [{ url: "https://keypro.hu/uploads/a.png", alt: "Doboz", position: 0 }],
    });
    const withImages = await runCli(["--json", "products", "images", "9", "--api-base", base]);
    expect(JSON.parse(withImages.stdout)).toEqual([
      { url: "https://keypro.hu/uploads/a.png", alt: "Doboz", position: 0 },
    ]);
    expect(withImages.code).toBe(0);

    const oldBase = await startStub({ id: 10 });
    const empty = await runCli(["--json", "products", "images", "10", "--api-base", oldBase]);
    expect(JSON.parse(empty.stdout)).toEqual([]);
    expect(empty.code).toBe(0);
  }, 30_000);
});

/**
 * A `products get` KEP-BLOKKJA. Eddig csak kozvetve, a `parseProductImages`
 * unit-tesztjen keresztul volt fedve - vagyis a huzalozas (parancs -> blokk ->
 * kimenet) nem volt lehorgonyozva, es epp a REGI KISZOLGALO elleni degradacio a
 * lenyeg: a CLI tavoli, akar `images` mezot nem is kuldo telepitest hiv.
 */
describe("keypro products get - a kep-blokk", () => {
  const COMMON = {
    id: 42,
    name: "Windows 11 Pro",
    sku: "FQC-1",
    listNetPriceEur: "10.00",
    onSale: false,
    yourUnitNetEur: "10.00",
    yourDiscountPercent: 0,
    isVirtual: true,
  };

  it("REGI KISZOLGALO (nincs images mezo): 'nincs', semmi fokep, 0 kilepesi kod", async () => {
    const base = await startStub(COMMON);
    const result = await runCli(["products", "get", "42", "--api-base", base]);

    expect(result.stdout).toContain("nincs");
    expect(result.stdout).not.toContain("Fő kép");
    expect(result.stdout).not.toContain("keypro products images");
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  }, 30_000);

  it("ures images tomb ugyanaz, mint a hianyzo mezo", async () => {
    const base = await startStub({ ...COMMON, images: [] });
    const result = await runCli(["products", "get", "42", "--api-base", base]);

    expect(result.stdout).toContain("nincs");
    expect(result.stdout).not.toContain("Fő kép");
    expect(result.code).toBe(0);
  }, 30_000);

  it("ket kep: darabszam, FO KEP es a teljes listara mutato tipp", async () => {
    const base = await startStub({
      ...COMMON,
      images: [
        { url: "https://keypro.hu/uploads/a.png", alt: "Doboz", position: 0 },
        { url: "https://keypro.hu/uploads/b.png", alt: null, position: 1 },
      ],
    });
    const result = await runCli(["products", "get", "42", "--api-base", base]);

    expect(result.stdout).toContain("2 db");
    expect(result.stdout).toContain("https://keypro.hu/uploads/a.png");
    expect(result.stdout).toContain("keypro products images 42");
    expect(result.code).toBe(0);
  }, 30_000);

  it("EGY kep eseten nincs tipp (a fokep mar ott van)", async () => {
    const base = await startStub({
      ...COMMON,
      images: [{ url: "https://keypro.hu/uploads/a.png", alt: null, position: 0 }],
    });
    const result = await runCli(["products", "get", "42", "--api-base", base]);

    expect(result.stdout).toContain("1 db");
    expect(result.stdout).not.toContain("keypro products images");
    expect(result.code).toBe(0);
  }, 30_000);
});
