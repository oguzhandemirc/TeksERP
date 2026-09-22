// =============================================================================
// BEKÇİ — İADE BELGE NO PANELDE: OKUNUR, TÜRETİLMEZ
// =============================================================================
// Backend her iade satırına KENDİ BELGESİNİN numarasını koyuyor (çok kalemli
// iadede üye satırlar liderin numarasının kopyasını taşır). Panelin işi yalnız
// OKUMAK.
//
// ⚠️ NEDEN BEKÇİ GEREKİYOR: "lider kim" kuralı bir kez daha istemciye
// kopyalanırsa iki yerde iki kural yaşar ve kopyalamayan/güncellenmeyen
// yüzeyde SESSİZLİK doğar — `withDocumentSourceId`in backend'deki başlığı bu
// dersi zaten yazıyor ("kopyalamayan istemcide 'irsaliye yok' sessizliği").
//
//   §1 Sütun ve detay AYNI alanı okur (`returnNo`), türetim/yedek mantık YOK
//   §2 ⭐ Panelde `returnGroupId`/lider çözümleyen bir ifade YOK
//   §3 Numara yoksa yüzey "—" gösterir (uydurmaz)
//
// ⭐ NEGATİF SONDA (2026-09-22, ölçüldü): sütun hücresine
//    `row.original.returnNo ?? row.original.documentSourceId` yedeği eklenince
//    §2 ❌; `returnNo` alanı satır tipinden silinince tsc kırmızı.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const oku = (ad: string): string => readFileSync(resolve(__dirname, ad), "utf8");
const KOLONLAR = oku("returnsColumns.tsx");
const DETAY = oku("ReturnsDetailSheet.tsx");
const SERVIS = oku("service.ts");

describe("İade belge no — panel yalnız OKUR", () => {
  it("§1 sütun ve detay AYNI alanı okuyor", () => {
    expect(KOLONLAR).toContain("row.original.returnNo");
    expect(DETAY).toContain("row.returnNo");
    expect(SERVIS).toContain("returnNo: string | null");
  });

  it("§1 körlük zemini: dosyalar gerçekten okundu", () => {
    expect(KOLONLAR.length).toBeGreaterThan(500);
    expect(DETAY.length).toBeGreaterThan(500);
  });

  it("⭐ §2 panelde LİDER ÇÖZÜMLEYEN ifade YOK (kural iki yerde yaşamasın)", () => {
    // `returnGroupId ?? id`, `documentSourceId` üstünden numara türetme, ya da
    // `returnNo`ya yedek arama — üçü de aynı sınıftır.
    for (const kaynak of [KOLONLAR, DETAY]) {
      expect(kaynak).not.toMatch(/returnNo\s*\?\?/);
      expect(kaynak).not.toMatch(/returnGroupId/);
      expect(kaynak).not.toMatch(/documentSourceId/);
    }
  });

  it("⭐ §2 panel numarayı KENDİ KURMUYOR (biçimlendirici yok)", () => {
    for (const kaynak of [KOLONLAR, DETAY]) {
      expect(kaynak).not.toContain("IADE-");
    }
  });

  it("§3 numara yoksa yüzey '—' gösterir (uydurmaz)", () => {
    expect(KOLONLAR).toContain('row.original.returnNo ? (');
    expect(KOLONLAR).toContain("—");
    expect(DETAY).toContain('row.returnNo ?');
  });
});
