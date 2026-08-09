import { defineConfig, type Options } from "tsup";

const shared: Options = {
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: false,
};

// Ket kulon build: a bin (index.js) shebanggel; a webes app altal importalt
// modulok (mcp-tools.js az MCP registryhez, agent-docs.js az agens-utmutatohoz)
// shebang NELKUL, hogy a Next/Turbopack build be tudja huzni oket.
export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...shared,
    entry: ["src/mcp-tools.ts", "src/agent-docs.ts"],
    clean: false,
    // A webes app (tsc) tipusai a *.d.ts-ekbol jonnek.
    dts: true,
  },
]);
