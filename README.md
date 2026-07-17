# @keypro/cli

Parancssori eszköz és MCP-szerver a [KeyPro.hu](https://keypro.hu) B2B
szoftverlicenc-webshophoz: rendelés leadása, visszamondása, fizetési mód
módosítása, rendelések / számlák / termékkulcsok lekérdezése, KEP-egyenleg és
profil kezelése. Regisztrált (jóváhagyott) viszonteladó fiók szükséges.

AI-ügynök barát: minden parancs támogatja a `--json` kimenetet, és a
`keypro mcp` beépített MCP stdio szerverként natív tool-okat ad a Claude Code /
Claude Desktop / Codex típusú ügynököknek.

## Biztonság és átláthatóság

- **Nyílt forrás.** Ez a repó a teljes forráskód — ellenőrizhető, hogy a
  csomag semmi rejtettet nem tartalmaz.
- **Vékony kliens.** Csak a HTTP API-t hívja; nincs benne titok, nincs
  telemetria, nem gyűjt és nem küld semmit rajtad kívül máshova.
- **Csak az általad megadott szerverhez beszél** (alap: `https://keypro.hu`).
- **A kulcs a tiéd.** `Authorization: Bearer` fejlécben megy, te hozod létre és
  bármikor visszavonhatod a fiókod `/mcp-cli` oldalán.
- **Provenance.** Az npm csomag GitHub Actions-ből, `--provenance` jelöléssel
  publikálódik, így kriptográfiailag igazolható, hogy a közzétett csomag ebből a
  forrásból, ebből a commitból épült.

## Telepítés

```bash
npm install -g @keypro/cli
```

Node.js 20+ szükséges.

## Gyors kezdés

```bash
keypro setup
```

A `setup` végigvezet: megkérdezi a szervert, majd a hitelesítést — **API kulcs**
(ajánlott) vagy **email + jelszó**. Utána:

```bash
keypro whoami
keypro products search windows --limit 5
```

## Hitelesítés

Négyféleképp adhatod meg a kulcsot (erősebb elöl):

```bash
keypro --api-key kp_live_... whoami        # per-parancs kapcsoló
export KEYPRO_API_KEY=kp_live_...           # környezeti változó (agentnek jó)
keypro config set api-key kp_live_...        # elmenti a configba
keypro login                                 # email + jelszó -> új kulcsot ment
```

- Kulcsot a weben a fiók **MCP és CLI** (`/mcp-cli`) oldalán készíthetsz,
  scope-okkal (olvasás / rendelés / profil) és lejárattal.
- A config a `~/.config/keypro/config.json` fájlban van (0600 jog).

## Szerver (API cím)

Alapértelmezés a production (`https://keypro.hu`). Váltás:

```bash
keypro config set api-base https://dev.keypro.hu
# vagy: KEYPRO_API_BASE=https://dev.keypro.hu, vagy --api-base
```

## Parancsok

| Parancs | Leírás |
|---|---|
| `keypro setup` | interaktív beállítás (szerver + hitelesítés) |
| `keypro whoami` | a bejelentkezett fiók adatai |
| `keypro rate` | aktuális EUR/HUF árfolyam (amit a shop használ) |
| `keypro products search <szó>` / `products get <sku\|id>` | termékkeresés / részletek |
| `keypro order preview --item <sku>=<db> --payment <mód>` | rendelés előnézete (összegek + confirmToken) |
| `keypro order create --item ... --payment ... --yes` | rendelés leadása |
| `keypro order list [--status ...]` / `order get <id>` | rendelések |
| `keypro order cancel <id>` | fizetetlen rendelés visszamondása |
| `keypro order change-payment <id> --payment <mód> [--yes]` | fizetési mód módosítása |
| `keypro keys list [--order <id>]` | kézbesített termékkulcsok |
| `keypro invoices list [--order <id>]` / `invoices get <id>` | számlák / díjbekérők (PDF link) |
| `keypro wallet [transactions]` | KEP-egyenleg + tranzakciók |
| `keypro profile get` / `profile set billing.city=... ` | profil |
| `keypro cards list` | mentett bankkártyák |
| `keypro parcelshops search <város\|irsz>` | GLS csomagpontok |
| `keypro key list` / `config get` / `logout` | kulcsok, config, kijelentkezés |
| `keypro agent-docs` | részletes AI-ügynök útmutató (stdout) |

Fizetési módok: `bacs` (átutalás / díjbekérő), `cheque` (8 napos, +5%),
`cod` (utánvét), `wallet` (KEP-egyenleg), `stripe` (bankkártya).

Rendelés-biztonság: a `create` és a `change-payment` mindig előnézetet kér
(összegekkel) és csak a preview-ból származó `confirmToken`-nel hajtódik végre,
így véletlen rendelés nem történhet.

## Gépi (JSON) kimenet

Minden parancs támogatja a `--json`-t: a stdout-ra gépi adat, a hibák a
stderr-re mennek stabil `error.code`-dal (snake_case, angol). Példa:

```bash
keypro --json whoami
```

## MCP (AI ügynök) bekötés

**Claude Desktop** — Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "keypro": { "command": "npx", "args": ["-y", "@keypro/cli", "mcp"] }
  }
}
```

**Claude Code:**

```bash
claude mcp add keypro -- npx -y @keypro/cli mcp
```

Az MCP a beállított kulcsot (`keypro setup` / config / `KEYPRO_API_KEY`)
használja. A webes claude.ai számára a shop külön **távoli MCP connectort** ad
(OAuth-tal); azt a fiókod `/mcp-cli` oldala írja le.

## Fejlesztés

```bash
pnpm install
pnpm build        # tsup -> dist/
pnpm typecheck
pnpm test         # vitest
```

## Licenc

MIT — lásd [LICENSE](./LICENSE).
