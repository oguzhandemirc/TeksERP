// =============================================================================
// DOKUMA RAPORLARI — DIŞA AKTARIM SPEC'İ (Excel · PDF · Yazdır)
// =============================================================================
// Karne Listesi ortak kalıba katılır: TEK spec, üç çıktı (`reportExport.ts`).
// (Randıman · Duruş Pareto · Vardiya Karnesi spec'leri sayfalarıyla kalktı, 2026-11-12.)
//
// ⚠️ "ölçülemedi" BEYANDIR, boş hücre değil: payda yoksa oran hesaplanmaz ve
// hücreye o kelime yazılır. Bu yüzden oran kolonları SAYI DEĞİL METİN taşır
// (`formatPct` çıktısı) — sayıya zorlansaydı "ölçülemedi" 0'a düşerdi.
// Süreler ekrandaki biçimle yazılır ("1 sa 05 dk"): tablo EKRANIN aynası olsun.
// =============================================================================
import type { ReportExportSpec } from "../_components/reportExport";
import { fmtInt } from "../_components/formatters";
import { fmtSec } from "./DokumaShared";
import { SOURCE_LABELS, formatPct } from "./dokuma-regime";
import type { ShiftStatRow } from "./service";

const UNMEASURED_NOTE =
  "Oran kolonlarında 'ölçülemedi' bir BEYANDIR (payda yok), sıfır değildir — sayıya çevrilmemelidir.";
const SOURCE_COLUMN_NOTE = "Kaynak kolonu satırın ölçülmüş mü elle mi girilmiş olduğunu söyler; simüle değer elle girişten ayrı sayılır.";

// ---------- Karne Listesi ve Mühür -----------------------------------------

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
          { header: "Atkı", key: "atki", width: 12, numFmt: "0", align: "right" },
          { header: "K", key: "k", width: 12, align: "right" },
          { header: "P", key: "p", width: 12, align: "right" },
          { header: "E", key: "e", width: 12, align: "right" },
          { header: "Durum", key: "durum", width: 12 },
          { header: "Kuşak", key: "kusak", width: 9, align: "right" },
          { header: "Uyarı", key: "uyari", width: 9, numFmt: "0", align: "right" },
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
