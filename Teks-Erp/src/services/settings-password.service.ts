// =============================================================================
// TeksERP — AYAR ŞİFRESİ (ikinci kapı) — saklama + yönetim (2026-09-03, P3)
// =============================================================================
// NEDEN VAR (tasarım §7.2): davranış bayrağı ekranı her değişiklikte İKİNCİ bir
// şifre sorar — açık kalmış bir admin oturumundan (masaüstü başında bırakılmış
// panel, ödünç alınmış bilgisayar) bayrak değiştirilmesin. Şifreyi SÜPERADMİN
// üretir/dağıtır/değiştirir/iptal eder; fabrika onu ekrandan tanımlayamaz.
//
// ⚠️ `systemSettingService.set()` KULLANILMAZ ve bu kararın tek gerekçesi SIR
//    HİJYENİDİR (tasarım §12 kural 8). `set()` her yazımda `AuditService.log`u
//    `oldData`/`newData` ile çağırır ve o iki kolon HAM yazılır (maskeleme
//    yalnız `changes` kolonuna uygulanır — `audit-diff.helper.ts` başlığı bunu
//    açıkça söyler). Yani `set()` ile yazılan bir hash, audit tablosuna DÜZ
//    METİN olarak düşerdi ve `system_logs` tablosunu okuyabilen herkes çevrimdışı
//    kırma için gereken bcrypt gövdesini ele geçirirdi. Bunun yerine:
//      • yazma → `prisma.systemSetting.upsert` (audit'siz),
//      • iz    → ayrı `AuditService.logEvent` (payload YALNIZ `{ by: userId }`).
//
// ⚠️ `invalidateFeatureFlagsCache()` ÇAĞRILMAZ: hash bir feature flag DEĞİLDİR,
//    `getFeatureFlags` yükünde dönmez, dolayısıyla o önbelleği tazelemek anlamsız
//    bir yan etki olurdu (30 sn'lik önbelleği her şifre rotasyonunda düşürmek).
//
// ⚠️ OKUMA CACHE'SİZ. Bu bir REJİM okumasıdır: şifre iptal edildiği ANDA kapı
//    uyumalı, tanımlandığı ANDA kilitlemeli. Önbellek, iptal edilmiş bir şifrenin
//    TTL boyunca geçerli kalması demekti.
// =============================================================================

import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import { SETTINGS_PASSWORD_HASH_KEY } from "../constants/reserved-settings";
import type { SystemEventName } from "../constants/system-events";
import { AppError } from "../utils/app-error";

/** bcrypt maliyeti — kullanıcı parolalarıyla AYNI (auth.service `hash(p, 10)`). */
const BCRYPT_COST = 10;

/**
 * Kabul edilen şifre uzunluğu.
 *
 * ⚠️ ÜST SINIR 72 ve bu SAYI KEYFİ DEĞİL — bcrypt'in kendi sınırıdır: algoritma
 * parolanın yalnız İLK 72 BAYTINI karıştırır, gerisini SESSİZCE ATAR. ÖLÇÜLDÜ
 * (2026-09-03, D2): sınır 128 iken süperadmin 100 karakterlik bir şifre tanımladı
 * ve doğrulamada `"A"×72` ile `"A"×72+"ZZZZ"` İKİSİ DE 200 verdi, `"A"×71` 403
 * verdi. Yani kullanıcı "uzun şifre = güçlü" sanırken son 28 karakter hiç
 * sayılmıyordu. Sınırı 72'ye çekmek sessiz kırpmayı görünür bir redde çevirir.
 *
 * ⚠️ 72 KARAKTER = 72 BAYT yalnız ASCII'de doğrudur; şifre kümesi
 * (`settingsPasswordSchema` regex'i) zaten yazdırılabilir ASCII ile sınırlı
 * olduğu için ikisi burada eşittir. Yine de savunma derinliği olarak
 * `assertSettingsPasswordUsable` bcrypt'in KENDİ `truncates()` yüklemiyle ölçer
 * — regex bir gün gevşerse sessiz kırpma geri gelmesin.
 */
export const SETTINGS_PASSWORD_MIN_LENGTH = 8;
export const SETTINGS_PASSWORD_MAX_LENGTH = 72;

/**
 * Audit olayları — tek yerde, bekçi ve reçete bu adları arar.
 * ⚠️ `satisfies` BİLEREK: bu sabit olay adlarını SABİTTEN kuruyor ve kaynakta dizge
 * arayan tarama o çağrıları GÖREMEZ (altı olayın Türkçesi bu yüzden aylarca eksik
 * kaldı). Birliğe `satisfies` ile bağlı olduğu için artık yeni bir ad buraya
 * eklenemez — önce `constants/system-events.ts`e girer, etiket kapısı da onu görür.
 * Bağ koparsa aynı kaçak yeniden doğar; `test_system_event_names` §5 o bağı ölçer.
 */
export const SETTINGS_PASSWORD_EVENTS = {
  SET: "SETTINGS_PASSWORD_SET",
  ROTATED: "SETTINGS_PASSWORD_ROTATED",
  REVOKED: "SETTINGS_PASSWORD_REVOKED",
  USED: "SETTINGS_PASSWORD_USED",
  FAILED: "SETTINGS_PASSWORD_FAILED",
  LOCKED: "SETTINGS_PASSWORD_LOCKED",
} as const satisfies Record<string, SystemEventName>;

/**
 * Kayıtlı hash (yoksa `null`). CACHE'SİZ — gerekçe dosya başlığında.
 *
 * ⚠️ Boş/whitespace değer `null` sayılır: elle SQL ile `''` yazan biri kapıyı
 * "tanımlı ama hiçbir şifreyle geçilemez" hâline sokabilirdi (fabrikayı ayar
 * ekranından kalıcı olarak kilitler). Boş = tanımsız, yani kapı UYUR.
 */
export async function readSettingsPasswordHash(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string | null> {
  const client = tx ?? prisma;
  const row = await client.systemSetting.findUnique({
    where: { key: SETTINGS_PASSWORD_HASH_KEY },
    select: { value: true },
  });
  const value = row?.value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Ayar şifresi TANIMLI mı — `GET /api/feature-flags` ve `/api/auth/me` bunu
 * döner. SIR DEĞİLDİR: istemci "kaydederken şifre soracağım" kararını buradan
 * verir; bilgi zaten ilk 403 `SETTINGS_PASSWORD_REQUIRED` ile de öğrenilir.
 */
export async function isSettingsPasswordConfigured(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  return (await readSettingsPasswordHash(tx)) !== null;
}

/**
 * bcrypt'in SESSİZ KIRPMASINA karşı son kapı. `settingsPasswordSchema` zaten
 * 72 karakterde keser; bu yüklem BAYT üzerinden ölçer ve şemadan bağımsız
 * koşar (servisin ileride başka bir çağıranı doğarsa da korunur).
 *
 * ⚠️ SESSİZ KIRPMA NEDEN TEHLİKELİ: kırpılan şifre YAZILIR ve DOĞRULANIR —
 * hiçbir yerde hata görünmez; yalnız gerçekte geçerli olan sır kullanıcının
 * bildiğinden kısadır. Görünür bir 400, sessiz bir zayıflamadan iyidir.
 */
export function assertSettingsPasswordUsable(password: string): void {
  if (bcrypt.truncates(password)) {
    throw AppError.badRequest(
      `Ayar şifresi en fazla ${SETTINGS_PASSWORD_MAX_LENGTH} bayt olabilir (bcrypt sınırı) — daha kısa bir şifre seçin.`,
      { code: "SETTINGS_PASSWORD_TOO_LONG" },
    );
  }
}

/**
 * Şifreyi TANIMLA/DEĞİŞTİR (süperadmin). Var olan hash üzerine yazmak
 * ROTASYONdur — audit olayı ona göre ayrışır ki "ilk kez tanımlandı" ile
 * "değiştirildi" denetimde karışmasın.
 */
export async function setSettingsPassword(
  password: string,
  userId: string | undefined,
): Promise<{ rotated: boolean }> {
  assertSettingsPasswordUsable(password);
  const rotated = (await readSettingsPasswordHash()) !== null;
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  await prisma.systemSetting.upsert({
    where: { key: SETTINGS_PASSWORD_HASH_KEY },
    // `description` yalnız ilk oluşturmada yazılır (systemSettingService.set
    // sözleşmesiyle aynı) — burada da güncellemede DOKUNULMAZ.
    create: {
      key: SETTINGS_PASSWORD_HASH_KEY,
      value: hash,
      description:
        "Ayar şifresi (bcrypt hash). Süperadmin yönetir; ham ayar ucundan yazılamaz/okunamaz.",
      updatedById: userId ?? null,
    },
    update: { value: hash, updatedById: userId ?? null },
  });
  // ⚠️ PAYLOAD YALNIZ AKTÖR. Şifre de hash de GİRMEZ: `logEvent` `payload`ı
  // `newData` kolonuna HAM yazar (maskeleme yalnız `changes`e uygulanır).
  await AuditService.logEvent({
    category: "SYSTEM",
    action: rotated ? SETTINGS_PASSWORD_EVENTS.ROTATED : SETTINGS_PASSWORD_EVENTS.SET,
    userId: userId ?? null,
    tableName: "system_settings",
    recordId: SETTINGS_PASSWORD_HASH_KEY,
    payload: { by: userId ?? null },
  });
  return { rotated };
}

/**
 * Şifreyi KALDIR (süperadmin) → kapı UYUR: hiçbir istek şifre istemez.
 *
 * ⚠️ Satır fiziksel olarak SİLİNİR (soft-delete YOK). `system_settings` bir
 * ayar deposudur, `isActive` kolonu taşımaz ve "pasif hash" diye bir durum
 * okuyucuya üçüncü bir hâl eklerdi ("şifre yok" ≠ "şifre vardı, kaldırıldı"
 * ayrımı hiçbir karara girmiyor). Kaldırmanın izi audit'tedir. Emsal:
 * `ItemPrice` satırı silme (CLAUDE.md "Ortak Konvansiyonlar" bilinçli istisnası).
 */
export async function revokeSettingsPassword(
  userId: string | undefined,
): Promise<{ removed: boolean }> {
  const result = await prisma.systemSetting.deleteMany({
    where: { key: SETTINGS_PASSWORD_HASH_KEY },
  });
  const removed = result.count > 0;
  if (removed) {
    await AuditService.logEvent({
      category: "SYSTEM",
      action: SETTINGS_PASSWORD_EVENTS.REVOKED,
      userId: userId ?? null,
      tableName: "system_settings",
      recordId: SETTINGS_PASSWORD_HASH_KEY,
      payload: { by: userId ?? null },
    });
  }
  return { removed };
}

/**
 * Sunulan şifre kayıtlı hash'e uyuyor mu.
 *
 * ⚠️ Sabit maliyet: hash YOKSA burası hiç çağrılmaz (kapı zaten uyur), yani
 * "şifre tanımlı mı" bilgisi zamanlamadan değil, açıkça dönen
 * `settingsPasswordRequired` alanından öğrenilir. Tanımlıyken doğru/yanlış iki
 * yolun maliyeti bcrypt'in kendisidir ve EŞİTTİR (zamanlama orakülü yok).
 */
export async function verifySettingsPassword(
  candidate: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(candidate, hash);
}
