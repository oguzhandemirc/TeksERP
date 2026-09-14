// =============================================================================
// BEKÇİ — HER YAPRAK RAPOR SAYFASI ÇIKTI ŞERİDİ ÇİZER (`<ReportExportBar`)
// =============================================================================
// ⭐ NEDEN VAR (2026-09-15, Raporlar fazı R3): dokuma raporlarının DÖRDÜ birden
// çıktısız doğdu ve bunu kimse fark etmedi — 25 yaprak Excel/PDF/Yazdır verirken
// dört yaprak vermiyordu, üstelik dördü de "gelişmiş" sınıftaydı (envanter
// `docs/design/RAPORLAR-ENVANTER.md` §0). Çıktı, rapor yüzeyinin SESSİZ eksiğidir:
// ekran çalışır, rakam doğrudur, yalnız kâğıda/Excel'e geçmez ve kimse hata
// mesajı görmez. Kapı bu yüzden VARLIK ölçer, davranış değil.
//
// ⚠️ ÖLÇÜLEN: yaprak rapor route'unun bağlandığı dosyada `<ReportExportBar`
// GEÇİYOR MU. ÖLÇÜLMEYEN: şeridin gerçekten çizildiği (koşul altında olabilir),
// spec'in doğruluğu, kolonların ekranla birebirliği — onlar sayfa testlerinde.
// Kapsamı yazılmayan bir yeşil, ölçülmemiş olmakla temiz olmayı karıştırır.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../..");
const ROUTES = readFileSync(resolve(SRC, "routes/content-routes.tsx"), "utf8");

/** Üç segmentli rapor yolu = YAPRAK (iki segment hub'dır: `reports/dokuma`). */
const LEAF_RE = /path:\s*"(reports\/[a-z0-9-]+\/[a-z0-9-]+)"[\s\S]{0,400}?<([A-Z][A-Za-z0-9]*)\s*\/>/g;

/** Bileşen adı → dosya (import satırından; `@/` kök `src/`). */
function dosyaBul(bilesen: string): string | null {
  const m = new RegExp(`import\\s*\\{[^}]*\\b${bilesen}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`).exec(ROUTES);
  if (!m) return null;
  return resolve(SRC, m[1]!.replace(/^@\//, "") + ".tsx");
}

const yapraklar = [...ROUTES.matchAll(LEAF_RE)].map(([, yol, bilesen]) => ({ yol: yol!, bilesen: bilesen! }));

describe("rapor çıktı kapsamı — her yaprak sayfa ReportExportBar çizer", () => {
  it("zemin: yaprak rapor route'ları okundu", () => {
    // Sıfır yaprak "hepsi temiz" DEĞİL, tarayıcı bozuk demektir.
    expect(yapraklar.length).toBeGreaterThan(20);
  });

  it("zemin: her yaprağın kaynak dosyası bulundu", () => {
    const kayip = yapraklar.filter((y) => dosyaBul(y.bilesen) === null).map((y) => `${y.yol} → ${y.bilesen}`);
    expect(kayip).toEqual([]);
  });

  it("⭐ her yaprak rapor sayfası <ReportExportBar taşır", () => {
    const eksik = yapraklar
      .filter((y) => {
        const dosya = dosyaBul(y.bilesen);
        if (!dosya) return false; // ayrı testte kırmızı
        return !readFileSync(dosya, "utf8").includes("<ReportExportBar");
      })
      .map((y) => `${y.yol} (${y.bilesen})`);
    expect(eksik).toEqual([]);
  });
});
