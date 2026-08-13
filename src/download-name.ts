import { basename } from "node:path";

/**
 * A SZERVERTOL KAPOTT FAJLNEV EGYETLEN TISZTITOJA.
 *
 * A binaris letoltesek (`GET /license-documents/{id}/pdf`) a fajlnevet a
 * `Content-Disposition` fejlecben hozzak, es a CLI ezt hasznalja iras-celkent.
 * Ez az EGYETLEN hely a CLI-ben, ahol SZERVER-ADATBOL UTVONAL lesz (az
 * `invoices get --download <fajl>` celjat mindig a felhasznalo irja), ezert a
 * nev itt, a SZULETESEKOR tisztul meg - nem a `writeFileSync` elott, egy
 * kesobbi hivo joindulatara bizva.
 *
 * A szabalyt a repo mar kimondja a szerver oldalan
 * (`src/lib/reseller-docs/render.ts`): "egy fajlnevbol epitett utvonal sosem
 * hagyhatja el a sajat konyvtarat, fuggetlenul attol, hogy ma mi irja a
 * mezot". A CLI-ben ez ELESEBB: az `api-base` a felhasznalo altal atallithato
 * ertek (a README maga mutatja a dev cimre allitast), tehat a valaszolo szerver
 * nem axiomatikusan megbizhato. `filename="../../../home/user/.bashrc"` a
 * kifejto regexen atmegy, es tisztitas nelkul a munkakonyvtaron KIVULRE irna a
 * bajtokat, szo nelkul.
 *
 * A `\` -> `/` csere azert kell, mert a `basename()` PLATFORMFUGGO: POSIX-on a
 * visszaperjel sima karakter, Windowson elvalaszto. A csomag mindket helyen fut,
 * es egy vedelmi kapu nem viselkedhet mashogy a ket platformon.
 *
 * `null` = "nincs hasznalhato nev", amire a hivo a SAJAT alapertelmezett nevet
 * teszi. Az ures string, a `.` es a `..` mind ilyen: mindharom letezo konyvtarra
 * (vagy semmire) mutat, tehat celfajlnak alkalmatlan.
 */
export function safeDownloadName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = basename(raw.replace(/\\/g, "/")).trim();
  if (name === "" || name === "." || name === "..") return null;
  return name;
}

/**
 * A `Content-Disposition` fejlec `filename="..."` erteke, mar megtisztitva.
 *
 * A kifejtes es a tisztitas SZANDEKOSAN egy fuggveny: ha a ketto szetvalna, egy
 * kesobbi hivo kifejthetne a nevet a tisztito nelkul.
 */
export function filenameFromContentDisposition(
  header: string | null | undefined,
): string | null {
  const match = /filename="([^"]+)"/.exec(header ?? "");
  return safeDownloadName(match ? match[1] : null);
}
