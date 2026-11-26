// =============================================================================
// DOKUMA İŞ EMRİ — GERÇEKLEŞEN MALİYET (devere maliyet dilim 2; plan PLAN-devere-maliyet-1126 §3)
// =============================================================================
// `GET /api/cost/weaving-orders/:id/actual`. Sayı tek kaynaktan (`weavingActualCostTx`), metinler rapordan
// (`weaving-efficiency.report`); burası yalnız DTO kurar, panel hesap yapmaz. Devere için standart karşılık YOK:
// standart sürümde devere ek işlem satırı tarife koduyla seçilemiyor (karar K6) — "—" ve not yazılır, 0 değil.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { WEAVING_INFO_CODES, weavingActualCostTx, type WeavingActualMissing } from "./helpers/weaving-actual-cost.helper";
import { missingText, warpingView, warpYarnView } from "./reports/weaving-efficiency.report";
import { qtyText } from "./helpers/qty-text.helper";
import { readCostProfitMachineTime } from "./system-setting.service";

type Dec = Prisma.Decimal;
const dec = (d: Dec | null): string | null => (d === null ? null : d.toDecimalPlaces(4).toString());

export type ActualCostRowKey = "TEZGAH" | "DEVERE" | "COZGU_IPLIGI";

export interface ActualCostRow {
  anahtar: ActualCostRowKey;
  ad: string;
  /** Standart sürümdeki karşılık (TL/m); karşılık yoksa null. */
  standartTlM: string | null;
  /** Gerçekleşen (TL/m); ölçülemediyse null — `eksik` sebebini söyler. */
  gercekTlM: string | null;
  /** Günlük dilde kaynak (ör. "fatura", "tarife (tahmini)"). */
  kaynak: string | null;
  /** Değerin bir kısmı ya da tamamı tahmin. */
  tahmini: boolean;
  eksik: string[];
}

export interface WeavingOrderActualCost {
  isEmriId: string;
  isEmriNo: string;
  devamEdiyor: boolean;
  /** İşin canlı top metresi. */
  topMetre: string;
  satirlar: ActualCostRow[];
  notlar: string[];
}

const texts = (codes: WeavingActualMissing[]): string[] => codes.filter((m) => !WEAVING_INFO_CODES.includes(m)).map(missingText);

/** İş emrinin gerçekleşen maliyeti, standart karşılıklarıyla. İş yoksa 404. */
export async function getWeavingOrderActualCost(id: string): Promise<WeavingOrderActualCost> {
  const [w] = await weavingActualCostTx(prisma, [id], await readCostProfitMachineTime());
  if (!w) throw AppError.notFound("Dokuma iş emri bulunamadı.");
  const loomMissing = w.missing.filter((m) => m !== "STANDART_YOK" && (m !== "TOP_YOK" || w.runCount > 0));
  const rows: ActualCostRow[] = [{
    anahtar: "TEZGAH",
    ad: "Tezgâh (dokuma)",
    standartTlM: dec(w.standardPerMTry),
    gercekTlM: dec(w.actualPerMTry),
    kaynak: w.timeSource === "NORM" ? "metre normundan tezgâh süresi" : "koşum süresi × tezgâh saat ücreti",
    tahmini: false,
    eksik: texts(loomMissing),
  }];
  if (w.warpingMissing !== null) {
    const v = warpingView(w);
    rows.push({
      anahtar: "DEVERE", ad: "Devere (çözgü sarımı)", standartTlM: null, gercekTlM: dec(w.warpingPerMTry),
      kaynak: v.sourceText, tahmini: w.warpingSource === "TARIFE" || w.warpingSource === "KARMA", eksik: texts(w.warpingMissing),
    });
  }
  if (w.warpYarnMissing !== null) {
    const v = warpYarnView(w);
    rows.push({
      anahtar: "COZGU_IPLIGI", ad: "Çözgü ipliği", standartTlM: dec(w.standardWarpYarnPerMTry), gercekTlM: dec(w.warpYarnPerMTry),
      kaynak: v.sourceText, tahmini: w.warpYarnSource === "MALIYET_FIYATI" || w.warpYarnSource === "KARMA", eksik: texts(w.warpYarnMissing),
    });
  }
  const notes: string[] = [];
  if (w.missing.includes("STANDART_YOK")) notes.push("Ürünün yürürlükte standart maliyeti yok; standart sütunu boş.");
  notes.push(...w.missing.filter((m) => WEAVING_INFO_CODES.includes(m)).map((m) => `Bilgi: ${missingText(m)}.`));
  if (w.ongoing) notes.push("İş devam ediyor: tezgâhta henüz top olmamış kumaş metreye girmedi.");
  if (w.warpingMissing !== null) {
    notes.push("Devere için standart maliyette ayrı kalem seçilemiyor; karşılaştırma yapılmaz.");
    if (w.warpingMissing.includes("COZGU_TUKETIMI")) {
      notes.push(`Devere ve çözgü ipliği yalnız çözgü tüketimi yazılmış toplardan hesaplandı: ${qtyText(w.warpingCoveredMeters ?? 0, 1)} / ${qtyText(w.totalMeters, 1)} m.`);
    }
  }
  return { isEmriId: w.weavingOrderId, isEmriNo: w.weavingOrderNumber, devamEdiyor: w.ongoing, topMetre: dec(w.totalMeters) ?? "0", satirlar: rows, notlar: notes };
}
