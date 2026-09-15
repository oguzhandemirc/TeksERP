// =============================================================================
// DOKUMA RAPORLARI — DIŞA AKTARIM SPEC'LERİ (Excel · PDF · Yazdır)
// =============================================================================
// Dört yaprak (Randıman · Duruş Pareto · Vardiya Karnesi · Karne Listesi) 25
// yaprağın kullandığı ortak kalıba katıldı: TEK spec, üç çıktı (`reportExport.ts`).
// Yeni altyapı yok, backend dokunuşu yok — çıktı panelde üretilir.
//
// ⚠️ İKİ DEĞİŞMEZ ÇIKTIYA DA GEÇER, yoksa kâğıt ekrandan BAŞKA şey söyler:
//   ① KAYNAK KOLONU: her satır "ölçüldü mü elle mi" taşır (`dokuma.md`: rapor
//      "ölçüldü mü elle mi" taşır). Excel'e alınıp paylaşılan bir tabloda bu
//      kolon düşerse, simüle/elle girilmiş satır ölçülmüş gibi okunur.
//   ② "ölçülemedi" BEYANDIR, boş hücre değil: payda yoksa oran hesaplanmaz ve
//      hücreye o kelime yazılır. Bu yüzden oran kolonları SAYI DEĞİL METİN taşır
//      (`formatPct` çıktısı) — sayıya zorlansaydı "ölçülemedi" 0'a düşerdi ve
//      sıfır randıman ile ölçülemeyen randıman aynı görünürdü.
// Süreler ekrandaki biçimle yazılır ("1 sa 05 dk"): tablo EKRANIN aynası olsun.
// =============================================================================
import type { ReportExportSpec } from "../_components/reportExport";
import { fmtInt } from "../_components/formatters";
import { fmtSec } from "./DokumaShared";
import { SOURCE_LABELS, formatPct, type DataSource } from "./dokuma-regime";
import type {
  EfficiencyReport,
  LoomReportMeta,
  ParetoReport,
  ShiftScorecardReport,
  ShiftStatRow,
  SourceBreakdownTable,
} from "./service";

const SOURCE_ORDER: DataSource[] = ["MACHINE", "OPERATOR", "SUPERVISOR", "SIMULATED", "INFERRED"];

/** Kaynak kırılımı şeridi ekranda rakamla duruyor — çıktıda da METİN olarak durur. */
function sourceBreakdownNote(k: SourceBreakdownTable | undefined, unit: string): string[] {
  if (!k) return [];
  const parts = SOURCE_ORDER.map((s) => (k[s]?.satir ? `${SOURCE_LABELS[s]}: ${k[s].satir}` : null)).filter(Boolean);
  return parts.length ? [`Kaynak kırılımı (${unit}): ${parts.join(" · ")} — tek yüzdeye çökertilmez.`] : [];
}

/** Ufuk notu ekranda her sayfanın altında yazıyor; çıktıda da yazar. */
function horizonNotes(meta: LoomReportMeta | undefined): string[] {
  if (!meta) return [];
  const n = [`Ölçüm ufku: ${meta.ufuk} sonrası ölçülüdür` + (meta.ufukOncesiSatir > 0 ? ` · ufuk öncesi ${meta.ufukOncesiSatir} satır (eksik olabilir)` : "")];
  if (meta.truncated) n.push(`Liste ${meta.total} satırdan kırpıldı — aralığı daraltın.`);
  n.push(`Anlık ${meta.live} · mühürlü ${meta.sealed} satır. Mühürsüz satır anlık hesaplanır, mühürlü satır resmî rakamdır.`);
  return n;
}

const UNMEASURED_NOTE =
  "Oran kolonlarında 'ölçülemedi' bir BEYANDIR (payda yok), sıfır değildir — sayıya çevrilmemelidir.";
/**
 * Çıktı SÜZGECİ SÖYLER (K10): dosya tek başına paylaşıldığında "bu tablo neden
 * eksik" sorusunun cevabı kâğıtta dursun. Süzgeç yoksa satır da YOK — "Tümü"
 * yazmak, süzgeç varmış gibi bir izlenim üretirdi.
 */
function filterNote(eksen: string, label: string | null | undefined): string[] {
  return label ? [`SÜZGEÇ — ${eksen}: ${label}. Tablo yalnız bu seçimi içerir.`] : [];
}

const SOURCE_COLUMN_NOTE = "Kaynak kolonu satırın ölçülmüş mü elle mi girilmiş olduğunu söyler; simüle değer elle girişten ayrı sayılır.";

const sourceCell = (r: { emptyLoom: boolean; source: DataSource }): string =>
  r.emptyLoom ? "Boş tezgah" : SOURCE_LABELS[r.source];

// ---------- ① Randıman -------------------------------------------------------

export function buildRandimanExport(opts: { rapor: EfficiencyReport; periodLabel: string; filterLabel?: string | null; extraNotes?: string[] }): ReportExportSpec {
  const { rapor, periodLabel, filterLabel, extraNotes = [] } = opts;
  const t = rapor.toplam;
  return {
    title: "Randıman",
    subtitle: periodLabel,
    orientation: "landscape",
    meta: [
      ...filterNote("Tezgah", filterLabel),
      ...extraNotes,
      "Kullanılabilirlik · performans · etkinlik AYRI sunulur, ÇARPILMAZ.",
      UNMEASURED_NOTE,
      SOURCE_COLUMN_NOTE,
      `Toplam: kullanılabilirlik ${formatPct(t.availabilityPct)} · performans ${formatPct(t.performancePct)} · etkinlik ${formatPct(t.effectivenessPct)} · ${fmtInt(t.rowCount)} satır (dışlanan A ${t.olculemedi.A} · P ${t.olculemedi.P} · E ${t.olculemedi.E}).`,
      ...sourceBreakdownNote(rapor.kaynakKirilimi, "satır"),
    ],
    tables: [
      {
        name: "Tezgah × vardiya",
        columns: [
          { header: "Tezgah", key: "tezgah", width: 24 },
          { header: "Gün", key: "gun", width: 12 },
          { header: "Vardiya", key: "vardiya", width: 14 },
          { header: "Kaynak", key: "kaynak", width: 14 },
          { header: "Planlı", key: "planli", width: 12, align: "right" },
          { header: "Çalıştı", key: "calisti", width: 12, align: "right" },
          { header: "Atkı", key: "atki", width: 12, numFmt: "#,##0", align: "right" },
          { header: "Kullanılabilirlik", key: "k", width: 16, align: "right" },
          { header: "Performans", key: "p", width: 14, align: "right" },
          { header: "Etkinlik", key: "e", width: 12, align: "right" },
          { header: "Durum", key: "durum", width: 12 },
          { header: "Uyarı", key: "uyari", width: 9, numFmt: "#,##0", align: "right" },
        ],
        rows: rapor.satirlar.map((r) => ({
          tezgah: `${r.machine.code} · ${r.machine.name}`,
          gun: r.factoryDayKey.slice(0, 10),
          vardiya: r.shift.name,
          kaynak: sourceCell(r),
          planli: fmtSec(r.potSec),
          calisti: fmtSec(r.aptSec),
          atki: r.unitsActual,
          k: formatPct(r.availabilityPct),
          p: formatPct(r.performancePct) + (r.performancePct === null && r.olculemedi.P ? ` (${r.olculemedi.P})` : ""),
          e: formatPct(r.effectivenessPct),
          durum: r.sealState === "SEALED" ? "Mühürlü" : r.live ? "Anlık" : "Açık",
          uyari: r.warnings.length,
        })),
        notes: horizonNotes(rapor.meta),
      },
    ],
  };
}

// ---------- ② Duruş Pareto ---------------------------------------------------

const LOSS_LABELS: Record<string, string> = {
  UNPLANNED: "Plansız", SETUP: "Kurulum", PLANNED: "Planlı", NON_SCHEDULED: "Çalışma dışı", MINOR: "Mikro",
};

export function buildParetoExport(opts: { rapor: ParetoReport; periodLabel: string; filterLabel?: string | null; extraNotes?: string[] }): ReportExportSpec {
  const { rapor, periodLabel, filterLabel, extraNotes = [] } = opts;
  const bucketRow = (ad: string, b: { stopCount: number; stopSec: number }, aciklama: string) => ({
    kova: ad, olay: b.stopCount, sure: fmtSec(b.stopSec), aciklama,
  });
  return {
    title: "Duruş Pareto",
    subtitle: periodLabel,
    meta: [
      ...filterNote("Tezgah", filterLabel),
      ...extraNotes,
      "Sebep sıralama ekseni, süre sınıfı gruplama eksenidir; mikro duruş bir sebep DEĞİL bir süre sınıfıdır.",
      SOURCE_COLUMN_NOTE,
      ...sourceBreakdownNote(rapor.kaynakKirilimi, "karne"),
    ],
    tables: [
      {
        name: "Sebep × süre sınıfı",
        columns: [
          { header: "Sebep", key: "sebep", width: 30 },
          { header: "Kod", key: "kod", width: 16 },
          { header: "Süre sınıfı", key: "sinif", width: 14 },
          { header: "Olay", key: "olay", width: 10, numFmt: "#,##0", align: "right" },
          { header: "Süre", key: "sure", width: 14, align: "right" },
        ],
        rows: rapor.sebepler.map((r) => ({
          sebep: r.reasonLabel ?? r.reasonCode,
          kod: r.reasonCode,
          sinif: r.lossClass ? LOSS_LABELS[r.lossClass] : "—",
          olay: r.stopCount,
          sure: fmtSec(r.stopSec),
        })),
        notes: horizonNotes(rapor.meta),
      },
      {
        name: "Ayrı kovalar",
        columns: [
          { header: "Kova", key: "kova", width: 24 },
          { header: "Olay", key: "olay", width: 10, numFmt: "#,##0", align: "right" },
          { header: "Süre", key: "sure", width: 14, align: "right" },
          { header: "Neden ayrı", key: "aciklama", width: 54 },
        ],
        rows: [
          bucketRow("Mikro duruşlar", rapor.mikroDuruslar, "Eşik altı; sebep listesinde DEĞİL."),
          bucketRow("Sınıflandırılmamış", rapor.siniflandirilmamis, "Sebep bekliyor; plansız sayıldı."),
          bucketRow("Yuvası atanmamış", rapor.atanmamis, "Levent ekseni — sebep listesiyle KESİŞİR, toplama ikinci kez eklenmez."),
          bucketRow("TOPLAM", rapor.toplam, "Sebepler + mikro + sınıflandırılmamış."),
        ],
        notes: ["Kesişen kova (yuvası atanmamış) toplama ikinci kez EKLENMEZ — ekrandaki kutularla aynı okuma."],
      },
    ],
  };
}

// ---------- ③ Vardiya Karnesi ------------------------------------------------

export function buildVardiyaKarnesiExport(opts: { rapor: ShiftScorecardReport; day: string; filterLabel?: string | null; extraNotes?: string[] }): ReportExportSpec {
  const { rapor, day, filterLabel, extraNotes = [] } = opts;
  return {
    title: "Vardiya Karnesi",
    subtitle: `Fabrika günü ${day}`,
    orientation: "landscape",
    meta: [
      ...filterNote("Vardiya", filterLabel),
      ...extraNotes,
      "Her satır kaynağını taşır; toplam tek yüzdeye çökertilmez.",
      UNMEASURED_NOTE,
      SOURCE_COLUMN_NOTE,
      ...horizonNotes(rapor.meta),
    ],
    tables: rapor.vardiyalar.map((v) => ({
      name: `${v.shift.code} ${v.shift.name}`.slice(0, 31),
      columns: [
        { header: "Tezgah", key: "tezgah", width: 24 },
        { header: "Kaynak", key: "kaynak", width: 14 },
        { header: "Atkı", key: "atki", width: 12, numFmt: "#,##0", align: "right" },
        { header: "Metre", key: "metre", width: 12, align: "right" },
        { header: "Duruş", key: "durus", width: 12, align: "right" },
        { header: "Kullanılabilirlik", key: "k", width: 16, align: "right" },
        { header: "Performans", key: "p", width: 14, align: "right" },
        { header: "Etkinlik", key: "e", width: 12, align: "right" },
        { header: "Durum", key: "durum", width: 12 },
      ],
      rows: v.makineler.map((m) => ({
        tezgah: `${m.machine.code} · ${m.machine.name}`,
        kaynak: sourceCell(m),
        atki: m.unitsActual,
        metre: m.producedM === null ? "—" : m.producedM.toLocaleString("tr-TR"),
        durus: fmtSec(m.durusSec),
        k: formatPct(m.availabilityPct),
        p: formatPct(m.performancePct),
        e: formatPct(m.effectivenessPct),
        durum: m.sealState === "SEALED" ? "Mühürlü" : m.live ? "Anlık" : "Açık",
      })),
      notes: [
        `${v.shift.name} (${v.shift.code})${v.isCancelled ? " · İPTAL" : ""} · atkı ${fmtInt(v.uretim.unitsActual)} · metre ${v.uretim.producedM === null ? "—" : v.uretim.producedM.toLocaleString("tr-TR")} · duruş ${fmtSec(v.durusSec)}.`,
        `${v.ozet.toplamSatir} tezgah satırı: ${v.ozet.olculen} ölçüldü · ${v.ozet.elle} elle girildi · ${v.ozet.simule} simüle · ${v.ozet.cikarim} çıkarım (boş tezgah) · ${v.ozet.olculemedi} ölçülemedi.`,
        ...sourceBreakdownNote(v.kaynakKirilimi, "satır"),
      ],
    })),
  };
}

// ---------- ④ Karne Listesi ve Mühür -----------------------------------------

export function buildKarneExport(opts: { rows: ShiftStatRow[]; periodLabel: string; meta?: { total: number; live: number; sealed: number } }): ReportExportSpec {
  const { rows, periodLabel, meta } = opts;
  return {
    title: "Karne Listesi ve Mühür",
    subtitle: periodLabel,
    orientation: "landscape",
    meta: [
      "Mühürsüz satır ANLIK hesaplanır; mühürlü satır RESMÎ rakamdır. Karne, vardiya bitiminden 60 dk sonra kapanış işiyle yazılır.",
      UNMEASURED_NOTE,
      SOURCE_COLUMN_NOTE,
      ...(meta ? [`Liste: ${fmtInt(meta.total)} satır · anlık ${meta.live} · mühürlü ${meta.sealed}.`] : []),
    ],
    tables: [
      {
        name: "Vardiya × tezgah",
        columns: [
          { header: "Tezgah", key: "tezgah", width: 24 },
          { header: "Gün", key: "gun", width: 12 },
          { header: "Vardiya", key: "vardiya", width: 14 },
          { header: "Kaynak", key: "kaynak", width: 14 },
          { header: "Planlı", key: "planli", width: 12, align: "right" },
          { header: "Çalıştı", key: "calisti", width: 12, align: "right" },
          { header: "Atkı", key: "atki", width: 12, numFmt: "#,##0", align: "right" },
          { header: "K", key: "k", width: 12, align: "right" },
          { header: "P", key: "p", width: 12, align: "right" },
          { header: "E", key: "e", width: 12, align: "right" },
          { header: "Durum", key: "durum", width: 12 },
          { header: "Kuşak", key: "kusak", width: 9, align: "right" },
          { header: "Uyarı", key: "uyari", width: 9, numFmt: "#,##0", align: "right" },
        ],
        rows: rows.map((r) => ({
          tezgah: `${r.machine.code} · ${r.machine.name}`,
          gun: r.shiftInstance.factoryDayKey.slice(0, 10),
          vardiya: r.shiftInstance.shiftDefinition.name,
          kaynak: r.emptyLoom ? "Boş tezgah" : SOURCE_LABELS[r.terms.source],
          planli: fmtSec(r.terms.potSec),
          calisti: fmtSec(r.terms.aptSec),
          atki: r.terms.unitsActual,
          k: formatPct(r.kpis.availabilityPct),
          p: formatPct(r.kpis.performancePct),
          e: formatPct(r.kpis.effectivenessPct),
          durum: r.sealState === "SEALED" ? "Mühürlü" : r.live ? "Anlık" : "Açık",
          kusak: r.sealGeneration > 0 ? String(r.sealGeneration) : "",
          uyari: r.warnings.length,
        })),
        notes: [
          "Karne satırı yazılmamış (statId yok) vardiyalarda mühür eylemleri kapalıdır; satır yine anlık rakamla listelenir.",
        ],
      },
    ],
  };
}
