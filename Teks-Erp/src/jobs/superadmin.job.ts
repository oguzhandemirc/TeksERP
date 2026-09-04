// =============================================================================
// SATICI HESABI (süperadmin) — boot kaydı + yaşam döngüsü audit'i (2026-09-03)
// =============================================================================
// NEDEN VAR: modül anahtarlarını (`ticaretEnabled`, `iplikEnabled`, …) yalnız
// SATICI değiştirebilmeli — bunlar fabrikanın ayarı değil, kurulumun hangi ürünü
// satın aldığının kaydıdır. Kimliği taşıyan gerçek bir `User` satırı gerekir
// (audit ve FK sanal kullanıcı kabul etmez), ama o satır fabrikanın hiçbir
// yüzeyinde görünmemeli ve fabrikanın hiçbir paneli onu YARATAMAMALIDIR.
//
// ⚠️ `.env` TOHUMLAMA YOLU KALDIRILDI (2026-09-03, P8 kullanıcı kararı).
// Hesabın TEK doğuş yolu artık sunucuda elle koşulan interaktif script'tir:
//     npm run superadmin:kur            (idempotent — hesap varsa DOKUNMAZ)
//     npm run superadmin:kur -- --rotate  (parola + PIN + TOTP yenilenir)
// Neden tek yol: iki doğuş yolu = iki sır yüzeyi. `.env` yolunda parola hash'i,
// PIN ve TOTP sırrı diskte KALICI olarak duruyordu (yedeğe, `kur.ps1`in taşıdığı
// dosyaya, ekran paylaşımına giriyordu) ve "FORCE_SYNC satırını sonra kaldırın"
// gibi unutulabilir bir adım gerektiriyordu. Script'te sır yalnız süreç belleğinde
// yaşar ve terminale BİR KEZ basılır. Kaldırma sıfır farktır: sahadaki kurulumda
// `SUPERADMIN_*` satırları YOKTU (kapanış provasında ölçüldü — boot log'u
// "[superadmin] SUPERADMIN_* tanımlı değil" basıyordu).
//
// BU DOSYADA KALAN ÜÇ İŞ:
//   ① BOOT KAYDI — `SystemAccountRegistry`yi tazeler. Guard (`flagWriteGuard`
//      üçüncü dalı) SENKRON okumak zorunda olduğu için değeri bu job yazar;
//      hesap yoksa emniyet supabının devrede olduğunu boot log'unda SÖYLER.
//   ①b ÖLÜ ORTAM SATIRI UYARISI — P8 ÖNCESİ yolu kullanmış bir kurulumda
//      `.env`de kalan satıcı satırları artık OKUNMUYOR ama hâlâ CANLI kimlik
//      bilgisidir (parola hash'i / PIN / TOTP sırrı diskte durur, yedeğe ve
//      `kur.ps1`in taşıdığı dosyaya girer). Sessizce yok saymak, sırrı
//      kaldırdığımızı sanarak bırakmak demekti. ⚠️ Uyarı YALNIZ ANAHTAR ADINI
//      basar — DEĞER ASLA (pm2 log'u fabrika sunucusunda okunabilir).
//   ② YAŞAM DÖNGÜSÜ AUDIT'İ — `SUPERADMIN_PROVISIONED` / `SUPERADMIN_ROTATED`.
//      ⚠️ Audit çağrısı BİLEREK burada, script'te değil: `test_audit_labels` §3
//      yalnız `src/` ağacını tarar (`logEvent({ action: "…" })` literalleri) ve
//      Electron sözlüğünün kapsamını oradan ölçer. Çağrı `scripts/` altında
//      kalsaydı iki olay da bekçinin KÖR NOKTASINDA doğar, Türkçe karşılığı
//      unutulur ve audit ekranında ham İngilizce basardı (2026-08-25 dersi).
//
// SIR HİJYENİ (tasarım §12 kural 8):
//   • Ham parola / PIN / TOTP sırrı HİÇBİR audit yüküne YAZILMAZ. `AuditService`
//     `payload`ı HAM yazar (maskeleme yalnız `changes` kolonuna uygulanır) — yani
//     temizlik ÇAĞIRANIN sorumluluğudur (`setQuickPin` emsali: `rotated: boolean`).
//   • Log satırlarında sır YOK ve KULLANICI ADI DA YOK (2026-09-03): ad audit
//     yüzeylerinde 2026-09-04'e kadar gizleniyordu (artık görünür), pm2 log'u ise
//     fabrika sunucusunda okunabilir — iki yüzey ayrışmamalı.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import { setSystemAccountExists } from "../services/helpers/system-account.registry";
import { reportJobFailure } from "./job-failure";

// installation-identity ile aynı politika: mutlu yolda ~3sn, DB geç gelirse
// 3 + 4x15 = ~63sn'lik pencere.
const STARTUP_DELAY_MS = 3 * 1000;
const RETRY_DELAY_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;

/** Doğuşta yazılan tam ad — audit yüzeylerinde görünen takma ad. */
export const SYSTEM_ACCOUNT_FULLNAME = "Sistem Bakımı";

/**
 * P8 ile ölü kalan ortam değişkenlerinin ÖN EKİ.
 *
 * ⚠️ TAM ANAHTAR ADLARI BU DOSYAYA YAZILMAZ ve değer alan adıyla OKUNMAZ:
 * `test_superadmin_provision` §6 tam bu iki deseni (tam anahtar adı literali +
 * `process.env` üzerinden alan erişimi) arayarak `.env` doğuş yolunun geri
 * gelmediğini ölçer. Ön ek taraması o kapıyı açmaz — anahtar ADI okunur,
 * DEĞERİNE hiç dokunulmaz.
 */
const OLU_ORTAM_ONEKI = "SUPERADMIN_";

/**
 * `.env`de kalmış ölü satıcı satırlarını BİR KEZ bildirir.
 *
 * Neden gürültü: bu satırlar P8'den (2026-09-03) beri okunmuyor, ama P2 yolunu
 * kullanmış bir kurulumda hâlâ ÇALIŞAN bir parola hash'i, PIN ve TOTP sırrı
 * taşıyorlar. "Artık kullanılmıyor" sessizliği, kurulumcuya sırrın da ortadan
 * kalktığını düşündürürdü — kalkmadı, yalnız etkisizleşti.
 */
function uyarOluOrtamSatirlari(): void {
  const kalanlar = Object.keys(process.env)
    .filter((k) => k.startsWith(OLU_ORTAM_ONEKI))
    .sort();
  if (kalanlar.length === 0) return;
  console.warn(
    `[superadmin] ⚠️ Ortamda ARTIK KULLANILMAYAN ${kalanlar.length} satır var: ` +
      `${kalanlar.join(", ")} — 2026-09-03'ten (P8) beri OKUNMUYOR, ama ` +
      "CANLI kimlik bilgisi olabilirler (parola hash'i / PIN / TOTP sırrı diskte " +
      "durur, yedeğe ve kurulum paketine girer). `.env`den SİLİN; satıcı hesabı " +
      "artık yalnız `npm run superadmin:kur` ile kurulur/rotasyonlanır.",
  );
}

export type SuperadminRegistryResult =
  /** Kurulumda satıcı hesabı YOK → emniyet supabı devrede. */
  | { action: "absent" }
  /** Hesap var → modül anahtarı kilidi YÜRÜRLÜKTE. */
  | { action: "exists"; id: string };

/**
 * Kilit defterini DB'den tazeler (her koşumda).
 *
 * ⚠️ Yazma YAPMAZ (ne `User` satırına ne de `isSystemAccount` alanına). Hesabı
 * yaratan tek yer `scripts/superadmin-olustur.ts`tir;
 * boot yolunun satır yaratması "her restart panelden yapılan rotasyonu geri
 * alır" sınıfı bir sessiz bozulma üretirdi (installation-identity dersi).
 */
export async function ensureSuperadminAccount(): Promise<SuperadminRegistryResult> {
  uyarOluOrtamSatirlari();

  const existing = await prisma.user.findFirst({
    where: { isSystemAccount: true },
    select: { id: true },
  });
  setSystemAccountExists(existing !== null);

  if (!existing) {
    console.log(
      "[superadmin] Satıcı hesabı yok — emniyet supabı devrede " +
        "(modül anahtarları bu kurulumda admin:settings ile yazılır). " +
        "Kurmak için sunucuda: npm run superadmin:kur",
    );
    return { action: "absent" };
  }
  return { action: "exists", id: existing.id };
}

/**
 * Satıcı hesabının yaşam döngüsü izi.
 *
 * ⚠️ SIR YOK ve GERÇEK KULLANICI ADI DA YOK. `recordId` zaten hesabın id'sidir;
 * `username` yazılınca audit DETAYINDA (`GET /api/admin/system-logs/:id` →
 * `newData`) giriş adı ham çıkıyor ve `system-log.service`in takma adını
 * çürütüyordu (2026-09-03, D1/D2 bulgusu).
 *
 * ⚠️ İKİ AYRI `logEvent` çağrısı BİLEREK: `test_audit_labels` §3 action'ı
 * `logEvent({ … action: "LİTERAL" })` deseninden okur. Tek çağrı + değişken
 * action yazılsaydı iki olay da taramada görünmez olurdu.
 */
export async function logSuperadminLifecycleEvent(params: {
  rotated: boolean;
  userId: string;
  /** TOTP sırrı yazıldı mı — sırrın KENDİSİ değil, yalnız durumu. */
  totp: "seeded" | "cleared";
}): Promise<void> {
  const ortak = {
    category: "SYSTEM" as const,
    tableName: "users",
    recordId: params.userId,
    payload: { fullName: SYSTEM_ACCOUNT_FULLNAME, totp: params.totp },
  };
  if (params.rotated) {
    await AuditService.logEvent({ ...ortak, action: "SUPERADMIN_ROTATED" }).catch(() => undefined);
  } else {
    await AuditService.logEvent({ ...ortak, action: "SUPERADMIN_PROVISIONED" }).catch(
      () => undefined,
    );
  }
}

let started = false;

/** Açılışta BİR KEZ koşar. Hata sunucuyu DÜŞÜRMEZ; sınırlı sayıda dener. */
export function startSuperadminAccount(): void {
  if (started) return;
  started = true;

  const attempt = (n: number): void => {
    void ensureSuperadminAccount().catch((err) => {
      if (n < MAX_ATTEMPTS) {
        console.warn(
          `[superadmin] deneme ${n}/${MAX_ATTEMPTS} başarısız (DB hazır olmayabilir), ` +
            `${RETRY_DELAY_MS / 1000}sn sonra tekrar denenecek:`,
          err instanceof Error ? err.message : err,
        );
        setTimeout(() => attempt(n + 1), RETRY_DELAY_MS).unref();
        return;
      }
      // ⚠️ `console.error` YETMEZ: defter tazelenemezse kilit "bilinmiyor"da
      // kalır (fail-closed) ve modül anahtarını kimse yazamaz. `reportJobFailure`
      // kalıcı SystemLog satırı + /health sayacı yazar.
      reportJobFailure("superadmin", err);
    });
  };

  setTimeout(() => attempt(1), STARTUP_DELAY_MS).unref();
}

/** Test-only: modül durumunu sıfırlar. */
export function __resetSuperadminJobForTests(): void {
  started = false;
}
