// Hata tipi gövdesinde `defectGroup` doğrulaması (R1-BOYUT). Küme YALNIZ `constants/hata-gruplari.ts`ten
// okunur (DB CHECK yok; ikinci liste `test_hata_gruplari` ile kırmızı). Bilinmeyen kod 400, boş = null.
import { DEFECT_GROUPS, isDefectGroup } from "../../constants/hata-gruplari";
import { AppError } from "../../utils/app-error";

/** Gövdeyi YERİNDE düzeltir: "" → null; alan hiç gelmezse dokunulmaz (eski panel göndermez). */
export function normalizeDefectGroupBody(body: Record<string, unknown>): void {
  if (!("defectGroup" in body) || body.defectGroup === undefined) return;
  const value = body.defectGroup;
  if (value === null || value === "") {
    body.defectGroup = null;
    return;
  }
  if (!isDefectGroup(value)) {
    throw AppError.badRequest(
      `Geçersiz hata grubu: "${String(value)}". Geçerli değerler: ${DEFECT_GROUPS.join(", ")} (boş = gruplanmamış).`,
      { code: "INVALID_DEFECT_GROUP" },
    );
  }
}
