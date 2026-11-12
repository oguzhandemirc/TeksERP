// =============================================================================
// BEKÇİ — EKSEN SÜZGECİ OLAN HER RAPOR SEÇİCİSİNİ ÇİZER (R5b-c)
// =============================================================================
// ⭐ NEDEN VAR: sunucu sekiz uçta süzgeci AÇTI (`_filters.ts` · `meta.secenekler`).
// Panel yaprağı seçiciyi çizmezse o süzgeç YALNIZ ELLE URL YAZANA açıktır — ekran
// çalışır, rakam doğrudur, yetenek görünmez. Sessiz eksik sınıfı (R3'teki çıktı
// şeridinin aynısı), bu yüzden kapı VARLIK ölçer.
//
// ⚠️ ÖLÇÜLEN: eksen taşıdığı BEYAN EDİLEN yaprağın dosyasında `<ReportAxisBar`
// ve beyan edilen eksen anahtarları geçiyor mu; ve beyan ile şeridin `eksenler=`
// listesi TUTUYOR mu. ÖLÇÜLMEYEN: sunucunun o ekseni gerçekten süzdüğü
// (`test_rapor_satis_ekseni` §0–§10, gerçek DB) — panel bekçisi çapraz projeye
// BAKAMAZ (import bekçiyi çökertir), bu yüzden beyan ELLE yazılır ve sunucu
// sözleşmesiyle hizası sürüm notu geri-okumasında denetlenir.
//
// Negatif sonda (bir kezlik, cp+sha256 ile geri alındı): KDV özetine cari seçicisi sızdırıldı → ⭐⑥ ❌.
// (⭐①② `<ReportAxisBar` beyanı son yapraklarıyla 2026-11-12'de kalktı.) (⭐③④ levent/lot ve diyalog/taşıyıcı zeminleri
// sayfalarıyla birlikte kalktı — eski raporların kaldırılması, 2026-11-12.)
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../..");
const ROUTES = readFileSync(resolve(SRC, "routes/content-routes.tsx"), "utf8");

// Satış/müşteri eksen beyanı (`AXES_BY_REPORT`, `<ReportAxisBar`) son iki yaprağı — Talep Analizi ve Müşteri
// Sipariş Profili — emekli olup sayfaları silinince kalktı (2026-11-12); şerit bileşeni de onlarla gitti.

// Levent/lot ekseni beyanı (R5b-b2) dokuma üçlüsü + kalite/fire ikizi emekli olup sayfaları silinince
// kalktı (2026-11-12); yeni nesil raporlarda eksen `varyantBoyutlari`ndan çizilir (`reportV2.test`).

/**
 * Finans eksenleri (R5b-d). Değerler: o yaprakta GÖRÜNMESİ gereken seçici işaretleri.
 * Yaşlandırma yaprağı ve ekstre diyaloğu (`finance/aging`, rapor ekstresi) emekli olup silinince
 * taşıyıcı/diyalog beyanları da kalktı; ekstre Cari ekranındadır (`Finance/StatementDialog`).
 */
const FINANCE_AXES: Record<string, { isaretler: readonly string[] }> = {
  "finance/cash-book": { isaretler: ["<ReportMultiSelect", "onChangeKategori={", "onChangeYon={"] },
  "finance/fx-diff": { isaretler: ["<ReportMultiSelect", "onChangeKind={"] },
  // KDV özetinde cari ekseni YOKTUR: backend şeması `cariId` kabul etmiyor (400).
  "finance/vat-summary": { isaretler: ['patch("yon"', 'patch("oran"'] },
};

const LEAF_RE = /path:\s*"reports\/([a-z0-9-]+\/[a-z0-9-]+)"[\s\S]{0,400}?<([A-Z][A-Za-z0-9]*)\s*\/>/g;

function dosyaBul(bilesen: string): string | null {
  const m = new RegExp(`import\\s*\\{[^}]*\\b${bilesen}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`).exec(ROUTES);
  return m ? resolve(SRC, m[1]!.replace(/^@\//, "") + ".tsx") : null;
}

const yapraklar = new Map([...ROUTES.matchAll(LEAF_RE)].map(([, yol, bilesen]) => [yol!, bilesen!]));

function kaynak(anahtar: string): string {
  const bilesen = yapraklar.get(anahtar);
  if (!bilesen) throw new Error(`route'ta yaprak yok: ${anahtar}`);
  const dosya = dosyaBul(bilesen);
  if (!dosya) throw new Error(`bileşen dosyası çözülemedi: ${bilesen}`);
  return readFileSync(dosya, "utf8");
}

describe("yaprak route'ları", () => {
  it("zemin: yaprak route'ları okundu", () => {
    expect(yapraklar.size).toBeGreaterThan(5);
  });
});

describe("finans eksenleri kapsamı (R5b-d) — beyan ↔ ekran", () => {
  const oku = (anahtar: string): string => kaynak(anahtar);

  it("zemin: beyan edilen her finans yaprağı route'ta var", () => {
    expect(Object.keys(FINANCE_AXES).filter((k) => !yapraklar.has(k))).toEqual([]);
  });

  it("⭐⑤ beyan edilen her finans yaprağı seçicilerini çizer", () => {
    const eksik: string[] = [];
    for (const [anahtar, { isaretler }] of Object.entries(FINANCE_AXES)) {
      const src = oku(anahtar);
      for (const i of isaretler) if (!src.includes(i)) eksik.push(`${anahtar}: ${i}`);
    }
    expect(eksik).toEqual([]);
  });

  it("⭐⑥ KDV özetinde cari seçicisi YOK (backend şeması `cariId` kabul etmiyor)", () => {
    expect(oku("finance/vat-summary")).not.toContain("AXIS_LABELS.cariId");
  });
});
