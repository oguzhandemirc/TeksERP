/**
 * K29 "Bitmiş say ve geç" yetkisi — TEK kaynak (S15b): `POST /api/scan-route` guard'ı ve önizlemenin
 * `canClose` alanı buradan okur. İzin kümesi kapatma ucunun (`POST /api/kursun-qc/finish-step`) iznidir;
 * yoksa yalnız Tambur yetkili operatör kurşun/KK adımını kapatabilirdi (s14 inceleme).
 */
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { AppError } from "../../utils/app-error";

export const SCAN_ROUTE_CLOSE_PERMISSIONS = ["quality:write", "mobile:kk2-kursun"] as const;

export const canCloseOpenStep = (permissions: readonly string[]): boolean =>
  SCAN_ROUTE_CLOSE_PERMISSIONS.some((p) => matchesPermission(permissions, p));

export function assertCanCloseOpenStep(permissions: readonly string[]): void {
  if (canCloseOpenStep(permissions)) return;
  throw AppError.forbidden("Önceki istasyondaki işi bitirme yetkiniz yok; o istasyonun ekranından bitirilmeli.", {
    code: "SCAN_ROUTE_CLOSE_FORBIDDEN",
    requiredAny: [...SCAN_ROUTE_CLOSE_PERMISSIONS],
  });
}
