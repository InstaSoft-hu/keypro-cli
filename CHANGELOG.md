# Változásnapló

A KeyPro partner API (`/api/v1`), a [`@keypro/cli`](https://www.npmjs.com/package/@keypro/cli)
parancssori eszköz és a beépített `keypro mcp` MCP szerver változásai,
**legújabb kiadás elöl**. A verziószám az npm csomagé; a CLI, az MCP szerver és
a szerver oldali API ugyanazzal a kiadással megy ki, tehát egy verzió itt
mindhármat jelenti.

Ez a fájl a változásnapló **egyetlen forrása**: a repóban él, innen kerül a
publikus `keypro-cli` repóba, az npm csomagba és a keypro.hu `/api` oldalára.
A mezők és a végpontok teljes leírása az `API.md`-ben áll (a weben: a `/api`
oldal API fülén) - ez a napló csak azt mondja meg, MI VÁLTOZOTT.

**Törő vagy sem.** Minden bejegyzés kimondja. Törőnek azt hívjuk, ami egy addig
működő hívást elront: mező vagy végpont eltűnése, átnevezése, kötelezővé váló
paraméter, meglévő érték jelentésének megváltozása. Új mező és egy felsorolás
új értéke nem törő - a **Figyelmet igényel** pontokat viszont akkor is olvasd
el, mert kimerítő elágazást írhattál a régi értékekre.

Frissítés: `npm i -g @keypro/cli`. A telepített verzió: `keypro --version`.

---

## 0.1.11 - 2026-08-20

### A licenc jellege olvasható a termék-végpontokon

A `GET /products` és a `GET /products/{key}` válasza új mezőt visz:
`licenseNature` (`used` | `new` | `subscription`). Azt mondja meg, **mit veszel
jogilag**: használt, határozatlan idejű licencet a másodlagos forgalomból
(`used`), korábban nem aktivált licencet a gyártó hivatalos láncából (`new`),
vagy határozott idejű, a jogosulthoz kötött előfizetést (`subscription`). A
mező mindig ki van töltve, sosem `null`.

Ott van a termék-soron és **minden változat-soron** is (a lista `variants[]`
elemein, a részletező bővebb `variants[]` elemein, és `include_variants=true`
mellett az önálló változat-találatokon). A jelleg a változat SAJÁT értéke, egy
családon belül is eltérhet, és a változaté a mérvadó: a csoport-sor nem
rendelhető.

Külön dolog a `fulfillmentType`-tól, ami azt mondja meg, mit **kapsz** (kulcs,
matrica, kártya, előfizetés): egy `digital` termék lehet használt is, új is.

Parancssorból: a `keypro products get <cikkszám vagy azonosító>` új "Licenc
jellege" sorban mutatja, a `--json` a nyers értéket viszi tovább.

**Nem törő.** Új mező, a meglévők változatlanok.

### A licenc-dokumentum is viszi a jelleget, és ez dönti el, melyik irat készül

A `GET /license-documents` sorai, a `GET /license-documents/{id}` és a
`POST /license-documents` válasza is viszi a `licenseNature` mezőt. A
dokumentumon ez a **kiállítás pillanatképe**: egy későbbi katalógus-javítás nem
írja át egy már kiadott irat fajtáját.

Ebből következik a válasz `pdf` objektumának KULCSHALMAZA is, tehát az
dokumentumonként különbözhet:

| `licenseNature` | A `pdf` kulcsai (és a `?kind=` értékek) |
| --- | --- |
| `used` | `atruhazas`, `megsemmisites` |
| `new` | `licencigazolas` |
| `subscription` | `elofizetes-igazolas` |

A fajtát nem a hívó választja: a kiállított tételek terméke dönti el. Ami a
`pdf` mezőben nincs meghirdetve, arra a `GET /license-documents/{id}/pdf`
`not_found` (404) hibát ad - ugyanazt, mint ismeretlen fajtára.

**Nem törő.** A `pdf` kulcsai eddig is a dokumentumhoz tartozó iratokat
hirdették, és használt licencre változatlanul `atruhazas` + `megsemmisites`.
Aki eddig is a `pdf` mezőből vette a letöltési címet, annak nincs teendője.
**Aki a két régi kulcsnevet égette be, az kezelje a másik két fajtát is** - egy
előfizetésre kiállított dokumentumon nincs `atruhazas`.

### Két új végfelhasználói irat

A `GET /license-documents/{id}/pdf` `kind` paramétere két új értéket vett fel:

- `licencigazolas` - Licencigazolás, új (`new`) licencre,
- `elofizetes-igazolas` - Előfizetés-igazolás, előfizetésre (`subscription`).

A használt licenc iratai változatlanok: `atruhazas` (átruházási igazolás) és
`megsemmisites` (megsemmisítési nyilatkozat).

Egy dokumentumon továbbra is csak AZONOS jellegű tételek lehetnek: vegyes
kérésre a `POST /license-documents` `item_not_allowed` (400) hibát ad, és a
hibaüzenet megnevezi a terméket meg a jellegét.

Parancssorból: a `keypro licdok pdf <id> --kind <fajta>` mind a négy fajtát
elfogadja.

**Nem törő.** Új felvett értékek; a régi kettő ugyanazt jelenti, mint eddig.

### Új készlet-állapot: `on_demand` ("Max 24 óra")

A `stock.status` felvette az `on_demand` értéket, tehát a lehetséges értékek:
`always` | `unknown` | `unlimited` | `in_stock` | `low` | `out` | `on_demand`.

Az `on_demand` azt jelenti, hogy a terméket **rendelésre szerezzük be**, és
nincs belőle szabad licenc: az `available` ezért 0, a `label` pedig
`Max 24 óra`. Az `out` ugyanígy 0 szabad licencet jelent, de olyan terméken,
amit készleten tartunk - ott a beszerzési idő nyitott. Egyik sem blokkolja a
rendelést.

**Nem törő** a szó szoros értelmében: egyetlen meglévő érték jelentése sem
változott.

**Figyelmet igényel.** Ez a kiadás egyetlen ilyen pontja. Ha a `stock.status`
hat régi értékére KIMERÍTŐ elágazást írtál (`switch` alapértelmezett ág nélkül,
szigorú felsorolás-típus, "minden más = hiba" szabály), akkor a hetedik érték
nálad hibát vagy üres állapotot okoz. Vedd fel az `on_demand` ágat, vagy adj az
elágazásnak biztonságos alapértelmezést.

### A cikkszám egyedi, az `ambiguous_sku` hiba nem fordulhat elő

A cikkszám (`sku`) a katalógusban **egyedi, kis- és nagybetűre nézve is**:
`OFFICE2024` és `office2024` nem élhet meg egymás mellett. Adatbázis-szintű
részleges egyedi index őrzi, tehát egy cikkszám **legfeljebb egy** terméksort -
egyszerű terméket vagy változatot - azonosít. A `POST /orders/preview` és a
`POST /orders` `items[].sku` mezője ezért egyértelmű, és az `ambiguous_sku`
(400) hiba nem fordulhat elő.

A hibakód a szerződés része marad, védekezésből: a kliensednek nem kell
kivennie a kezeléséből, de számítania sem kell rá.

Változatlan, hogy a `sku` **hiányozhat** (`null`): a katalógus több mint
felének nincs cikkszáma, azokat `productId`-vel kell rendelni.

**Nem törő.** Egy hibaág szűnt meg, új nem keletkezett.

### Új fizetési mód: `internal`

A `paymentMethod` (a `POST /orders/preview`, a `POST /orders` és a fizetési mód
módosítása) felvette az `internal` értéket: belső elszámolás, fizetés nélkül,
és **semmilyen bizonylat nem készül róla** - számla, díjbekérő és szállítólevél
sem.

**Fiók-szintű engedélyhez kötött**: kizárólag a cégen belüli partner-fiókból
választható. Minden más fiók `payment_method_not_allowed` (403) hibát kap, már
az előnézeten. Ez a hibakód is új.

Parancssorból: `keypro order preview --payment internal`. A CLI szándékosan
átengedi az értéket, hogy a beszélő hibaüzenet a szervertől jöjjön.

**Nem törő.** Új felvett érték és egy új hibakód egy új úton; a meglévő
fizetési módok viselkedése változatlan.

---

## 0.1.10 - 2026-08-16

### Licenc-dokumentumok a partner API-n

Új végpontok a végfelhasználói licenc-iratokhoz:

| Végpont | Scope |
| --- | --- |
| `GET /api/v1/license-documents` | `read` |
| `GET /api/v1/license-documents/{id}` | `read` |
| `GET /api/v1/license-documents/{id}/pdf` | `read` |
| `POST /api/v1/license-documents` | `licenses:write` |
| `DELETE /api/v1/license-documents/{id}` | `licenses:write` |

A `licenses:write` scope **külön kérhető**, a `keypro login` magától nem adja
meg. A kiállítás idempotens, és `Idempotency-Key` fejlécet **kötelezően** vár.
A visszajátszás **fiók-szintű**: a fiókodon korábban - akár egy másik API
kulccsal - használt azonos `Idempotency-Key` a teljes dokumentumot visszaadja,
maszkolatlan termékkulccsal. Ezért a kulcs legyen véletlen (UUID), soha ne
üzleti azonosítóból származtatott: egy kitalálható `10030-lic-1` alakkal egy
csak-író kulcs a fiók másik végfelhasználójának adatait olvasná ki.

Parancssorból: `keypro licdok list`, `keypro licdok get <id>`,
`keypro licdok pdf <id>`. Kiállítani és visszavonni csak az API-n lehet.

**Nem törő.** Új végpontok.

### A változat örökli a csoportja képeit

A partner-felületeken (`GET /products`, `GET /products/{key}`) az a változat,
aminek nincs SAJÁT kiszolgálható képe, a csoportja `images` tömbjét kapja meg,
változatlan `position` értékekkel. Fordítva sosem működik: saját képes
változathoz nem adunk hozzá semmit.

**Nem törő.** Egy eddig gyakran üres tömb telik meg.
