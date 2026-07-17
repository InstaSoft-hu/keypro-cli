/**
 * Terminal jelszo-bekeres. A rejtett bekeres nyers (raw) modban olvas, ezert
 * kulon kell kezelni a beillesztest: a modern terminalok a beillesztett szoveget
 * "bracketed paste" jelolokbe (ESC[200~ ... ESC[201~) csomagoljak, es a jelszo a
 * zaro ujsorral egyutt egyetlen chunkban erkezhet. A regi, chunk-egeszet-egyben
 * kezelo logika ezeket beleragasztotta a jelszoba -> hibas jelszo. A
 * `consumeHiddenChunk` leszedi a jeloloket es karakterenkent dolgozik.
 */

export type HiddenStatus = "typing" | "submit" | "cancel";

const ESC = String.fromCharCode(27); // \x1b
// Bracketed-paste jelolok: ESC[200~ (kezdet) es ESC[201~ (veg).
const BRACKETED_PASTE = new RegExp(ESC + "\\[20[01]~", "g");

/**
 * Egy nyers stdin chunk feldolgozasa a rejtett jelszo-bekereshez. Tiszta
 * fuggveny (nincs I/O), ezert egysegtesztelheto. Visszaadja a frissitett
 * erteket es hogy folytatni kell-e (typing), submitolni (Enter/EOF) vagy
 * megszakitani (Ctrl-C). Char-kodokkal dolgozik, hogy ne kelljen literal
 * control-karaktereket a forrasba tenni.
 */
export function consumeHiddenChunk(
  current: string,
  chunk: string,
): { value: string; status: HiddenStatus } {
  const s = chunk.replace(BRACKETED_PASTE, "");
  let value = current;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    // Enter (LF/CR) vagy EOT (Ctrl-D) -> kesz.
    if (code === 10 || code === 13 || code === 4) {
      return { value, status: "submit" };
    }
    // ETX (Ctrl-C) -> megszakitas.
    if (code === 3) {
      return { value, status: "cancel" };
    }
    // DEL vagy Backspace -> egy karakter torlese.
    if (code === 127 || code === 8) {
      value = value.slice(0, -1);
    } else {
      value += ch;
    }
  }
  return { value, status: "typing" };
}

/** Rejtett (nem echozott) jelszo-bekeres a terminalon. */
export async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    const stop = () => {
      stdin.off("data", onData);
      if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer) => {
      const res = consumeHiddenChunk(value, chunk.toString("utf8"));
      value = res.value;
      if (res.status === "submit") {
        stop();
        resolve(value);
      } else if (res.status === "cancel") {
        stop();
        reject(new Error("Megszakítva."));
      }
    };
    stdin.on("data", onData);
  });
}
