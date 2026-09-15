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
// Negatif sondalar (bir kezlik, cp+sha256 ile geri alındı): bir yapraktan
// `<ReportAxisBar` kaldırıldı → ⭐① ❌ · beyandaki `colorId` şeritten düşürüldü → ⭐② ❌ ·
// Randıman'dan `<LotInput` kaldırıldı → ⭐③ ❌ · Kalite Karnesi'ne KAYNAKSIZ levent
// seçicisi eklendi → ⭐④ ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../..");
const ROUTES = readFileSync(resolve(SRC, "routes/content-routes.tsx"), "utf8");

/** Sunucu sözleşmesinin (6e `_filters.ts`) panel aynası — her yaprak kendi eksenlerini beyan eder. */
const AXES_BY_REPORT: Record<string, readonly string[]> = {
  "sales/order-intake": ["customerId", "itemId", "destination"],
  "sales/demand-analysis": ["customerId", "itemId", "colorId", "destination"],
  "sales/order-leadtime": ["customerId", "itemId", "destination"],
  "sales/order-cancellation": ["customerId", "reasonCode", "destination"],
  // Açık karşılanmada müşteri ekseni BİLEREK yok: FIFO havuzu spec başına paylaşılır.
  "sales/open-order-coverage": ["itemId"],
  "customer/scorecard": ["customerId", "itemId", "destination"],
  "customer/order-profile": ["customerId", "destination"],
  // Fasonda hedef ekseni yok: sevk müşteriye değil firmaya gider.
  "subcontract/scorecard": ["subcontractorId", "itemId", "colorId"],
};

/**
 * Levent/lot ekseni (R5b-b2): dokuma üçlüsünde LEVENT SEÇİCİSİ + lot kutusu,
 * kalite/fire ikizinde YALNIZ lot kutusu — o yanıt `meta.leventler` taşımadığı
 * için seçici çizilemez (kaynağı olmayan seçici, olmayan veriyi vaat eder).
 */
const BEAM_LOT_BY_REPORT: Record<string, "levent+lot" | "lot"> = {
  "dokuma/randiman": "levent+lot",
  "dokuma/durus-pareto": "levent+lot",
  "dokuma/vardiya-karnesi": "levent+lot",
  "quality/scorecard": "lot",
  "quality/scrap-scorecard": "lot",
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

describe("eksen süzgeci kapsamı — beyan ↔ ekran", () => {
  it("zemin: yaprak route'ları okundu ve beyan edilen sekizinin hepsi route'ta var", () => {
    expect(yapraklar.size).toBeGreaterThan(20);
    expect(Object.keys(AXES_BY_REPORT).filter((k) => !yapraklar.has(k))).toEqual([]);
  });

  it("⭐① eksen beyan eden her yaprak <ReportAxisBar çizer", () => {
    const eksik = Object.keys(AXES_BY_REPORT).filter((k) => !kaynak(k).includes("<ReportAxisBar"));
    expect(eksik).toEqual([]);
  });

  it("⭐② şeridin eksen listesi BEYANLA birebir (fazlası da eksiği de kırmızı)", () => {
    const sapma: string[] = [];
    for (const [anahtar, beklenen] of Object.entries(AXES_BY_REPORT)) {
      const src = kaynak(anahtar);
      const liste = src.match(/const AXIS_KEYS = \[([^\]]*)\]/);
      if (!liste) { sapma.push(`${anahtar}: AXIS_KEYS bulunamadı`); continue; }
      const gercek = [...liste[1]!.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]!);
      // `destination` ayrı bir seçicidir: şeride `destination` propuyla girer.
      if (/<ReportAxisBar[^>]*\sdestination(\s|\/|>)/.test(src)) gercek.push("destination");
      const b = [...beklenen].sort().join(",");
      const g = [...gercek].sort().join(",");
      if (b !== g) sapma.push(`${anahtar}: beyan [${b}] ≠ ekran [${g}]`);
    }
    expect(sapma).toEqual([]);
  });
});

describe("levent/lot ekseni kapsamı — beyan ↔ ekran", () => {
  it("zemin: beyan edilen beş yaprağın hepsi route'ta var", () => {
    expect(Object.keys(BEAM_LOT_BY_REPORT).filter((k) => !yapraklar.has(k))).toEqual([]);
  });

  it("⭐③ lot ekseni beyan eden her yaprak <LotInput çizer", () => {
    const eksik = Object.keys(BEAM_LOT_BY_REPORT).filter((k) => !kaynak(k).includes("<LotInput"));
    expect(eksik).toEqual([]);
  });

  it("⭐④ levent seçicisi YALNIZ kaynağı olan yapraklarda (`meta.leventler`) — fazlası da eksiği de kırmızı", () => {
    const sapma: string[] = [];
    for (const [anahtar, kip] of Object.entries(BEAM_LOT_BY_REPORT)) {
      const src = kaynak(anahtar);
      const secici = /label="Levent"/.test(src) && src.includes("beamOptionsFrom");
      if (kip === "levent+lot" && !secici) sapma.push(`${anahtar}: levent seçicisi beyan edildi ama çizilmiyor`);
      if (kip === "lot" && secici) sapma.push(`${anahtar}: kaynağı olmayan levent seçicisi çizilmiş`);
    }
    expect(sapma).toEqual([]);
  });
});
