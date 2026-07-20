/**
 * KeyPro CLI: rendeles leadas, rendelesek/szamlak/termekkulcsok lekerdezese,
 * profil es KEP wallet kezeles a KeyPro B2B licencshopban. Ember-olvashato
 * magyar kimenet, --json kapcsoloval gepi (AI-agent) kimenet, es beepitett
 * MCP szerver mod (keypro mcp).
 */

import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import {
  createClient,
  type AddressInput,
  type KeyproClient,
  type OrderRequestInput,
} from "./client.js";
import { configPath, readConfig, resolveConfig, writeConfig } from "./config.js";
import { AGENT_DOCS } from "./agent-docs.js";
import { parseItemSpec } from "./items.js";
import {
  eurFmt,
  fail,
  output,
  printKV,
  printTable,
  setJsonMode,
  usageError,
} from "./output.js";
import { KEYPRO_MCP_VERSION } from "./mcp-tools.js";
import { runMcpServer } from "./mcp.js";
import { promptHidden } from "./prompt.js";

const program = new Command();

program
  .name("keypro")
  .description(
    "KeyPro.hu B2B licencshop CLI - rendeles, szamlak, termékkulcsok, profil. AI-agent utmutato: keypro agent-docs",
  )
  .version(KEYPRO_MCP_VERSION)
  .option("--json", "gepi (JSON) kimenet a stdout-ra", false)
  .option("--api-key <kulcs>", "API kulcs (felulirja az env/config erteket)")
  .option("--api-base <url>", "API kiszolgalo cime (alap: eles bolt)")
  .hook("preAction", (thisCommand) => {
    setJsonMode(Boolean(thisCommand.optsWithGlobals().json));
  });

interface GlobalOpts {
  json?: boolean;
  apiKey?: string;
  apiBase?: string;
}

function resolved(cmd: Command) {
  const opts = cmd.optsWithGlobals() as GlobalOpts;
  return resolveConfig({ apiKey: opts.apiKey, apiBase: opts.apiBase });
}

function clientFor(cmd: Command, requireKey = true): KeyproClient {
  const cfg = resolved(cmd);
  if (requireKey && !cfg.apiKey) {
    process.stderr.write(
      "Nincs API kulcs beállítva. Futtasd: keypro login, vagy add meg a KEYPRO_API_KEY környezeti változót / a --api-key kapcsolót.\n",
    );
    process.exit(3);
  }
  return createClient({ apiBase: cfg.apiBase, apiKey: cfg.apiKey });
}

async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

program
  .command("login")
  .description("bejelentkezes email + jelszoval; uj API kulcsot ment a configba")
  .option("--email <email>")
  .option("--password <jelszo>", "jelszo (ha nincs megadva, rejtve keri be)")
  .option("--name <nev>", "a letrejovo API kulcs cimkeje", "CLI login")
  .action(async (opts: { email?: string; password?: string; name: string }, cmd: Command) => {
    try {
      const cfg = resolved(cmd);
      const email = opts.email ?? (await promptText("Email: "));
      const password = opts.password ?? (await promptHidden("Jelszó: "));
      const client = createClient({ apiBase: cfg.apiBase });
      const result = await client.login(email, password, opts.name);
      writeConfig({ apiKey: result.token, apiBase: cfg.apiBase });
      output(
        { prefix: result.prefix, keyId: result.keyId, scopes: result.scopes, apiBase: cfg.apiBase, configPath: configPath() },
        () => {
          process.stdout.write(
            `Sikeres bejelentkezés. Új API kulcs mentve (${result.prefix}...) ide: ${configPath()}\n`,
          );
        },
      );
    } catch (err) {
      fail(err);
    }
  });

program
  .command("logout")
  .description("a mentett API kulcs torlese a configbol")
  .option("--revoke", "a kulcs visszavonasa a szerveren is", false)
  .action(async (opts: { revoke: boolean }, cmd: Command) => {
    try {
      if (opts.revoke) {
        const client = clientFor(cmd);
        const me = await client.me();
        await client.keyRevoke(me.key.id);
      }
      writeConfig({ apiKey: undefined });
      output({ loggedOut: true, revoked: opts.revoke }, () => {
        process.stdout.write(
          opts.revoke
            ? "Kijelentkezve, a kulcs a szerveren is visszavonva.\n"
            : "Kijelentkezve (a kulcs törölve a configból).\n",
        );
      });
    } catch (err) {
      fail(err);
    }
  });

program
  .command("whoami")
  .description("a bejelentkezett fiok adatai")
  .action(async (_opts: unknown, cmd: Command) => {
    try {
      const me = await clientFor(cmd).me();
      output(me, () => {
        printKV([
          ["Fiók", `${me.email} (#${me.id})`],
          ["Cég", me.companyName],
          ["Szerep", me.role],
          ["KEP egyenleg", eurFmt(me.walletBalanceEurNet)],
          ["API kulcs", `${me.key.prefix}... (${me.key.name})`],
          ["Jogosultságok", me.key.scopes.join(", ")],
        ]);
      });
    } catch (err) {
      fail(err);
    }
  });

program
  .command("setup")
  .description("interaktiv beallitas: szerver + hitelesites (API kulcs vagy jelszo)")
  .action(async (_opts: unknown, cmd: Command) => {
    try {
      const current = resolveConfig({});

      // 1. Szerver: az aktualisan ervenyes cim az alapertelmezett (Enter = marad).
      const baseInput = (
        await promptText(`API szerver [${current.apiBase}]: `)
      ).trim();
      const apiBase = (baseInput || current.apiBase).replace(/\/$/, "");
      if (!/^https?:\/\//.test(apiBase)) {
        usageError("Az API szerver http(s) URL kell legyen, pl. https://keypro.hu");
      }

      // 2. Hitelesites: API kulcs (ajanlott, alap) vagy email + jelszo.
      const method = (
        await promptText(
          "Hitelesítés - [1] API kulcs (ajánlott)  [2] Email + jelszó  [1]: ",
        )
      ).trim();

      let apiKey: string;
      if (method === "2") {
        const email = await promptText("Email: ");
        const password = await promptHidden("Jelszó: ");
        const result = await createClient({ apiBase }).login(
          email,
          password,
          "CLI setup",
        );
        apiKey = result.token;
      } else {
        // Az API kulcs beillesztheto (rejtett, mint a jelszo).
        const key = (await promptHidden("API kulcs (kp_live_...): ")).trim();
        if (!key.startsWith("kp_live_")) {
          usageError(
            "Érvénytelen kulcs formátum (kp_live_...). Kulcsot a weben az /mcp-cli oldalon készíthetsz.",
          );
        }
        apiKey = key;
      }

      writeConfig({ apiBase, apiKey });

      // 3. Ellenorzes: kiirjuk a fiokot.
      const me = await createClient({ apiBase, apiKey }).me();
      output(
        {
          apiBase,
          configPath: configPath(),
          account: { id: me.id, email: me.email, role: me.role },
        },
        () => {
          process.stdout.write(
            `\nBeállítva.\n  Szerver: ${apiBase}\n  Fiók:    ${me.email} (#${me.id}, ${me.role})\n  Config:  ${configPath()}\n\nPróbáld ki: keypro whoami\n`,
          );
        },
      );
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config = program.command("config").description("CLI beallitasok");

config
  .command("get")
  .description("aktualis beallitasok")
  .action((_opts: unknown, cmd: Command) => {
    const cfg = resolved(cmd);
    const file = readConfig();
    output(
      {
        apiBase: cfg.apiBase,
        apiKeySet: cfg.apiKey !== null,
        keySource: cfg.keySource,
        configPath: configPath(),
        configFile: { apiBase: file.apiBase, apiKeySet: Boolean(file.apiKey) },
      },
      () => {
        printKV([
          ["API cím", cfg.apiBase],
          ["API kulcs", cfg.apiKey ? `beállítva (forrás: ${cfg.keySource})` : "nincs"],
          ["Config fájl", configPath()],
        ]);
      },
    );
  });

config
  .command("set <kulcs> <ertek>")
  .description("beallitas mentese (tamogatott kulcs: api-base, api-key)")
  .action((key: string, value: string) => {
    if (key === "api-base") {
      if (!/^https?:\/\//.test(value)) {
        usageError("Az api-base http(s) URL kell legyen, pl. https://keypro.hu");
      }
      const next = writeConfig({ apiBase: value.replace(/\/$/, "") });
      output({ apiBase: next.apiBase }, () => {
        process.stdout.write(`API cím beállítva: ${next.apiBase}\n`);
      });
      return;
    }
    if (key === "api-key") {
      if (!value.startsWith("kp_live_")) {
        usageError("Érvénytelen kulcs formátum (kp_live_...).");
      }
      writeConfig({ apiKey: value });
      output({ apiKeySet: true, configPath: configPath() }, () => {
        process.stdout.write("API kulcs elmentve a configba.\n");
      });
      return;
    }
    usageError(`Ismeretlen beállítás: ${key}. Támogatott: api-base, api-key`);
  });

// ---------------------------------------------------------------------------
// API kulcsok
// ---------------------------------------------------------------------------

const key = program.command("key").description("API kulcsok kezelese");

key
  .command("list")
  .description("a fiok API kulcsai")
  .action(async (_opts: unknown, cmd: Command) => {
    try {
      const { keys } = await clientFor(cmd).keysList();
      output({ keys }, () => {
        printTable(
          ["ID", "Prefix", "Név", "Jogok", "Utoljára használva", "Állapot"],
          keys.map((k) => [
            String(k.id),
            `${k.prefix}...`,
            String(k.name),
            (k.scopes as string[]).join(","),
            k.lastUsedAt ? String(k.lastUsedAt).slice(0, 10) : "-",
            k.revokedAt ? "visszavonva" : "aktív",
          ]),
        );
      });
    } catch (err) {
      fail(err);
    }
  });

key
  .command("revoke <id>")
  .description("API kulcs visszavonasa")
  .action(async (id: string, _opts: unknown, cmd: Command) => {
    try {
      const result = await clientFor(cmd).keyRevoke(Number(id));
      output(result, () => {
        process.stdout.write(`A(z) ${id} kulcs visszavonva.\n`);
      });
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Termekek
// ---------------------------------------------------------------------------

const products = program.command("products").description("termek-katalogus");

products
  .command("search [query]")
  .description("termekkereses nev vagy cikkszam alapjan")
  .option("--category <slug>", "kategoria-szures")
  .option("--on-sale", "csak akcios termekek", false)
  .option("--sort <mod>", "rendezes: name|price_asc|price_desc|newest")
  .option("--limit <n>", "talalatok szama (max 100)", "25")
  .action(
    async (
      query: string | undefined,
      opts: { category?: string; onSale: boolean; sort?: string; limit: string },
      cmd: Command,
    ) => {
      try {
        const result = await clientFor(cmd).productsSearch({
          q: query,
          category: opts.category,
          onSale: opts.onSale,
          sort: opts.sort,
          limit: Number(opts.limit),
        });
        output(result, () => {
          printTable(
            ["ID", "SKU", "Név", "Nettó EUR", "Akciós"],
            result.products.map((p) => [
              String(p.id),
              p.sku ? String(p.sku) : "-",
              String(p.name),
              Number(p.netPriceEur).toFixed(2),
              p.onSale ? "igen" : "",
            ]),
          );
          process.stdout.write(`\nÖsszesen: ${result.total} találat\n`);
        });
      } catch (err) {
        fail(err);
      }
    },
  );

products
  .command("get <skuVagyId>")
  .description("termek reszletei (id, slug vagy cikkszam)")
  .action(async (keyArg: string, _opts: unknown, cmd: Command) => {
    try {
      const p = await clientFor(cmd).productGet(keyArg);
      output(p, () => {
        printKV([
          ["Termék", `${p.name} (#${p.id})`],
          ["SKU", p.sku as string | null],
          ["Lista nettó ár", `${Number(p.listNetPriceEur).toFixed(2)} EUR`],
          ["Akciós", p.onSale ? "igen" : "nem"],
          ["A te nettó egységárad", `${Number(p.yourUnitNetEur).toFixed(2)} EUR`],
          [
            "Kedvezményed",
            Number(p.yourDiscountPercent) > 0
              ? `${p.yourDiscountPercent}%`
              : null,
          ],
          ["Szállítást igényel", p.isVirtual ? "nem (digitális)" : "igen (fizikai)"],
        ]);
      });
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Rendeles
// ---------------------------------------------------------------------------

const ADDRESS_FLAG_FIELDS: Array<[flag: string, field: keyof AddressInput]> = [
  ["first-name", "firstName"],
  ["last-name", "lastName"],
  ["company", "company"],
  ["address1", "address1"],
  ["address2", "address2"],
  ["city", "city"],
  ["postcode", "postcode"],
  ["state", "state"],
  ["country", "country"],
  ["email", "email"],
  ["phone", "phone"],
];

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function addOrderOptions(cmd: Command): Command {
  cmd
    .option(
      "--item <tetel>",
      "tetel: SKU=DB vagy id:SZAM=DB (tobbszor is megadhato)",
      collect,
      [] as string[],
    )
    .option(
      "--payment <mod>",
      "fizetesi mod: bacs|cheque|cod|wallet|card",
    )
    .option("--shipping <mod>", "szallitasi mod: gls_hd|gls_parcelshop|combine_free")
    .option("--parcelshop <id>", "GLS atveteli pont azonosito (gls_parcelshop eseten)")
    .option("--coupon <kod>", "kuponkod")
    .option("--currency <penznem>", "EUR vagy HUF", "EUR")
    .option("--tax-number <adoszam>", "adoszam (ceges szamlahoz)")
    .option("--card <pm_id>", "mentett kartya azonosito (card fizetesnel)");
  for (const [flag, ] of ADDRESS_FLAG_FIELDS) {
    cmd.option(`--billing-${flag} <ertek>`);
    cmd.option(`--shipping-${flag} <ertek>`);
  }
  return cmd;
}

function camel(prefix: string, flag: string): string {
  return (
    prefix +
    flag
      .split("-")
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join("")
  );
}

function buildOrderRequest(opts: Record<string, unknown>): OrderRequestInput {
  const itemSpecs = (opts.item as string[]) ?? [];
  if (itemSpecs.length === 0) {
    usageError("Legalább egy --item kell (pl. --item OFF2021=2). Keresés: keypro products search");
  }
  const payment = String(opts.payment ?? "");
  const methodMap: Record<string, OrderRequestInput["paymentMethod"]> = {
    bacs: "bacs",
    cheque: "cheque",
    cod: "cod",
    wallet: "wallet",
    card: "stripe",
    stripe: "stripe",
  };
  const paymentMethod = methodMap[payment];
  if (!paymentMethod) {
    usageError("Adj meg fizetési módot: --payment bacs|cheque|cod|wallet|card");
  }

  let items;
  try {
    items = itemSpecs.map(parseItemSpec);
  } catch (err) {
    usageError(err instanceof Error ? err.message : String(err));
  }

  const address = (prefix: "billing" | "shipping"): AddressInput | undefined => {
    const out: AddressInput = {};
    let any = false;
    for (const [flag, field] of ADDRESS_FLAG_FIELDS) {
      const value = opts[camel(prefix, flag)];
      if (typeof value === "string") {
        out[field] = value;
        any = true;
      }
    }
    return any ? out : undefined;
  };

  const currency = String(opts.currency ?? "EUR").toUpperCase();
  if (currency !== "EUR" && currency !== "HUF") {
    usageError("A --currency EUR vagy HUF lehet.");
  }

  return {
    items,
    paymentMethod,
    shippingMethodId: opts.shipping as OrderRequestInput["shippingMethodId"],
    parcelshopId: opts.parcelshop as string | undefined,
    couponCode: opts.coupon as string | undefined,
    currency,
    billing: address("billing"),
    shipping: address("shipping"),
    taxNumber: opts.taxNumber as string | undefined,
    cardId: opts.card as string | undefined,
  };
}

function printPreview(preview: Awaited<ReturnType<KeyproClient["orderPreview"]>>): void {
  printTable(
    ["Termék", "Db", "Nettó egységár", "Nettó összesen"],
    preview.lines.map((line) => [
      String(line.name),
      String(line.qty),
      Number(line.unitNetEur).toFixed(2),
      Number(line.lineNetEur).toFixed(2),
    ]),
  );
  process.stdout.write("\n");
  const rows: Array<[string, string | null]> = [
    ["Fizetési mód", String((preview.payment as { label?: string }).label ?? "")],
  ];
  for (const fee of (preview.payment as { fees?: Array<{ label: string; netEur: number }> }).fees ?? []) {
    rows.push([fee.label, eurFmt(fee.netEur)]);
  }
  if (preview.shipping) {
    rows.push([
      `Szállítás (${(preview.shipping as { label?: string }).label})`,
      eurFmt(Number((preview.shipping as { netEur?: number }).netEur ?? 0)),
    ]);
  }
  if (preview.coupon) {
    rows.push([
      `Kupon (${(preview.coupon as { code?: string }).code})`,
      `-${eurFmt(Number((preview.coupon as { discountNetEur?: number }).discountNetEur ?? 0))}`,
    ]);
  }
  rows.push(["Nettó végösszeg", eurFmt(preview.totals.netTotalEur)]);
  rows.push(["ÁFA (27%)", eurFmt(preview.totals.taxTotalEur)]);
  rows.push(["Bruttó végösszeg", eurFmt(preview.totals.grossTotalEur)]);
  if (preview.currency === "HUF") {
    rows.push(["Fizetendő", `${preview.displayGrossTotal} HUF`]);
  }
  if (preview.wallet) {
    rows.push([
      "KEP egyenleg",
      `${eurFmt(preview.wallet.balanceEurNet)} (${preview.wallet.sufficient ? "fedezi" : "NEM fedezi"})`,
    ]);
  }
  printKV(rows);
}

const order = program.command("order").description("rendelesek");

addOrderOptions(
  order
    .command("preview")
    .description("rendeles-elonezet: vegosszegek iras nelkul + confirmToken"),
).action(async (opts: Record<string, unknown>, cmd: Command) => {
  try {
    const request = buildOrderRequest(opts);
    const preview = await clientFor(cmd).orderPreview(request);
    output(preview, () => {
      printPreview(preview);
      process.stdout.write(
        "\nMegrendelés: ugyanezekkel a kapcsolókkal futtasd az order create --yes parancsot.\n",
      );
    });
  } catch (err) {
    fail(err);
  }
});

addOrderOptions(
  order
    .command("create")
    .description("rendeles leadasa (elobb elonezet; --yes nelkul nem rendel)"),
)
  .option("--yes", "a rendeles tenyleges leadasa", false)
  .option(
    "--idempotency-key <kulcs>",
    "retry-dedup kulcs: ugyanazzal a kulccsal nem jon letre masodik rendeles",
  )
  .action(async (opts: Record<string, unknown>, cmd: Command) => {
    try {
      const request = buildOrderRequest(opts);
      const client = clientFor(cmd);
      const preview = await client.orderPreview(request);

      if (!opts.yes) {
        output({ preview, hint: "Add hozzá a --yes kapcsolót a megrendeléshez." }, () => {
          printPreview(preview);
          process.stdout.write(
            "\nEz csak előnézet volt. Add hozzá a --yes kapcsolót a megrendeléshez.\n",
          );
        });
        process.exit(1);
      }

      const idempotencyKey =
        (opts.idempotencyKey as string | undefined) ?? `cli-${randomUUID()}`;
      const result = await client.orderCreate(
        { ...request, confirmToken: preview.confirmToken },
        idempotencyKey,
      );
      output(result, () => {
        const orderData = result.order as { number?: string; id?: number; statusLabel?: string };
        printKV([
          ["Rendelés", `#${orderData.number} (id: ${orderData.id})`],
          ["Állapot", orderData.statusLabel ?? ""],
          ["Fizetés", result.payment.note],
          [
            "Fizetési link",
            result.payment.paymentUrl ? result.payment.paymentUrl : null,
          ],
          [
            "KEP egyenleg",
            result.payment.walletBalanceAfterEur !== undefined
              ? eurFmt(result.payment.walletBalanceAfterEur)
              : null,
          ],
          [
            "Kézbesített kulcsok",
            result.deliveredKeyCount > 0
              ? `${result.deliveredKeyCount} db (keypro keys list --order ${orderData.id})`
              : null,
          ],
          [
            "Számlák",
            result.invoices.length > 0
              ? result.invoices
                  .map((inv) => `${inv.typeLabel}: ${inv.downloadUrl ?? "készül"}`)
                  .join("; ")
              : null,
          ],
        ]);
        if (result.payment.paymentUrl) {
          process.stdout.write(
            "\nFONTOS: a fizetéshez nyisd meg a fenti fizetési linket a böngészőben (kb. 1 óráig érvényes).\n",
          );
        }
      });
    } catch (err) {
      fail(err);
    }
  });

order
  .command("list")
  .description("rendelesek listaja")
  .option("--status <statusz>", "szures statuszra (pl. processing, completed)")
  .option("--limit <n>", "darabszam", "25")
  .action(async (opts: { status?: string; limit: string }, cmd: Command) => {
    try {
      const result = await clientFor(cmd).ordersList({
        status: opts.status,
        limit: Number(opts.limit),
      });
      output(result, () => {
        printTable(
          ["ID", "Szám", "Dátum", "Állapot", "Fizetés", "Bruttó EUR", "Tételek"],
          result.orders.map((o) => [
            String(o.id),
            `#${o.number}`,
            String(o.createdAt).slice(0, 10),
            String(o.statusLabel),
            String(o.paymentMethodLabel),
            Number(o.grossTotalEur).toFixed(2),
            (o.itemNames as string[]).join(", ").slice(0, 60),
          ]),
        );
      });
    } catch (err) {
      fail(err);
    }
  });

order
  .command("get <id>")
  .description("rendeles reszletei")
  .action(async (id: string, _opts: unknown, cmd: Command) => {
    try {
      const result = await clientFor(cmd).orderGet(Number(id));
      output(result, () => {
        const o = result.order as Record<string, unknown>;
        printKV([
          ["Rendelés", `#${o.number} (id: ${o.id})`],
          ["Állapot", String(o.statusLabel)],
          ["Fizetési mód", String(o.paymentMethodLabel)],
          ["Dátum", String(o.createdAt).slice(0, 10)],
          ["Nettó", eurFmt(Number(o.netTotalEur))],
          ["Bruttó", eurFmt(Number(o.grossTotalEur))],
          ["Fizetési link", result.paymentUrl],
        ]);
        process.stdout.write("\n");
        printTable(
          ["Tétel", "Db", "Nettó összesen"],
          (o.items as Array<Record<string, unknown>>).map((item) => [
            String(item.name),
            String(item.qty),
            Number(item.lineNetEur).toFixed(2),
          ]),
        );
        if (result.invoices.length > 0) {
          process.stdout.write("\nSzámlák:\n");
          printTable(
            ["ID", "Típus", "Szám", "Állapot", "Letöltés"],
            result.invoices.map((inv) => [
              String(inv.id),
              String(inv.typeLabel),
              inv.number ? String(inv.number) : "-",
              String(inv.statusLabel),
              inv.downloadUrl ? String(inv.downloadUrl) : "-",
            ]),
          );
        }
      });
    } catch (err) {
      fail(err);
    }
  });

order
  .command("cancel <id>")
  .description("fizetetlen rendeles visszamondasa (torlese)")
  .action(async (id: string, _opts: unknown, cmd: Command) => {
    try {
      const result = await clientFor(cmd).orderCancel(Number(id));
      output(result, () => {
        const o = result.order as Record<string, unknown>;
        printKV([
          ["Rendelés", `#${o.number} (id: ${o.id})`],
          ["Állapot", String(o.statusLabel)],
        ]);
        process.stdout.write(`\n${result.note}\n`);
      });
    } catch (err) {
      fail(err);
    }
  });

order
  .command("change-payment <id>")
  .description("fizetetlen rendeles fizetesi modjanak modositasa (elonezet; --yes nelkul nem valt)")
  .requiredOption("--payment <mod>", "uj fizetesi mod: bacs|cheque|cod|wallet|stripe")
  .option("--card <pm_id>", "mentett kartya id (stripe-hoz, opcionalis)")
  .option("--yes", "a valtas tenyleges vegrehajtasa", false)
  .action(
    async (
      id: string,
      opts: { payment: string; card?: string; yes?: boolean },
      cmd: Command,
    ) => {
      try {
        const client = clientFor(cmd);
        const preview = await client.orderPaymentPreview(Number(id), opts.payment);
        if (!opts.yes) {
          output(
            { preview, hint: "Add hozzá a --yes kapcsolót a módosításhoz." },
            () => {
              printKV([
                ["Jelenlegi mód", preview.currentMethod],
                ["Új mód", preview.newMethod],
                ["Új nettó", eurFmt(preview.newTotals.netTotalEur)],
                ["Új bruttó", eurFmt(preview.newTotals.grossTotalEur)],
                ["Díj-változás (bruttó)", eurFmt(preview.feeDeltaEur)],
                [
                  "KEP fedezet",
                  preview.wallet
                    ? preview.wallet.sufficient
                      ? "elég"
                      : "NEM elég"
                    : null,
                ],
              ]);
              process.stdout.write(
                "\nEz csak előnézet. Add hozzá a --yes kapcsolót a módosításhoz.\n",
              );
            },
          );
          process.exit(1);
        }
        const result = await client.orderChangePayment(Number(id), {
          newMethod: opts.payment,
          confirmToken: preview.confirmToken,
          cardId: opts.card,
        });
        output(result, () => {
          const o = result.order as Record<string, unknown>;
          const p = result.payment as Record<string, unknown>;
          printKV([
            ["Rendelés", `#${o.number} (id: ${o.id})`],
            ["Állapot", String(o.statusLabel)],
            ["Fizetési mód", String(o.paymentMethodLabel)],
            ["Fizetés", String(p.note)],
            ["Fizetési link", p.paymentUrl ? String(p.paymentUrl) : null],
            [
              "KEP egyenleg",
              p.walletBalanceAfterEur !== undefined
                ? eurFmt(Number(p.walletBalanceAfterEur))
                : null,
            ],
          ]);
        });
      } catch (err) {
        fail(err);
      }
    },
  );

// ---------------------------------------------------------------------------
// Termekkulcsok
// ---------------------------------------------------------------------------

const keysCmd = program.command("keys").description("termékkulcsok");

keysCmd
  .command("list")
  .description("kezbesitett termékkulcsok (osszes vagy egy rendelese)")
  .option("--order <id>", "csak az adott rendeles kulcsai")
  .action(async (opts: { order?: string }, cmd: Command) => {
    try {
      const client = clientFor(cmd);
      if (opts.order) {
        const result = await client.orderKeys(Number(opts.order));
        output(result, () => {
          if (result.keys.length === 0 && result.licenses.length === 0) {
            process.stdout.write(
              "Ehhez a rendeléshez még nincs kézbesített kulcs (fizetésre vagy feldolgozásra vár).\n",
            );
            return;
          }
          printTable(
            ["Termék", "Kulcs", "Kézbesítve"],
            [
              ...result.keys.map((k) => [
                k.productName,
                k.keyValue,
                k.deliveredAt ? String(k.deliveredAt).slice(0, 10) : "-",
              ]),
              ...result.licenses.map((lic) => [
                String(lic.productName ?? "-"),
                lic.keyValue ? String(lic.keyValue) : "(kulcs a weben: /view-license-keys)",
                String(lic.statusLabel),
              ]),
            ],
          );
        });
      } else {
        const result = await client.licenseKeys();
        output(result, () => {
          for (const group of result.products) {
            process.stdout.write(`\n${group.productName}\n`);
            printTable(
              ["Kulcs", "Rendelés", "Kézbesítve"],
              group.keys.map((k) => [
                String(k.keyValue),
                k.orderNumber ? `#${k.orderNumber}` : "-",
                k.deliveredAt ? String(k.deliveredAt).slice(0, 10) : "-",
              ]),
            );
          }
          if (result.products.length === 0) {
            process.stdout.write("Még nincs kézbesített termékkulcsod.\n");
          }
        });
      }
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Szamlak
// ---------------------------------------------------------------------------

const invoicesCmd = program.command("invoices").description("szamlak, dijbekerok");

invoicesCmd
  .command("list")
  .description("bizonylatok listaja")
  .option("--order <id>", "csak az adott rendeles bizonylatai")
  .option("--limit <n>", "darabszam", "25")
  .action(async (opts: { order?: string; limit: string }, cmd: Command) => {
    try {
      const result = await clientFor(cmd).invoicesList({
        orderId: opts.order ? Number(opts.order) : undefined,
        limit: Number(opts.limit),
      });
      output(result, () => {
        printTable(
          ["ID", "Típus", "Szám", "Rendelés", "Állapot", "Bruttó EUR", "Letöltés"],
          result.invoices.map((inv) => [
            String(inv.id),
            String(inv.typeLabel),
            inv.number ? String(inv.number) : "-",
            inv.orderNumber ? `#${inv.orderNumber}` : "-",
            String(inv.statusLabel),
            Number(inv.grossTotalEur).toFixed(2),
            inv.downloadUrl ? String(inv.downloadUrl) : "-",
          ]),
        );
      });
    } catch (err) {
      fail(err);
    }
  });

invoicesCmd
  .command("get <id>")
  .description("bizonylat reszletei; --download: mentes fajlba")
  .option("--download <fajl>", "a bizonylat letoltese a megadott fajlba")
  .action(async (id: string, opts: { download?: string }, cmd: Command) => {
    try {
      const { invoice } = await clientFor(cmd).invoiceGet(Number(id));
      if (opts.download) {
        const url = invoice.downloadUrl as string | null;
        if (!url) {
          fail(new Error("Ehhez a bizonylathoz nincs letölthető dokumentum."));
        }
        const response = await fetch(url);
        if (!response.ok) {
          fail(new Error(`A letöltés nem sikerült (HTTP ${response.status}).`));
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(opts.download, buffer);
        output({ invoice, savedTo: opts.download, bytes: buffer.length }, () => {
          process.stdout.write(`Mentve: ${opts.download} (${buffer.length} bájt)\n`);
        });
        return;
      }
      output({ invoice }, () => {
        printKV([
          ["Bizonylat", `${invoice.typeLabel} ${invoice.number ?? "(még számozatlan)"}`],
          ["Rendelés", invoice.orderNumber ? `#${invoice.orderNumber}` : null],
          ["Állapot", String(invoice.statusLabel)],
          ["Nettó", eurFmt(Number(invoice.netTotalEur))],
          ["ÁFA", eurFmt(Number(invoice.vatEur))],
          ["Bruttó", eurFmt(Number(invoice.grossTotalEur))],
          ["Letöltés", invoice.downloadUrl as string | null],
        ]);
      });
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

const profile = program.command("profile").description("fiok torzsadatok");

profile
  .command("get")
  .description("kontakt + szamlazasi + szallitasi adatok")
  .action(async (_opts: unknown, cmd: Command) => {
    try {
      const { profile: p } = await clientFor(cmd).profileGet();
      output({ profile: p }, () => {
        const billing = p.billing as Record<string, string | null>;
        const shipping = p.shipping as Record<string, string | null>;
        printKV([
          ["Email", String(p.email)],
          ["Cég", p.companyName as string | null],
          ["Adószám", p.taxNumber as string | null],
          ["Név", p.firstName as string | null],
          ["Telefon", p.phone as string | null],
          ["Weboldal", p.website as string | null],
        ]);
        process.stdout.write("\nSzámlázási cím:\n");
        printKV(
          Object.entries(billing).map(([k, v]) => [`  billing.${k}`, v] as [string, string | null]),
        );
        process.stdout.write("\nSzállítási cím:\n");
        printKV(
          Object.entries(shipping).map(([k, v]) => [`  shipping.${k}`, v] as [string, string | null]),
        );
      });
    } catch (err) {
      fail(err);
    }
  });

/** profile set kulcs-lekepezes: szekcio.mezo -> API mezonev. */
const CONTACT_FIELD_MAP: Record<string, string> = {
  firstName: "firstName",
  phone: "phone",
  website: "website",
  company: "companyName",
  taxNumber: "taxNumber",
};
const ADDRESS_FIELD_NAMES = [
  "firstName",
  "lastName",
  "company",
  "address1",
  "address2",
  "city",
  "postcode",
  "state",
  "country",
  "email",
  "phone",
] as const;

profile
  .command("set <mezo=ertek...>")
  .description(
    "adatmodositas, pl.: keypro profile set billing.city=Budapest contact.phone=+36201234567 (ures ertek torol)",
  )
  .action(async (pairs: string[], _opts: unknown, cmd: Command) => {
    try {
      const patch: Record<string, string> = {};
      for (const pair of pairs) {
        const eq = pair.indexOf("=");
        if (eq === -1) {
          usageError(`Hibás megadás: "${pair}" (mezo=ertek formát várunk).`);
        }
        const keyName = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1);
        const [section, field] = keyName.split(".", 2);
        if (!field) {
          usageError(
            `Hibás mező: "${keyName}". Formátum: contact.*, billing.*, shipping.* (pl. billing.city)`,
          );
        }
        if (section === "contact") {
          const mapped = CONTACT_FIELD_MAP[field];
          if (!mapped) {
            usageError(
              `Ismeretlen contact mező: ${field}. Lehetséges: ${Object.keys(CONTACT_FIELD_MAP).join(", ")}`,
            );
          }
          patch[mapped] = value;
        } else if (section === "billing" || section === "shipping") {
          if (!(ADDRESS_FIELD_NAMES as readonly string[]).includes(field)) {
            usageError(
              `Ismeretlen ${section} mező: ${field}. Lehetséges: ${ADDRESS_FIELD_NAMES.join(", ")}`,
            );
          }
          if (section === "shipping" && field === "email") {
            usageError("A szállítási címhez nincs email mező.");
          }
          patch[section + field[0].toUpperCase() + field.slice(1)] = value;
        } else {
          usageError(
            `Ismeretlen szekció: ${section}. Lehetséges: contact, billing, shipping`,
          );
        }
      }
      const result = await clientFor(cmd).profileUpdate(patch);
      output(result, () => {
        process.stdout.write(
          `Frissítve: ${result.updated.join(", ")}\n`,
        );
      });
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

program
  .command("rate")
  .description("Aktuális EUR/HUF árfolyam (amit a webshop használ és megjelenít)")
  .action(async (_opts: unknown, cmd: Command) => {
    try {
      const result = await clientFor(cmd).exchangeRate();
      output(result, () => {
        printKV([
          ["EUR -> HUF", `${result.rate.toFixed(2)} Ft`],
          ["ECB referencia (felár nélkül)", `${result.referenceRate.toFixed(2)} Ft`],
          ["Felár", `${result.markupPct}%`],
          ["1 HUF -> EUR", result.hufToEur.toFixed(6)],
          ["Forrás", result.source],
        ]);
      });
    } catch (err) {
      fail(err);
    }
  });

const wallet = program.command("wallet").description("KEP egyenleg");

wallet.action(async (_opts: unknown, cmd: Command) => {
  try {
    const result = await clientFor(cmd).wallet({ limit: 1 });
    output({ balanceEurNet: result.balanceEurNet }, () => {
      printKV([["KEP egyenleg (nettó)", eurFmt(result.balanceEurNet)]]);
    });
  } catch (err) {
    fail(err);
  }
});

wallet
  .command("transactions")
  .description("KEP tranzakcio-tortenet")
  .option("--limit <n>", "darabszam", "25")
  .action(async (opts: { limit: string }, cmd: Command) => {
    try {
      const result = await clientFor(cmd).wallet({ limit: Number(opts.limit) });
      output(result, () => {
        printKV([["KEP egyenleg (nettó)", eurFmt(result.balanceEurNet)]]);
        process.stdout.write("\n");
        printTable(
          ["Dátum", "Típus", "Összeg EUR", "Egyenleg utána", "Rendelés", "Megjegyzés"],
          result.transactions.map((tx) => [
            String(tx.createdAt).slice(0, 10),
            String(tx.typeLabel),
            Number(tx.amountEur).toFixed(2),
            Number(tx.balanceAfterEur).toFixed(2),
            tx.orderNumber ? `#${tx.orderNumber}` : "-",
            tx.description ? String(tx.description) : "-",
          ]),
        );
      });
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Kartyak, csomagpontok
// ---------------------------------------------------------------------------

const cards = program.command("cards").description("mentett bankkartyak");

cards
  .command("list")
  .description("mentett kartyak (kartyat felvenni a weben lehet)")
  .action(async (_opts: unknown, cmd: Command) => {
    try {
      const result = await clientFor(cmd).cardsList();
      output(result, () => {
        if (!result.stripeEnabled) {
          process.stdout.write(
            "A kártyás fizetés ezen a környezeten nincs bekötve.\n",
          );
          return;
        }
        if (result.cards.length === 0) {
          process.stdout.write(
            "Nincs mentett kártya. Kártyát a weben tudsz menteni: /payment-methods\n",
          );
          return;
        }
        printTable(
          ["ID", "Kártya", "Lejárat", "Alapértelmezett"],
          result.cards.map((card) => [
            card.id,
            `${card.brand} **** ${card.last4}`,
            `${card.expMonth}/${card.expYear}`,
            card.isDefault ? "igen" : "",
          ]),
        );
      });
    } catch (err) {
      fail(err);
    }
  });

const parcelshops = program
  .command("parcelshops")
  .description("GLS atveteli pontok");

parcelshops
  .command("search <keresoszo>")
  .description("csomagpont/automata kereses (varos, iranyitoszam vagy nev)")
  .option("--type <tipus>", "parcel-shop | parcel-locker | all", "all")
  .action(async (query: string, opts: { type: string }, cmd: Command) => {
    try {
      const result = await clientFor(cmd).parcelshopsSearch(query, opts.type);
      output(result, () => {
        printTable(
          ["ID", "Név", "Típus", "Cím"],
          result.parcelshops.map((p) => [
            String(p.id),
            String(p.name),
            p.type === "parcel-locker" ? "automata" : "csomagpont",
            `${p.postcode} ${p.city}, ${p.address}`,
          ]),
        );
        if (result.truncated) {
          process.stdout.write("\n(a lista csonkolva - pontosítsd a keresést)\n");
        }
      });
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Agent docs + MCP
// ---------------------------------------------------------------------------

program
  .command("agent-docs")
  .description("beepitett utmutato AI-agenteknek (angol)")
  .action(() => {
    process.stdout.write(AGENT_DOCS);
  });

program
  .command("mcp")
  .description("MCP stdio szerver mod (Claude Code: claude mcp add keypro -- keypro mcp)")
  .action(async (_opts: unknown, cmd: Command) => {
    const cfg = resolved(cmd);
    if (!cfg.apiKey) {
      process.stderr.write(
        "Nincs API kulcs. Futtasd elobb: keypro login (vagy KEYPRO_API_KEY env).\n",
      );
      process.exit(3);
    }
    await runMcpServer(createClient({ apiBase: cfg.apiBase, apiKey: cfg.apiKey }));
  });

program.parseAsync(process.argv).catch((err) => {
  fail(err);
});
