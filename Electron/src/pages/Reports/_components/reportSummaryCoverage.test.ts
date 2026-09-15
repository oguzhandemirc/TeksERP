// =============================================================================
// BEKÇİ — HER YAPRAK RAPOR ÖZET ŞERİDİ ÇİZER (`<MetricCard`) ve SORU CÜMLESİ
// TEK YERDEN GELİR
// =============================================================================
// ⭐ NEDEN VAR (2026-09-15, R6): dört yaprak özet şeridi olmadan doğmuştu
// (`RAPORLAR-ENVANTER.md` §8) — rapor açılıyor, doğru rakamı veriyor, ama okuyucu
// "önce tabloya" düşüyor ve sayfanın ne söylediğini tablodan ÇIKARMAK zorunda
// kalıyor. Şerit bir süs değil, raporun CEVABIDIR; tablo onun gerekçesi.
//
// ⚠️ SIRA ÖLÇÜMÜ SAYFA GÖVDESİNDE yapılır, dosyanın tamamında değil: yardımcı
// bileşen (ör. `ShiftCard`) sayfa fonksiyonundan ÖNCE tanımlanabilir ve dosya
// sırası render sırası DEĞİLDİR. İlk sürümde bu ölçülmedi ve `vardiya-karnesi`
// yanlışlıkla "şerit tablodan sonra" göründü — ölçümün kendi kusuruydu.
//
// ⚠️ ÖLÇÜLMEYEN: şeridin İÇERİĞİ (hangi sayı) ve koşullu çizim. Kapsamı
// yazılmayan yeşil, ölçülmemiş olmakla temizi karıştırır.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../..");
const ROUTES = readFileSync(resolve(SRC, "routes/content-routes.tsx"), "utf8");
const LEAF_RE = /path:\s*"(reports\/[a-z0-9-]+\/[a-z0-9-]+)"[\s\S]{0,400}?<([A-Z][A-Za-z0-9]*)\s*\/>/g;
const TABLE_TAGS = ["<DetailTable", "<AgingBlockTable", "<CashLedgerTable", "<KarneTable"];
/**
 * ⚠️ ETİKET SINIRI ŞART: `includes("<MetricCard")` "<MetricCardX" ile de eşleşir
 * ve negatif sonda YEŞİL kalır (ölçüldü 2026-09-15 — bu kapının ilk hâli tam da
 * böyle sustu). Sınırını beyan etmeyen yüklem alakasızla eşleşir.
 */
const METRIC_RE = /<MetricCard[\s/>]/;

function dosyaBul(bilesen: string): string | null {
  const m = new RegExp(`import\\s*\\{[^}]*\\b${bilesen}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`).exec(ROUTES);
  return m ? resolve(SRC, m[1]!.replace(/^@\//, "") + ".tsx") : null;
}

/** Sayfa BİLEŞENİNİN gövdesi — yardımcı bileşenler kapsam dışı (sıra ölçümü için). */
function sayfaGovdesi(src: string, bilesen: string): string {
  const i = src.indexOf(`export function ${bilesen}`);
  return i >= 0 ? src.slice(i) : src;
}

const yapraklar = [...ROUTES.matchAll(LEAF_RE)]
  .map(([, yol, bilesen]) => ({ yol: yol!, bilesen: bilesen!, dosya: dosyaBul(bilesen!) }))
  .filter((y) => y.dosya !== null)
  .map((y) => ({ ...y, src: readFileSync(y.dosya!, "utf8") }));

describe("rapor özet şeridi kapsamı", () => {
  it("zemin: yaprak sayfalar okundu", () => {
    expect(yapraklar.length).toBeGreaterThan(20);
  });

  it("⭐ her yaprak rapor sayfası <MetricCard çizer", () => {
    const eksik = yapraklar.filter((y) => !METRIC_RE.test(y.src)).map((y) => y.yol);
    expect(eksik).toEqual([]);
  });

  it("⭐ özet şeridi TABLODAN ÖNCE gelir (sayfa gövdesinde)", () => {
    const sonra = yapraklar
      .filter((y) => {
        const govde = sayfaGovdesi(y.src, y.bilesen);
        const iM = govde.search(METRIC_RE);
        if (iM < 0) return false; // ayrı testte kırmızı
        const tablo = TABLE_TAGS.map((t) => govde.indexOf(t)).filter((n) => n >= 0);
        return tablo.length > 0 && iM > Math.min(...tablo);
      })
      .map((y) => y.yol);
    expect(sonra).toEqual([]);
  });

  it("⭐ soru cümlesi TEK YERDEN (ReportPageLayout) gelir — sayfa metni yazmaz", () => {
    const layout = readFileSync(resolve(SRC, "pages/Reports/_components/ReportPageLayout.tsx"), "utf8");
    expect(layout).toContain("REPORT_BY_KEY");
    expect(layout).toContain("Bu rapor şunu cevaplar");
    // Sayfa kendi soru cümlesini yazarsa katalogla ayrışır ve hangisinin doğru
    // olduğu ölçülemez hâle gelir.
    const kendiYazan = yapraklar.filter((y) => y.src.includes("Bu rapor şunu cevaplar")).map((y) => y.yol);
    expect(kendiYazan).toEqual([]);
  });
});
