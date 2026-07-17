/**
 * Kimenet-kezeles: --json modban nyers JSON a stdout-ra (agenteknek),
 * egyebkent magyar, ember-olvashato sorok. Hibak a stderr-re.
 * Kilepesi kodok: 0 siker, 1 API/uzleti hiba, 2 hasznalati hiba,
 * 3 auth/konfiguracios hiba.
 */

import { KeyproApiError } from "./client.js";

export let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

/** Siker-kimenet: JSON modban a nyers adat, kulonben az emberi megjelenites. */
export function output(data: unknown, human: () => void): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    human();
  }
}

export function fail(err: unknown): never {
  if (err instanceof KeyproApiError) {
    if (jsonMode) {
      process.stderr.write(
        JSON.stringify(
          {
            ok: false,
            error: { code: err.code, message: err.message, details: err.details },
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      process.stderr.write(`Hiba (${err.code}): ${err.message}\n`);
      if (err.details !== undefined) {
        process.stderr.write(`Részletek: ${JSON.stringify(err.details)}\n`);
      }
    }
    process.exit(err.status === 401 || err.status === 403 ? 3 : 1);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (jsonMode) {
    process.stderr.write(
      JSON.stringify({ ok: false, error: { code: "cli_error", message } }) + "\n",
    );
  } else {
    process.stderr.write(`Hiba: ${message}\n`);
  }
  process.exit(1);
}

export function usageError(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/** Egyszeru kulcs-ertek sorok igazitott kulcsokkal. */
export function printKV(rows: Array<[string, string | number | null | undefined]>): void {
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    if (value === null || value === undefined || value === "") continue;
    process.stdout.write(`${key.padEnd(width)}  ${value}\n`);
  }
}

/** Egyszeru, fuggosegmentes tablazat. */
export function printTable(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const cells = rows.map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "-" : String(cell))),
  );
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => (row[i] ?? "").length)),
  );
  const line = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i])).join("  ") + "\n";
  process.stdout.write(line(headers));
  process.stdout.write(line(widths.map((w) => "-".repeat(w))));
  for (const row of cells) process.stdout.write(line(row));
}

export function eurFmt(value: number): string {
  return `${value.toFixed(2)} EUR`;
}
