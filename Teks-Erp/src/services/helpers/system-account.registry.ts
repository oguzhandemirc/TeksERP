// =============================================================================
// TeksERP — SİSTEM HESABI VAR MI? (senkron kayıt defteri)
// =============================================================================
// NEDEN VAR — EMNİYET SUPABI. Modül anahtarlarını YALNIZ sistem hesabı yazabilir
// (`feature-flag.routes.ts` üçüncü dalı). Kural doğru ama tek başına bir
// KİLİTLENME üretir: satıcı hesabı sunucuda elle kurulur (`npm run
// superadmin:kur`, 2026-09-03 P8) ve script koşulmadığı sürece hiç doğmaz —
// o kurulumda modül anahtarlarını HİÇ KİMSE değiştiremezdi.
// Bu, `constants/document-design.ts`teki "admin:settings DÖRT EKRANI DA AÇMAYA
// DEVAM EDER" dersinin birebir tekrarı olurdu (deploy anında herkesi dışarıda
// bırakan sıkı ayrım).
//
// Supap: hesap YOKSA dal devre dışıdır — modül anahtarı BUGÜNKÜ gibi
// `admin:settings` ile yazılır (davranış değişmez). Hesap doğduğu AN kilit
// mutlaktır.
//
// ⚠️ SENKRON OLMAK ZORUNDA: guard `next`i aynı tick'te çağırmalı (mevcut bekçi
// harness'ı — `test_document_template_permission.ts` yetkiVerirMi — zinciri
// senkron koşturur ve async'e çevrilirse sessizce `false` döner). Bu yüzden
// burada DB'ye GİDİLMEZ; değeri boot job'ı yazar.
//
// ⚠️ BİLİNMİYOR = VAR SAYILIR (fail-closed). Job açılıştan ~3 sn sonra koşar;
// o pencerede "yok" varsaymak her restart'ta birkaç saniyelik bir bypass
// penceresi açardı. Ters yön yalnız geçici bir 403 üretir.
//
// ⚠️ TEMBEL DOĞRULAMA (2026-09-03, D1 bulgusu) — defter yalnız BOOT'ta yazılıyordu.
// Süreç `exists=false` ile açılır, SONRA DB'ye bir sistem hesabı gelirse (elle SQL,
// içe aktarım, yedekten geri yükleme) supap bir sonraki restart'a kadar AÇIK kalır
// ve o pencerede modül anahtarları `admin:settings` ile yazılabilir. Kapatma:
// `refreshSystemAccountRegistry()` — guard'ın SUPAP dalı, yani zaten nadir olan
// dal, isteği geçirmeden ÖNCE tek indeksli sorguyla defteri tazeler.
//   • KİLİTLİ dal SENKRON kalır (istek başına sorgu yok, harness sözleşmesi korunur).
//   • Fail-open yön kapanır; fail-closed yön (bilinmiyor → kilitli) değişmez.
//
// ⚠️ DEFTER TEK YÖNDE TAZELENİR (2026-09-03, V bulgusu): yokluktan varlığa
// (`false → true`) istek anında (tembel doğrulama), varlıktan yokluğa (`true →
// false`) YALNIZ restart'ta. Sistem hesabı elle kaldırılırsa (reçetedeki UPDATE)
// supap restart'a kadar KAPALI kalır — fail-closed, açık değil; reçete bu yüzden
// "restart ŞART" der. Kilitli dalda sorgu koşturmamak bilinçli: fabrikada sıcak
// yol odur ve senkron sözleşme orada yaşar.
//
// ⚠️ `db-copy` TAKASINA ÇAĞRI EKLENMEDİ ve bu ÖLÇÜLDÜ, unutulmadı: takas backend
// içinde koşmaz — `db-swap-command.helper.ts` operatöre `pm2 stop … ALTER DATABASE
// RENAME … pm2 start` bloğu üretir, yani süreç zaten yeniden başlar ve defteri boot
// job'ı tazeler. İn-process bir kanca oraya konsaydı hiçbir zaman çalışmazdı.
// =============================================================================

import prisma from "../../lib/prisma";

/** `null` = henüz ölçülmedi (boot penceresi ya da job düştü) → VAR sayılır. */
let known: boolean | null = null;

/** Boot job'ı ölçtüğü sonucu buraya yazar (her koşumda tazeler). */
export function setSystemAccountExists(value: boolean): void {
  known = value;
}

/**
 * Guard'ın okuduğu yüklem. `true` → modül anahtarı kilidi YÜRÜRLÜKTE.
 * Ölçülmemişken de `true` (fail-closed; başlıktaki gerekçe).
 */
export function systemAccountLockActive(): boolean {
  return known !== false;
}

/**
 * HAM üç-durumlu okuma: "job ÖLÇTÜ ve hesap VAR" mı?
 *
 * ⚠️ PANEL BUNU OKUMAZ. `/api/auth/me` `systemAccountExists` alanı guard'ın
 * yüklemiyle (`systemAccountLockActive`) AYNI olmak zorundadır: "bilinmiyor"
 * durumunda burası `false` der ama kapı KİLİTLİDİR — panel o farkı görürse
 * supabı açık çizer, kullanıcı toggle'ı çevirir ve 403 yer (D2 bulgusu).
 * Bu fonksiyon yalnız tanı/bekçi içindir.
 */
export function systemAccountExistsKnown(): boolean {
  return known === true;
}

/**
 * Defteri DB'den TAZELER (tek indeksli sorgu) ve sonucu döner.
 *
 * Guard'ın SUPAP dalından çağrılır — yani yalnız `known === false` iken, yani
 * sistem hesabı OLMAYAN kurulumlarda. Fabrikada hesap varken bu yol hiç koşmaz,
 * dolayısıyla istek başına ek sorgu getirmez.
 */
export async function refreshSystemAccountRegistry(): Promise<boolean> {
  const row = await prisma.user.findFirst({
    where: { isSystemAccount: true },
    select: { id: true },
  });
  known = row !== null;
  return known;
}

/** Test-only: modül durumunu sıfırlar. */
/**
 * Guard'ın supap dalı ile `/auth/me`nin ORTAK yüklemi (2026-09-03, V major #1):
 * defter "yok" diyorsa DB'den bir kez doğrula (fail-open yön kapanır — hesap
 * boot'tan SONRA doğmuşsa panel de kapı da aynı anda kilitlenir), sonra kilit
 * durumunu döner. Sorgu YALNIZ `known === false` dalında; kilitli/bilinmiyor
 * durumunda `systemAccountLockActive()` ile aynı senkron karar.
 * ⚠️ Panel `systemAccountExists` alanını BUNDAN okur — `systemAccountLockActive()`
 * tek başına "hesap sonradan doğdu" penceresinde panel↔kapı ayrışması üretiyordu
 * (ölçüldü: /auth/me false derken PATCH 403).
 */
export async function resolveSystemAccountLock(): Promise<boolean> {
  if (known === false) await refreshSystemAccountRegistry();
  return known !== false;
}

export function __resetSystemAccountRegistryForTests(): void {
  known = null;
}
