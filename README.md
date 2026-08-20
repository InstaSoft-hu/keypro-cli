# @keypro/cli

Parancssori eszköz és MCP-szerver a [KeyPro.hu](https://keypro.hu) B2B
szoftverlicenc-webshophoz: rendelés leadása, visszamondása, fizetési mód
módosítása, rendelések / számlák / termékkulcsok lekérdezése, KEP-egyenleg és
profil kezelése. Regisztrált (jóváhagyott) viszonteladó fiók szükséges.

AI-ügynök barát: minden parancs támogatja a `--json` kimenetet, és a
`keypro mcp` beépített MCP stdio szerverként natív tool-okat ad a ChatGPT,
Claude, Gemini, Codex, OpenCode, Antigravity és más MCP-kompatibilis
ügynököknek.

## Biztonság és átláthatóság

- **Nyílt forrás.** Ez a repó a teljes forráskód — ellenőrizhető, hogy a
  csomag semmi rejtettet nem tartalmaz.
- **Vékony kliens.** Csak a HTTP API-t hívja; nincs benne titok, nincs
  telemetria, nem gyűjt és nem küld semmit rajtad kívül máshova.
- **Csak az általad megadott szerverhez beszél** (alap: `https://keypro.hu`).
- **A kulcs a tiéd.** `Authorization: Bearer` fejlécben megy, te hozod létre és
  bármikor visszavonhatod a fiókod `/api` oldalán.
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

- Kulcsot a weben a fiók **API, MCP és CLI** (`/api`) oldalán készíthetsz,
  scope-okkal (olvasás / rendelés / profil / licenc-dokumentum) és lejárattal.
  A `licenses:write` (licenc-dokumentum kiállítása és visszavonása) **nincs
  alapból bejelölve**, és a `keypro login` sem adja meg magától: éles
  termékkulcs-készletbe ír, ezért kérni kell.
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
| `keypro products images <sku\|id>` | a termék képeinek URL-je, soronként egy |
| `keypro order preview --item <sku>=<db> --payment <mód>` | rendelés előnézete (összegek + confirmToken) |
| `keypro order create --item ... --payment ... --yes` | rendelés leadása |
| `keypro order list [--status ...]` / `order get <id>` | rendelések |
| `keypro order cancel <id>` | fizetetlen rendelés visszamondása |
| `keypro order change-payment <id> --payment <mód> [--yes]` | fizetési mód módosítása |
| `keypro keys list [--order <id>]` | kézbesített termékkulcsok, a továbbadási számokkal |
| `keypro licdok list [--product <id>] [--order <id>] [--status ...]` | kiállított licenc-átruházási dokumentumok (kulcsok nélkül) |
| `keypro licdok get <id>` | egy dokumentum teljes pillanatképe, termékkulcsokkal |
| `keypro licdok pdf <id> [--kind <fajta>] [--out fájl]` | a dokumentum PDF-je (a fajta a licenc-jellegből következik: `atruhazas`+`megsemmisites` / `licencigazolas` / `elofizetes-igazolas`) |
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

## Változatos termékek (csomagméretek, kiadások)

Egyes termékek **csoportok** (`type: "variable"`): egy termékcsalád több
változattal (pl. eszközszám, csomagméret). A csoport **nem rendelhető**, a nála
látszó ár csak a változatok árának minimuma.

- A `keypro products get <csoport>` válaszában `notPurchasable: true` és egy
  `variants` tömb van; minden elemnek saját `productId`, `sku`, `attributes` és
  `yourUnitNetEur` mezője van. A `keypro products search` ugyanezt a `variants`
  tömböt adja a csoport-sorokon.
- Mindig változatot rendelj: `--item <valtozat-sku>=<db>` vagy
  `--item id:<valtozat-productId>=<db>`.
- Ha mégis csoport kerül a rendelésbe, a szerver `variant_required` hibát ad, és
  az `error.details.variants` felsorolja a választható változatokat.
- Ha egy cikkszám több termékre illeszkedik, a szerver nem tippel, hanem
  `ambiguous_sku` hibát ad (`error.details.ambiguousSkus`); ilyenkor add meg a
  `productId`-t.

## Termékképek

Minden termék és minden változat kap egy `images` tömböt: rendezett, mindig ott
van (kép nélküli terméknél üres, sosem `null`). Egy elem `{ url, alt, position }`,
az URL **abszolút** és közvetlenül letölthető, az **első elem a fő kép a
kiszolgálható képek közül**: amit a bolt nem tud kiszolgálni, azt ki sem küldi (a
szerver naplózza), tehát ilyen terméknél a következő kép lesz az első. Külön
`image` mező nincs.

```bash
keypro products images 123                        # soronként egy abszolút URL
keypro products images 123 | xargs -n1 curl -O    # tükrözés a saját boltba
keypro --json products images 123                 # strukturált tömb
```

- Kép nélküli terméknél a parancs semmit nem ír ki, és **0 kilépési kóddal** áll
  meg: a hiányzó kép nem hiba, így egy `set -e` melletti tükröző ciklust nem
  szakít meg.
- A `keypro products get` a képek darabszámát és a fő kép URL-jét mutatja; a
  `--json` (és a `products search --json`) a teljes tömböt adja.
- Régebbi bolt-telepítésnél, ahol a mező még nincs a válaszban, a CLI "nincs
  kép"-ként viselkedik, nem hibázik.

## Gépi (JSON) kimenet

Minden parancs támogatja a `--json`-t: a stdout-ra gépi adat, a hibák a
stderr-re mennek stabil `error.code`-dal (snake_case, angol). Példa:

```bash
keypro --json whoami
```

## REST API (CLI nélkül)

A CLI és az MCP szerver ugyanannak a nyilvános REST API-nak a burkolója. Ha
saját szkriptből vagy más nyelvből hívnád közvetlenül, a teljes mezőszintű
hivatkozás a csomagban szállított **[API.md](./API.md)**: alap-URL,
hitelesítés és scope-ok, a stabil `error.code` értékek, lapozás, és
végpontonként a válasz mezői.

Webes változata: <https://keypro.hu/api>

## MCP (AI ügynök) bekötés

Bármely MCP-kompatibilis ügynök (Claude, ChatGPT, Codex, Gemini CLI, OpenCode,
Antigravity ...) natív tool-ként éri el a KeyPro-t a helyi (stdio) MCP
szerveren keresztül:

```bash
npx -y @keypro/cli mcp
```

Példák a regisztrációra:

**Claude Code:**

```bash
claude mcp add keypro -- npx -y @keypro/cli mcp
```

**Claude Desktop** (Settings → Developer → Edit Config) — a legtöbb kliens
hasonló `mcpServers` configot használ:

```json
{
  "mcpServers": {
    "keypro": { "command": "npx", "args": ["-y", "@keypro/cli", "mcp"] }
  }
}
```

Az MCP a beállított kulcsot (`keypro setup` / config / `KEYPRO_API_KEY`)
használja. Webes ügynököknek (ChatGPT, claude.ai) a shop külön **távoli MCP
connectort** ad (OAuth-tal); azt a fiókod `/api` oldala írja le.

## Fejlesztés

```bash
pnpm install
pnpm build        # tsup -> dist/
pnpm typecheck
pnpm test         # vitest
```

> **Ez a repó generált másolat.** A forrás a KeyPro webshop privát
> monorepójában él (`cli/`), és onnan írja felül a kiadási szkript
> (`pnpm cli:release`), hogy a webshop beépített MCP-végpontja és az npm-re
> kiadott csomag garantáltan ugyanazt a kódot futtassa. Kézzel itt ne
> szerkessz: a következő kiadás felülírja. Hibajelentést és javaslatot
> issue-ban várunk.

## Licenc

MIT — lásd [LICENSE](./LICENSE).
