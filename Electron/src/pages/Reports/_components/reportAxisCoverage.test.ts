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
// seçicisi eklendi → ⭐④ ❌ · ekstre diyalogundan belge tipi seçicisi silindi → ⭐⑤ ❌
// (İLK yazımda TUTMADI: işaret `setBelgeTipi` idi ve durum bildiriminde kalıyordu ⇒
// işaret SEÇİCİNİN KENDİSİ olmalı) · KDV özetine cari seçicisi sızdırıldı → ⭐⑥ ❌ ·
// taşıyıcı şerit (`AgingFilterBar`) seçiciyi bıraktı → zemin ❌ (beyan tek başına yeşil bırakmaz).
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

/**
 * Finans eksenleri (R5b-d). ⚠️ `finance/statement` bir DİYALOGDUR (route'u yok)
 * ⇒ dosyası ADIYLA verilir; route zinciri onu bulamaz ve "ölçülemedi" sayılması
 * gerekirdi. Değerler: o yaprakta GÖRÜNMESİ gereken seçici işaretleri.
 */
const FINANCE_AXES: Record<string, { dosya?: string; tasiyici?: string; isaretler: readonly string[] }> = {
  // Seçici şeridin kendi dosyasında yaşıyor ⇒ TAŞIYICI beyan edilir ve taşıdığı
  // ayrıca ÖLÇÜLÜR (aşağıdaki zemin testi); beyan tek başına yeşil bırakmaz.
  "finance/aging": { tasiyici: "pages/Reports/Finance/AgingFilterBar.tsx", isaretler: ["<AgingCariSelect", "<ReportMultiSelect", "AXIS_LABELS.cariId"] },
  "finance/cash-book": { isaretler: ["<ReportMultiSelect", "onChangeKategori={", "onChangeYon={"] },
  "finance/fx-diff": { isaretler: ["<ReportMultiSelect", "onChangeKind={"] },
  // KDV özetinde cari ekseni YOKTUR: backend şeması `cariId` kabul etmiyor (400).
  "finance/vat-summary": { isaretler: ['patch("yon"', 'patch("oran"'] },
  // ⚠️ İşaret SEÇİCİNİN KENDİSİNİ göstermeli: `setBelgeTipi` durum bildiriminde
  // de geçer ve seçici silinse bile YEŞİL kalırdı (ölçüldü, sonda tutmadı).
  "finance/statement": { dosya: "pages/Reports/Finance/CariStatementDialog.tsx", isaretler: ["value={belgeTipi}", "belgeSecenekleri.map("] },
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

describe("finans eksenleri kapsamı (R5b-d) — beyan ↔ ekran", () => {
  const oku = (anahtar: string): string => {
    const { dosya, tasiyici } = FINANCE_AXES[anahtar]!;
    const govde = dosya ? readFileSync(resolve(SRC, dosya), "utf8") : kaynak(anahtar);
    return tasiyici ? `${govde}\n${readFileSync(resolve(SRC, tasiyici), "utf8")}` : govde;
  };

  it("zemin: route'suz yaprağın dosyası ADIYLA verildi ve okunabiliyor", () => {
    const diyalog = Object.entries(FINANCE_AXES).filter(([, v]) => v.dosya);
    expect(diyalog.length).toBeGreaterThan(0);
    for (const [k] of diyalog) expect(oku(k).length).toBeGreaterThan(100);
  });

  it("zemin: beyan edilen TAŞIYICI şerit seçiciyi gerçekten çiziyor", () => {
    const tasiyicilar = Object.values(FINANCE_AXES).map((v) => v.tasiyici).filter(Boolean) as string[];
    expect(tasiyicilar.length).toBeGreaterThan(0);
    for (const t of tasiyicilar) expect(readFileSync(resolve(SRC, t), "utf8")).toContain("<ReportMultiSelect");
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
