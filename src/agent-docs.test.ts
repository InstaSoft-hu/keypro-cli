import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_DOCS } from "./agent-docs.js";

/**
 * A csomagban szallitott `AGENTS.md` az `AGENT_DOCS` konstans MASOLATA, es a
 * masolat el is csuszott: a ket szoveg 2026-08-09-ig ket hibakoddal
 * (`wallet_payment_disabled`, `topup_method_not_allowed`) es a sortoressel
 * kulonbozott, mert a fajlt kezzel kellett utananyulni. A csuszas nema volt -
 * az npm csomagot olvaso agens mast latott, mint a `keypro agent-docs` kimenete.
 *
 * Ez a teszt a KOTES: egy tulajdonos (`agent-docs.ts`), es a fajlt ujra kell
 * generalni, ha a konstans valtozik:
 *
 *   npx tsx -e "import {AGENT_DOCS} from './src/agent-docs.ts'; \
 *     import {writeFileSync} from 'node:fs'; writeFileSync('AGENTS.md', AGENT_DOCS);"
 */
describe("AGENTS.md", () => {
  it("bitre azonos az AGENT_DOCS konstanssal", () => {
    const file = readFileSync(resolve(import.meta.dirname, "..", "AGENTS.md"), "utf8");
    expect(file).toBe(AGENT_DOCS);
  });

  it("az API.md-re mutat, ami a REST hivatkozas egyetlen forrasa", () => {
    expect(AGENT_DOCS).toContain("API.md");
    expect(AGENT_DOCS).toContain("https://keypro.hu/api");
  });
});
