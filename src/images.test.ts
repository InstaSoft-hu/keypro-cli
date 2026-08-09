import { describe, it, expect } from "vitest";
import { featuredImage, imageUrlLines, parseProductImages } from "./images.js";

const WELL_FORMED = {
  id: 123,
  images: [
    { url: "https://keypro.hu/uploads/a.png", alt: "Fo kep", position: 0 },
    { url: "https://keypro.hu/uploads/b.png", alt: null, position: 1 },
  ],
};

describe("parseProductImages", () => {
  it("jol formazott tomb: sorrend es mezok valtozatlanul", () => {
    expect(parseProductImages(WELL_FORMED)).toEqual([
      { url: "https://keypro.hu/uploads/a.png", alt: "Fo kep", position: 0 },
      { url: "https://keypro.hu/uploads/b.png", alt: null, position: 1 },
    ]);
  });

  it("REGI KISZOLGALO: nincs images mezo -> ures tomb, nem hiba", () => {
    expect(parseProductImages({ id: 1, name: "Termek" })).toEqual([]);
  });

  it("images: null -> ures tomb", () => {
    expect(parseProductImages({ images: null })).toEqual([]);
  });

  it("images: ures tomb -> ures tomb", () => {
    expect(parseProductImages({ images: [] })).toEqual([]);
  });

  it("url nelkuli (vagy nem string urlu) elem kimarad, a tobbi megmarad", () => {
    const parsed = parseProductImages({
      images: [
        { alt: "url nelkul", position: 0 },
        { url: 42, position: 1 },
        { url: "   ", position: 2 },
        null,
        "https://keypro.hu/uploads/nem-objektum.png",
        { url: "https://keypro.hu/uploads/jo.png", position: 5 },
      ],
    });
    expect(parsed).toEqual([
      { url: "https://keypro.hu/uploads/jo.png", alt: null, position: 5 },
    ]);
  });

  it("hianyzo vagy nem szam position: a megtartott elemek sorszama lep a helyebe", () => {
    expect(
      parseProductImages({
        images: [
          { url: "https://keypro.hu/uploads/a.png" },
          { url: "https://keypro.hu/uploads/b.png", position: "2" },
        ],
      }),
    ).toEqual([
      { url: "https://keypro.hu/uploads/a.png", alt: null, position: 0 },
      { url: "https://keypro.hu/uploads/b.png", alt: null, position: 1 },
    ]);
  });

  it("nem objektum bemenet (null, string, tomb nelkuli valasz) -> ures tomb", () => {
    expect(parseProductImages(null)).toEqual([]);
    expect(parseProductImages("termek")).toEqual([]);
    expect(parseProductImages(undefined)).toEqual([]);
    expect(parseProductImages({ images: "https://keypro.hu/uploads/a.png" })).toEqual([]);
  });

  it("ures alt szovegbol null lesz", () => {
    expect(
      parseProductImages({ images: [{ url: "https://keypro.hu/uploads/a.png", alt: "  " }] })[0]
        .alt,
    ).toBeNull();
  });
});

describe("featuredImage", () => {
  it("az elso elem a fo kep", () => {
    expect(featuredImage(parseProductImages(WELL_FORMED))?.url).toBe(
      "https://keypro.hu/uploads/a.png",
    );
  });

  it("kep nelkul null", () => {
    expect(featuredImage([])).toBeNull();
  });
});

describe("imageUrlLines (a `products images` kimenete)", () => {
  it("soronkent EGY abszolut URL, semmi mas", () => {
    expect(imageUrlLines(parseProductImages(WELL_FORMED))).toBe(
      "https://keypro.hu/uploads/a.png\nhttps://keypro.hu/uploads/b.png\n",
    );
  });

  it("kep nelkul ures kimenet - nem ures sor", () => {
    expect(imageUrlLines([])).toBe("");
  });
});

/**
 * A CLI SAJAT kimeneti szerzodese: "soronkent EGY abszolut URL". A szerver ma
 * mar nem ad ki sortorest tartalmazo erteket (`isImageRef` fail-closed), de a
 * CLI TAVOLI - akar regebbi vagy idegen - telepitest hiv, es a sajat kimenete
 * akkor sem toredezhet ket sorra: a dokumentalt `| xargs -n1 curl -O` egy
 * MASODIK, nem a bolttol szarmazo cimet toltene le.
 */
describe("sortoro URL - a soronkent egy URL szerzodes", () => {
  const HOSTILE = {
    images: [
      {
        url: "https://keypro.hu/uploads/a.png\nhttps://tamado.pelda/x.png",
        alt: null,
        position: 0,
      },
      { url: "https://keypro.hu/uploads/jo.png", alt: null, position: 1 },
    ],
  };

  it("a sortorest tartalmazo elem mar a beolvasasnal kimarad", () => {
    expect(parseProductImages(HOSTILE)).toEqual([
      { url: "https://keypro.hu/uploads/jo.png", alt: null, position: 1 },
    ]);
  });

  it("a kimenet SOSEM ad tobb sort, mint ahany kep van", () => {
    const out = imageUrlLines(parseProductImages(HOSTILE));
    expect(out).toBe("https://keypro.hu/uploads/jo.png\n");
    expect(out.split("\n").filter((line) => line !== "")).toHaveLength(1);
    expect(out).not.toContain("tamado.pelda");
  });

  it("a fokep sem lehet tobb soros (a `products get` egy SORBA irja)", () => {
    const featured = featuredImage(parseProductImages(HOSTILE));
    expect(featured?.url).toBe("https://keypro.hu/uploads/jo.png");
  });

  it("kocsivissza es sor-elvalaszto is kizarva", () => {
    expect(
      parseProductImages({
        images: [
          { url: "https://keypro.hu/a.png\rhttps://tamado.pelda/x.png" },
          { url: "https://keypro.hu/b.png\u2028https://tamado.pelda/x.png" },
          { url: "https://keypro.hu/c.png\u2029https://tamado.pelda/x.png" },
        ],
      }),
    ).toEqual([]);
  });
});

/**
 * A SZOKOZ ugyanolyan hasitas, mint a sorveg. Az `xargs` alapertelmezesben a
 * szokozon ES a tabon IS hasit, tehat egy EGY SOROS, szokozzel osszefuzott
 * ertek ugyanugy ket letoltest inditana - a masodikat a tamado valasztana.
 * A csak sorvegre nezo szabaly ezt atengedte.
 */
describe("szokoz es tab az URL-ben - ugyanaz a hasitas, mint a sorveg", () => {
  const HOSTILE = {
    images: [
      {
        url: "https://keypro.hu/uploads/ok.png https://tamado.pelda/rossz.png",
        alt: null,
        position: 0,
      },
      {
        url: "https://keypro.hu/uploads/ok2.png\thttps://tamado.pelda/rossz2.png",
        alt: null,
        position: 1,
      },
      { url: "https://keypro.hu/uploads/jo.png", alt: null, position: 2 },
    ],
  };

  it("a szokozzel vagy tabbal osszefuzott ket cim mar a beolvasasnal kimarad", () => {
    expect(parseProductImages(HOSTILE)).toEqual([
      { url: "https://keypro.hu/uploads/jo.png", alt: null, position: 2 },
    ]);
  });

  it("a kimenet egyetlen sora sem tartalmaz idegen cimet", () => {
    const out = imageUrlLines(parseProductImages(HOSTILE));
    expect(out).toBe("https://keypro.hu/uploads/jo.png\n");
    expect(out).not.toContain("tamado.pelda");
    // Amit az `xargs -n1` argumentumnak latna: pontosan egy.
    expect(out.split(/\s+/).filter((token) => token !== "")).toHaveLength(1);
  });

  it("a fokep sem lehet ket argumentum (a `products get` egy SORBA irja)", () => {
    expect(featuredImage(parseProductImages(HOSTILE))?.url).toBe(
      "https://keypro.hu/uploads/jo.png",
    );
  });

  it("a JSON korulvagast (vezeto/zaro szokoz) tovabbra is elviseljuk", () => {
    expect(
      parseProductImages({
        images: [{ url: "  https://keypro.hu/uploads/jo.png  " }],
      }),
    ).toEqual([{ url: "https://keypro.hu/uploads/jo.png", alt: null, position: 0 }]);
  });
});
