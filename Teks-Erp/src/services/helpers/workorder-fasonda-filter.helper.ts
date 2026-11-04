// =============================================================================
// İş emri listesi — "en az bir topu fasonda" süzgeci (`filter[fasonda]=1`)
// =============================================================================
// Anlam liste rozetiyle (`withProductionMeters` → `currentFasonStations`) AYNI:
// WO'nun bir adımında `currentStepId` taşıyan ve durumu AT_SUBCONTRACTOR olan top.
// Bu serviste `buildWhereClause` allowlist kullanmaz; anahtar okunup filtre
// kümesinden SİLİNMEZSE Prisma where'ine sızar ve 500 verir.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/** Panelin gönderdiği filtre anahtarı. Tek yerde tanımlı — servislere kopyalama. */
export const FASONDA_FILTER = "fasonda";

/** Liste rozetiyle aynı yüklem — Prisma parçası. */
export const FASONDA_WHERE: Prisma.WorkOrderWhereInput = {
  steps: { some: { currentRolls: { some: { status: RollStatus.AT_SUBCONTRACTOR } } } },
};

/**
 * Anahtarı filtre kümesinden OKUR ve SİLER. Yoksa `undefined`; `1`/`true` ise
 * where parçası; başka her değer 400 (fail-closed).
 */
export function takeFasondaFilter(
  filters: Record<string, unknown>,
): Prisma.WorkOrderWhereInput | undefined {
  if (!Object.prototype.hasOwnProperty.call(filters, FASONDA_FILTER)) return undefined;
  const raw = filters[FASONDA_FILTER];
  delete filters[FASONDA_FILTER];
  if (raw === "1" || raw === "true" || raw === 1 || raw === true) return FASONDA_WHERE;
  throw AppError.badRequest("Geçersiz 'fasonda' süzgeç değeri; yalnız 1 ya da true kabul edilir.", {
    code: "INVALID_FILTER_VALUE",
  });
}
