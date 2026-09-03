// =============================================================================
// TeksERP — AYAR ŞİFRESİ KAPISI (`requireSettingsPassword`) — 2026-09-03 / P3
// =============================================================================
// Tasarım §7.2: "Davranış bayrağı ekranı her değişiklikte İKİNCİ bir şifre sorar
// — açık kalmış admin oturumundan bayrak değiştirilmesin." Yani bu kapı bir
// YETKİ kapısı DEĞİL, bir NİYET kapısıdır: `admin:settings` iznine zaten sahip
// olan kişiden, o anda klavyenin başında GERÇEKTEN o kişinin olduğunu ispatlaması
// istenir. Bu yüzden izin zincirinin YERİNE geçmez, ARDINA takılır.
//
// KAPSAM — BEŞ YAZMA YÜZEYİ (spec A2 üç sayıyordu; D2 turu ikisini daha buldu):
//   • `PATCH /api/feature-flags`                 (davranış bayrakları + ayarlar)
//   • `PUT   /api/feature-flags/documents-logo`  (firma kimliği)
//   • `PUT   /api/admin/settings/:key`           (yapılandırılmış ham ayarlar)
//   • `PATCH /api/admin/backups/offsite`         (yedek hedefi — 2026-09-03)
//   • `POST  /api/admin/backups/offsite/authorize` (Drive token — 2026-09-03)
//
// ⚠️ KAPSAMIN YÜKLEMİ "AYAR EKRANI" DEĞİL, "`system_settings`e YAZIYOR MU"dur.
//    Son ikisi tam da bu yüzden kaçmıştı: onlar "yedek" ekranında yaşıyor ama
//    `systemSettingService.set()` çağırıyorlar. Yeni bir yüzey eklerken soru
//    budur; bekçi (`test_settings_password` §J tripwire) `src/routes/**`
//    içindeki HER `systemSettingService.set(` / `setFeatureFlags(` /
//    `systemSetting.upsert(` çağıranını tarar ve kapısız olanı KIRMIZI yapar.
//
// ⚠️ HASH YOKSA KAPI UYUR. Sıfır fark kuralı (tasarım §12/1): şifre tanımlı
//    olmayan bir kurulumda hiçbir istek şifre istemez, hiçbir yanıt şekli
//    değişmez. Fabrikada bugün hash satırı YOKTUR → davranış birebir aynıdır.
//
// ⚠️ SÜPERADMİN MUAF. Satıcı hesabı zaten `["*"]` taşır ve ayar şifresini o
//    ÜRETİR — kendi ürettiği kapıda beklemesi, şifreyi unuttuğu anda kurulumu
//    kilitler (kurtarma yolu ortadan kalkar).
//
// ⚠️ BELGE-ONLY GÖVDE MUAF (`.every`, `flagWriteGuard`ın ② dalıyla AYNI yön).
//    Belge şablonu düzenleyen büro personeli `document-template:write` taşır,
//    `admin:settings` taşımaz — ona ayar şifresini dağıtmak, korumanın kapsamını
//    tam da korumadığı kişilere genişletmek olurdu. `.some` yazılsaydı karma
//    gövde (`{documentsConfig, backupHour}`) şifresiz geçerdi: KAÇAK.
//
// ⚠️ ASENKRON — ve bu bilinçli. `flagWriteGuard` senkron kalmak ZORUNDA (bekçi
//    harness'ı `next`i aynı tick'te bekler); bu kapı ondan SONRA gelir, kendi
//    DB okumasını yapar ve senkronluk sözleşmesi taşımaz. Sıra load-bearing:
//    izin kararı ÖNCE verilir, yoksa yetkisiz bir kullanıcı da şifre denemesi
//    yaparak kilit sayacını doldurabilir (meşru yöneticiye DoS).
// =============================================================================

import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error";
import { AuditService } from "../services/audit.service";
import { DOCUMENT_DESIGN_FLAG_KEYS } from "../constants/document-design";
import {
  readSettingsPasswordHash,
  verifySettingsPassword,
  SETTINGS_PASSWORD_EVENTS,
} from "../services/settings-password.service";
import {
  reserveLoginAttempt,
  releaseLoginAttempt,
  resolveLoginLockoutKeys,
  type LockoutKeySpec,
} from "./login-lockout";
import "../types/express-augment";

/** Şifrenin taşındığı başlık. GÖVDEYE KONMAZ — gerekçe aşağıda. */
export const SETTINGS_PASSWORD_HEADER = "x-settings-password";

/**
 * NEDEN BAŞLIK, GÖVDE DEĞİL (üç ayrı gerekçe, üçü de bağımsız):
 *  ① `PATCH /api/feature-flags` gövdesi `z.strictObject` ile doğrulanır —
 *    şemada olmayan bir alan 400 verir; şifreyi şemaya eklemek ise onu
 *    `setFeatureFlags`in yazma dalına bir adım uzaklıkta bırakırdı.
 *  ② Gövdedeki alan `changes`/`oldData`/`newData` yollarından audit'e sızabilir
 *    (maskeleme yalnız `changes` kolonuna uygulanır — sır hijyeni, §12/8).
 *  ③ Aynı middleware BEŞ FARKLI gövde şekline takılır (`{value}`, `{dataUrl}`,
 *    bayrak yükü, `{remote,localDir}`, `{name,token}`); ortak bir alan adı
 *    hepsini kirletirdi.
 *
 * ⚠️ QUERY / GÖVDE / COOKIE FALLBACK'İ YASAK — ve bu bir üslup tercihi değil,
 *    ÖLÇÜLMÜŞ bir sızıntıdır (D2, 2026-09-03). `?sp=` gibi bir yedek okuma
 *    eklenirse şifre İKİ ayrı deftere düz metin düşer:
 *      • erişim logu (morgan) İSTEK URL'İNİ basar — sunucu log dosyasında
 *        `PATCH /api/feature-flags?password=… 403` satırı ölçüldü;
 *      • USED audit yükü isteğin yolunu taşır → `system_logs`.
 *    Cookie de aynı sınıftır (tarayıcı deposu + otomatik yeniden gönderim).
 *    Şifre YALNIZ `x-settings-password` başlığından okunur; bekçi bunu METİNLE
 *    değil DAVRANIŞLA ölçer (§C: gövde/query/cookie/benzer-adlı başlık → 403).
 */
function readHeaderPassword(req: Request): string | null {
  const raw = req.headers[SETTINGS_PASSWORD_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  return value.length > 0 ? value : null;
}

/**
 * Bu kapının kilit kovaları. ⚠️ ÖN EK LOAD-BEARING — ÖLÇÜLDÜ (2026-09-03):
 *
 * `resolveLoginLockoutKeys(req, identity)` varsayılan kapsamda
 * (`LOGIN_LOCKOUT_SCOPE` verilmemiş → `"ip"`) **kimliği DÜŞÜRÜR** ve tek
 * elemanlı `[{ key: <ip> }]` döner. Yani `identity`ye "sp:" yazmak tek başına
 * HİÇBİR ŞEY AYIRMAZ: ayar şifresi denemeleri o IP'nin GİRİŞ kovasına yazılır.
 * Ölçüm: 5 yanlış ayar şifresinden sonra `POST /api/auth/login` `429
 * LOGIN_LOCKED` verdi — yani bir yönetici, ayar şifresini yanlış girerek
 * kendisini ve aynı IP'den giren HERKESİ oturum açamaz hâle getiriyordu (ters
 * yönü de aynı: birkaç yanlış parola, ayar kapısını kilitliyordu).
 *
 * Bu yüzden ayrım anahtarın KENDİSİNDE yapılır — her iki kapsam rejiminde de
 * (`ip` ve `ip|kimlik`) çalışır ve iki-kova davranışı korunur.
 *
 * ⚠️ AYNI ŞALTER, AYRI KOVA: kilit yine `auth.pinLockoutEnabled` ile açılıp
 * kapanır (ayrı bir bayrak İCAT EDİLMEDİ — bir kurulumda deneme sınırı
 * kapatıldıysa o karar burada da geçerlidir); ayrılan yalnız SAYAÇTIR.
 */
function resolveSettingsLockoutKeys(req: Request, userId: string | null): LockoutKeySpec[] {
  return resolveLoginLockoutKeys(req, `sp:${userId ?? "-"}`).map((spec) => ({
    ...spec,
    key: `sp:${spec.key}`,
  }));
}

/** Gövde YALNIZ belge tasarım anahtarları mı taşıyor (boş gövde SAYILMAZ). */
function isDocumentOnlyBody(body: unknown): boolean {
  const keys = Object.keys((body ?? {}) as Record<string, unknown>);
  return keys.length > 0 && keys.every((k) => DOCUMENT_DESIGN_FLAG_KEYS.has(k));
}

/**
 * Ayar şifresi kapısı. Sıra (spec A3) — her adım bir öncekinin ölçümüne dayanır:
 *
 *   ① süperadmin           → geç
 *   ② belge-only gövde     → geç
 *   ③ hash yok             → geç (kapı uyur)
 *   ④ KİLİT REZERVASYONU   → bloklu ise 429 (⚠️ `bcrypt.compare`den ÖNCE)
 *   ⑤ başlık yok           → 403 REQUIRED (audit YOK — istemcinin "sor" turu)
 *   ⑥ şifre yanlış         → 403 INVALID + audit
 *   ⑦ şifre doğru          → rezervasyon geri alınır + audit USED → geç
 */
export async function requireSettingsPassword(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ① Satıcı hesabı — kapıyı o kurar, onda beklemez.
    if (req.isSystemAccount === true) {
      next();
      return;
    }

    // ② Belge tasarımı gövdesi — dar izinli büro personeli bu şifreyi taşımaz.
    if (isDocumentOnlyBody(req.body)) {
      next();
      return;
    }

    // ③ Şifre tanımlı değil → SIFIR FARK.
    const hash = await readSettingsPasswordHash();
    if (!hash) {
      next();
      return;
    }

    const userId = req.user?.userId ?? null;
    // Kilit kovaları GİRİŞ kovalarından AYRI (gerekçe + ölçüm: helper başlığı).
    const lockKeys = resolveSettingsLockoutKeys(req, userId);

    // ④ ⚠️ SIRA LOAD-BEARING — rezervasyon `bcrypt.compare`den ÖNCE.
    //    Ters sırada kilitli bir anahtar da bcrypt (maliyet 10) hesabı
    //    koşturmaya devam eder: hem deneme sınırı hem CPU/DoS ayağı açık kalır.
    //    Birebir emsal: `auth.controller.ts` login yolu.
    //    ⚠️ AYNI ŞALTER: kilit `auth.pinLockoutEnabled` ile açılır/kapanır.
    //    Ayrı bir şalter İCAT EDİLMEDİ — bir kurulumda deneme sınırı kapatılmışsa
    //    o karar burada da geçerlidir; ikinci bir bayrak, panelde "kapattım ama
    //    hâlâ kilitleniyor" ayrışması üretirdi.
    const lock = await reserveLoginAttempt(lockKeys);
    // ⚠️ DENETİM SATIRI KİLİDİN KURULDUĞU ANDA YAZILIR, HER 429'DA DEĞİL.
    //    Eskiden `blocked` dalında yazılıyordu; ÖLÇÜLDÜ (D2): kilitliyken gelen
    //    60 istek 60 satır ekledi. Kilit bir DURUM değil bir GEÇİŞTİR — "kim,
    //    ne zaman kilitlendi" sorusu tek satırla cevaplanır, gerisi gürültüdür
    //    (ve yetkili bir oturumdan `system_logs`u şişirmenin bedava yoluydu).
    //    ⚠️ Bu satırı yazan istek `blocked:false`tur ve aşağıda doğrulamaya
    //    devam eder (403 INVALID alır); 429'lar bir SONRAKİ istekten başlar.
    if (lock.justLocked) {
      void AuditService.logEvent({
        category: "SYSTEM",
        action: SETTINGS_PASSWORD_EVENTS.LOCKED,
        userId,
        tableName: "system_settings",
        payload: { userId, retryAfterSec: lock.retryAfterSec },
      });
    }
    if (lock.blocked) {
      next(
        AppError.tooManyRequests(
          `Çok fazla hatalı ayar şifresi denemesi. ${lock.retryAfterSec} saniye sonra tekrar deneyin.`,
          { code: "SETTINGS_PASSWORD_LOCKED", retryAfterSec: lock.retryAfterSec },
        ),
      );
      return;
    }

    const supplied = readHeaderPassword(req);
    if (supplied === null) {
      // ⑤ İstemcinin İLK turu: başlıksız gönderir, 403 REQUIRED alır, diyaloğu
      //    açar, aynı isteği başlıkla TEKRARLAR. Bu bir saldırı denemesi
      //    DEĞİLDİR → rezervasyon geri alınır (F49 deseni: brute-force olmayan
      //    sonuç kendi artışını düşer, birikmiş gerçek hataları SİLMEZ).
      //    Geri alınmasaydı her kayıt bir deneme yakar ve meşru yönetici birkaç
      //    kayıttan sonra kendi kendini kilitlerdi.
      //    Audit da YAZILMAZ: bu tur her kayıtta bir kez koşar, denetim
      //    tablosunu gürültüye boğardı.
      releaseLoginAttempt(lockKeys);
      next(
        AppError.forbidden("Bu değişiklik için ayar şifresi gerekli.", {
          code: "SETTINGS_PASSWORD_REQUIRED",
        }),
      );
      return;
    }

    // ⑥ Yanlış → rezervasyon DURUR (sayaç ilerler).
    const ok = await verifySettingsPassword(supplied, hash);
    if (!ok) {
      void AuditService.logEvent({
        category: "SYSTEM",
        action: SETTINGS_PASSWORD_EVENTS.FAILED,
        userId,
        tableName: "system_settings",
        payload: { userId },
      });
      next(
        AppError.forbidden("Ayar şifresi hatalı.", {
          code: "SETTINGS_PASSWORD_INVALID",
        }),
      );
      return;
    }

    // ⑦ Doğru. ⚠️ Yük ŞİFRE TAŞIMAZ — yalnız aktör ve HANGİ ALANLARIN
    //    değiştirildiği. `keys` denetimin asıl sorusudur ("hangi bayrak
    //    çevrildi"); değerleri yazmak gereksiz, şifreyi yazmak felaket olurdu.
    releaseLoginAttempt(lockKeys);
    void AuditService.logEvent({
      category: "SYSTEM",
      action: SETTINGS_PASSWORD_EVENTS.USED,
      userId,
      tableName: "system_settings",
      recordId: typeof req.params?.key === "string" ? req.params.key : undefined,
      payload: {
        userId,
        keys: Object.keys((req.body ?? {}) as Record<string, unknown>),
        // ⚠️ `req.baseUrl + req.path` — `req.originalUrl` DEĞİL, salt `req.path` de DEĞİL.
        // `originalUrl` QUERY STRING'i taşır; bir gün biri şifreyi (ya da başka bir
        // sırrı) query'ye koyarsa o değer denetim tablosuna DÜZ METİN düşerdi
        // (D2 bulgusu #3). Ama salt `req.path` MOUNT'A GÖRELİDİR ve `PATCH
        // /api/feature-flags` için "/" olur — denetimin "hangi uçta" sorusu
        // cevapsız kalırdı (P3 doğrulayıcısı ölçtü: asıl korunan yüzeyde satır
        // hiçbir şey tanımlamıyordu). `baseUrl + path` ikisini birden verir:
        // tam yol + query YOK (ölçüldü: `?x=y` yüke girmiyor).
        path: `${req.baseUrl ?? ""}${req.path ?? ""}` || null,
      },
    });
    next();
  } catch (error) {
    // Okuma/karşılaştırma düşerse YAZMA OLMAZ (fail-closed).
    next(error);
  }
}
