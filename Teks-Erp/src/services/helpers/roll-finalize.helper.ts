// =============================================================================
// Roll finalize helper — "her rotanın son adımı final üretir"
// =============================================================================
// Tambur'un kalite→durum finalize mantığının (resolveCutStatus + katalog haritası)
// JENERİK versiyonu: HERHANGİ bir rotanın son adımı bitince (Kurşun/QC2 ya da ileride
// başka bir istasyon) toplar WAREHOUSE'a (kaliteye göre) çekilir — artık PRODUCED
// limbosu yok. Tambur kendi çocuk-üretim akışını korur; bu helper yalnız MEVCUT
// topları son adımda finalize eder.
// =============================================================================
import { Prisma, RollStatus, RollForm } from "@prisma/client";
import { reserveRollBarcodesInOrder, type RollBarcodeType } from "./roll-barcode.helper";

export type TxClient = Prisma.TransactionClient;

/**
 * Kalite kodları → katalog `targetStatus` + `id` haritaları (Tambur :637-652 ile aynı
 * desen). null/boş kodlar atlanır → resolveFinalStatus onları WAREHOUSE'a düşürür.
 */
export async function loadQualityTargetMaps(
  tx: TxClient,
  codes: Array<string | null | undefined>,
): Promise<{ statusByCode: Map<string, RollStatus>; idByCode: Map<string, string> }> {
  const uniqueCodes = Array.from(new Set(codes.filter((c): c is string => !!c)));
  const rows = uniqueCodes.length
    ? await tx.qualityGrade.findMany({
        where: { code: { in: uniqueCodes } },
        select: { id: true, code: true, targetStatus: true },
      })
    : [];
  return {
    statusByCode: new Map(rows.map((q) => [q.code, q.targetStatus])),
    idByCode: new Map(rows.map((q) => [q.code, q.id])),
  };
}

/**
 * Kalite kodundan final durum — kod yok ya da katalogda yoksa WAREHOUSE
 * (Tambur `resolveCutStatus` + "kalite belirsizse WAREHOUSE" kuralı).
 */
export function resolveFinalStatus(
  code: string | null | undefined,
  statusByCode: Map<string, RollStatus>,
): RollStatus {
  return (code ? statusByCode.get(code) : undefined) ?? RollStatus.WAREHOUSE;
}

/** Final duruma göre barkod tipi — satılabilire (WAREHOUSE/A1_STOCK) inen "F", diğer "H". */
export function finalBarcodeType(status: RollStatus): RollBarcodeType {
  return status === RollStatus.WAREHOUSE || status === RollStatus.A1_STOCK ? "F" : "H";
}

export interface FinalizedRoll {
  rollId: string;
  status: RollStatus;
  barcode: string;
  barcodeGenerated: boolean;
}

/**
 * Rotanın SON adımı bitince MEVCUT topları finalize eder. Her top için:
 *  - kalite kodundan durum çöz (varsayılan WAREHOUSE),
 *  - `currentStepId = null` (istasyondan çıktı),
 *  - `form = ACIK` (Tambur-DIŞI çıktı = açık kumaş; Tambur kendi TOP çocuklarını ayrı üretir),
 *  - `qualityGradeId` boşsa katalogdan doldur,
 *  - barkod yoksa üret ("her kumaşa etiket"; barkod KALICI kimlik → varsa dokunulmaz,
 *    böylece re-finalize idempotent).
 *
 * ÇAĞIRAN sorumluluğu: `recomputeStepStatus` + `completeWorkOrderIfStepsDone` bu helper
 * DÖNDÜKTEN SONRA çağrılır (WO/kart tamamlama akışı değişmez). tx'te SIRALI çalışır
 * (Promise.all yasak; barkod sayacı zaten satır-kilidiyle serileşir).
 */
export async function finalizeRollsAtLastStep(
  tx: TxClient,
  rollIds: string[],
): Promise<FinalizedRoll[]> {
  if (rollIds.length === 0) return [];
  const rolls = await tx.roll.findMany({
    where: { id: { in: rollIds } },
    select: { id: true, barcode: true, qualityGrade: true, qualityGradeId: true },
  });
  const { statusByCode, idByCode } = await loadQualityTargetMaps(
    tx,
    rolls.map((r) => r.qualityGrade),
  );

  // Barkod gereken toplar için TEK rezervasyon (tip başına tek ifade).
  // (2026-08-10 denetimi, F-CORE-VER-001) Eskiden döngü her barkodsuz top için
  // ayrı bir sayaç turu atıyordu; N top = N gidiş-dönüş ve sayaç satırının kilidi
  // ilk turdan itibaren zaten tutuluyordu, yani araya giren her tur kilidi o
  // kadar daha uzun tutuyordu. Artık tip başına tek ifade.
  //
  // ⚠️ REZERVASYON BİLİNÇLİ OLARAK TX'İN İÇİNDE KALDI, dışarı taşınmadı.
  // Taşımak imkânsız: çağıranların ikisinde (`kursun-bypass.service` ~1386,
  // `kursun-qc.service` ~866) `rollIds` listesi tx'in İÇİNDE hesaplanıyor
  // (o an hareketi kapanan toplar) — çağıran tx açılmadan hangi topların
  // barkoda ihtiyacı olduğunu BİLEMEZ. Tx içinde kalmanın bir kazancı da var:
  // tx geri sararsa sayaç artışı da geri sarılır, boşluk doğmaz.
  const statusOf = new Map(rolls.map((r) => [r.id, resolveFinalStatus(r.qualityGrade, statusByCode)]));
  const needBarcode = rolls.filter((r) => !r.barcode);
  const reserved = await reserveRollBarcodesInOrder(
    tx,
    needBarcode.map((r) => finalBarcodeType(statusOf.get(r.id)!)),
  );
  const barcodeFor = new Map(needBarcode.map((r, i) => [r.id, reserved[i]!]));

  const out: FinalizedRoll[] = [];
  for (const r of rolls) {
    const status = statusOf.get(r.id)!;
    let barcode = r.barcode;
    let barcodeGenerated = false;
    if (!barcode) {
      barcode = barcodeFor.get(r.id)!;
      barcodeGenerated = true;
    }
    const resolvedQualityGradeId =
      r.qualityGradeId ?? (r.qualityGrade ? idByCode.get(r.qualityGrade) ?? null : null);
    await tx.roll.update({
      where: { id: r.id },
      data: {
        status,
        currentStepId: null,
        form: RollForm.ACIK,
        ...(barcodeGenerated ? { barcode } : {}),
        ...(resolvedQualityGradeId && resolvedQualityGradeId !== r.qualityGradeId
          ? { qualityGradeId: resolvedQualityGradeId }
          : {}),
      },
    });
    out.push({ rollId: r.id, status, barcode: barcode as string, barcodeGenerated });
  }
  return out;
}
