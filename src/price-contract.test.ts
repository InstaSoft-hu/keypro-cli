import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { AGENT_DOCS } from "./agent-docs.js";
import type { KeyproClient } from "./client.js";
import { KEYPRO_MCP_INSTRUCTIONS, registerKeyproTools } from "./mcp-tools.js";
import {
  FALSE_PRICE_CLAIM,
  priceContract,
  wrapText,
} from "./price-contract.js";

/**
 * A KOTES: az ar-szerzodesnek egy tulajdonosa van (`price-contract.ts`).
 *
 * A mondat harom peldanyban allt, es a harmadik (`KEYPRO_MCP_INSTRUCTIONS`)
 * elesben azt mondta minden csatlakozo modellnek, hogy a keresesi ar mar
 * tartalmazza a hivo szerzodeses kedvezmenyet - miutan az `AGENT_DOCS` es az
 * `AGENTS.md` javito korben mar az ellenkezojere allt. Ez a fajl az, ami egy
 * negyedik (vagy visszairt) peldanyt pirosra valt.
 */

const API_MD = readFileSync(resolve(import.meta.dirname, "..", "API.md"), "utf8");

/**
 * Az MCP tool-leirasok, ahogy a modell latja oket. A registry csak eltarolja a
 * klienst (a handlerek closure-jeben), a REGISZTRACIO nem hivja meg - ezert
 * elmegy egy ures alany, es a teszt nem nyul semmilyen halozathoz.
 */
function toolDescriptions(): { name: string; description: string }[] {
  const found: { name: string; description: string }[] = [];
  const server = {
    registerTool: (name: string, config: { description?: string }) => {
      found.push({ name, description: config.description ?? "" });
    },
  } as unknown as McpServer;
  registerKeyproTools(server, {} as unknown as KeyproClient);
  return found;
}

describe("ar-szerzodes: egy forras", () => {
  it("az AGENT_DOCS a kozos `priceContract(...)`-ot hasznalja", () => {
    const expected = priceContract(
      {
        catalog: "`GET /products`",
        ownPrice: "`GET /products/{key}`",
        preview: "`POST /orders/preview`",
      },
      { width: 76, firstPrefix: "- ", prefix: "  " },
    );
    expect(
      AGENT_DOCS,
      "Az AGENT_DOCS ar-mondata nem a `price-contract.ts`-bol jon. Kezzel " +
        "irt peldany nem keszulhet: pontosan igy csuszott el az MCP-leiras.",
    ).toContain(expected);
  });

  it("a KEYPRO_MCP_INSTRUCTIONS ugyanazt a fuggvenyt hasznalja", () => {
    const expected = priceContract({
      catalog: "keypro_products_search",
      ownPrice: "keypro_product_get",
      preview: "keypro_order_preview",
    });
    expect(
      KEYPRO_MCP_INSTRUCTIONS,
      "Az MCP `instructions` ar-mondata nem a `price-contract.ts`-bol jon. " +
        "Ezt a mezot MINDEN csatlakozo modell megkapja az initialize valaszban.",
    ).toContain(expected);
  });

  it("egyetlen szallitott angol szoveg sem allitja, hogy az ar kedvezmenyes", () => {
    const tools = toolDescriptions();
    // Egy ures lista NEMA zold lenne: a sopres csak akkor er valamit, ha
    // tenylegesen minden tool-leiras atmegy rajta.
    expect(tools.length, "a tool-registry nem adott vissza leirasokat").toBeGreaterThan(
      15,
    );
    const surfaces: { where: string; text: string }[] = [
      { where: "AGENT_DOCS", text: AGENT_DOCS },
      { where: "KEYPRO_MCP_INSTRUCTIONS", text: KEYPRO_MCP_INSTRUCTIONS },
      ...tools.map((tool) => ({
        where: `tool-leiras: ${tool.name}`,
        text: tool.description,
      })),
    ];
    const offenders = surfaces
      .filter((surface) => FALSE_PRICE_CLAIM.test(surface.text))
      .map((surface) => surface.where);
    expect(
      offenders,
      `Ezek a szovegek azt allitjak, hogy az ar tartalmazza a kedvezmenyt: ` +
        `${offenders.join(", ")}. A katalogus ara a hivo szemelyetol fuggetlen; ` +
        "a hivo sajat ara a `yourUnitNetEur`, a kotelezo ervenyu osszeg az elonezete.",
    ).toEqual([]);
  });

  it("a keypro_products_search leirasa KIMONDJA az ar-szerzodest", () => {
    // A fenti sopres csak POZITIV hamis allitast keres (`FALSE_PRICE_CLAIM`),
    // a HIANYT nem: az ar-tagmondat csendben torolheto volt ebbol a kezzel irt
    // leirasbol. Ez az a tool, ahol a modell a katalogus-arat eloszor latja,
    // ezert itt a jelenletet is meg kell kovetelni.
    const search = toolDescriptions().find(
      (tool) => tool.name === "keypro_products_search",
    );
    expect(search, "nincs `keypro_products_search` a tool-registryben").toBeDefined();
    expect(
      search?.description,
      "A katalogus-arat ado tool leirasa nem mondja ki, hogy az ar NEM a hivoe.",
    ).toMatch(/does NOT carry the caller's contracted discount/);
    expect(
      search?.description,
      "A leiras nem iranyitja a modellt a hivo sajat arahoz (`yourUnitNetEur`).",
    ).toContain("yourUnitNetEur");
  });

  it("a magyar API.md is mind a harom allitast hozza", () => {
    // Mas nyelv, tehat a stringet nem oszthatja meg - de a HAROM allitasnak
    // ott is szerepelnie kell, kulonben a harom felulet ismet szetcsuszik.
    expect(API_MD, "hianyzik: a lista ara katalogus-ar").toMatch(
      /A terméklista ára NEM tartalmazza a szerződéses kedvezményedet/,
    );
    expect(API_MD, "hianyzik: a hivo sajat ara a `yourUnitNetEur`").toMatch(
      /A TE árad két helyről jön[\s\S]{0,200}yourUnitNetEur/,
    );
    expect(API_MD, "hianyzik: kotelezo ervenyu osszeg az elonezete").toMatch(
      /Kötelező érvényű összeg mindig az előnézeté/,
    );
  });
});

describe("wrapText", () => {
  it("a sorhosszt tartja, es az elotagokat kiirja", () => {
    const lines = wrapText("aaa bbb ccc ddd", {
      width: 9,
      firstPrefix: "- ",
      prefix: "  ",
    }).split("\n");
    expect(lines).toEqual(["- aaa bbb", "  ccc ddd"]);
    expect(lines.every((line) => line.length <= 9)).toBe(true);
  });

  it("egy kodreszletet nem tor ket sorba", () => {
    const wrapped = wrapText("x `GET /products/{key}` y", { width: 12 });
    expect(wrapped).toContain("`GET /products/{key}`");
  });
});
