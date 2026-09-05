// =============================================================================
// ÖN MUHASEBE REJİM KAPISI
// =============================================================================
// `finance.enabled` bir GÖRÜNÜRLÜK ayarı DEĞİL, bir REJİM anahtarıdır. Menüyü
// gizlemek yetmez: adresi bilen (ya da eski bir sekmesi açık kalan) bir kullanıcı
// ekranı yine açar ve modül kapalıyken cari deftere satır yazılabilirdi.
//
// ⚠️ Bu kapı `requirePermission`'ın YERİNE GEÇMEZ, ONA EKLENİR. İkisi farklı
// soruları sorar: bayrak "bu kurulum bu modülü kullanıyor mu", izin "bu kişi
// bunu yapabilir mi". Fabrikada bayrak kapalı olduğu için izin taşıyan
// muhasebeci bile modülü açamaz — sıfır-fark garantisinin ayağı budur.
//
// ⚠️ Okuma CACHE'SİZ: bayrak acil kapatma anahtarıdır (kk1 tuzağı emsali).
// Modül sahada yanlış davranırsa tek geri dönüş yolu onu kapatmaktır ve
// kapatmanın etkisi bir sonraki istekte görünmelidir.
// =============================================================================
import { Request, Response, NextFunction } from "express";
import { readFinanceEnabled } from "../services/system-setting.service";
import { AppError } from "../utils/app-error";

export async function requireFinanceEnabled(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const enabled = await readFinanceEnabled();
    if (!enabled) {
      // 403 (404 değil): kaynak VAR, bu kurulumda kapalı. 404 dönmek destek
      // ekibini "uç deploy edilmemiş" diye yanlış yöne gönderirdi.
      //
      // ⚠️ `details.code` KARDEŞ KAPILARLA AYNI SÖZLEŞME (`module.middleware`
      // `modulKapali`): istemci "modül kapalı"yı metinden değil koddan ayırt
      // eder. `code` TOP-LEVEL DEĞİL — `error.middleware` onu `details` altına
      // basar; `body.code` arayan istemci sessizce hep `undefined` okur.
      throw AppError.forbidden(
        "Ön muhasebe modülü bu kurulumda kapalı. Genel Ayarlar → Muhasebe bölümünden açılabilir.",
        { code: "MODULE_DISABLED", modul: "finance" },
      );
    }
    next();
  } catch (e) {
    next(e);
  }
}
