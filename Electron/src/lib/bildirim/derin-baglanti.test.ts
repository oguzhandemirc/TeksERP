// Derin bağlantı ölçümü: backend bildirim kataloğundaki her `panelYol` (ve yer tutucusu boşken düşülen
// `/<panelEkran>`) panelde gerçek bir rotaya çıkar. Katalog yeni tür/rota eklediğinde kırmızı verir.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { matchPath } from "react-router-dom";
import { describe, expect, it } from "vitest";

const oku = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
// Katalog tek nesnedir ama boyut yüzünden parça dosyalara yayılır (D4-I5 `notification-catalog-cari.ts`).
const katalog = ["notification-catalog.ts", "notification-catalog-cari.ts", "notification-catalog-sevkiyat.ts"]
  .map((f) => oku(`../../../../Teks-Erp/src/constants/${f}`))
  .join("\n");
const rotalar = [...oku("../../routes/content-routes.tsx").matchAll(/path:\s*"([^"]+)"/g)]
  .map((m) => m[1]!)
  .filter((p) => p !== "*" && !p.includes("*"));

const turler = [...katalog.matchAll(/panelEkran:\s*"([^"]+)",\s*panelYol:\s*"([^"]+)"/g)].map((m) => ({
  ekran: m[1]!,
  yol: m[2]!,
}));

/** `{siparisId}` → örnek değer; sorgu dizgesi rota eşleşmesine katılmaz. */
function ornekYol(yol: string): string {
  return yol.replace(/\{[^}]+\}/g, "ornek-1").split("?")[0]!;
}
const rotaVar = (yol: string) => rotalar.some((r) => matchPath({ path: `/${r}`, end: true }, yol) !== null);

describe("bildirim derin bağlantıları", () => {
  it("körlük zemini: katalog ve rota taraması dolu", () => {
    expect(turler.length).toBeGreaterThanOrEqual(10);
    expect(rotalar.length).toBeGreaterThan(100);
    // Katalogdaki her panelYol satırı ayrıştırıldı (biçim kayarsa tarama sessizce eksilmesin).
    expect(turler.length).toBe([...katalog.matchAll(/panelYol:\s*"/g)].length);
  });

  it("her tür panelde açılan bir rotaya gider", () => {
    const eksik = turler.filter((t) => !rotaVar(ornekYol(t.yol))).map((t) => t.yol);
    expect(eksik).toEqual([]);
  });

  it("yer tutucusu boş kalırsa düşülen /<panelEkran> da rotadır", () => {
    const eksik = turler
      .filter((t) => /\{[^}]+\}/.test(t.yol) && !rotaVar(`/${t.ekran}`))
      .map((t) => t.ekran);
    expect(eksik).toEqual([]);
  });

  it("sonda: var olmayan yol eşleşmez", () => {
    expect(rotaVar("/operations/olmayan-ekran")).toBe(false);
  });
});
