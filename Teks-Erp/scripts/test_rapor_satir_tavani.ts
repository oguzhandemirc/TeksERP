// =============================================================================
// RAPOR KIRILIM LİSTESİ SATIR TAVANI — Perf-2 B5 (2026-10-13)
//
// Kalite · fire · stok karnelerinin kırılım listeleri katalogla büyür ve tavansızdı.
// Tavan (`REPORT_MAX_ROWS`) yalnız listeyi keser; özet tam kümeden kalır ve kesilen
// her liste `warnings` ile SÖYLENİR (sessiz kesme yok). Tavan altında yanıt bayt
// bayt eskisidir (aynı nesne, `warnings` anahtarı yok).
//   §1 capReportLists: tavan altı dokunulmaz · tavan üstü kesilir + uyarı · özet sabit
//   §2 reportEnvelope: boş uyarı → anahtar YOK; dolu → `warnings`
//   §3 ⭐ rotaların liste beyanı raporun BÜTÜN dizi alanlarını kapsar (muaflar beyanlı:
//      sabit/aralık-sınırlı) — yeni kırılım listesi beyansız doğarsa kırmızı
//
// Koşum: npx tsx scripts/test_rapor_satir_tavani.ts
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { capReportLists, reportEnvelope, REPORT_MAX_ROWS, resolveDateRange } from "../src/services/reports/_shared";
import { QUALITY_LISTS, SCRAP_LISTS } from "../src/routes/reports/quality.routes";
import { STOCK_LISTS } from "../src/routes/reports/inventory.routes";
import { getQualityScorecard } from "../src/services/reports/quality-scorecard.report.service";
import { getScrapScorecard } from "../src/services/reports/scrap-scorecard.report.service";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

/** Tavana GİRMEYEN dizi alanları ve gerekçesi (sabit uzunluk ya da aralıkla sınırlı). */
const MUAF: Record<string, string> = {
  daily: "gün serisi — aralık ≤ 366 gün",
  grades: "kalite sözlüğü — sabit küçük küme",
  gradeOrder: "kalite sözlüğü — sabit küçük küme",
  byAge: "yaş kovaları — sabit",
  oldest: "en eski 25 top — sabit",
};

function diziAlanlari(o: object): string[] {
  return Object.entries(o).filter(([, v]) => Array.isArray(v)).map(([k]) => k).sort();
}

async function main(): Promise<void> {
  console.log("\n=== Rapor kırılım listesi satır tavanı ===\n");

  // §1
  const satir = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}` }));
  const alti = { summary: { total: 7 }, byItem: satir(REPORT_MAX_ROWS), byColor: satir(3) };
  const r1 = capReportLists(alti, [["byItem", "Kumaş"], ["byColor", "Renk"]] as const);
  check("§1a tavan ALTI (= tavan) aynı nesne, uyarı yok", r1.data === alti && r1.warnings.length === 0);
  const ustu = { summary: { total: 7 }, byItem: satir(REPORT_MAX_ROWS + 1), byColor: satir(3) };
  const r2 = capReportLists(ustu, [["byItem", "Kumaş"], ["byColor", "Renk"]] as const);
  check("§1b ⭐ tavan ÜSTÜ kesilir", r2.data.byItem.length === REPORT_MAX_ROWS, `${r2.data.byItem.length}`);
  check("§1c ⭐ kesilen liste için TEK Türkçe uyarı (sayılarla)", r2.warnings.length === 1 && r2.warnings[0]!.includes(`${REPORT_MAX_ROWS + 1}`) && r2.warnings[0]!.startsWith("Kumaş"), r2.warnings.join(" | "));
  check("§1d özet ve kesilmeyen liste dokunulmadı; girdi nesnesi mutasyona uğramadı", r2.data.summary === ustu.summary && r2.data.byColor === ustu.byColor && ustu.byItem.length === REPORT_MAX_ROWS + 1);

  // §2
  const range = resolveDateRange({});
  check("§2a boş uyarı → `warnings` anahtarı YOK (eski yanıt)", !("warnings" in reportEnvelope({}, range, null, { warnings: [] })));
  check("§2b dolu uyarı → `warnings` yanıtta", JSON.stringify(reportEnvelope({}, range, null, { warnings: ["x"] }).warnings) === '["x"]');

  // §3 — gerçek rapor çıktılarının dizi alanları ↔ rota beyanı
  const bos = { from: new Date("2098-01-01T00:00:00.000Z"), to: new Date("2098-01-31T23:59:59.999Z") };
  const raporlar: Array<[string, object, ReadonlyArray<readonly [string, string]>]> = [
    ["quality/scorecard", await getQualityScorecard(bos, null, {}), QUALITY_LISTS],
    ["quality/scrap-scorecard", await getScrapScorecard(bos, null, {}), SCRAP_LISTS],
    ["inventory/scorecard", await getStockScorecard(), STOCK_LISTS],
  ];
  for (const [ad, rapor, beyan] of raporlar) {
    const beyanli = new Set(beyan.map(([k]) => k));
    const acik = diziAlanlari(rapor).filter((k) => !beyanli.has(k) && !(k in MUAF));
    const hayalet = [...beyanli].filter((k) => !Array.isArray((rapor as Record<string, unknown>)[k]));
    check(`§3 ⭐ ${ad}: her dizi alanı ya tavanlı ya muaf`, acik.length === 0, acik.length ? `beyansız: ${acik.join(", ")}` : diziAlanlari(rapor).join(", "));
    check(`§3 ${ad}: beyan edilen her liste raporda VAR (hayalet beyan yok)`, hayalet.length === 0, hayalet.join(", "));
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
