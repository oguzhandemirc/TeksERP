import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPO_FONT_STYLE_ID,
  fontFaceRule,
  fontUri,
  preregisterIconFonts,
  type FontDocumentLike,
  type FontRuleLike,
} from "../src/lib/web-icon-font";

const URI = "/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.abc123.ttf";

/** Sahte belge: `<style>` sayfası belgeye bağlanınca doğar (tarayıcıdaki gibi); metin düğümü yaratımı izlenir. */
function sahteBelge(onceden?: { kurallar: FontRuleLike[] }) {
  const eklenen: string[] = [];
  const kurallar: FontRuleLike[] = onceden?.kurallar ?? [];
  const sheet = {
    cssRules: kurallar,
    insertRule: jest.fn((r: string, i?: number) => {
      eklenen.push(r);
      const aile = /font-family:"([^"]+)"/.exec(r)?.[1];
      kurallar.splice(i ?? 0, 0, { style: { fontFamily: aile } });
      return i ?? 0;
    }),
  };
  const yarat = () => {
    const el = { id: "", isConnected: false, sheet: null as typeof sheet | null, appendChild: jest.fn(), textContent: "" };
    return el;
  };
  const elemanlar = new Map<string, ReturnType<typeof yarat>>();
  if (onceden) {
    const el = yarat();
    el.id = EXPO_FONT_STYLE_ID;
    el.isConnected = true;
    el.sheet = sheet;
    elemanlar.set(el.id, el);
  }
  const createTextNode = jest.fn();
  const head = {
    appendChild: jest.fn((el: ReturnType<typeof yarat>) => {
      el.isConnected = true;
      el.sheet = sheet;
      elemanlar.set(el.id, el);
      return el;
    }),
  };
  const doc = {
    head,
    createTextNode,
    getElementById: (id: string) => elemanlar.get(id) ?? null,
    createElement: jest.fn(() => yarat()),
  };
  return { doc: doc as unknown as FontDocumentLike & typeof doc, sheet, eklenen, elemanlar, createTextNode };
}

describe("web ikon fontu CSSOM önkaydı", () => {
  it("web'de expo-font'un <style> öğesini yaratır ve kuralı insertRule ile ekler; metin düğümü yok", () => {
    const b = sahteBelge();
    expect(preregisterIconFonts("web", b.doc, [{ ionicons: URI }])).toEqual(["ionicons"]);
    expect(b.eklenen).toEqual([`@font-face{font-family:"ionicons";src:url("${URI}");font-display:auto}`]);
    const el = b.elemanlar.get(EXPO_FONT_STYLE_ID)!;
    expect(el.isConnected).toBe(true);
    expect(el.appendChild).not.toHaveBeenCalled();
    expect(el.textContent).toBe("");
    expect(b.createTextNode).not.toHaveBeenCalled();
  });

  it("aynı aile zaten kayıtlıysa yeniden eklemez (çift çağrı / Fast Refresh)", () => {
    const b = sahteBelge();
    preregisterIconFonts("web", b.doc, [{ ionicons: URI }]);
    expect(preregisterIconFonts("web", b.doc, [{ ionicons: URI }])).toEqual([]);
    expect(b.sheet.insertRule).toHaveBeenCalledTimes(1);
    expect(b.doc.head!.appendChild).toHaveBeenCalledTimes(1);
  });

  it("var olan öğenin sayfasını kullanır; tırnaklı aile adını da kayıtlı sayar", () => {
    const b = sahteBelge({ kurallar: [{ style: { fontFamily: '"ionicons"' } }] });
    expect(preregisterIconFonts("web", b.doc, [{ ionicons: URI, diger: { uri: "/x.ttf" } }])).toEqual(["diger"]);
    expect(b.doc.createElement).not.toHaveBeenCalled();
    expect(b.doc.head!.appendChild).not.toHaveBeenCalled();
  });

  it("web dışında ve belge yokken hiçbir şeye dokunmaz", () => {
    const b = sahteBelge();
    expect(preregisterIconFonts("android", b.doc, [{ ionicons: URI }])).toEqual([]);
    expect(preregisterIconFonts("ios", b.doc, [{ ionicons: URI }])).toEqual([]);
    expect(preregisterIconFonts("web", undefined, [{ ionicons: URI }])).toEqual([]);
    expect(b.doc.createElement).not.toHaveBeenCalled();
    expect(b.sheet.insertRule).not.toHaveBeenCalled();
  });

  it("çözülemeyen kaynak (yerel varlık numarası) atlanır, expo-font'a kalır", () => {
    expect(fontUri(42)).toBeNull();
    expect(fontUri("")).toBeNull();
    expect(fontUri({ uri: URI })).toBe(URI);
    const b = sahteBelge();
    expect(preregisterIconFonts("web", b.doc, [{ ionicons: 42 }])).toEqual([]);
    expect(b.sheet.insertRule).not.toHaveBeenCalled();
  });
});

describe("expo-font ile sözleşme (sürüm kayması bekçisi)", () => {
  const kaynak = readFileSync(join(__dirname, "..", "node_modules", "expo-font", "build", "ExpoFontLoader.web.js"), "utf8");

  it("expo-font aynı <style> kimliğinde arar ve metin düğümüyle enjekte eder (önkaydın gerekçesi)", () => {
    expect(kaynak).toContain(`const ID = '${EXPO_FONT_STYLE_ID}';`);
    expect(kaynak).toMatch(/getFontFaceRulesMatchingResource\(fontFamilyName, resource\);\s*if \(!res\.length\)/);
  });

  it("kural metni expo-font _createWebFontTemplate ile bayt-eşit", () => {
    const m = /export function _createWebFontTemplate[\s\S]*?return `([^`]+)`;/.exec(kaynak);
    expect(m?.[1]).toBe("@font-face{font-family:${JSON.stringify(fontFamily)};src:url(${JSON.stringify(resource.uri)});font-display:${display}}");
    expect(fontFaceRule("ionicons", URI)).toBe(
      `@font-face{font-family:${JSON.stringify("ionicons")};src:url(${JSON.stringify(URI)});font-display:auto}`,
    );
  });

  it("giriş: önkayıt yönlendiriciden önce içe aktarılır ve Ionicons.font'u geçirir", () => {
    const giris = readFileSync(join(__dirname, "..", "entry.ts"), "utf8");
    const i = giris.indexOf('import "./src/web-icon-font";');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(giris.indexOf('import "expo-router/entry";'));
    const modul = readFileSync(join(__dirname, "..", "src", "web-icon-font.ts"), "utf8");
    expect(modul).toContain("[Ionicons.font]");
  });
});
