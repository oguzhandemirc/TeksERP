// =============================================================================
// DEMO REJİM KAPISI
// =============================================================================
// `demo.modeEnabled` bir GÖRÜNÜRLÜK ayarı DEĞİL, bir REJİM anahtarıdır —
// `finance.middleware.ts` ile birebir aynı gerekçe. Panelde düğmeyi çizmemek
// yetmez: adresi bilen (ya da eski bir sekmesi açık kalan) biri ucu yine
// çağırabilirdi ve demo senaryosu GERÇEK bir fabrikada veri üretirdi.
//
// ⚠️ Bu kapı `requirePermission`'ın YERİNE GEÇMEZ, ONA EKLENİR. İki farklı soru:
// bayrak "bu kurulum bir demo mu", izin "bu kişi bunu yapabilir mi". Demo uçları
// simüle ettikleri GERÇEK işin iznini de arar (etiket senaryosu `label:print`,
// iş emri senaryosu `workorder:write`) — bayrak zaten kapatıyor olsa bile,
// sürümde bir yetki YÜKSELTME yüzeyi bırakmamak için.
//
// ⚠️ Okuma CACHE'SİZ: bayrak acil kapatma anahtarıdır (kk1 tuzağı emsali).
// Yanlışlıkla açık kalmış bir demo modunu kapatmanın etkisi BİR SONRAKİ istekte
// görünmelidir; 5 dakikalık bir önbellek burada "kapattım ama hâlâ çalışıyor"
// demektir.
//
// ⚠️ 403, 404 DEĞİL: kaynak VAR, bu kurulum demo değil. 404 dönmek destek
// ekibini "uç deploy edilmemiş" diye yanlış yöne gönderirdi (finance emsali).
// =============================================================================
import { Request, Response, NextFunction } from "express";
import { readDemoModeEnabled } from "../services/system-setting.service";
import { AppError } from "../utils/app-error";

export async function requireDemoMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const enabled = await readDemoModeEnabled();
    if (!enabled) {
      throw AppError.forbidden(
        "Demo yardımcıları bu kurulumda kapalı. Genel Ayarlar → Demo bölümünden açılabilir.",
      );
    }
    next();
  } catch (e) {
    next(e);
  }
}
