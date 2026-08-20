/**
 * Termek-szoveg beolvasasa az API valaszabol - SZUK, VEDEKEZO ertelmezo.
 *
 * A `/api/v1/products` es `/api/v1/products/{key}` minden termek- ES
 * valtozat-soran harom szoveg-mezot ad: `shortDescriptionBullets` (MINDIG
 * tomb, uresen is, sosem `null`), `shortDescription` es `description`
 * (`string` vagy `null`). Sajat szoveg nelkuli valtozaton a CSOPORTJAE all
 * ott, mezonkent.
 *
 * MIERT VAN MEGIS SAJAT ERTELMEZO - ugyanaz az indok, mint a kepeknel
 * (`images.ts`): a `client.ts` szandekosan lazan tipusozott
 * (`Record<string, unknown>`), es a CLI TAVOLI kiszolgalot hiv, ami lehet egy
 * REGEBBI telepites, amiben ez a harom mezo meg nincs is benne. Egy hianyzo,
 * `null` vagy hibas alaku mezo ilyenkor "nincs szoveg" kell legyen, sosem
 * osszeomlas.
 *
 * (A szerver oldali `src/lib/text/control-chars.ts` NEM ugyanez: az az XML 1.0
 * ervenyesseget vedi a kimeno bizonylatokon, es TABot / sortorest / kocsivisszat
 * megtart. Ez a CLI SAJAT kimeneti szabalya, es a `cli/` kulon csomag, ami a
 * `src/`-bol nem is importalhat.)
 *
 * AMIT VISZONT ITT IS MEGTESZUNK: kiszedjuk a VEZERLO karaktereket. A CLI a
 * kapott szoveget a TERMINALRA irja, egy ESC-szekvencia pedig ott nem szoveg,
 * hanem parancs (szinezes, kurzormozgatas, a mar kiirt sorok atirasa) - egy
 * regebbi vagy idegen telepites valasza igy at tudna rajzolni a kimenetet.
 * A hosszu leirasban a SORTORES marad (az a szoveg szerkezete: ures sor =
 * bekezdes), a felsorolas-pontban viszont nem: a `products get` soronkent egy
 * pontot iger, tehat ott a sortores is szokozze valik.
 */

export interface ProductText {
  /** A felsorolas-pontok, mindig tomb (uresen is). */
  bullets: string[];
  /** A rovid leiras szoveges resze, vagy `null`. */
  shortDescription: string | null;
  /** A hosszu leiras, vagy `null`. */
  description: string | null;
}

/**
 * C0/C1 vezerlo karakterek. A `\n` (0x0a) SZANDEKOSAN nincs benne: a hosszu
 * leiras szerkezete rajta all. A `\r` igen - a CRLF `\r`-je onmagaban
 * kurzort ugrat a sor elejere.
 */
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/** Vezerlo karakterek nelkuli, vagott szoveg; `null`, ha nem maradt semmi. */
function clean(value: unknown, keepNewlines: boolean): string | null {
  if (typeof value !== "string") return null;
  const stripped = value.replace(CONTROL_CHARS, "");
  const flattened = keepNewlines ? stripped : stripped.replace(/\n+/g, " ");
  const trimmed = flattened.trim();
  return trimmed === "" ? null : trimmed;
}

/** A termek-objektum harom szoveg-mezoje, vedekezo olvasassal. */
export function parseProductText(product: unknown): ProductText {
  if (typeof product !== "object" || product === null) {
    return { bullets: [], shortDescription: null, description: null };
  }
  const row = product as {
    shortDescriptionBullets?: unknown;
    shortDescription?: unknown;
    description?: unknown;
  };

  const bullets: string[] = [];
  if (Array.isArray(row.shortDescriptionBullets)) {
    for (const entry of row.shortDescriptionBullets) {
      const line = clean(entry, false);
      if (line !== null) bullets.push(line);
    }
  }

  return {
    bullets,
    shortDescription: clean(row.shortDescription, false),
    description: clean(row.description, true),
  };
}

/**
 * A `keypro products get` szoveg-blokkja: a felsorolas-pontok soronkent egy
 * `- ` jellel, alattuk a rovid, majd a hosszu leiras. Ures string, ha egyik
 * mezo sincs kitoltve - ilyenkor a parancs semmit nem ir ki rola.
 */
export function productTextBlock(text: ProductText): string {
  const parts: string[] = [];
  if (text.bullets.length > 0) {
    parts.push(text.bullets.map((line) => `- ${line}`).join("\n"));
  }
  if (text.shortDescription !== null) parts.push(text.shortDescription);
  if (text.description !== null) parts.push(text.description);
  return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
}
