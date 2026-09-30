import { readFileSync } from "node:fs";
import path from "node:path";
import { fixWebLocation, foldSlashes, normalizedWebUrl, type WebWindowLike } from "../src/lib/web-path";

function sahte(pathname: string, search = "", hash = "") {
  const cagri: { data: unknown; url: string | undefined }[] = [];
  const w: WebWindowLike = {
    location: { pathname, search, hash },
    history: { state: { idx: 3 }, replaceState: (data, _u, url) => void cagri.push({ data, url }) },
  };
  return { w, cagri };
}

describe("web adresi: fazla eğik çizgi katlaması", () => {
  it("ardışık eğik ve ters eğik çizgi tek '/'ye katlanır", () => {
    expect(foldSlashes("//")).toBe("/");
    expect(foldSlashes("///")).toBe("/");
    expect(foldSlashes("/cariler//x")).toBe("/cariler/x");
    expect(foldSlashes("//cariler///x//")).toBe("/cariler/x/");
    expect(foldSlashes("/\\cariler\\x")).toBe("/cariler/x");
    expect(foldSlashes("")).toBe("/");
  });

  it("temiz yola dokunulmaz (null) — sondaki tek '/' dahil", () => {
    expect(normalizedWebUrl({ pathname: "/", search: "", hash: "" })).toBeNull();
    expect(normalizedWebUrl({ pathname: "/cariler/x", search: "?a=1", hash: "#b" })).toBeNull();
    expect(normalizedWebUrl({ pathname: "/cariler/", search: "", hash: "" })).toBeNull();
    expect(normalizedWebUrl({ pathname: "/a%2F%2Fb", search: "", hash: "" })).toBeNull();
  });

  it("sorgu ve hash korunur; sonuç başka kökene işaret edemez", () => {
    expect(normalizedWebUrl({ pathname: "//cariler//x", search: "?q=a//b", hash: "#h//" })).toBe("/cariler/x?q=a//b#h//");
    const kotu = normalizedWebUrl({ pathname: "//evil.example/x", search: "", hash: "" });
    expect(kotu).toBe("/evil.example/x");
    expect(kotu?.startsWith("//")).toBe(false);
  });

  it("web'de gerekiyorsa replaceState bir kez, durum nesnesi korunarak", () => {
    const { w, cagri } = sahte("//", "?davet=abc", "#x");
    expect(fixWebLocation("web", w)).toBe(true);
    expect(cagri).toEqual([{ data: { idx: 3 }, url: "/?davet=abc#x" }]);
  });

  it("temiz yolda, web dışı platformda ya da pencere yokken hiçbir şey yazılmaz", () => {
    const temiz = sahte("/cariler/x");
    expect(fixWebLocation("web", temiz.w)).toBe(false);
    expect(temiz.cagri).toHaveLength(0);
    for (const os of ["ios", "android"]) {
      const s = sahte("//cariler//x");
      expect(fixWebLocation(os, s.w)).toBe(false);
      expect(s.cagri).toHaveLength(0);
    }
    expect(fixWebLocation("web", undefined)).toBe(false);
    expect(fixWebLocation("web", {})).toBe(false);
  });

  it("giriş sırası: katlama modülü yönlendiriciden ÖNCE içe aktarılır", () => {
    const kok = path.join(__dirname, "..");
    const paket = JSON.parse(readFileSync(path.join(kok, "package.json"), "utf8")) as { main?: string };
    expect(paket.main).toBe("entry.ts");
    const aktarimlar = [...readFileSync(path.join(kok, "entry.ts"), "utf8").matchAll(/^import\s+"([^"]+)";/gm)].map((m) => m[1]);
    expect(aktarimlar).toEqual(["@expo/metro-runtime", "./src/web-path-fix", "expo-router/entry"]);
  });
});
