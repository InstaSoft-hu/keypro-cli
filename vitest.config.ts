import { defineConfig } from "vitest/config";

/**
 * A `cli/` workspace SAJAT vitest konfigja.
 *
 * Enelkul a `vitest` felsetal a repo gyokereben levo konfigert, es annak
 * `setupFiles: ["src/test/load-env.ts"]` bejegyzeset a CLI konyvtarahoz kepest
 * oldja fel (`cli/src/test/load-env.ts`), ami nem letezik - ezert a
 * `pnpm cli:test` "Cannot find module" hibaval bukott, mielott egyetlen teszt
 * elindult volna. A CLI-nek nincs szuksege sem `.env`-re, sem a `@/` aliasra:
 * tiszta kliens-csomag.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
