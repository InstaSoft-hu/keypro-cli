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

## 0.1.18 - 2026-09-24

### Licenc-dokumentum: a SAJÁT hivatkozásod az iraton

**NEM TÖRŐ**: egy új, opcionális kérés-mező és egy új válasz-mező. Meglévő hívás
változatlanul működik, a korábban kiállított dokumentumokon az érték `null`.

A `POST /license-documents` új, opcionális mezője a **`partnerReference`**: a
saját hivatkozásod (jellemzően a saját rendelésszámod), hogy később tudd, melyik
iratot melyik rendelésedhez készítetted. Ugyanez a mező visszajön a
`GET /license-documents` **listán**, a `GET /license-documents/{id}` részletezőn
és a `GET /orders/{id}` `licenseDocuments[]` tömbjében.

**Figyelmet igényel**, ha automatikusan töltöd:

- **Rákerül a kiállított PDF-re**, a fejlécbe (`Kiállítói hivatkozás:`), tehát a
  végfelhasználód is látja. Ezért a kiállításkor **rögzül**: utólag nem
  módosítható, elgépelésnél visszavonás + újrakiállítás kell, új sorszámmal.
- **Legfeljebb 63 karakter**, és csak **betű, számjegy, szóköz** meg a
  `-` `_` `.` `/` `#` jelek. Bármi más - emoji, nyíl, kínai vagy arab írásjel,
  gondolatjel, tipográfiai idézőjel - `validation_failed` (400); a hibaüzenet
  megnevezi a kifogásolt karaktert. A szerver **nem vág le és nem szűr némán**:
  az ok a PDF, két irányból is. A betűkészlet a hiányzó jel helyére mást
  rajzolna, a sornál szélesebb érték pedig némán levágódna - a 63 ezért MÉRT
  határ (a leghosszabb megengedett érték a legszélesebb engedett jelből még
  éppen elfér a papíron), nem kerek szám. A **betű** itt szűk, explicit halmaz,
  nem "minden latin betű": az ASCII betűk, valamint a Latin-1 Supplement és a
  Latin Extended-A / -B ékezetes betűi (a magyar, a közép-európai és a román
  vesszős alakok). Az ezeken túli latin betűk - például a vietnami ékezetesek -
  és a horvát/szerb **digráf-ligatúrák**
  (`Ǆ` `ǅ` `ǆ` `Ǉ` `ǈ` `ǉ` `Ǌ` `ǋ` `ǌ` `Ǳ` `ǲ` `ǳ`) **nem** mennek át; a
  kétbetűs, DEKOMPONÁLT `DŽ` / `LJ` / `NJ` / `DZ` alak - amit a valódi szöveg
  amúgy is használ - igen. A mező teljes leírása az `API.md`-ben.
- A mező **nem egyedi** és nem azonosít: ugyanaz az érték több dokumentumon is
  állhat, és nem lehet vele dokumentumot lekérni.

CLI: a `keypro licdok get <id>` kiírja a `Saját hivatkozás` sort.

MCP: a `keypro_license_documents_list` és a `keypro_license_document_get`
válaszában ott a `partnerReference` mező.

## 0.1.17 - 2026-09-16

### Rendelés-csatolmány: a saját számlád a csomagba

**NEM TÖRŐ**: két új végpont, meglévő mező vagy viselkedés nem változik.

Dropshipping küldeménynél (a csomagot a te vevődnek adjuk fel, a te nevedben)
feltöltheted a **saját, a végfelhasználódnak kiállított számládat** - kinyomtatjuk
és a csomagba tesszük. A fájl tartalmát nem ellenőrizzük és nem dolgozzuk fel.

- `POST /orders/{id}/attachments` (scope: `orders:write`) - **ennek a kérése
  `multipart/form-data`, nem JSON** (a boríték bájtokat nem tud vinni). A fájl
  az `attachments` mezőben, egy kérésben több is. A válasz a szokásos boríték.
- `GET /orders/{id}/attachments` (scope: `read`) - a feltöltött fájlok listája.

Korlátok: csak PDF (a szerver a **tartalmon** ellenőrzi az aláírást, nem a
bejelentett típuson), rendelésenként 5 fájl, fájlonként 8 MB, együtt 16 MB, és
10 feltöltés / perc. Csak addig fogad fájlt, amíg a csomag el nem indult;
egyébként `409` `order_not_attachable`.

Két új hibakód: `order_not_attachable` (409) és `attachment_rejected` (400).
Törlés az API-n nincs - a feltöltött fájlt a fiókodban, a rendelés oldalán
törölheted (akkor is, ha a csomag már elment).

CLI: `keypro order attach <rendelesId> <fajl...>` és
`keypro order attachments <rendelesId>`.

MCP: `keypro_order_attach_file` és `keypro_order_attachments`. A feltöltő eszköz
**helyi fájl-útvonalat vesz át, nem fájltartalmat**: az MCP szerver a te gépeden
fut és maga olvassa be a fájlt, így a PDF bájtjai soha nem kerülnek bele a
beszélgetésbe (egy 8 MB-os PDF base64-ben több millió token lenne).

### Dropshipping: a csomag a te nevedben, a te vevődnek

**NEM TÖRŐ**: új, opcionális mező és egy új végpont.

A rendelés-kérés új mezője a **`dropshipping`** (logikai, alap `false`). Ha
bekapcsolod, a csomagot a **te végfelhasználódnak** adjuk fel, **a te nevedben**:
a címkén a te neved és címed lesz a feladó, és sem a küldeményen, sem a dobozban
nem lesz KeyPro-felirat. A dobozba a te átruházási dokumentumaid kerülnek, és ha
feltöltötted, a saját számlád is.

Csak olyan rendelésen választható, amelynek **saját küldeménye** van, tehát
`gls_hd` vagy `gls_parcelshop` szállítási móddal. Tisztán digitális rendelésen
`400` `dropshipping_requires_shipping`, összecsomagolt (`combine_free`)
rendelésen `400` `dropshipping_requires_own_parcel` - annak nincs saját
küldeménye, az áru a szülő rendelés csomagjában utazik.

Utólag is átállítható a **GLS-címke igényléséig**:
`POST /orders/{id}/dropshipping`. Utána `409` `dropshipping_locked` - akkor a
feladó neve már eldőlt. Az aktuális érték a `GET /orders/{id}` válaszának új
`dropshipping` mezőjéből olvasható vissza.

Az utólagos bekapcsolásnak **harmadik** feltétele is van: ha ebben a csomagban
már utazik egy hozzácsomagolt (`combine_free`) rendelés, a válasz `409`
`dropshipping_has_combined_orders`, és az `error.details.combinedChildren`
megnevezi őket. Az abban lévő áru a te saját rendelésed, tehát a
végfelhasználódhoz menne ki. Előbb annak kell külön küldeményt választani.

Az utólagos átállítás elutasításai a KONKRÉT hiányt nevezik meg: tisztán
digitális rendelésen `dropshipping_requires_shipping`, összecsomagoltan
`dropshipping_requires_own_parcel` (eddig mindkettő az utóbbit adta).

**A feladás feltétele a végfelhasználó adata**, és azt pontosan abban a
formában kérjük, ahogy a címke használja: **vezeték- ÉS keresztnév** (a cégnév
nem kerül a címkére), valamint **telefonszám vagy e-mail cím** - ez utóbbi
mostantól házhozszállításnál is, nem csak csomagpontnál, mert a futár azon hívja
a címzettet. Kell továbbá a végfelhasználó **címe** (irányítószám, város,
utca/házszám) - **csomagpontos küldeménynél is**, mert a GLS a címzett címét ott
is megköveteli; a csomag ettől még a csomagpontra megy. A rendelés leadását egy
hiány nem akadályozza, csak a feladást; hiány esetén emlékeztető e-mailt küldünk.

A végfelhasználó adatai a kérés `shipping` blokkjában mennek, ami csomagpontos
rendelésen is elfogadott. Két szabály ehhez a blokkhoz:

- **Dropshippingnél a kihagyott kulcsot NEM töltjük ki a fiókod mentett
  szállítási adataiból.** Normál rendelésen a `shipping` blokk továbbra is
  mezőnkénti felüldefiniálás a profilod fölött; dropshippingnél viszont a blokk
  a végfelhasználód adatait hordozza, ezért egy kihagyott kulcs hiány marad -
  különben a címzett helyére a te saját neved vagy telefonszámod kerülne. A
  `lastName`, `address1`, `city`, `postcode` és `country` hiánya így `400`
  `validation_failed` (a `details.missing` megnevezi), a `firstName` és az
  elérhetőség hiánya a rendelést nem, csak a feladást állítja meg. Ha a
  végfelhasználó adatait rendeléskor még nem tudod, a `shipping` blokkot hagyd
  el egészen: a rendelés leadható, a feladás megáll, és emlékeztetőt küldünk.
  Ajánlás: küldd el mindig az összes címzett-mezőt (`lastName`, `firstName`,
  `phone` vagy `email`, `address1`, `city`, `postcode`, `country`), akkor a
  feladás sem akad el. A `POST /orders/preview` `shippingAddress` mezője
  pontosan azt mutatja, ami a rendelésre kerül.
- **Dropshipping rendelésen a `shipping.email` a rendelésre kerül.** A GLS ezen
  értesíti a címzettet, és az elérhetőség feltételét telefonszám nélkül is
  teljesíti. Nem kötelező (üresen is mehet), de érvénytelen formátumban `400`
  `validation_failed` (`details.invalid: ["shipping.email"]`). Normál rendelésen
  a mezőt továbbra sem mentjük és nem is ellenőrizzük: ott a GLS-értesítő a
  számlázási e-mail címedre megy.

Ez a két szabály NEM TÖRŐ: egy NEM dropshipping hívás viselkedése semmiben nem
változik, a dropshipping mező pedig maga is ebben a verzióban jelenik meg, tehát
kiadott kliens eddig nem küldhette.

**Utánvét és dropshipping soha nem együtt.** Egy dropshipping csomagon a futár a
rendelés végösszegét - a te beszerzési áradat - a végfelhasználódtól szedné be, a
bolt számlájára. Új hibakód: `dropshipping_excludes_cod`, mindkét irányban:
`400` a rendelésfelvételen (`paymentMethod: "cod"` + `dropshipping: true`) és egy
dropshipping rendelés `cod`-ra váltásakor (`POST /orders/{id}/payment`), `409`
egy `cod` rendelés utólagos dropshippingre állításakor.
A fizetésimód-váltás **előnézete** (`POST /orders/{id}/payment/preview`) már
ugyanígy elutasít (`400` `dropshipping_excludes_cod`, ugyanazzal a mondattal),
tehát erre a váltásra `confirmToken`-t sem kapsz.
**Figyelmet igényel:** a `POST /orders/{id}/payment` és az előnézete ettől egy
MEGLÉVŐ végponton ad új hibakódot - de csak dropshipping rendelésen, tehát egy
eddig működő hívást nem ront el.

CLI: `keypro order create --dropshipping ...` (és ugyanez az
`order preview`-n), illetve `keypro order dropshipping <rendelesId> [--off]`.
MCP: `keypro_order_set_dropshipping`, és a `dropshipping` mező a
`keypro_order_preview` / `keypro_order_create` sémájában.

---

## 0.1.16 - 2026-09-15

### A 8 napos fizetési határidő (`cheque`) fiókhoz kötött lett

**TÖRŐ** azoknak, akik `cheque` fizetési móddal rendelnek. A 8 napos határidő
hitel: a termékkulcs a pénz beérkezése előtt kimegy, és a rendelés utólag nem
mondható le. Ezért mostantól partnerenként engedélyezzük, a belső elszámolás
(`internal`) mintájára.

Amit az integrációdban látsz, ha a fiókod NEM jogosult rá:

- `POST /orders/preview`, `POST /orders`, `POST /orders/{id}/payment/preview`
  és `POST /orders/{id}/payment`: **403 `payment_method_not_allowed`**. Az
  előnézeten is, tehát tiltott módra `confirmToken`-t sem kapsz.
- A hibaüzenet mostantól megmondja, MELYIK módról van szó. Eddig minden
  `payment_method_not_allowed` a belső elszámolás mondatát adta vissza, akkor
  is, ha a `cheque`-et utasítottuk el - ez félrevezető volt.

Ha eddig `cheque`-kel rendeltél és most 403-at kapsz, szólj a KeyPro
kapcsolattartódnak: a jogosultság fiókszinten adható. Addig válassz másik
fizetési módot (`bacs`, `wallet`, `stripe`, `cod`).

### Figyelmet igényel: a `cheque` +5% díja nem minden fiókon jár

A kényelmi díj továbbra is +5% a nettó termékösszegre, de néhány fiókon
megállapodás szerint elmarad. **A díjat sose számold**, mindig az előnézet
válaszából olvasd ki (`POST /orders/preview` -> `payment.fees[]`, illetve
`POST /orders/{id}/payment/preview` -> `fees[]` / `feeDeltaEur`). A `totals`
nem visz külön díj-tételt: az összegeibe már bele van számolva. Ez nem törő:
a mezők és a végpontok változatlanok, csak a beégetett 5%-os számolás adhat
mostantól rossz végösszeget.

## 0.1.15 - 2026-09-12

### Gyártói adatok a termék-végpontokon

A `GET /products` és a `GET /products/{key}` válasza három új mezőt visz, a
termék-soron ÉS minden `variants[]` elemen:

- `manufacturer` - a gyártó (márka) neve, például `Microsoft`. Eddig a márka
  sehol nem szerepelt önálló mezőként, a terméknévből pedig gépileg nem
  olvasható ki ("Windows 11 Pro" nem mondja ki, hogy Microsoft).
- `gtin` - a termék vonalkódja (EAN / UPC / GTIN), csupa számjegy. A
  webshop-feedek ezen az azonosítón kötik a terméket a saját katalógusukhoz;
  mentéskor ellenőrizzük a GS1 ellenőrző számjegyet, tehát ami kijön, érvényes.
- `manufacturerUrl` - a gyártó saját termékoldala, teljes `http(s)` címmel.

Mindhárom `null`, ha az adott soron nincs adat. Egyik sem egyedi, és egyikkel
sem lehet rendelni: a `POST /orders(/preview)` `items[]` mezője továbbra is
`sku`-t vagy `productId`-t vár.

**NEM törő:** csak új mezők jöttek, meglévő mező nem tűnt el és nem változott a
jelentése.

**Figyelmet igényel.** Az öröklés mezőnként eltér. Saját érték nélküli VÁLTOZAT
a csoportjáét kapja a `manufacturer` és a `manufacturerUrl` mezőn (mint a
`shortDescription` és társai), a `gtin` és a `manufacturerPartNumber` viszont
SOSEM öröklődik: azok a konkrét cikk, ill. csomagolás azonosítói, és a
változatok épp ezek mentén térnek el, tehát egy örökölt érték egy MÁSIK
terméket nevezne meg a listádban. Ha eddig azt feltételezted, hogy a család
minden sora ugyanazt az azonosítót viszi, ezt nézd át.

### A keresés a gyártóra és a vonalkódra is illeszt

A `GET /products` `q` paramétere eddig a névre, a cikkszámra és a gyártói
cikkszámra illesztett; mostantól a `manufacturer` és a `gtin` mezőre is, ugyanazzal
a részlet-egyezéssel. Egy beszállítói listából kimásolt vonalkód így egy hívásból
megválaszolja, hogy visszük-e a terméket, a `manufacturer` pedig egy gyártó teljes
kínálatát adja vissza.

A vonalkód-ág a `q` SZÁMJEGYEIRE illeszt: a szóköz és a kötőjel kiesik belőle,
ugyanúgy, ahogy mentéskor - a tagolt `590-1234 123457` tehát megtalálja a tárolt
`5901234123457`-et. Ha a `q` (a szóközt és a kötőjelet elhagyva) nem csak
számjegyekből áll, a vonalkód-ág kimarad: a `gtin` csupa számjegy, ezért egy
betűt tartalmazó mintára amúgy sem találna. A másik négy ág ilyenkor is fut.

**NEM törő:** a korábbi keresések ugyanazokat a találatokat adják, legfeljebb
továbbiakat is. Ha `q`-ra PONTOS találatszámot vártál, az nőhet.

### CLI

- `keypro products get` kiírja a gyártót, a vonalkódot és a gyártói
  termékoldalt (a `Gyártói cikkszám` sor mellett).
- `keypro products search` találati táblája új `Gyártó` oszlopot kapott.

**NEM törő** a válasz szempontjából: a `--json` kimenet ugyanaz a szerver-válasz,
ami új mezőkkel bővült. Az EMBERI táblázat viszont új oszlopot kapott, tehát ha a
`--json` helyett a szöveges kimenetre építettél feldolgozást, azt nézd át.

### MCP

- `keypro_products_search` és `keypro_product_get` visszaadja a három új mezőt,
  és a leírásuk kimondja az öröklés szabályát.

**NEM törő:** csak új mezők és bővebb leírás.

---

## 0.1.14 - 2026-08-21

### A termék leírása és felsorolás-pontjai a termék-végpontokon

A `GET /products` és a `GET /products/{key}` válasza két új mezőt visz, a
termék-soron ÉS minden `variants[]` elemen:

- `shortDescriptionBullets`: a rövid leírás felsorolás-pontjai, amiket a bolt a
  kép mellett, adatsorként mutat (például "Újratelepíthető, örökös ESD
  termékkulcs", "Azonnali online aktiválás 1 PC-re"). **Mindig tömb, sosem
  `null`**: adat nélkül üres tömb, ugyanaz a szerződés, mint az `images`-nél.
- `description`: a hosszú termékleírás. `string` vagy `null`, üres string sosem.

A `shortDescription` eddig CSAK a `GET /products/{key}` termék-gyökerén jött;
mostantól a listán és minden változat-soron is ott van, tehát a három
szöveg-mező egy blokkban, ugyanazokon a helyeken érhető el.

Erre való: a partner-webshop termékoldala eddig csak a nevet, az árat és a képet
tudta kitölteni a mi adatunkból, a leírást viszont nem - a 107 publikált
termék-sorból 106-nak van hosszú leírása és 99-nek felsorolása, de egyiket sem
adta ki az API.

**A változat a csoportja szövegét kapja, ha nincs sajátja - mezőnként.** Amelyik
mezőben a változatnak van saját értéke, ott azt kapod, és a csoport szövege nem
fűződik mögé; amelyikben nincs, ott a csoporté jön. Visszafelé nincs öröklés. Ez
ugyanaz a szabály, mint a képeknél, és azért van, mert a boltban a változatnak
nincs saját oldala: a vevő is a család szövegét olvassa, a partner viszont épp a
változat-sort rendeli meg (a csoport-sor `notPurchasable`). A pontos
megfogalmazás az `API.md` **Termékszöveg** szakaszában áll.

Parancssorból: a `keypro products get <cikkszám|id>` a kulcs-érték blokk alatt
kiírja a felsorolás-pontokat és a leírást; gépi feldolgozásra a `--json` viszi
mindhárom mezőt.

**Nem törő.** Csak új mezők jelentek meg, meglévő mező nem tűnt el, nem
változott a neve és nem változott a jelentése sem. A `shortDescription` a
`GET /products/{key}` termék-gyökerén továbbra is ugyanaz a mező; annyi
változott, hogy VÁLTOZAT-soron lekérdezve (`{key}` = a változat azonosítója,
slugja vagy cikkszáma) saját érték hiányában a család szövegét adja `null`
helyett.

---

## 0.1.13 - 2026-08-20

### A gyártói cikkszám is kereshető

A `GET /products` `q` paramétere mostantól **három mezőre illeszt**: a termék
nevére, a cikkszámra (`sku`) és a **gyártói cikkszámra**
(`manufacturerPartNumber`). Mindhárom ugyanúgy: részlet-egyezéssel és kis- és
nagybetűtől függetlenül, tehát a `dg7gmgf0pn5d` ugyanazt találja meg, mint a
`DG7GMGF0PN5D`, és a szám töredéke is elég.

Erre való: a gyártói vagy beszállítói árlistádból kimásolt azonosítóval egy
hívásból megkérdezhető, hogy **visszük-e azt a cikket**. Eddig a mező a
válaszban benne volt (0.1.12), de keresni nem lehetett rá, tehát ehhez a teljes
katalógust végig kellett lapoznod.

**Rendelni továbbra sem lehet a gyártói számmal**, mert nem egyedi: ugyanaz a
szám több változaton is szerepelhet. A találatból a `productId`-t vagy a `sku`-t
használd a `POST /orders(/preview)` `items[]` mezőjében. Ugyanezért a
`GET /products/{key}` **sem** old fel gyártói cikkszámot: a `{key}` továbbra is
azonosító, slug vagy `sku`.

Parancssorból: a `keypro products search <kifejezés>` ugyanezt a `q`-t küldi,
tehát a gyártói cikkszám ott is működik.

**Nem törő.** A `q` a névre és a cikkszámra pontosan ugyanúgy illeszt, mint
eddig; a változás csak annyi, hogy egy eddig nem keresett mező is találhat.
Aki a `q`-t cikkszám-kereséshez használja, **több** találatot kaphat, mint
korábban - ha pontos cikkszámra van szükséged, a `sku` mezőt hasonlítsd a
találatokon.

---

## 0.1.12 - 2026-08-20

### Gyártói cikkszám a termék-végpontokon

A `GET /products` és a `GET /products/{key}` válasza új mezőt visz:
`manufacturerPartNumber`. Ez a **gyártó saját azonosítója** a termékre (MPN), a
Microsoftnál például `DG7GMGF0PN5D`. Erre való: a katalógusunkat a gyártói vagy
beszállítói árlistáddal ezen az azonosítón tudod összevetni.

Ott van a termék-soron és **minden változat-soron** is (a lista `variants[]`
elemein, a részletező bővebb `variants[]` elemein, és `include_variants=true`
mellett az önálló változat-találatokon). A mező **hiányozhat** (`null`): a
katalógus nagy részének nincs gyártói cikkszáma.

**Külön mező a `sku`-tól, és nem is helyettesíti.** A `sku` a MI azonosítónk:
ezen old fel a rendelés, ezért a katalógusban egyedi. A gyártói szám a GYÁRTÓÉ,
tehát **nem egyedi** - ugyanaz a szám több változaton is szerepelhet -, és
**rendelni nem lehet vele**: a `POST /orders(/preview)` `items[]` mezője
továbbra is `sku`-t vagy `productId`-t vár.

Parancssorból: a `keypro products get <cikkszám vagy azonosító>` új "Gyártói
cikkszám" sorban mutatja (kitöltetlen mezőnél a sor kimarad), a `--json` pedig a
nyers értéket viszi tovább.

**Nem törő.** Új mező, a meglévők változatlanok.

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
