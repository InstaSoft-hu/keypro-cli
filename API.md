# KeyPro REST API (`/api/v1`)

A KeyPro.hu B2B szoftverlicenc-webshop nyilvános REST API-ja. Ugyanazt a
felületet szolgálja ki, amit a [`@keypro/cli`](https://www.npmjs.com/package/@keypro/cli)
parancssori eszköz és a beépített MCP szerver használ - a CLI és az MCP nem
külön rendszer, hanem ennek az API-nak a burkolója.

- Ha AI ügynököt kötsz be, a CLI/MCP út egyszerűbb: `keypro agent-docs`
  (vagy a csomagban lévő `AGENTS.md`) leírja a teljes folyamatot.
- Ha saját szkriptből, más nyelvből vagy közvetlenül HTTP-vel hívnál, ez a
  dokumentum a hivatkozás.

Ez a fájl az API leírásának **egyetlen forrása**: a repóban él, innen kerül a
publikus `keypro-cli` repóba, az npm csomagba és a keypro.hu `/api` oldalára.

---

## Alap-URL

```
https://keypro.hu/api/v1
```

A fejlesztői példány (`https://dev.keypro.hu`) külön adatbázison fut, saját
kulcsokkal, és HTTP Basic Auth mögött áll - éles integrációt ne oda köss.

Minden válasz `application/json`, UTF-8 - **egy kivétellel**: ha egy létező
úton rossz HTTP metódust hívsz, a keretrendszer válaszol HTTP **405**-tel,
**üres törzzsel és `Content-Type` nélkül**, tehát ott nincs `error.code`,
amire kötni lehetne. A törzs feldolgozása előtt mindig nézd meg a
státuszkódot.

---

## Hitelesítés

Minden végpont (kettő kivételével) API kulcsot vár az `Authorization`
fejlécben:

```
Authorization: Bearer kp_live_...
```

Kulcsot a fiókod **[/api](https://keypro.hu/api)** oldalán készíthetsz
(korábbi neve: `/mcp-cli`), vagy géppel a `POST /api/v1/auth/login`
végponttal. A nyers kulcs csak a létrehozáskor látszik egyszer; a szerver
csak a hasheket tárolja.

Auth **nélkül** hívható:

| Végpont | Mit ad |
| --- | --- |
| `GET /api/v1` | discovery: mi ez az API, hol a dokumentáció |
| `POST /api/v1/auth/login` | email + jelszó → friss API kulcs |

### Scope-ok

Egy kulcs egy vagy több jogosultságot kap. **Nincs implicit kiterjesztés**: az
`orders:write` nem ad `read`-et és fordítva; minden végpont pontosan egy
scope-ot követel.

| Scope | Mit enged |
| --- | --- |
| `read` | minden olvasó végpont, az **előnézetek** (`POST /orders/preview`, `POST /orders/{id}/payment/preview`) és a fiók **bármely** API kulcsának visszavonása (`DELETE /keys/{id}`) |
| `orders:write` | rendelés leadása, visszamondása, fizetési mód módosítása |
| `profile:write` | `PATCH /profile` |

Az `admin` scope **nem kérhető API kulcsként**: a webes kulcskezelő nem is
ajánlja fel, és `/api/v1` alatt egyetlen végpontot sem elégít ki. Az admin
hozzáférés külön felület (admin MCP, OAuth vagy szerveren tárolt token).

> **A `read` scope nem ártalmatlan, és nem csak a saját üzemedet érinti.** Egy
> `read` kulcs a fiók TELJES olvasó hozzáférése. Amit egyetlen ilyen kulccsal
> ki lehet olvasni:
>
> - **A végfelhasználóid személyes adatai.** A
>   `GET /license-documents/{id}` és a `/pdf` a kiállított licenc-átruházási
>   dokumentumot adja vissza, benne a végfelhasználó nevével, címével,
>   adószámával és kapcsolattartójával. Ez HARMADIK SZEMÉLYEK adata, nem a
>   tiéd: itt egy kiszivárgott kulcs nem a te rendelkezésre állásodat rontja,
>   hanem az ügyfeleid adatait teszi ki, ami adatvédelmi incidens.
> - **A fiók teljes termékkulcs-készlete, maszkolatlanul.** A
>   `GET /license-keys` EGY hívásban visszaadja az összes kézbesített
>   termékkulcsot (nagyobb partnernél több száz kulcs), teljes szövegükkel,
>   plusz azt, hogy melyikből mennyi szabad még.
> - **A fiók összes API kulcsának letiltása.** A `GET /keys` kilistázza az
>   azonosítójukat, a `DELETE /keys/{id}` pedig bármelyiket visszavonja - nem
>   csak azt, amelyikkel hitelesítettél. Egy `read` kulcs tehát le tud tiltani
>   egy `orders:write` kulcsot, azaz meg tudja bénítani a fiók összes
>   integrációját.
>
> Amit viszont **nem** tud: nem ad le és nem mond vissza rendelést, nem költ
> pénzt (sem KEP egyenleget, sem kártyát), és nem ír profilt - ezek
> `orders:write` / `profile:write` scope-ot kérnek. Licenc-dokumentumot
> kiállítani vagy visszavonni pedig egyetlen scope-pal sem lehet: az API-n a
> licenc-dokumentumoknak csak OLVASÓ végpontjuk van, kiállítani a webes
> felületen tudsz.
>
> Ha egy harmadik félnek adsz ki kulcsot, ezzel számolj, és adj neki SAJÁT
> kulcsot: az önmagában visszavonható, a többi integrációd leállítása nélkül.

### Rate limit

Kulcsonként **120 kérés / 60 másodperc**. Túllépésnél HTTP 429,
`error.code = "rate_limited"`, `Retry-After` fejléc, és
`error.details.retryAfterSeconds`.

A bejelentkezés külön, szigorúbb korláton van: 5 kísérlet / perc
(IP + email párra) és 20 kísérlet / óra (IP-re).

Két végpontnak **saját, szűkebb kerete** van. Mindkettő a 120-as általánoson
**felül** fogy, tehát mindig a szűkebb lép életbe:

| Végpont | Keret | Miért |
| --- | --- | --- |
| `GET /license-documents/{id}/pdf` | **10** kérés / 60 mp | minden hívása egy PDF-generálást indít, ami nagyságrendekkel drágább egy JSON válasznál |
| `GET /license-keys` | **6** kérés / 60 mp | egy hívás ára a te kulcsaid SZÁMÁVAL nő: kulcsonként egy külön kérés megy a licencszolgáltatáshoz (nagyobb partnernél több száz), amit az általános keret nem modellez |

A `GET /license-keys` válasza csak akkor változik, ha új kulcs érkezik vagy új
átruházási dokumentum készül, tehát a 10 másodperces frissítés bőven sűrűbb,
mint amit az adat indokol. Ha egy ügynök ciklusban hívja, **tárold el a
választ** ahelyett, hogy újrakérnéd.

---

## Válasz-boríték

Minden válasz ugyanaz a két alak közül az egyik.

Siker:

```json
{ "ok": true, "data": { } }
```

Hiba:

```json
{ "ok": false, "error": { "code": "unknown_product", "message": "Nincs ilyen termék ...", "details": {} } }
```

- `error.code` **stabil, gépi azonosító** (snake_case, angol). **Erre köss**,
  ne a `message`-re: a `message` embernek szóló magyar szöveg, és bármikor
  változhat.
- `error.details` csak akkor van jelen, ha az adott hibához tartozik
  többletadat (lásd a táblázatot).

**Egyetlen kivétel van, és az is csak a SIKER ágon**: a
`GET /license-documents/{id}/pdf` sikeres válasza nyers `application/pdf`
bájtfolyam, boríték nélkül (a JSON boríték bájtokat nem tud vinni). Minden
HIBÁJA - 401, 403, 404, 429 - ugyanaz a `{ ok: false, error }` boríték, mint
mindenhol máshol. A gyakorlati szabály: ha a válasz `Content-Type`-ja
`application/pdf`, a törzs a fájl; minden más esetben boríték jön.

### Hibakódok

| `code` | HTTP | Mikor |
| --- | --- | --- |
| `unauthorized` | 401 | hiányzó, nem `Bearer` alakú, érvénytelen, visszavont vagy lejárt kulcs |
| `forbidden_scope` | 403 | a kulcsnak nincs meg a végponthoz kellő scope-ja |
| `rate_limited` | 429 | átlépted a percenkénti keretet; `details.retryAfterSeconds` |
| `validation_failed` | 400 | séma-hiba; `details` = `[{ path, message }]`, vagy hiányzó törzsadat esetén `details.missing` |
| `not_found` | 404 | nincs ilyen rendelés / számla / kulcs, vagy ismeretlen végpont |
| `unknown_product` | 400 / 404 | ismeretlen SKU vagy termékazonosító; `details.unknownSkus` / `details.unknownProductIds` |
| `ambiguous_sku` | 400 | a SKU több termékre illik; `details.ambiguousSkus` - adj `productId`-t |
| `variant_required` | 400 | csoport-terméket próbáltál rendelni; `details.variants` felsorolja a választható változatokat |
| `coupon_invalid` | 400 | a kuponkód nem érvényes erre a kosárra |
| `shipping_required` | 400 | fizikai tétel szállítási mód nélkül; `details.availableMethods` |
| `invalid_parcelshop` | 400 | ismeretlen csomagpont-azonosító |
| `cod_requires_physical` | 400 | utánvét csak fizikai kiszállításhoz |
| `combine_parent_unavailable` | 400 | az összevonásra jelölt rendelés már nem alkalmas rá |
| `confirm_required` | 400 | hiányzik a `confirmToken` (kötelező előnézet) |
| `confirm_token_invalid` | 400 | lejárt vagy nem illő token; `details.reason` (`malformed` / `expired` / `mismatch`) + `details.currentTotals` |
| `insufficient_wallet_balance` | 400 | kevés a KEP egyenleg; `details.balanceEurNet`, `details.requiredNetEur` |
| `wallet_payment_disabled` | 400 | a KEP egyenleggel fizetés ki van kapcsolva |
| `topup_method_not_allowed` | 400 | egyenlegfeltöltő rendelésre ez a fizetési mód nem megengedett |
| `same_payment_method` | 400 | a rendelés már ezen a fizetési módon van |
| `invalid_card` | 400 | a megadott `cardId` nem a te mentett kártyád |
| `stripe_unavailable` | 502 | a kártyás fizetés szolgáltatója nem elérhető |
| `order_not_cancelable` | 409 | a rendelés ebben az állapotban nem mondható vissza |
| `order_not_changeable` | 409 | a rendelés fizetési módja már nem módosítható |
| `account_pending` | 403 | a fiók még jóváhagyásra vár (bejelentkezés) |
| `account_inactive` | 403 | a fiók le van tiltva (bejelentkezés) |
| `invalid_credentials` | 401 | rossz email vagy jelszó (bejelentkezés) |
| `internal` | 500 | váratlan szerverhiba |

---

## Lapozás

**Öt végpont lapozható**, és csak ezek fogadják a `limit` + `offset` query
paramétert (a válaszban vissza is küldik mindkettőt):

| Végpont | `limit` alapérték | `limit` korlát | `offset` |
| --- | --- | --- | --- |
| `GET /api/v1/products` | `50` | 1-100 | `0`, >= 0 |
| `GET /api/v1/orders` | `25` | 1-100 | `0`, >= 0 |
| `GET /api/v1/invoices` | `25` | 1-100 | `0`, >= 0 |
| `GET /api/v1/wallet` | `25` | 1-100 | `0`, >= 0 |
| `GET /api/v1/license-documents` | `25` | 1-100 | `0`, >= 0 |

**`total` mezőt a `GET /products` és a `GET /license-documents` ad** (a teljes
szűrt találathalmaz mérete a lapozás előtt). A másik három lapozható lista
darabszámot nem küld: ott addig lapozz, amíg a tömb rövidebb nem lesz a
`limit`-nél.

**A többi listázó végpont NEM lapozható**, és a `limit` / `offset` paramétert
CSENDBEN figyelmen kívül hagyja: egyben adja vissza a teljes listát, tehát a
fenti "lapozz, amíg rövidebb" recept rajtuk **végtelen ciklus** lenne (a tömb
sosem lesz rövidebb, mert mindig ugyanaz jön vissza).

| Nem lapozható végpont | Amit ad |
| --- | --- |
| `GET /api/v1/keys` | `{ keys }` |
| `GET /api/v1/cards` | `{ stripeEnabled, cards }` |
| `GET /api/v1/license-keys` | `{ products }` |
| `GET /api/v1/shipping/parcelshops` | `{ truncated, parcelshops }` |
| `GET /api/v1/orders/{id}/keys` | `{ orderId, orderStatus, keys, licenses }` |

A `GET /shipping/parcelshops` a hosszú találatlistát csonkolja, és ezt a saját
`truncated: true` mezőjével jelzi - ilyenkor szűkíts a `q` paraméterrel, ne
lapozz.

---

## Pénznem, árak, kerekítés

- Minden összeg EUR, JSON `number`-ként (nem string), két tizedesre kerekítve.
- **Alapszabály: minden EUR-összeg NETTÓ.** Így nettó a `netPriceEur`, a
  `listNetPriceEur`, a `priceFromEur`, a `priceToEur`, a `yourUnitNetEur`, az
  `unitNetEur`, a `lineNetEur`, a `netTotalEur`, a `cartNetEur`, a
  `shippingNetEur`, a `couponDiscountNetEur`, a `couponDiscountEur`, a
  `discountNetEur`, a `netEur` (díj- és szállítási sorokon), a `balanceEurNet`,
  a `walletBalanceEurNet`, az `amountEur`, a `bonusEur`, a `balanceAfterEur`, a
  `walletBalanceAfterEur` és a `requiredNetEur` is.
  **A mezőnév-utótagra ne köss**: a `netTotalEur` és a `balanceEurNet` sem
  `...NetEur` végű, a `taxTotalEur` pedig a végén `Eur`, mégsem bruttó.
  Pontosan **három** mezőcsoport nem nettó:

| Mező | Mit hoz |
| --- | --- |
| `lineGrossEur`, `grossTotalEur`, `shipping.grossEur`, a `payment.fees[]` `grossEur` mezője | bruttó = nettó + ÁFA |
| `taxTotalEur`, `lineTaxEur`, `vatEur` | **maga az ÁFA** (`grossTotalEur - netTotalEur`), nem bruttó összeg |
| `displayGrossTotal`, `feeDeltaEur` | bruttó: a `displayGrossTotal` a kért `currency` szerinti bruttó végösszeg (HUF-nál **egész forint**), a `feeDeltaEur` a bruttó végösszeg változása a fizetési mód váltásakor (előjeles) |

- A `GET /exchange-rate` `rate` / `eurToHuf` / `hufToEur` / `referenceRate`
  mezője nem összeg, hanem szorzó, a `yourDiscountPercent` és a
  `discountPercent` pedig százalék - ezekre a fenti szabály nem vonatkozik.
- **A terméklista ára NEM tartalmazza a szerződéses kedvezményedet.** A
  `GET /products` `netPriceEur` és `listNetPriceEur` mezője a katalógus-ár
  (akciós, illetve listaár), a hívó személyétől függetlenül.
- **A TE árad két helyről jön**: a `GET /products/{key}` `yourUnitNetEur` +
  `yourDiscountPercent` mezőjéről (a `variants[]` elemein is), 1 db-ra; és a
  `POST /orders/preview` `lines[]` tömbjének `unitNetEur` mezőjéről.
- **Kötelező érvényű összeg mindig az előnézeté** (`POST /orders/preview`):
  csak ott van benne a mennyiségi sáv, a kupon, a fizetési mód díja és a
  szállítás. Aki a lista `netPriceEur`-jából árazza a saját ügyfelét,
  szisztematikusan MAGASABB árat mutat, mint amit a rendelés ténylegesen
  felszámít.
- HUF megjelenítéshez a `GET /exchange-rate` végponton kapott árfolyammal
  szorozz, és **egész forintra** kerekíts.
- Dátumok ISO 8601 UTC stringek (`createdAt`, `deliveredAt`, ...).

---

## Termékképek - az `images` szerződés

Ugyanaz az alak minden felületen (terméklista sorai, a lista `variants[]`
elemei, a termék-részletező, annak `variants[]` elemei):

```json
"images": [
  { "url": "https://keypro.hu/uploads/products/b1224aa9ee630329e0806b459dbccbeee7fc08cf2a8126ca20c7d1602fda0e3d.jpg", "alt": "Office 2024", "position": 0 }
]
```

A szerződés pontjai:

1. Az `images` **mindig tömb, soha nem `null`**. Kép nélküli terméken üres
   tömb (`[]`).
2. `images[0]` a **főkép** - a kiszolgálhatók közül. Egy tárolt, de ki nem
   szolgálható kép kimarad a tömbből (a szerver naplózza), tehát ilyenkor a
   következő kép lesz az első, és a `position` értékek nem feltétlenül
   folytonosak és nem feltétlenül 0-ról indulnak.
3. Az `url` **abszolút** és közvetlenül letölthető, bejelentkezés nélkül. Az
   URL ALAKJÁRA viszont semmi nem garantált. Ma minden sor a bolt saját
   képtárára mutat
   (`https://keypro.hu/uploads/products/<sha256>.<kiterjesztés>`; 2026-08-09-i
   mérés: 113 sorból 113), de a legacy
   `https://keypro.hu/wp-content/uploads/<év>/<hó>/...` alak **továbbra is
   érvényes és bármikor előfordulhat** - a bolt tárolhat külső abszolút
   címet is. **Ne szűrj URL-mintára**, a kapott címet töltsd le.
4. Az `alt` `string` vagy `null`; 300 karakternél hosszabb szöveg csonkolva
   érkezik.
5. **Nincs külön `image` vagy `imageUrl` skalármező** egyik végponton sem.
6. **A változat (variant) örökli a csoportja képeit, ha nincs sajátja.** A
   sorrend: ha a változatnak van legalább egy kiszolgálható saját képe, azt (és
   CSAK azt) kapod - a csoport képei nem fűződnek mögé. Ha egy sincs, a
   `images` a CSOPORT képeivel jön, változatlan `position` értékekkel, a 2.
   pont szűrése után (tehát ott is `images[0]` a főkép a kiszolgálhatók közül).
   Visszafelé nincs öröklés: a csoport sosem veszi át egy változata képét.
   **Ezért egy változaton kapott kép a csoportot is ábrázolhatja** - ma a
   változatok nem néznek ki másképp (a "10 db" és a "25 db" ugyanaz a matrica),
   de ha a saját képre van szükséged, a `GET /products/{key}` `groupProductId`
   mezőjéből tudod, hogy változat-sort nézel. A termék-részletező `group`
   hivatkozás-objektuma továbbra sem hoz képet: a képnek egy helye van a
   válaszban, a termék `images` tömbje.

---

## Végpontok

### `GET /api/v1`

Discovery, auth nélkül. `data`: `name`, `version`, `docs`, `auth`.

### `POST /api/v1/auth/login`

Auth nélkül. Email + jelszó → friss API kulcs.

Törzs: `email` (kötelező), `password` (kötelező), `name` (kulcs neve,
alapértelmezés `"CLI login"`, max 80), `scopes` (alapértelmezés: mind a három
kiadható scope).

`data`: `token` (a nyers kulcs - **csak itt látszik**), `keyId`, `prefix`,
`scopes`, `name`.

Hibák: `invalid_credentials`, `account_pending`, `account_inactive`,
`rate_limited`.

### `GET /api/v1/me` - scope: `read`

`data`: `id`, `email`, `companyName`, `firstName`, `role`,
`walletBalanceEurNet`, `key: { id, prefix, name, scopes }`.

### `GET /api/v1/profile` - scope: `read`

`data`: `{ profile }`. A profil alakja:

- gyökér: `id`, `email`, `role`, `companyName`, `taxNumber`, `firstName`,
  `phone`, `website`, `noteOnInvoice`
- `billing`: `firstName`, `lastName`, `company`, `address1`, `address2`,
  `city`, `postcode`, `state`, `country`, `email`, `phone`
- `shipping`: ugyanaz, `email` nélkül

### `PATCH /api/v1/profile` - scope: `profile:write`

Törzs: a lapos mezőnevek (`firstName`, `phone`, `website`, `companyName`,
`taxNumber`, `billingCity`, `shippingPostcode`, ... ) részhalmaza, plusz a
`noteOnInvoice` és `licenseDocsIncludeKeys` logikai kapcsolók. Üres string
(`""`) → `null`. A bejelentkezési email itt **nem** módosítható.

`data`: `updated` és a friss `profile`. Az `updated` a kérésben ELFOGADOTT
mezők neve (amit ismert mezőként küldtél), **nem** a ténylegesen megváltozott
értékeké: ha ugyanazt az értéket küldöd vissza, a mező akkor is szerepel
benne. Változás-detektálásra a friss `profile`-t hasonlítsd a korábbihoz.
Ha egyetlen ismert mezőt sem küldtél: `validation_failed`.

### `GET /api/v1/products` - scope: `read`

Query: `q` (max 200), `category` (kategória-slug, az alkategóriákkal együtt),
`on_sale` (`true`/`false`), `sort`
(`popularity` | `name` | `price_asc` | `price_desc` | `newest`),
`include_variants` (`true`/`false`), `limit` (alap 50), `offset`.

`data`: `total`, `limit`, `offset`, `products[]`. Egy termék:

`id`, `slug`, `sku`, `name`, `type` (`simple` | `variable`), `groupProductId`,
`listNetPriceEur`, `netPriceEur`, `priceFromEur`, `priceToEur`, `onSale`,
`isVirtual`, `isLicensed`, `fulfillmentType`
(`digital` | `oem_sticker` | `key_card` | `subscription`),
`stock: { status, available, label }`
(`status`: `always` | `unknown` | `unlimited` | `in_stock` | `low` | `out`),
`variantCount`, `variants[]`, `category: { slug, name } | null`, `images[]`.

**Az itteni `netPriceEur` / `listNetPriceEur` a KATALÓGUS-ár, a te
szerződéses kedvezményed nélkül** (lásd a "Pénznem, árak, kerekítés"
szakaszt). A te egységárad a `GET /products/{key}` `yourUnitNetEur` mezőjén,
a kötelező érvényű összeg pedig a `POST /orders/preview` válaszán jön.

A `variants[]` **mindig jelen van**: `variable` típusú soron a publikált
változatokkal, minden más soron üres tömbként - `include_variants` nélkül is.
Elemei: `productId`, `sku`, `name`, `attributes`, `netPriceEur`, `images[]`.
Az `include_variants=true` azt kapcsolja be, hogy a változat-sorok ÖNÁLLÓ
találatként is megjelenjenek a `products[]` tömbben (különben csak a
csoport-sor jön).

### `GET /api/v1/products/{key}` - scope: `read`

A `{key}` lehet numerikus termékazonosító, slug vagy cikkszám (ebben a
sorrendben próbálja).

`data`: a lista mezőin túl `shortDescription`, **`yourUnitNetEur`**,
`yourDiscountPercent`, `notPurchasable`, `variantAttributes`,
`group: { productId, slug, name } | null`, és a bővebb `variants[]`
(`productId`, `slug`, `sku`, `name`, `attributes`, `listNetPriceEur`,
`netPriceEur`, `onSale`, `yourUnitNetEur`, `yourDiscountPercent`,
`isVirtual`, `fulfillmentType`, `stock`, `images[]`).

**A lista három mezője viszont HIÁNYZIK innen** - ez nem a lista bővebb
változata, hanem egy másik alak: nincs `category`, nincs `priceFromEur` és
nincs `variantCount`. Ha kategória kell, a `GET /products` soráról vedd; a
változatok száma itt a `variants.length`.

**Az itteni `netPriceEur` / `listNetPriceEur` is a KATALÓGUS-ár** - ugyanaz,
amit a `GET /products` ad -, és ugyanez áll a `variants[]` elemeinek
`netPriceEur` / `listNetPriceEur` mezőjére. A szerződéses kedvezményedet
kizárólag a `yourUnitNetEur` (+ `yourDiscountPercent`) hordozza, a termék
gyökerén és minden változat-soron külön. A rendelésre kötelező érvényű összeg
továbbra is a `POST /orders/preview` válasza.

`notPurchasable: true` = **csoport-termék**, közvetlenül nem rendelhető (a
listaára a változatai minimuma). Mindig változatot rendelj.

Hiba: `unknown_product` (404).

### `POST /api/v1/orders/preview` - scope: `read`

**A rendelés kötelező első lépése.** Beárazza a kosarat, és kiad egy
`confirmToken`-t.

Törzs: `items[]` (1-50 elem, elemenként `sku` **vagy** `productId`, plusz
`qty`), `paymentMethod` (`bacs` | `cheque` | `cod` | `wallet` | `stripe`),
`shippingMethodId` (`gls_hd` | `gls_parcelshop` | `combine_free`),
`parcelshopId`, `combineWithOrderId`, `couponCode`, `currency`
(`EUR` | `HUF`, alap `EUR`), `billing`, `shipping`, `taxNumber`,
`internalReference`, `cardId`.

`data`: `lines[]` (`productId`, `sku`, `name`, `qty`, `unitNetEur`,
`lineNetEur`, `lineGrossEur`, `discountPercent`),
`payment: { method, label, fees: [{ label, netEur, grossEur }] }`,
`shipping: { id, label, netEur, grossEur, parcelshop } | null`,
`coupon: { code, discountNetEur } | null`,
`totals: { cartNetEur, couponDiscountNetEur, shippingNetEur, netTotalEur, taxTotalEur, grossTotalEur }`,
`stock: { lines[], backordered, message }`, `currency`, `eurRate`,
`displayGrossTotal`, `wallet: { balanceEurNet, sufficient } | null`,
`billing`, `shippingAddress`, `confirmToken`, `confirmTokenExpiresAt`.

A `confirmToken` **15 percig** él, és a tételekhez + fizetési módhoz + bruttó
végösszeghez van kötve.

### `POST /api/v1/orders` - scope: `orders:write`

Törzs: ugyanaz, mint az előnézeté, plusz a **kötelező** `confirmToken`.
Opcionális `Idempotency-Key` fejléc: ugyanazzal a kulccsal soha nem jön létre
második rendelés.

**A kulcs első 100 karaktere számít**, a hosszabbat a szerver hiba nélkül,
CSENDBEN levágja. Két különböző kulcs, ami az első 100 karakterében megegyezik
(pl. közös prefix + a végén eltérő azonosító), ugyanarra a rendelésre dedupál:
a második kérésre nem jön létre új rendelés, HTTP 200 érkezik
`idempotentReplay: true`-val. Használj rövid, ELÖL eltérő kulcsot (pl. UUID-t).

Válasz: HTTP **201** új rendelésnél, **200** idempotens ismétlésnél.

`data`: `order` (rendelés-részletező), `invoices[]`, `deliveredKeyCount`,
`payment: { method, charged, paymentUrl?, declineCode?, walletBalanceAfterEur?, note }`,
`idempotentReplay`.

Ha `payment.paymentUrl` érkezik (kártya + 3DS vagy nincs mentett kártya), azt
a linket kell böngészőben megnyitni; kb. 1 óráig érvényes, utána a rendelés
automatikusan **`cancelled` státuszba kerül**. A rendelés sora MEGMARAD (a
`GET /orders` listában is ott lesz, a `GET /orders/{id}` továbbra is
kiszolgálja) - ne `not_found`-ra várj.

Ha ár változott az előnézet óta: `confirm_token_invalid`, és
`error.details.currentTotals` már az új összegeket hozza - futtasd újra az
előnézetet.

Fizetési módok:

| `paymentMethod` | Mit jelent |
| --- | --- |
| `bacs` | átutalás: a rendelés `on-hold`, díjbekérő készül, kulcs a beérkezés után |
| `cheque` | 8 napos fizetési határidő (+5% díj a nettó termékösszegre) |
| `cod` | utánvét, csak fizikai kiszállításnál (+1,5 EUR) |
| `wallet` | KEP egyenleg, azonnal terhelődik |
| `stripe` | mentett bankkártya (off-session) |

### `GET /api/v1/orders` - scope: `read`

Query: `status` (`pending`, `processing`, `on-hold`, `completed`,
`cancelled`, `refunded`, `failed`, `prepared-shipping`, `shipped`,
`under-delivery`), `limit`, `offset`.

`data`: `limit`, `offset`, `orders[]`. Egy sor: `id`, `number`, `status`,
`statusLabel`, `paymentMethod`, `paymentMethodLabel`, `currency`, `eurRate`,
`netTotalEur`, `grossTotalEur`, `couponCode`, `createdAt`, `itemNames[]`.

### `GET /api/v1/orders/{id}` - scope: `read`

`data`: `order`, `invoices[]`, `paymentUrl` (csak nyitott kártyás fizetésnél,
egyébként `null`), `licenseDocuments[]`.

A `licenseDocuments[]` az EBBŐL a rendelésből merítő, általad kiállított
licenc-átruházási dokumentumok **összefoglaló** alakja (ugyanaz a sor, mint a
`GET /license-documents` listán, termékkulcsok nélkül). Egy dokumentum akkor
kerül ide, ha ez a rendelés az elsődleges forrása, VAGY ha valamelyik tétele
ebből a rendelésből származó kulcsot köt le.

A rendelés-részletező a lista mezőin túl: `items[]` (`id`, `productId`,
`name`, `qty`, `unitNetEur`, `lineNetEur`, `lineTaxEur`), `billing`,
`shipping`, `shippingMethod`, `glsParcelshop`, `couponDiscountEur`,
`taxNumber`, `internalReference`. (Az `itemNames` a részletezőn nincs.)

Idegen rendelés `not_found`-ot ad, nem 403-at.

### `POST /api/v1/orders/{id}/cancel` - scope: `orders:write`

Kifizetetlen rendelés visszamondása (átutalás / kártya / utánvét; a 8 napos
`cheque` és a már kifizetett rendelés nem). Törzs nincs.

`data`: `order`, `invoices[]`, `cancelled: true`, `alreadyCancelled`, `note`.
Hiba: `order_not_cancelable` (409).

### `POST /api/v1/orders/{id}/payment/preview` - scope: `read`

Törzs: `newMethod`. `data`: `currentMethod`, `newMethod`,
`newTotals: { netTotalEur, grossTotalEur }`, `feeDeltaEur`, `fees[]`,
`confirmToken`, `confirmTokenExpiresAt`, `wallet`, `note`.

### `POST /api/v1/orders/{id}/payment` - scope: `orders:write`

Törzs: `newMethod`, `confirmToken` (kötelező), `cardId` (opcionális,
`pm_...`). `data`: `order`, `invoices[]`,
`payment: { method, status, charged, paymentUrl, declineCode, walletBalanceAfterEur, note }`.

Figyelem: a `wallet` és a `stripe` irány **valódi pénzt mozgat**.

### `GET /api/v1/orders/{id}/keys` - scope: `read`

`data`: `orderId`, `orderStatus`, `keys[]` (`productId`, `productName`,
`keyValue`, `activationCount`, `deliveredAt`), `licenses[]`
(`licenseServiceId`, `productId`, `productName`, `statusLabel`, `keyValue`,
`activationCount`).

### `GET /api/v1/license-keys` - scope: `read`

A fiók összes kézbesített termékkulcsa, termékenként csoportosítva, a
**továbbadási (allokációs) számokkal** együtt. Ez a viszonteladói készlet
nézete: mennyi jött be, mennyit adtál már tovább végfelhasználónak kiállított
licenc-átruházási dokumentumon, és mennyi maradt szabadon.

`data`: `products[]`, ahol egy termék:
`{ productId, productName, totalUnits, allocatedUnits, remainingUnits, orderCount, keys[] }`,
egy kulcs pedig
`{ keyId, keyValue, quantity, allocated, remaining, orderId, orderNumber, orderCreatedAt }`.

- `quantity` a kulcs teljes darabszáma (egy MAK / volumen kulcs több
  aktiválást hordoz), `allocated` az ebből már dokumentált, `remaining` a
  szabad.
- `keyId` a licencszolgáltatás sorazonosítója - ezt add meg a dokumentumok
  `items[].keys[].keyId` mezőjével összepárosítva.
- **`keyValue` lehet `null`**: a darabszámok tisztán az adatbázisból jönnek, a
  kulcs SZÖVEGÉT viszont a licencszolgáltatás oldja fel. Ha az épp nem
  elérhető, a `keyValue` `null` lesz, de a `quantity` / `allocated` /
  `remaining` változatlanul helyes. Helyőrző szöveg soha nem jön - a `null`
  megbízhatóan azt jelenti, hogy nincs adat.

**A `deliveredAt` mező megszűnt, és nincs azonos nevű utódja.** A kulcsok
forrástáblájában (`license_refs`) nincs egyetlen dátumoszlop sem, tehát a
kézbesítés ideje ebből a forrásból nem mondható meg. Helyette
**`orderCreatedAt`** áll: a forrás-rendelés keltezése, ISO 8601 stringként.
Szándékosan nem ugyanaz a név: egy mező nem mérhet mást, mint amit a neve ígér.
Aki eddig `deliveredAt`-re kötött, `orderCreatedAt`-re álljon át, és tudja,
hogy az a RENDELÉS dátuma.

**Külön, szűkebb kerete van: kulcsonként 6 kérés / perc** (lásd Rate limit).
Egy hívás kulcsonként egy külön kérést indít a licencszolgáltatás felé, tehát
az ára a te kulcsaid számával nő. Tárold el a választ: csak akkor változik, ha
új kulcs érkezik vagy új átruházási dokumentum készül.

### `GET /api/v1/license-documents` - scope: `read`

Az általad kiállított licenc-átruházási dokumentumok listája (legújabb elöl).

Query: `productId`, `orderId`, `status` (`live` | `revoked` | `all`,
alapértelmezés `live`), `limit`, `offset`.

`data`: `limit`, `offset`, `total`, `documents[]`. Egy sor: `id`,
`documentNumber`, `orderId` (az elsődleges forrás-rendelés), `status`
(`live` | `revoked`), `customerName`, `totalQty`, `items[]`
(`productId`, `productName`, `qty`), `createdAt`, `revokedAt`.

Az `orderId` szűrő ugyanazt a szabályt használja, mint a `GET /orders/{id}`
`licenseDocuments` mezője: a rendelés lehet az elsődleges forrás VAGY
szerepelhet valamelyik tétel kulcs-allokációjában.

**A listán nincsenek termékkulcsok** (`items[].keys[]`). Ez méret-döntés, nem
bizalmi: a kulcsokat a részletező maszk nélkül kiadja. Élesben 1253 dokumentum
van, és egy `limit=100`-as lap kulcsostul olyan tömeg, amit felesleges átvinni.
Ha kulcs kell, kérd el az egy dokumentumot.

### `GET /api/v1/license-documents/{id}` - scope: `read`

Egy kiállított dokumentum TELJES pillanatképe.

`data`: `{ document }`, a lista mezőin túl: `includeKeys`, `customer`
(`name`, `taxNumber`, `postcode`, `city`, `addressLine`, `contact` - a
végfelhasználó adatai a kiállítás pillanatában, hiányzó mező `null`),
`items[]` a `keys[]` tömbbel (`keyId`, `keyValue`, `qty`, `orderId`,
`orderNumber`), és `pdf` (`atruhazas`, `megsemmisites` - a két letöltési cím).

A `keyValue` a **teljes, maszkolatlan termékkulcs**, és itt sosem `null`: a
tárolt pillanatképből jön, nem a licencszolgáltatásból. Egy későbbi kulcscsere
vagy szolgáltatás-kiesés nem írja át visszamenőleg a már kiállított iratot.

A `pdf` mezőben lévő címek **nem** képesség-linkek (ellentétben a bizonylatok
`downloadUrl`-jével): API kulcsot kérnek, ugyanúgy, mint minden más végpont.

Idegen dokumentum `not_found`-ot ad, nem 403-at.

### `GET /api/v1/license-documents/{id}/pdf` - scope: `read`

A dokumentum PDF-je. Query: `kind` = `atruhazas` (átruházási igazolás,
alapértelmezés) vagy `megsemmisites` (megsemmisítési nyilatkozat); bármi más
`not_found`.

**Ez az API egyetlen olyan végpontja, amelynek a SIKERES válasza nem JSON
boríték**: HTTP 200 esetén a törzs nyers `application/pdf`, a fájlnév a
`Content-Disposition` fejlécben van. Minden hibája (401, 403, 404, 429)
ugyanaz a `{ ok: false, error }` boríték. Külön, szűkebb kerete van:
kulcsonként 10 kérés / perc (lásd Rate limit).

Migrált, régi szállítólevél esetén az EREDETI PDF jön vissza, nem a mai
sablonból újragenerált változat; visszavont dokumentum a mai sablont kapja,
VISSZAVONVA jelzéssel.

### `GET /api/v1/invoices` - scope: `read`

Query: `order_id`, `limit`, `offset`. `data`: `limit`, `offset`, `invoices[]`.

Egy bizonylat: `id`, `orderId`, `orderNumber`, `type`
(`proforma` | `prepayment` | `final` | `invoice` | `delivery_note` |
`correction` | `storno`), `typeLabel`, `number`, `status`
(`draft` | `finalized` | `sent` | `paid` | `cancelled`), `statusLabel`,
`netTotalEur`, `vatEur`, `grossTotalEur`, `downloadUrl`, `createdAt`.

A `downloadUrl` abszolút, tokennel védett publikus PDF-link (kulcs nélkül is
letölthető, a token maga a jogosultság); `null`, ha még nincs bizonylat-fájl.

### `GET /api/v1/invoices/{id}` - scope: `read`

`data`: `{ invoice }`. Idegen bizonylat `not_found`.

### `GET /api/v1/keys` - scope: `read`

A fiók API kulcsai. `data`: `{ keys: [{ id, prefix, name, scopes,
lastUsedAt, expiresAt, revokedAt, createdAt }] }`. Nyers tokent soha nem ad
vissza.

### `DELETE /api/v1/keys/{id}` - scope: `read`

Kulcs visszavonása (a sor auditálhatóság miatt megmarad, `revokedAt`-tel).
`data`: `{ revoked: true, keyId }`. Hiba: `not_found` (ha az `{id}` nem a te
fiókod kulcsa, **vagy már vissza van vonva**).

**A művelet NEM idempotens**: a szerver csak AKTÍV kulcsot talál meg, tehát egy
már visszavont kulcs második törlése is `404 not_found`. Aki hálózati hiba után
újrapróbál, ezt a 404-et sikerként kezelje - a kulcs ilyenkor már nem él.

**A fiók BÁRMELY kulcsa visszavonható vele, nem csak az, amelyikkel hívtad** -
és mivel a `GET /keys` (szintén `read`) kilistázza az összes kulcs-azonosítót,
egy `read` scope-ú kulcs le tud tiltani egy `orders:write` kulcsot is. A
visszavonás nem visszafordítható: az új kulcsot a `/api` oldalon vagy a
`POST /auth/login` végponttal kell kiváltani.

### `GET /api/v1/wallet` - scope: `read`

Query: `limit`, `offset`. `data`: `balanceEurNet`, `limit`, `offset`,
`transactions[]` (`id`, `type`, `typeLabel`, `amountEur` (előjeles),
`bonusEur`, `balanceAfterEur`, `orderId`, `orderNumber`, `description`,
`createdAt`).

A `type` **öt** értéket vehet fel - aki négyre írt `switch`-et, elesik az
ötödiken:

| `type` | Mit jelent |
| --- | --- |
| `topup` | egyenlegfeltöltés |
| `payment` | rendelés kifizetése az egyenlegből |
| `refund` | visszatérítés az egyenlegre |
| `bonus` | feltöltéshez járó bónusz |
| `adjustment` | **kézi korrekció** (adminisztrátori könyvelés) |

### `GET /api/v1/cards` - scope: `read`

`data`: `stripeEnabled`, `cards[]` (`id`, `brand`, `last4`, `expMonth`,
`expYear`, `isDefault`). Új kártyát csak a weboldalon lehet rögzíteni.

### `GET /api/v1/exchange-rate` - scope: `read`

`data`: `base` (`EUR`), `quote` (`HUF`), `rate`, `eurToHuf`, `hufToEur`,
`referenceRate`, `markupPct`, `source`, `rounding: { HUF: 0, EUR: 2 }`,
`note`.

### `GET /api/v1/shipping/parcelshops` - scope: `read`

Query: `q` (város vagy irányítószám, max 200), `type`
(`parcel-shop` | `parcel-locker` | `all`, alap `all`).

`data`: `truncated`, `parcelshops[]` (`id`, `name`, `type`, `postcode`,
`city`, `address`).

### Ismeretlen végpont

Bármi más `/api/v1` alatt: HTTP 404, `error.code = "not_found"`, auth nélkül
is. Ez a nem létező UTAKRA vonatkozik (GET / POST / PATCH / PUT / DELETE
metódussal).

**Létező úton rossz metódus más**: arra a keretrendszer HTTP **405**-öt ad,
üres törzzsel és `Content-Type` nélkül - nincs `error.code`, és a `res.json()`
ott hibára fut. Például `GET /api/v1/orders/preview` vagy
`POST /api/v1/products` így válaszol. Egy ismeretlen úton az `OPTIONS` HTTP
204-et ad.

---

## Példa: keresés, előnézet, rendelés

```bash
KEY="kp_live_..."
BASE="https://keypro.hu/api/v1"

# 1. termék keresése (a fokep: .products[0].images[0].url)
curl -s -H "Authorization: Bearer $KEY" \
  "$BASE/products?q=office&limit=5"

# 2. elonezet - innen jon a confirmToken
curl -s -X POST -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"sku":"OFFICE2024","qty":2}],"paymentMethod":"bacs"}' \
  "$BASE/orders/preview"

# 3. rendeles a friss tokennel
curl -s -X POST -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sajat-egyedi-azonosito-1" \
  -d '{"items":[{"sku":"OFFICE2024","qty":2}],"paymentMethod":"bacs","confirmToken":"..."}' \
  "$BASE/orders"
```

---

## Kapcsolat

Integrációs kérdés: [i@keypro.hu](mailto:i@keypro.hu) -
weben: [keypro.hu/api](https://keypro.hu/api)
