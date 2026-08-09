/**
 * `keypro_products_search` - a LEIRAS es a SEMA kotese.
 *
 * Egy MCP hivonak a LEIRAS a sema: amit ott igerunk, azt a `inputSchema`-nak
 * fel kell tudnia venni, es a kliensnek tovabb kell kuldenie. A leiras egy
 * ideig `include_variants=true`-t igert, mikozben se a sema, se a
 * `productsSearch` nem ismerte - egy agens ilyenkor vagy sema-hibat kap, vagy
 * (rosszabb) csendben a szurtlen listat, es azt hiszi, valtozatra keresett.
 */

import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { afterAll } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KeyproClient } from "./client.js";
import { registerKeyproTools } from "./mcp-tools.js";

const servers: Server[] = [];

afterAll(() => {
  for (const server of servers) server.close();
});

/** Hamis /api/v1 kiszolgalo, ami a KAPOTT URL-t adja vissza. */
async function startUrlEcho(seen: string[]): Promise<string> {
  const server = createServer((req, res) => {
    seen.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, data: { total: 0, products: [] } }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("nincs port");
  return `http://127.0.0.1:${address.port}`;
}

interface RegisteredTool {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function registeredTools(client: KeyproClient): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: (
      name: string,
      config: { description: string; inputSchema?: Record<string, unknown> },
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => {
      tools.set(name, {
        description: config.description,
        inputSchema: config.inputSchema ?? {},
        handler,
      });
    },
  } as unknown as McpServer;
  registerKeyproTools(server, client);
  return tools;
}

describe("keypro_products_search", () => {
  it("amit a leiras iger, azt a sema is ismeri", async () => {
    const base = await startUrlEcho([]);
    const tool = registeredTools(
      new KeyproClient({ apiBase: base, apiKey: "kp_live_teszt" }),
    ).get("keypro_products_search");

    expect(tool).toBeDefined();
    // A leiras ezen a neven hivatkozik ra, tehat pontosan ez a kulcs kell.
    expect(tool!.description).toContain("includeVariants=true");
    expect(Object.keys(tool!.inputSchema)).toContain("includeVariants");
  });

  it("az includeVariants VALOBAN eljut az API lekerdezesbe", async () => {
    const seen: string[] = [];
    const base = await startUrlEcho(seen);
    const tool = registeredTools(
      new KeyproClient({ apiBase: base, apiKey: "kp_live_teszt" }),
    ).get("keypro_products_search")!;

    await tool.handler({ q: "office", includeVariants: true });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("include_variants=true");
    expect(seen[0]).toContain("q=office");
  });

  it("nelkule nem kerul be a parameter (a lista alapertelmezetten csoport-sorokat ad)", async () => {
    const seen: string[] = [];
    const base = await startUrlEcho(seen);
    const tool = registeredTools(
      new KeyproClient({ apiBase: base, apiKey: "kp_live_teszt" }),
    ).get("keypro_products_search")!;

    await tool.handler({ q: "office" });

    expect(seen[0]).not.toContain("include_variants");
  });
});
