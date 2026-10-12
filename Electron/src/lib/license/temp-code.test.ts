import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TEMP_ALPHABET,
  TEMP_CODE_GROUP,
  TEMP_CODE_GROUPS,
  TEMP_CODE_LENGTH,
  TEMP_CODE_PREFIX,
  checkTempGroups,
  normalizeTempCode,
  normalizeTempGroup,
  splitTempGroups,
  tempGroupOfPosition,
  tempOpeningBand,
} from "./temp-code";

// Geçerli biçimde 115 karakter (sağlamayı backend denetler; burada yalnız yazım yardımı sınanır).
const BODY = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".repeat(4).slice(0, TEMP_CODE_LENGTH);
const GROUPED = `TG-${BODY.match(/.{5}/g)!.join("-")}`;

describe("geçici açılış kodu — backend protokol aynası", () => {
  const src = readFileSync(resolve(process.cwd(), "..", "Teks-Erp", "src", "lib", "license", "protocol", "gecici-kod.ts"), "utf8");
  it("alfabe, ön ek, grup ve uzunluk backend ile aynı", () => {
    expect(TEMP_ALPHABET).toBe(/const ALPHABET = "([0-9A-Z]+)";/.exec(src)?.[1]);
    expect(TEMP_CODE_PREFIX).toBe(/export const TEMP_CODE_PREFIX = "([A-Z]+)";/.exec(src)?.[1]);
    expect(TEMP_CODE_GROUP).toBe(Number(/export const TEMP_CODE_GROUP = (\d+);/.exec(src)?.[1]));
    expect(TEMP_CODE_LENGTH).toBe(Number(/export const TEMP_CODE_LENGTH = (\d+);/.exec(src)?.[1]));
    expect(TEMP_CODE_GROUPS).toBe(23);
  });
});

describe("normalizasyon", () => {
  it("küçük harf büyür; O→0, I/L→1; tire, boşluk, nokta atılır; TG ön eki atılır", () => {
    expect(normalizeTempCode("tg-o1il a.b_c")).toBe("0111ABC");
    expect(normalizeTempCode(GROUPED)).toBe(BODY);
  });
  it("kutu yazımı ön eki ATMAZ (kutuda TG geçerli karakterdir)", () => {
    expect(normalizeTempGroup("tg o1l")).toBe("TG011");
  });
  it("alfabe dışı karakter korunur ki yeri gösterilebilsin", () => {
    expect(normalizeTempCode("AB-UÇ")).toBe("ABUÇ");
  });
});

describe("bölüştürme ve biçim doğrulaması", () => {
  it("tam kod 23 kutuya bölünür ve geçerli sayılır", () => {
    const g = splitTempGroups(GROUPED.toLowerCase());
    expect(g).toHaveLength(23);
    expect(g.every((x) => x.length === 5)).toBe(true);
    expect(checkTempGroups(g)).toEqual({ ok: true, kod: GROUPED });
  });
  it("tiresiz/boşluklu yapıştırma aynı sonuca iner", () => {
    expect(splitTempGroups(BODY.replace(/(.{10})/g, "$1 "))).toEqual(splitTempGroups(GROUPED));
  });
  it("boşken ileti yok", () => {
    expect(checkTempGroups(splitTempGroups(""))).toMatchObject({ ok: false, kind: "BOS", message: null });
  });
  it("eksik grup: sırası ve ileti", () => {
    const g = splitTempGroups(BODY.slice(0, 57));
    expect(checkTempGroups(g)).toMatchObject({ ok: false, kind: "EKSIK", group: 11 });
  });
  it("geçersiz karakter: kutusu ve karakteri (U Crockford'da yok)", () => {
    const g = splitTempGroups(GROUPED);
    g[4] = "AB" + "U" + "CD";
    const c = checkTempGroups(g);
    expect(c).toMatchObject({ ok: false, kind: "KARAKTER", group: 4 });
    expect(!c.ok && c.message).toContain("5. grupta geçersiz karakter: “U”");
  });
  it("backend konumu → kutu", () => {
    expect(tempGroupOfPosition(0)).toBe(0);
    expect(tempGroupOfPosition(4)).toBe(0);
    expect(tempGroupOfPosition(5)).toBe(1);
    expect(tempGroupOfPosition(114)).toBe(22);
  });
});

describe("geçici etkinlik bandı", () => {
  const gecici = { bitis: "2026-11-10T23:59:59.999Z", kalanGun: 29, kodSonu: "AB12" };
  it("zorla kipinde metin + kalan gün", () => {
    expect(tempOpeningBand({ kip: "zorla", gecici })).toEqual({
      metin: expect.stringContaining("…AB12") as unknown as string,
      gun: "Geçici kod: 29 gün",
    });
  });
  it("süre dolunca gün yerine 'süresi doldu'", () => {
    expect(tempOpeningBand({ kip: "zorla", gecici: { ...gecici, kalanGun: 0 } })?.gun).toBe("Geçici kod süresi doldu");
  });
  it("gözlem kipinde ya da alan yokken (eski backend) bant yok", () => {
    expect(tempOpeningBand({ kip: "gozlem", gecici })).toBeNull();
    expect(tempOpeningBand({ kip: "zorla" })).toBeNull();
    expect(tempOpeningBand(null)).toBeNull();
  });
});
