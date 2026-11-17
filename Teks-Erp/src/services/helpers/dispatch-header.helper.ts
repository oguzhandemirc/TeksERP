// =============================================================================
// FASON BAŞLIK DARALTMASI — iş emri yolu ↔ dokuma işi yolu (G2, 2026-09-14) ↔ devere siparişi yolu (D4b, 2026-11-17)
// =============================================================================
// `SubcontractorDispatch` / `SubcontractorReceipt` başlığı POLİMORFİK: ya iş emri
// adımına (`workOrderId`+`stepId`[+`batchId`]) ya dokuma işine (`weavingOrderId`) ya da (yalnız sevk)
// fason devere siparişine (`warpingOrderId`) bağlı — tam biri (CHECK `*_header_ck`). İş emri yolundaki her okuyucu yüklediği
// kaydı BURADAN geçirir: tip `string | null`dan `string`a iner VE dokuma işine
// bağlı kayıt o yola girerse 409 verir — aksi hâlde `where: { workOrderId: null }`
// sessizce derlenir ve yanlış satırı okurdu (fail-closed).
// =============================================================================
import { AppError } from "../../utils/app-error";
import { TERIM } from "../../constants/terim";

type HeaderRow = { workOrderId: string | null };

/** İş emrine bağlı başlık: skalerler dolu, yüklenmiş ilişkiler NonNullable. */
export type WorkOrderBound<T> = T & { workOrderId: string } & (T extends { stepId: string | null }
    ? { stepId: string }
    : unknown) &
  (T extends { batchId: string | null } ? { batchId: string } : unknown) &
  (T extends { workOrder: infer W } ? { workOrder: NonNullable<W> } : unknown) &
  (T extends { step: infer S } ? { step: NonNullable<S> } : unknown) &
  (T extends { batch: infer B } ? { batch: NonNullable<B> } : unknown);

export function isWorkOrderBound<T extends HeaderRow>(row: T): row is WorkOrderBound<T> {
  return row.workOrderId !== null;
}

/**
 * İş emri yolunun kapısı: dokuma işine bağlı sevk/makbuz buradan geçemez.
 * Yükleyicinin HEMEN ardında çağrılır (`if (!row) notFound` sonrası).
 */
export function assertWorkOrderBound<T extends HeaderRow>(
  row: T,
  what = "Fason sevki",
): asserts row is WorkOrderBound<T> {
  if (row.workOrderId === null) {
    throw AppError.conflict(`${what} bir ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} değil dokuma iş emrine ya da devere siparişine bağlı — bu işlem ${TERIM.terbiyeIsEmri.tekilKucuk} yolundadır`, {
      code: "DISPATCH_NOT_WORK_ORDER_BOUND",
    });
  }
}

/**
 * Liste daraltması. İş emri KAPSAMLI sorguda (`where: { workOrderId }`) çalışma
 * zamanında no-op; fasoncu-geneli listede dokuma sevklerini dışarıda bırakır —
 * o listeler iş emri kolonlarını okur, dokuma sevkinin kendi yüzeyi vardır.
 */
export function workOrderBoundOnly<T extends HeaderRow>(rows: T[]): WorkOrderBound<T>[] {
  return rows.filter(isWorkOrderBound);
}

/** İş emri yolundaki tek alan okuması (`stepId`) — daraltmanın nokta biçimi, aynı kapı. */
export function workOrderStepIdOf(row: { workOrderId: string | null; stepId: string | null }, what?: string): string {
  assertWorkOrderBound(row, what);
  return row.stepId;
}

/** Dokuma işine bağlı başlık kapısı — iş emri belgesi bu yola giremez (ayna: `assertWorkOrderBound`). */
export function assertWeavingBound<T extends { weavingOrderId: string | null }>(
  row: T,
  what = "Fason belgesi",
): asserts row is T & { weavingOrderId: string } {
  if (row.weavingOrderId === null) {
    throw AppError.conflict(`${what} dokuma iş emrine bağlı değil (${TERIM.terbiyeIsEmri.tekilKucuk} ya da devere siparişi belgesi) — bu işlem kendi yolundan yapılır`, {
      code: "DISPATCH_NOT_WEAVING_BOUND",
    });
  }
}

export function isWarpingBound<T extends { warpingOrderId: string | null }>(row: T): row is T & { warpingOrderId: string } {
  return row.warpingOrderId !== null;
}

/** Fason devere siparişine bağlı sevk kapısı (D4b) — iş emri ve dokuma sevki devere yoluna giremez (ayna). */
export function assertWarpingBound<T extends { warpingOrderId: string | null }>(
  row: T,
  what = "Fason sevki",
): asserts row is T & { warpingOrderId: string } {
  if (row.warpingOrderId === null) {
    throw AppError.conflict(`${what} fason devere siparişine bağlı değil — bu işlem kendi yolundan yapılır`, {
      code: "DISPATCH_NOT_WARPING_BOUND",
    });
  }
}
