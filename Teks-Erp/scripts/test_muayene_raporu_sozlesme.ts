// =============================================================================
// Bekçi: MUAYENE RAPORU BELGESİ — sözleşme, iç kolon opt-in, PDF = Excel (DB gerekmez)
// Çalıştır: npx tsx scripts/test_muayene_raporu_sozlesme.ts
// =============================================================================
// Ölçtüğü değişmezler (K4P-RAPOR, `docs/kurallar/belge-etiket.md`):
//  §1 Müşteri kuralı etiketi/sonucu belgeye olduğu gibi gider (fabrika derecesi basılmaz).
//  §2 İç kolonlar (operatör · istasyon · cihaz) VARSAYILANDA bağlamda, kolon düzeninde
//     ve HTML'de YOK; `shown` / iç alan opt-in'iyle VAR.
//  §3 PDF = Excel: HTML top tablosunun HER hücresi `renderInspectionReportTables`
//     modelinin aynı hücresinin metnidir (kolon sırası dahil).
//  §4 Tarih fabrika diliminden (22:30Z → ertesi gün); §5 patron dipnotu basılır.
//
// Negatif sonda (2026-10-25): `rollColumns`ta `inspector` kolonunun `defaultHidden`ı
// kaldırıldı → §2 ❌ (HTML'de ve kolon düzeninde operatör çıktı); geri alındı → yeşil.
// =============================================================================
import {
  renderInspectionReportHtml,
  renderInspectionReportTables,
} from "../src/services/document-render/inspection-report.html";
import { SAMPLE_INSPECTION_REPORT } from "../src/services/document-render/sample-data-inspection";
import type { DocCellKind, DocCellValue } from "../src/services/document-render/doc-model";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import type { DocumentConfig } from "../src/services/system-setting.service";
import { inspectionReportContract } from "../src/services/document-template/sozlesme/inspection-report";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** Renderer'dan BAĞIMSIZ TR sayı biçimi (binlik nokta, ondalık virgül). */
function trNum(n: number, dec: number): string {
  const [int, frac] = Math.abs(n).toFixed(dec).split(".");
  return (n < 0 ? "-" : "") + int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (frac ? `,${frac}` : "");
}
function asPdfText(kind: DocCellKind, v: DocCellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return esc(v);
  if (kind.t === "text") return esc(String(v));
  return (kind.t === "int" ? String(v) : trNum(v, kind.dec)) + (kind.suffix ?? "");
}

const INTERNAL = ["inspector", "station", "device"];
const doc = structuredClone(SAMPLE_INSPECTION_REPORT) as { header: { date: string } } & Record<string, unknown>;
doc.header.date = "2026-06-07T22:30:00.000Z"; // fabrika diliminde (İstanbul) 08.06.2026
const snap = (override: DocumentConfig | null): PrintedDocSnapshot => ({
  schemaVersion: 1,
  frozenAt: "2026-06-07T22:30:00.000Z",
  company: { name: "Örnek Fabrika", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
  docConfigOverride: override,
  doc,
});
const OPT_IN: DocumentConfig = { columns: { toplar: { shown: INTERNAL } } } as DocumentConfig;

function rollTableHtml(html: string): string[][] {
  const t = [...html.matchAll(/<table class="sec[^"]*">([\s\S]*?)<\/table>/g)].map((m) => m[1]!).find((b) => b.includes("BARKOD")) ?? "";
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(t)?.[1] ?? "";
  return [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1]!.matchAll(/<td class="[^"]*">([\s\S]*?)<\/td>/g)].map((x) => x[1]!.trim()));
}

console.log("=== Muayene raporu sözleşme bekçisi ===\n");

// §1 müşteri kuralı
const plain = snap(null);
const html = renderInspectionReportHtml(plain);
const tables = renderInspectionReportTables(plain);
const rolls = tables.tables.find((t) => t.key === "toplar");
const labelIdx = rolls?.columns.findIndex((c) => c.key === "label") ?? -1;
const resultIdx = rolls?.columns.findIndex((c) => c.key === "result") ?? -1;
check("§1 müşteri etiketi: satır 2 RET / kaldı", rolls?.rows[1]?.[labelIdx] === "RET" && /kald/i.test(String(rolls?.rows[1]?.[resultIdx])), `${rolls?.rows[1]?.[labelIdx]}/${rolls?.rows[1]?.[resultIdx]}`);
check("§1 muayenesiz top satırı basılır", rolls?.rows.length === 3);

// §2 iç kolonlar
const keys = (t: typeof rolls) => (t?.columns ?? []).map((c) => c.key);
check("§2 varsayılan: kolon düzeninde iç kolon yok", !keys(rolls).some((k) => INTERNAL.includes(k)), keys(rolls).join(","));
check("§2 varsayılan: HTML'de operatör/istasyon/cihaz yok", !html.includes("Ayşe Yılmaz") && !html.includes("Kalite Kontrol 1") && !html.includes("KK1 Tablet"));
const ctx = inspectionReportContract.insa(plain, null, [], undefined) as unknown as { tablolar: { toplar: Array<Record<string, unknown>> }; ic_acik: Record<string, boolean> };
const ctxRow = ctx.tablolar.toplar[0] ?? {};
check("§2 varsayılan: bağlamda iç alan değeri yok", ctxRow.operator == null && ctxRow.istasyon == null && ctxRow.cihaz == null && !Object.values(ctx.ic_acik).some(Boolean), JSON.stringify({ o: ctxRow.operator, i: ctxRow.istasyon, c: ctxRow.cihaz }));
const optHtml = renderInspectionReportHtml(snap(OPT_IN));
const optRolls = renderInspectionReportTables(snap(OPT_IN)).tables.find((t) => t.key === "toplar");
check("§1 fabrika derecesi belgede yok (kolon düzeninde ve HTML başlığında)", ![rolls, optRolls].some((t) => keys(t).includes("factoryGrade")) && !/DERECE/i.test(html));
check("§2 opt-in: kolon düzeninde üç iç kolon", INTERNAL.every((k) => keys(optRolls).includes(k)), keys(optRolls).join(","));
check("§2 opt-in: HTML'de operatör/istasyon/cihaz var", optHtml.includes("Ayşe Yılmaz") && optHtml.includes("Kalite Kontrol 1") && optHtml.includes("KK1 Tablet"));
const optCtx = inspectionReportContract.insa(plain, null, ["muayene_operator"], undefined) as unknown as typeof ctx;
check("§2 opt-in (sözleşme): yalnız seçilen iç alan dolu", optCtx.tablolar.toplar[0]?.operator === "Ayşe Yılmaz" && optCtx.tablolar.toplar[0]?.istasyon == null && optCtx.ic_acik.muayene_operator === true);

// §3 PDF = Excel (varsayılan ve opt-in)
for (const [name, h, t] of [["varsayılan", html, rolls], ["opt-in", optHtml, optRolls]] as const) {
  const pdf = rollTableHtml(h);
  const excel = (t?.rows ?? []).map((r) => r.map((v, i) => asPdfText(t!.columns[i]!.kind, v)));
  const diff = excel.flatMap((r, i) => r.map((v, j) => (v === pdf[i]?.[j] ? null : `[${i},${j}] pdf=${pdf[i]?.[j]} excel=${v}`))).filter(Boolean);
  check(`§3 ${name}: HTML hücreleri = Excel hücreleri (${excel.length}×${excel[0]?.length ?? 0})`, pdf.length === excel.length && pdf.length > 0 && pdf[0]!.length === excel[0]!.length && diff.length === 0, diff.slice(0, 3).join(" | "));
}

// §4 tarih · §5 dipnot
check("§4 HTML tarihi fabrika diliminden 08.06.2026", html.includes("Tarih: <b>08.06.2026</b>"));
check("§4 Excel tarihi aynı", tables.header.some(([k, v]) => k === "Tarih" && v === "08.06.2026"), JSON.stringify(tables.header.find(([k]) => k === "Tarih")));
const FOOT = "Puan, muayene anındaki kural setiyle hesaplanmıştır.";
check("§5 patron dipnotu HTML'de ve Excel notlarında", html.includes(FOOT) && tables.notes.includes(FOOT));
check("§5 dipnot sözleşme bağlamında", ctx.tablolar && (inspectionReportContract.insa(plain, null, [], undefined) as unknown as { tablolar: { dipnotlar: Array<{ metin: string }> } }).tablolar.dipnotlar.some((d) => d.metin === FOOT));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
