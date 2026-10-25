import { describe, expect, it } from "vitest";
import en from "grapesjs/locale/en.mjs";
import { I18N_CONFIG, TR_ADDITIONS, TR_CORE, TR_MESSAGES, mergeMessages } from "./locale-tr";

type Tree = { [k: string]: string | Tree };
const flat = (o: Tree, p = ""): Array<[string, string]> =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));

const EN = new Map(flat(en as Tree));
const TR = new Map(flat(TR_MESSAGES));

describe("tasarımcı Türkçe dil dosyası", () => {
  it("körlük zemini: GrapesJS en dosyası okundu", () => {
    expect(EN.size).toBeGreaterThanOrEqual(90);
  });

  it("⭐ en'deki HER anahtarın Türkçe karşılığı var (çekirdek tr + ekler)", () => {
    const missing = [...EN.keys()].filter((k) => !TR.has(k));
    expect(missing).toEqual([]);
  });

  it("⭐ Türkçe değer İngilizce kaynağın kopyası değil", () => {
    // Türkçede de aynı yazılan kelimeler (ölçüldü: yalnız "Video").
    const SAME_IN_TURKISH = new Set(["Video"]);
    const same = [...EN.entries()]
      .filter(([k, v]) => TR.get(k) === v && /[a-z]{3}/i.test(v) && !SAME_IN_TURKISH.has(v))
      .map(([k]) => k);
    expect(same).toEqual([]);
  });

  it("çekirdekteki İngilizce kalıntılar ezildi (Margin/Padding/Font)", () => {
    expect(TR.get("styleManager.properties.margin")).toBe("Dış boşluk");
    expect(TR.get("styleManager.properties.padding")).toBe("İç boşluk");
    expect(TR.get("styleManager.properties.font-family")).toBe("Yazı tipi");
  });

  it("sektör adı i18n ile ezilmez: paketteki `layout: Düzen` yerine Yerleşim (e2e BT4 ölçtü)", () => {
    expect(TR.get("styleManager.sectors.layout")).toBe("Yerleşim");
  });

  it("ekler çekirdeği bozmaz: çekirdekte olup eklerde olmayan değer korunur", () => {
    expect(TR.get("styleManager.empty")).toBe(flat(TR_CORE as Tree).find(([k]) => k === "styleManager.empty")?.[1]);
    expect(mergeMessages({ a: { b: "1", c: "2" } }, { a: { b: "3" } })).toEqual({ a: { b: "3", c: "2" } });
  });

  it("dil tarayıcıdan algılanmaz, her zaman tr", () => {
    expect(I18N_CONFIG).toMatchObject({ locale: "tr", localeFallback: "tr", detectLocale: false });
    expect(Object.keys(TR_ADDITIONS).length).toBeGreaterThan(0);
  });
});
