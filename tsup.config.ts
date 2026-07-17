import { defineConfig, type Options } from "tsup";

const shared: Options = {
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: false,
};

// Ket kulon build: a bin (index.js) shebanggel; a megosztott MCP registry
// (mcp-tools.js, amit a webes route importal) shebang NELKUL, hogy a Next/
// Turbopack build be tudja huzni.
export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...shared,
    entry: ["src/mcp-tools.ts"],
    clean: false,
    // A webes app (tsc) tipusai a mcp-tools.d.ts-bol jonnek.
    dts: true,
  },
]);
