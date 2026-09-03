// =============================================================================
// SATICI HESABI (süperadmin) — boot-time doğum + rotasyon (2026-09-03)
// =============================================================================
// NEDEN VAR: modül anahtarlarını (`ticaretEnabled`, `iplikEnabled`, …) yalnız
// SATICI değiştirebilmeli — bunlar fabrikanın ayarı değil, kurulumun hangi ürünü
// satın aldığının kaydıdır. Kimliği taşıyan gerçek bir `User` satırı gerekir
// (audit ve FK sanal kullanıcı kabul etmez), ama o satır fabrikanın hiçbir
// yüzeyinde görünmemeli ve fabrikanın hiçbir paneli onu YARATAMAMALIDIR.
//
// NEDEN BOOT JOB (migration/seed DEĞİL):
//   • migration'a INSERT gömmek parolayı/PIN'i TAŞA yazar ve repoya sokar;
//   • seed yalnız ilk kurulumda koşar, sahadaki kurulumlar onu hiç görmez;
//   • `kur.ps1` mevcut `.env`i olduğu gibi taşır → değerler ELLE eklenir ve
//     sonraki restart'ta hesap doğar. Denklem: `.env` + restart = hesap.
// Emsal: `installation-identity.job.ts` (gecikmeli + sınırlı retry + best-effort)
// ve `default-warehouse.job.ts` (satır yaratan iş + P2002 yarış çözümü).
//
// SIR HİJYENİ (tasarım §12 kural 8):
//   • Parola HAM DEĞİL, HAZIR BCRYPT HASH olarak verilir (`SUPERADMIN_PASSWORD_HASH`)
//     — düz parola `.env`de bir kez daha okunabilir hâlde durmasın.
//   • PIN düz saklanır (şema gereği; `quickPin` tasarımı) ve bu KABUL EDİLMİŞ bir
//     risktir: `pg_dump`/`db-copy` onu taşır (F287). Karşılığı kolay rotasyondur.
//   • Audit yüküne hash/PIN/TOTP sırrı YAZILMAZ. `AuditService` `payload`ı HAM
//     yazar (maskeleme yalnız `changes` kolonuna uygulanır) — yani temizlik
//     çağıranın sorumluluğudur (`setQuickPin` emsali: `rotated: boolean`).
//   • Log satırlarında sır YOK ve KULLANICI ADI DA YOK (2026-09-03): ad audit
//     yüzeylerinde bilerek gizleniyor (`SYSTEM_ACTOR_USERNAME`), pm2 log'u ise
//     fabrika sunucusunda okunabilir — iki yüzey ayrışmamalı.
//
// ⚠️ VAR OLAN HESABA DOKUNULMAZ. `installation-identity`nin "kimliği bir daha
// üretme" kuralının aynısı: her boot'ta env'deki değerleri yazsaydık, panelden
// yapılan bir rotasyon bir sonraki restart'ta SESSİZCE geri alınırdı. Bilinçli
// rotasyonun yolu `SUPERADMIN_FORCE_SYNC=true`dur ve reçete onu kullandıktan
// SONRA `.env`den kaldırmayı söyler.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import { base32Decode } from "../services/totp.service";
import { setSystemAccountExists } from "../services/helpers/system-account.registry";
import { p2002Mentions } from "../utils/p2002";
import { reportJobFailure } from "./job-failure";

// installation-identity ile aynı politika: mutlu yolda ~3sn, DB geç gelirse
// 3 + 4x15 = ~63sn'lik pencere.
const STARTUP_DELAY_MS = 3 * 1000;
const RETRY_DELAY_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;

/** Doğuşta yazılan tam ad — audit yüzeylerinde görünen takma ad. */
export const SYSTEM_ACCOUNT_FULLNAME = "Sistem Bakımı";

/** `.env` üçlüsünün (+ opsiyoneller) çözülmüş hâli. */
export interface SuperadminEnvConfig {
  username: string;
  passwordHash: string;
  quickPin: string;
  /** base32 TOTP sırrı — verilirse hesap uzaktan girişe HAZIR doğar. */
  totpSecret: string | null;
  /** `true` → mevcut hesabın kimlik bilgileri env'e EŞİTLENİR (rotasyon). */
  forceSync: boolean;
}

export type SuperadminEnvResult =
  /** Üç değişkenin HİÇBİRİ verilmemiş → hesap istenmiyor, sessiz geç. */
  | { kind: "absent" }
  /** İstenmiş ama eksik/bozuk → hesap YARATILMAZ ve GÜRÜLTÜLÜ hata verilir. */
  | { kind: "invalid"; reasons: string[] }
  | { kind: "ok"; config: SuperadminEnvConfig };

/** bcrypt hash biçimi (`bcryptjs`, cost iki hane). */
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
/** `quickPin` sözleşmesi: TAM 6 hane (auth.service.loginWithQuickPin ile aynı). */
const PIN_RE = /^\d{6}$/;

function readFlag(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * SAF okuyucu — yalnız verilen `env` kaydına bakar.
 *
 * ⚠️ `process.env` MUTASYONU YASAK (web-hardening deseni): bekçi sahte bir env
 * geçirir; global'i geçici değiştirip geri almak paralel koşumda sızdırır.
 */
export function readSuperadminEnv(
  env: NodeJS.ProcessEnv = process.env,
): SuperadminEnvResult {
  const username = (env.SUPERADMIN_USERNAME ?? "").trim();
  const passwordHash = (env.SUPERADMIN_PASSWORD_HASH ?? "").trim();
  const quickPin = (env.SUPERADMIN_PIN ?? "").trim();
  const totpSecretRaw = (env.SUPERADMIN_TOTP_SECRET ?? "").trim();

  if (!username && !passwordHash && !quickPin) return { kind: "absent" };

  const reasons: string[] = [];
  // ⚠️ EKSİK ÜÇLÜ "yok" DEĞİL "BOZUK"tur: biri yazılmışsa niyet bellidir ve
  // sessiz geçmek, satıcının "hesabı kurdum" sanmasına yol açar.
  if (!username) reasons.push("SUPERADMIN_USERNAME boş");
  if (!passwordHash) reasons.push("SUPERADMIN_PASSWORD_HASH boş");
  if (!quickPin) reasons.push("SUPERADMIN_PIN boş");
  if (passwordHash && !BCRYPT_RE.test(passwordHash)) {
    // Düz parola yazılmış olabilir — o durumda hesap DÜZ METİNLE doğar ve
    // hiçbir zaman giriş yapılamaz (bcrypt.compare false döner). Sessiz kalmak,
    // "PIN çalışıyor ama parola çalışmıyor" gibi teşhisi zor bir arıza üretir.
    reasons.push("SUPERADMIN_PASSWORD_HASH bcrypt hash biçiminde değil ($2b$10$…)");
  }
  if (quickPin && !PIN_RE.test(quickPin)) {
    reasons.push("SUPERADMIN_PIN 6 haneli rakam değil");
  }
  let totpSecret: string | null = null;
  if (totpSecretRaw) {
    try {
      if (base32Decode(totpSecretRaw).length < 10) throw new Error("çok kısa");
      totpSecret = totpSecretRaw;
    } catch {
      reasons.push("SUPERADMIN_TOTP_SECRET geçerli base32 değil");
    }
  }

  if (reasons.length) return { kind: "invalid", reasons };
  return {
    kind: "ok",
    config: {
      username,
      passwordHash,
      quickPin,
      totpSecret,
      forceSync: readFlag(env.SUPERADMIN_FORCE_SYNC),
    },
  };
}

export type SuperadminEnsureResult =
  | { action: "absent" }
  | { action: "invalid"; reasons: string[] }
  | { action: "exists"; id: string }
  | { action: "synced"; id: string }
  | { action: "created"; id: string };

/**
 * Sistem hesabının varlığını garanti eder; her koşumda kayıt defterini tazeler.
 * İdempotent — ikinci koşum İKİNCİ satır yaratmaz.
 */
export async function ensureSuperadminAccount(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SuperadminEnsureResult> {
  const parsed = readSuperadminEnv(env);

  // Mevcut hesap ENV'DEN BAĞIMSIZ okunur: env sonradan kaldırılsa bile hesap
  // duruyorsa kilit YÜRÜRLÜKTEDİR (supap yalnız "hiç hesap yok"ta açılır).
  const existing = await prisma.user.findFirst({
    where: { isSystemAccount: true },
    select: { id: true, username: true },
  });
  setSystemAccountExists(existing !== null);

  if (parsed.kind === "absent") {
    if (!existing) {
      console.log(
        "[superadmin] SUPERADMIN_* tanımlı değil — satıcı hesabı oluşturulmadı " +
          "(modül anahtarları bu kurulumda admin:settings ile yazılır).",
      );
    }
    return { action: "absent" };
  }

  if (parsed.kind === "invalid") {
    // GÜRÜLTÜLÜ: kalıcı SystemLog izi + /health sayacı. Hesap YARATILMAZ.
    reportJobFailure(
      "superadmin",
      new Error(`SUPERADMIN_* yapılandırması geçersiz: ${parsed.reasons.join(" · ")}`),
    );
    return { action: "invalid", reasons: parsed.reasons };
  }

  const cfg = parsed.config;

  if (existing) {
    if (!cfg.forceSync) return { action: "exists", id: existing.id };
    // ⚠️ KULLANICI ADI DEĞİŞTİRİLMEZ (2026-09-03). `.env`'deki ad DB'dekinden
    // farklıysa doğru davranış "adı da senkronla" DEĞİLDİR: ad GİRİŞ KİMLİĞİdir
    // ve sessizce değiştirmek satıcıyı bir sonraki girişte dışarıda bırakır
    // ("parola çalışmıyor" sınıfı). Bunun yerine uyuşmazlık GÜRÜLTÜLÜ olur:
    // console uyarısı + audit yükünde `usernameMismatch: true`.
    const usernameMismatch = existing.username !== cfg.username;
    if (usernameMismatch) {
      console.warn(
        "[superadmin] FORCE_SYNC: SUPERADMIN_USERNAME kayıtlı addan FARKLI — " +
          "ad DEĞİŞTİRİLMEDİ (giriş kimliğidir). Parola/PIN/TOTP eşitlendi. " +
          "Ad gerçekten değişecekse hesap elle güncellenmelidir.",
      );
    }

    // ROTASYON: kimlik bilgileri env'e EŞİTLENİR. TOTP de aynı yaşam
    // döngüsündedir — env'de sır yoksa TEMİZLENİR ("env tek gerçektir").
    // ⚠️ `tokenVersion` artırılır: eski oturumlar anında düşer (parola/PIN
    // değişiminin her yerdeki sözleşmesi).
    try {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: cfg.passwordHash,
          quickPin: cfg.quickPin,
          totpSecret: cfg.totpSecret,
          totpEnabledAt: cfg.totpSecret ? new Date() : null,
          totpLastStep: null,
          isActive: true,
          tokenVersion: { increment: 1 },
        },
      });
    } catch (err) {
      // ⚠️ UPDATE YOLU DA P2002 ÇARPAR ve bu YOL BAŞTA SARILMAMIŞTI (D2 bulgusu,
      // ölçüldü): env'deki PIN başka bir kullanıcıda ise `quickPin` unique'i
      // patlar, hata yukarı çıkar ve `startSuperadminAccount` bunu "DB hazır
      // olmayabilir" sanıp 5×15 sn boyunca YENİDEN DENER — sonunda ham Prisma
      // mesajıyla düşer. Bu bir YAPILANDIRMA hatasıdır, geçici bir arıza değil:
      // retry'sız, adıyla raporlanır.
      if (p2002Mentions(err, /users_(username_key|username_lower_uq|quickPin_key)/)) {
        reportJobFailure(
          "superadmin",
          new Error(
            "SUPERADMIN_PIN veya SUPERADMIN_USERNAME başka bir kullanıcıda — " +
              "rotasyon (FORCE_SYNC) uygulanamadı. .env'de farklı değer verin.",
          ),
        );
        return { action: "invalid", reasons: ["PIN/kullanıcı adı başka kullanıcıda"] };
      }
      throw err;
    }
    if (!cfg.totpSecret) {
      console.warn(
        "[superadmin] FORCE_SYNC: SUPERADMIN_TOTP_SECRET verilmediği için iki adımlı " +
          "doğrulama TEMİZLENDİ (uzaktan giriş yeniden kurulum ister).",
      );
    }
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "SUPERADMIN_CREDENTIALS_SYNCED",
      tableName: "users",
      recordId: existing.id,
      // ⚠️ SIR YOK ve GERÇEK KULLANICI ADI DA YOK (2026-09-03). `recordId` zaten
      // hesabın id'sidir; `username` buraya yazılınca audit DETAYINDA
      // (`GET /api/admin/system-logs/:id` → `newData`) giriş adı ham çıkıyordu ve
      // `system-log.service`in takma adını çürütüyordu (ölçüldü: D1/D2).
      payload: {
        fullName: SYSTEM_ACCOUNT_FULLNAME,
        totp: cfg.totpSecret ? "seeded" : "cleared",
        // Env'deki ad DB'dekinden farklıysa: ad DEĞİŞTİRİLMEZ (giriş kimliğidir,
        // sessizce değiştirmek satıcıyı "parolam çalışmıyor"a düşürür) — ama
        // uyuşmazlık İZ BIRAKIR, yoksa `.env` düzeltmesi cevapsız kalır.
        ...(usernameMismatch ? { usernameMismatch: true } : {}),
      },
    }).catch(() => undefined);
    console.warn(
      "[superadmin] FORCE_SYNC uygulandı — .env'den SUPERADMIN_FORCE_SYNC satırını KALDIRIN.",
    );
    return { action: "synced", id: existing.id };
  }

  try {
    const created = await prisma.user.create({
      data: {
        username: cfg.username,
        // Takma ad DOĞUŞTA yazılır: `record-info`/künye yüzeylerinin çoğu
        // `fullName`i basar, yani gerçek ad hiçbir zaman DB'ye girmez.
        fullName: SYSTEM_ACCOUNT_FULLNAME,
        passwordHash: cfg.passwordHash,
        quickPin: cfg.quickPin,
        totpSecret: cfg.totpSecret,
        // ⚠️ İKİ ALAN BİRDEN: `getStatus` yalnız ikisi de doluyken "kurulu" der.
        totpEnabledAt: cfg.totpSecret ? new Date() : null,
        isSystemAccount: true,
        isActive: true,
      },
      select: { id: true },
    });
    setSystemAccountExists(true);
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "SUPERADMIN_ACCOUNT_CREATED",
      tableName: "users",
      recordId: created.id,
      // SIR YOK: hash/PIN/TOTP buraya YAZILMAZ (payload HAM saklanır).
      // ⚠️ GERÇEK KULLANICI ADI DA YAZILMAZ — bkz. SYNCED yükündeki not.
      payload: { fullName: SYSTEM_ACCOUNT_FULLNAME, totp: cfg.totpSecret ? "seeded" : "none" },
    }).catch(() => undefined);
    // ⚠️ Kullanıcı adı BASILMAZ: pm2 log'u fabrika sunucusunda okunabilir ve
    // aynı ad audit yüzeylerinde bilerek gizleniyor (yüzeyler ayrışmamalı).
    console.log("[superadmin] Satıcı hesabı oluşturuldu (sistem hesabı).");
    return { action: "created", id: created.id };
  } catch (err) {
    // Yarış: iki süreç aynı anda boot etti. ÜÇ unique çarpabilir ve üçüncüsü
    // ŞEMA-DIŞIDIR (`users_username_lower_uq`, migration 20260731160000) —
    // regex'e konmazsa yarış tanınmaz, boşuna 5 kez retry'lanır ve teşhis
    // "süperadmin doğmadı" diye yanlış yöne gider.
    if (p2002Mentions(err, /users_(username_key|username_lower_uq|quickPin_key)/)) {
      const now = await prisma.user.findFirst({
        where: { isSystemAccount: true },
        select: { id: true },
      });
      if (now) {
        setSystemAccountExists(true);
        return { action: "exists", id: now.id };
      }
      // Sistem hesabı yok ama unique çarptı → kullanıcı adı/PIN NORMAL bir
      // kullanıcıda kullanılıyor demektir. Bu bir yapılandırma hatasıdır.
      reportJobFailure(
        "superadmin",
        new Error(
          "SUPERADMIN_USERNAME veya SUPERADMIN_PIN zaten başka bir kullanıcıda — " +
            "hesap oluşturulamadı. .env'de farklı değer verin.",
        ),
      );
      return { action: "invalid", reasons: ["username/PIN çakışması"] };
    }
    throw err;
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
      // ⚠️ `console.error` YETMEZ (installation-identity'den ayrıldığımız yer):
      // hesap doğmazsa satıcı sisteme HİÇ giremez ve tek iz pm2 log'unda kalır.
      // `reportJobFailure` kalıcı SystemLog satırı + /health sayacı yazar.
      reportJobFailure("superadmin", err);
    });
  };

  setTimeout(() => attempt(1), STARTUP_DELAY_MS).unref();
}

/** Test-only: modül durumunu sıfırlar. */
export function __resetSuperadminJobForTests(): void {
  started = false;
}
