/**
 * Termekkepek beolvasasa az API valaszabol - SZUK, VEDEKEZO ertelmezo.
 *
 * A `/api/v1/products` es `/api/v1/products/{key}` minden termek- ES
 * valtozat-soron ad egy `images` tombot: `{ url, alt, position }` elemekkel,
 * rendezve, ABSZOLUT URL-ekkel. A tomb mindig ott van (uresen is), sosem
 * `null`, es AZ ELSO ELEM A FO KEP a KISZOLGALHATO kepek kozul: amit a bolt nem
 * tud kiszolgalni, azt a szerver ki sem kuldi (es naplozza), tehat ilyen
 * termeken a kovetkezo kep lesz az elso.
 *
 * MIERT VAN MEGIS SAJAT ERTELMEZO: a `client.ts` szandekosan lazan tipusozott
 * (`Record<string, unknown>`), es a CLI TAVOLI kiszolgalot hiv, ami lehet egy
 * REGEBBI telepites, amiben ez a mezo meg nincs is benne. Egy hianyzo, `null`
 * vagy hibas alaku mezo ilyenkor "nincs kep" kell legyen, sosem osszeomlas.
 * Ezert nem keszul teljes valasz-tipusmodell sem: pontosan azt olvassuk be,
 * amit hasznalunk.
 *
 * AMIT SZANDEKOSAN NEM CSINALUNK: nem ellenorizzuk az URL sematjat, es nem
 * teszunk relativ utat abszolutta. Annak EGY tulajdonosa van, a szerver oldali
 * `absoluteImageUrl` - ami nem tud biztosan abszolut alakot adni, azt a sort
 * ki sem kuldi. Egy masodik, itteni masolat pontosan attol csuszna szet.
 *
 * AMIT VISZONT IGEN: kidobjuk azt az URL-t, amiben BARMILYEN szokoz-jellegu
 * vagy vezerlo karakter van. Ez nem a szerver validaciojanak a masolata, hanem
 * a CLI SAJAT kimeneti szerzodese: a `keypro products images` "soronkent EGY
 * abszolut URL"-t iger, es a `products get` egy kulcs-ertek SORBA irja a
 * fokepet. A dokumentalt `| xargs -n1 curl -O` csovezetes ezen all - es az
 * `xargs` alapertelmezesben NEM CSAK a sorvegen hasit, hanem a SZOKOZON es a
 * taboni is. Egy "https://jo/a.png https://tamado/x.png" alaku, EGY soros ertek
 * igy ket letoltest inditana, a masodikat a tamado valasztana; ezert a szabaly
 * ugyanaz, mint a szerveren (`UNSAFE_IN_REF`), nem szukebb. A mai kiszolgalo
 * ilyet nem ad ki (`isImageRef` fail-closed), de a CLI TAVOLI, akar regebbi
 * vagy idegen telepitest hiv, es a sajat kimenete akkor sem toredezhet szet.
 */

export interface ProductImage {
  url: string;
  alt: string | null;
  position: number;
}

/**
 * A CLI kimeneti szerzodeset elronto karakter: BARMILYEN szokoz-jellegu (a
 * sortoresek, a szokoz es a tab is) vagy C0/C1 vezerlo karakter. Szandekosan
 * ugyanaz a szabaly, mint a szerver `UNSAFE_IN_REF`-je - egy szukebb, csak
 * sorvegre nezo valtozat atengedte volna a szokozzel osszefuzott ket cimet,
 * amit az `xargs` ugyanugy ket argumentumnak lat.
 *
 * EGY definicio, a beolvasasnal alkalmazva, tehat a `--json`, a
 * `featuredImage()` es az `imageUrlLines()` ugyanazt a listat latja.
 */
const UNSAFE_IN_URL = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * A termek-objektum `images` mezoje ProductImage tombkent. Barmilyen varatlan
 * alak (hianyzo mezo, `null`, nem tomb, `url` nelkuli elem, szokozt vagy
 * vezerlo karaktert tartalmazo URL) egyszeruen kimarad.
 */
export function parseProductImages(product: unknown): ProductImage[] {
  if (typeof product !== "object" || product === null) return [];
  const raw = (product as { images?: unknown }).images;
  if (!Array.isArray(raw)) return [];

  const images: ProductImage[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as { url?: unknown; alt?: unknown; position?: unknown };
    if (typeof item.url !== "string") continue;
    const url = item.url.trim();
    if (url === "" || UNSAFE_IN_URL.test(url)) continue;
    const alt = typeof item.alt === "string" && item.alt.trim() !== "" ? item.alt : null;
    images.push({
      url,
      alt,
      // A sorrendet a szerver adja; a `position` csak kiirando adat. Ha hianyzik
      // vagy nem szam, a megtartott elemek sorszama lep a helyebe.
      position:
        typeof item.position === "number" && Number.isFinite(item.position)
          ? item.position
          : images.length,
    });
  }
  return images;
}

/** A fo kep (a lista elso eleme), ha van. */
export function featuredImage(images: ProductImage[]): ProductImage | null {
  return images[0] ?? null;
}

/**
 * A `keypro products images` ember- ES gepbarat kimenete: soronkent EGY
 * abszolut URL, semmi mas (igy a `| xargs -n1 curl -O` egybol mukodik).
 * Kep nelkul ures string - nem ures sor.
 */
export function imageUrlLines(images: ProductImage[]): string {
  return images.map((image) => `${image.url}\n`).join("");
}
