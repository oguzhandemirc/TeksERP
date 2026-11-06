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
import { SETTING_KEYS, readFinanceEnabled, resolveServiceBillingEnabled } from "../services/system-setting.service";
import { licenseModuleError } from "../lib/license/module-ceiling";
import { AppError } from "../utils/app-error";
import { settingScreenPath } from "../constants/panel-ayar-yolu";

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
      // Lisans kapatıyorsa `LICENSE_MODULE` (bayrak DB'de açık olsa da) — kardeş kapılarla aynı.
      throw licenseModuleError(SETTING_KEYS.FINANCE_ENABLED, "Ön muhasebe") ?? AppError.forbidden(
        `Ön muhasebe modülü bu kurulumda kapalı. ${settingScreenPath("modules")} ekranından açılabilir.`,
        { code: "MODULE_DISABLED", modul: "finance" },
      );
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Hizmet faturası alt anahtarı (`finance.serviceBilling.enabled`) — hizmet fiyat tablosu uçları.
 * `requireFinanceEnabled`ten SONRA takılır (ön muhasebe kapalıysa o kapı lisansı da sorarak cevaplar);
 * Alt anahtar lisans modülü değildir → kod `SERVICE_BILLING_DISABLED` (dönem faturası emsali), `MODULE_DISABLED` değil.
 */
export async function requireServiceBillingEnabled(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!(await resolveServiceBillingEnabled())) {
      throw AppError.forbidden(
        `Hizmet faturası bu kurulumda kapalı. ${settingScreenPath("finance")} ekranından açılabilir.`,
        { code: "SERVICE_BILLING_DISABLED" },
      );
    }
    next();
  } catch (e) {
    next(e);
  }
}
