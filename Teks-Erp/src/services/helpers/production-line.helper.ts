// =============================================================================
// ÜRETİM HATTI YÜKLEMİ — "bu hat numarası bu makinede var mı"
// =============================================================================
// ⚠️ BU BİR GUARD DEĞİL, BİR YÜKLEMDİR. Ayrım P4b'de hükme bağlandı:
//   guard  = bir YOLU korur   ⇒ yol yoksa erişilemez dal ("basılmayan dalın yeşili")
//   yüklem = bir SORUYU cevaplar ⇒ çağrısız da doğru ya da yanlıştır, ve ÖLÇÜLEBİLİR
// Bu yüzden yazma yüzeyinden ÖNCE inebilir: çağrısız bir yüklem erişilemez bir dal
// üretmez, yalnız yanlış yazılmış olabilir — ve bekçisi tam olarak onu ölçer.
//
// Çağıran yol: `openMachineRun` → `machine-run-open.helper.ts` `resolveOpenContext` (bekçi: `test_production_line §4`
// + `test_machine_run §7`). Yüklemin doğru olması ÇAĞRILDIĞI anlamına gelmez;
// bekçi davranışı yoldan ölçer, varlığı değil.
//
// NEDEN DB'DE DEĞİL: PostgreSQL satırlar arası CHECK desteklemez —
// `machine_runs.productionLineNo <= machines.productionLineCount` iki tablo
// arasındadır. DB'deki `machines_productionLineCount_pos` yalnız ALT sınırı
// (`>= 1`) tutar; ÜST sınır buranın işidir.
// =============================================================================
import { AppError } from "../../utils/app-error";

/** Hat numarasının alt sınırı — `machines_productionLineCount_pos` CHECK'inin ikizi. */
const MIN_PRODUCTION_LINE_NO = 1;

/**
 * Bir koşumun/ölçümün üretim hattı numarasını makinenin hat sayısına karşı doğrular.
 *
 * @param productionLineNo  Yazılmak istenen hat numarası (`MachineRun.productionLineNo`).
 * @param productionLineCount  Makinenin hat sayısı (`Machine.productionLineCount`).
 * @throws {AppError} 400 `PRODUCTION_LINE_OUT_OF_RANGE`
 */
export function assertProductionLineValid(
  productionLineNo: number,
  productionLineCount: number,
): void {
  // ⚠️ Tam sayı kontrolü ÖNCE: `2.5 <= 4` doğrudur ve sessizce geçerdi.
  if (!Number.isInteger(productionLineNo)) {
    throw AppError.badRequest("Üretim hattı numarası tam sayı olmalıdır", {
      code: "PRODUCTION_LINE_OUT_OF_RANGE",
      productionLineNo,
    });
  }
  if (productionLineNo < MIN_PRODUCTION_LINE_NO) {
    throw AppError.badRequest("Üretim hattı numarası 1'den küçük olamaz", {
      code: "PRODUCTION_LINE_OUT_OF_RANGE",
      productionLineNo,
    });
  }
  if (productionLineNo > productionLineCount) {
    // Mesaj SAYIYI söyler: "geçersiz hat" operatöre hangi makineye baktığını
    // sormayı bırakmaz; "2 hattı var" tek okumada karar verdirir.
    throw AppError.badRequest(
      `Bu makinenin ${productionLineCount} üretim hattı var; ${productionLineNo}. hat yok`,
      { code: "PRODUCTION_LINE_OUT_OF_RANGE", productionLineNo, productionLineCount },
    );
  }
}
