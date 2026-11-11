// =============================================================================
// AÇILIŞ PANOSU — üretim ayrıntısı kutuları: istasyon üretimi · açık iş emri · kalite özeti
// =============================================================================
// İstasyon: Nerede Takıldı (WIP) karnesinin dönem "geçen" sayıları (`passedQty`/`passedCount`).
// Açık iş emri: `OPEN_WORK_ORDER` yüklemi + durum kırılımı (termin/gecikme YOK).
// Kalite: Kalite Karnesi (kalite payları, 1. kalite rolden) + Fire Karnesi (hurda oranı, bin metrede
// hata) — iki karnenin alanları aynen; fire tek tanımlı (`raporlar.md`).
// =============================================================================
import { WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { OPEN_WORK_ORDER } from "../helpers/live-ref-where.helper";
import { getWipScorecard } from "../reports/wip-scorecard.report.service";
import { getQualityScorecard } from "../reports/quality-scorecard.report.service";
import { getScrapScorecard } from "../reports/scrap-scorecard.report.service";
import type { BoxInput } from "./pano-kutu-mevcut";

export async function stationOutputBox({ src }: BoxInput) {
  const wip = await src.once("wip", () => getWipScorecard(src.window.aralik));
  return {
    istasyonlar: wip.byStation
      .filter((s) => s.passedCount > 0)
      .sort((a, b) => b.passedQty - a.passedQty || a.label.localeCompare(b.label, "tr"))
      .map((s) => ({ istasyonId: s.key, ad: s.label, tur: s.kind, metre: s.passedQty, top: s.passedCount })),
    toplam: { metre: wip.summary.passedQty, top: wip.summary.passedCount },
  };
}

/** Durum kırılımı sabit sırada; boş durum 0 ile döner (grafik ekseni oynamasın). */
export async function openWorkOrdersBox({ src }: BoxInput) {
  const rows = await src.once("openWo", () => prisma.workOrder.groupBy({ by: ["status"], where: OPEN_WORK_ORDER, _count: { _all: true } }));
  const count = (s: WorkOrderStatus): number => rows.find((r) => r.status === s)?._count._all ?? 0;
  const planli = count(WorkOrderStatus.PLANNED);
  const uretimde = count(WorkOrderStatus.IN_PROGRESS);
  return { toplam: planli + uretimde, durumlar: [{ durum: WorkOrderStatus.PLANNED, adet: planli }, { durum: WorkOrderStatus.IN_PROGRESS, adet: uretimde }] };
}

export async function qualityBox({ src }: BoxInput) {
  const [q, s] = await Promise.all([
    src.once("quality", () => getQualityScorecard(src.window.aralik)),
    src.once("scrap", () => getScrapScorecard(src.window.aralik)),
  ]);
  const top = q.summary.topGrade;
  return {
    bitenMetre: q.summary.totalQty,
    bitenTop: q.summary.rollCount,
    kalitesizMetre: q.summary.ungradedQty,
    // 1. kalite rolü atanmamışsa null (karne kartı da çizilmez).
    birinciKalite: top ? { kod: top.code, ad: top.name, metre: top.qty, yuzde: top.pct } : null,
    kaliteler: q.grades.filter((g) => g.qty > 0).map((g) => ({ kaliteId: g.gradeId, kod: g.code, ad: g.name, metre: g.qty, yuzde: g.pct })),
    fire: { hurdaMetre: s.summary.scrapQty, hurdaYuzde: s.summary.scrapPct, tespitEdilenHata: s.summary.defectsDetected, binMetredeHata: s.summary.defectsPerThousandM },
  };
}
