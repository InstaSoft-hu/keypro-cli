import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { AGENT_DOCS } from "./agent-docs.js";
import type { KeyproClient } from "./client.js";
import {
  DROPSHIPPING_ORDER_REFUSALS,
  DROPSHIPPING_PAYMENT_REFUSALS,
  DROPSHIPPING_REFUSALS,
  DROPSHIPPING_TOGGLE_REFUSALS,
  dropshippingRefusalSentence,
  type DropshippingRefusal,
  type DropshippingRefusalCode,
  type DropshippingSurface,
} from "./dropshipping-contract.js";
import { registerKeyproTools } from "./mcp-tools.js";

/**
 * A KOTES: a dropshipping "mikor utasitjuk el" mondatanak EGY tulajdonosa van
 * (`dropshipping-contract.ts`), es minden felulet ABBOL generalja.
 *
 * MERT ELOZMENY (2026-09-15, R1-12): a mondat negy peldanyban allt, es a ket
 * MCP-leiras lemaradt. Azok azt tanitottak minden csatlakozo modellnek, hogy a
 * dropshipping "Physical shipments only, otherwise
 * dropshipping_requires_shipping (400)" - a `combine_free` rendeles viszont
 * FIZIKAI, es megis elutasitjuk, a hozza tartozo
 * `dropshipping_requires_own_parcel` kodot pedig a leiras meg sem emlitette.
 * Egy tool-leirasban allo teves mondat nem kozlesi hiba, hanem rossz
 * rendelesek sorozata.
 *
 * A teszt CAFOLHATO: barmelyik leirast kezzel visszairva PIROS lesz.
 */

interface ToolConfig {
  description?: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
}

/**
 * Az MCP tool-definiciok, ahogy a modell latja oket. A registry csak eltarolja
 * a klienst (a handlerek closure-jeben), a REGISZTRACIO nem hivja meg - ezert
 * elmegy egy ures alany, es a teszt nem nyul semmilyen halozathoz. (Ugyanaz a
 * minta, mint a `price-contract.test.ts`-ben.)
 */
function toolConfigs(): Map<string, ToolConfig> {
  const found = new Map<string, ToolConfig>();
  const server = {
    registerTool: (name: string, config: ToolConfig) => {
      found.set(name, config);
    },
  } as unknown as McpServer;
  registerKeyproTools(server, {} as unknown as KeyproClient);
  return found;
}

/** A `dropshipping` bemeneti mezo leirasa egy tool semajabol. */
function dropshippingFieldDoc(tool: string): string {
  const field = toolConfigs().get(tool)?.inputSchema?.dropshipping;
  expect(field, `${tool}: nincs \`dropshipping\` bemeneti mezo`).toBeTruthy();
  return field?.description ?? "";
}

describe("dropshipping: a kapu-mondatnak EGY tulajdonosa van", () => {
  it("minden kod szerepel legalabb egy felulet halmazaban", () => {
    const codes = Object.keys(DROPSHIPPING_REFUSALS) as DropshippingRefusalCode[];
    const used = new Set<DropshippingRefusalCode>([
      ...DROPSHIPPING_ORDER_REFUSALS,
      ...DROPSHIPPING_TOGGLE_REFUSALS,
      ...DROPSHIPPING_PAYMENT_REFUSALS,
    ]);
    for (const code of codes) {
      expect(used.has(code), `${code} egyetlen felulet halmazaban sincs`).toBe(
        true,
      );
    }
  });

  it("a rendelesfelvetel NEM emliti a csak utolag keletkezo kodokat", () => {
    // Egy most keletkezo rendelesnek meg sem cimkeje, sem hozzacsomagolt
    // gyereke nincs - egy ilyen kod ott csak zavarna a hivo modellt.
    const order = new Set<string>(DROPSHIPPING_ORDER_REFUSALS);
    expect(order.has("dropshipping_locked")).toBe(false);
    expect(order.has("dropshipping_has_combined_orders")).toBe(false);
  });

  it("a rendelesfelveteli tool-ok `dropshipping` mezoje a generatorbol jon", () => {
    const expected = dropshippingRefusalSentence("order");
    for (const tool of ["keypro_order_preview", "keypro_order_create"]) {
      const described = dropshippingFieldDoc(tool);
      expect(
        described,
        `${tool}: a \`dropshipping\` mezo leirasa nem a ` +
          "`dropshipping-contract.ts`-bol jon.",
      ).toContain(expected);
      // A regi, kezzel irt mondat NEM terhet vissza: a `combine_free` rendeles
      // fizikai, megis elutasitjuk.
      expect(described).not.toContain("Physical shipments only");
    }
  });

  it("a `keypro_order_set_dropshipping` leirasa a generatorbol jon", () => {
    const described = toolConfigs().get("keypro_order_set_dropshipping")
      ?.description;
    expect(described).toBeTruthy();
    expect(described).toContain(
      dropshippingRefusalSentence("toggle"),
    );
  });

  it("a `keypro_order_change_payment` leirasa a generatorbol jon", () => {
    // A cod-tiltas MASIK iranya ezen a vegponton keletkezik: a jelzo mar be van
    // kapcsolva, es a fizetesi modot allitanank cod-ra.
    const described = toolConfigs().get("keypro_order_change_payment")
      ?.description;
    expect(described).toBeTruthy();
    expect(described).toContain(dropshippingRefusalSentence("payment"));
  });

  it("a `keypro_order_change_payment_preview` leirasa is a generatorbol jon", () => {
    // 2026-09-16: az elonezet is elutasitja a cod-ra valtast egy dropshipping
    // rendelesen (eddig csak a megerosites) - a leirasnak ezt kell mondania.
    const described = toolConfigs().get("keypro_order_change_payment_preview")
      ?.description;
    expect(described).toBeTruthy();
    expect(described).toContain(dropshippingRefusalSentence("payment"));
  });

  it("az AGENT_DOCS is a generatorbol dolgozik", () => {
    expect(AGENT_DOCS).toContain(dropshippingRefusalSentence("order"));
    expect(AGENT_DOCS).toContain(dropshippingRefusalSentence("toggle"));
  });

  it("minden kod szerepel az AGENT_DOCS hibakod-listajaban is", () => {
    for (const code of Object.keys(DROPSHIPPING_REFUSALS)) {
      expect(
        AGENT_DOCS,
        `${code} hianyzik az AGENT_DOCS hibakod-listajabol`,
      ).toContain(code);
    }
  });
});

/**
 * R1-15: a statusz FELULETENKENT all, es a mondat a FELULET sajat statuszat
 * mondja.
 *
 * Kodonkent EGY statusz allt a tablaban, holott a `requires_shipping` es a
 * `requires_own_parcel` a rendelesfelvetelen `400`, az utolagos atallitason
 * `409` - a generalt mondat tehat az egyik feluleten BIZTOSAN hazudott,
 * mikozben a kezzel irt `cli/API.md` helyesen mondta mindkettot. Egy modell a
 * statusz szerint agazik el, tehat ez nem kozlesi hiba.
 *
 * A BUKAS BIZONYITVA: a `dropshipping_requires_own_parcel` toggle-statuszat
 * 400-ra visszairva az elso ket allitas PIROS lett; a
 * `dropshippingRefusalSentence` statuszat a felulet helyett fixen az "order"
 * agrol olvasva a harmadik PIROS lett.
 */
describe("dropshipping: a statusz FELULETFUGGO (R1-15)", () => {
  const SURFACES: DropshippingSurface[] = ["order", "toggle", "payment"];

  it("minden kod legalabb egy feluleten elofordul", () => {
    for (const [code, refusal] of Object.entries(DROPSHIPPING_REFUSALS)) {
      expect(
        Object.keys(refusal.status).length,
        `${code} egyetlen felulethez sincs statusszal kotve, tehat egyetlen ` +
          "felulet mondata sem emliti - a hivo modell sosem hall rola.",
      ).toBeGreaterThan(0);
    }
  });

  it("a ket ertelmezhetoseg-kod a felvetelen 400, az atallitason 409", () => {
    for (const code of [
      "dropshipping_requires_shipping",
      "dropshipping_requires_own_parcel",
    ] as const) {
      expect(DROPSHIPPING_REFUSALS[code].status.order).toBe(400);
      expect(DROPSHIPPING_REFUSALS[code].status.toggle).toBe(409);
    }
  });

  it("a mondat a FELULET sajat statuszat irja ki, nem egy kozoset", () => {
    expect(dropshippingRefusalSentence("order")).toContain(
      "dropshipping_requires_own_parcel (400)",
    );
    expect(dropshippingRefusalSentence("toggle")).toContain(
      "dropshipping_requires_own_parcel (409)",
    );
  });

  it("a mondat PONTOSAN a felulet kodjait sorolja fel", () => {
    for (const surface of SURFACES) {
      const sentence = dropshippingRefusalSentence(surface);
      for (const code of Object.keys(
        DROPSHIPPING_REFUSALS,
      ) as DropshippingRefusalCode[]) {
        const refusal: DropshippingRefusal = DROPSHIPPING_REFUSALS[code];
        const belongs = refusal.status[surface] !== undefined;
        expect(
          sentence.includes(`${code} (`),
          `${surface}: a(z) ${code} ${belongs ? "hianyzik a" : "nem valo a"} mondatba`,
        ).toBe(belongs);
      }
    }
  });
});
