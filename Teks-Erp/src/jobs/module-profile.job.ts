// =============================================================================
// KURULUM PROFİLİ — modül anahtarlarını TAZE kurulumda bir kez yazar (2026-09-03)
// =============================================================================
// Grandfathering migration'ı (`20260902230000`) yalnız GEÇMİŞİ OLAN kurulumu
// damgalar (`WHERE EXISTS (SELECT 1 FROM "rolls")`). Taze bir müşteri kurulumu
// o koşuldan geçmez ve modül anahtarı satırları HİÇ doğmaz; davranış kod
// varsayılanlarına düşer (üretim AÇIK, diğer altısı KAPALI). Bu job o boşluğu
// `.env`deki `TEKSERP_PROFIL` seçimiyle doldurur.
//
// ÜÇ KURAL, ÜÇÜ DE ÖLÇÜLMÜŞ BİR ARIZA SINIFINI KAPATIR:
//
//   ① ENV YOKSA HİÇBİR ŞEY YAZILMAZ. "Verilmezse basit'i uygula" cazip ama
//      yanlıştır: kurulumcu `.env`e profili yazmadan sunucuyu bir kez açarsa
//      YANLIŞ profil KALICI damgalanır — ikinci koşum artık dokunmaz (aşağıdaki
//      ② kuralı). `superadmin.job`ın `absent` kalıbı birebir uygulanır.
//   ② SATIR VARSA DOKUNULMAZ. Eksik anahtarlar `createMany({skipDuplicates})`
//      ile TEK ifadede yazılır — `upsert.update` yazılsaydı fabrikanın panelden
//      verdiği karar her restart'ta sessizce geri alınırdı.
//   ③ BAĞIMLILIK SAF YÜKLEMLE DOĞRULANIR. Job `setFeatureFlags`i ÇAĞIRAMAZ
//      (imzası `userId` ister; `installation-identity.job` aynı sebeple
//      doğrudan Prisma'ya yazıyor) — yani `assertModuleDependencies`, audit
//      kaydı ve K7 reddi otomatik gelmez. Bağımlılığın SAF ikizi ve kendi audit
//      olayı burada yeniden kurulur; yoksa tutarsız bir çift (iplik açık +
//      ticaret kapalı) doğar, panel "açık" gösterirken uç 403 verir.
//
// ⚠️ DAMGA ≠ MEVCUT DURUM. `system.profile` yalnız "doğuşta hangi profil
// uygulandı"yı söyler; fabrika sonradan panelden anahtar değiştirebilir. Sistem
// Profili ekranı farkı damgadan DEĞİL CANLI değerlerden hesaplar
// (`GET /api/admin/module-profile` — 2026-08-21 "türetilmiş alan / ayrışan
// yüzey" sınıfının tekrarı olmasın).
//
// ⚠️ BOOT GECİKMESİ PENCERESİ: modül middleware'i CACHE'SİZ okur, job 3 sn
// gecikmelidir. Taze "tam" profilli kurulumda ilk birkaç saniyede ticaret/iplik
// uçları 403 döner. Zararsız; reçetede (`docs/ops/KURULUM.md`) yazılıdır.
// =============================================================================

import prisma from "../lib/prisma";
import { MODULE_DEPENDENCIES, MODULE_SETTING_KEYS } from "../constants/module-flags";
import {
  MODULE_DESCRIPTIONS,
  MODULE_FIELD_BY_SETTING_KEY,
  MODULE_PROFILES,
  MODULE_PROFILE_IDS,
  ModuleProfileId,
  isModuleProfileId,
} from "../constants/module-profiles";
import { PROFILE_STAMP_SETTING_KEY } from "../constants/reserved-settings";
import { AuditService } from "../services/audit.service";
import { reportJobFailure } from "./job-failure";
import { bilgi, uyari } from "../lib/logger";

// superadmin/installation-identity ile aynı politika: mutlu yolda ~3 sn,
// DB geç gelirse 3 + 4×15 = ~63 sn'lik pencere.
const STARTUP_DELAY_MS = 3 * 1000;
const RETRY_DELAY_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;

export type ProfileEnvResult =
  /** `TEKSERP_PROFIL` verilmemiş → profil istenmiyor, HİÇBİR yazma. */
  | { kind: "absent" }
  /** Verilmiş ama tanınmıyor → GÜRÜLTÜLÜ hata + HİÇBİR yazma. */
  | { kind: "invalid"; reasons: string[] }
  | { kind: "ok"; profil: ModuleProfileId };

/**
 * SAF okuyucu — yalnız verilen `env` kaydına bakar.
 *
 * ⚠️ `process.env` MUTASYONU YASAK (superadmin.job deseni): bekçi sahte bir env
 * geçirir; global'i geçici değiştirip geri almak paralel koşumda sızdırır.
 */
export function readProfileEnv(env: NodeJS.ProcessEnv = process.env): ProfileEnvResult {
  const raw = (env.TEKSERP_PROFIL ?? "").trim();
  if (!raw) return { kind: "absent" };
  if (!isModuleProfileId(raw)) {
    return {
      kind: "invalid",
      reasons: [
        `TEKSERP_PROFIL="${raw}" tanınmıyor — geçerli değerler: ${MODULE_PROFILE_IDS.join(" | ")}`,
      ],
    };
  }
  return { kind: "ok", profil: raw };
}

/**
 * Profilin KENDİ değerleri üzerinde bağımlılık doğrulaması — SAF, DB'ye dokunmaz.
 *
 * `assertModuleDependencies` (system-setting.service) private'tır ve DB okur;
 * job'dan çağrılamaz. Yüklem aynı haritadan (`MODULE_DEPENDENCIES`) beslenir —
 * ikinci bir tablo yazmak, iki tablonun ayrışacağı gün demektir.
 *
 * @returns İhlal açıklamaları (boş dizi = temiz).
 */
export function assertProfileDependencies(moduller: Record<string, boolean>): string[] {
  const alanDegeri = (alan: string): boolean => {
    const dbKey = Object.keys(MODULE_FIELD_BY_SETTING_KEY).find(
      (k) => MODULE_FIELD_BY_SETTING_KEY[k] === alan,
    );
    return dbKey ? moduller[dbKey] === true : false;
  };
  const ihlaller: string[] = [];
  for (const [bagimli, onKosul] of Object.entries(MODULE_DEPENDENCIES)) {
    if (alanDegeri(bagimli) && !alanDegeri(onKosul)) {
      ihlaller.push(`${bagimli} açık ama ön koşulu ${onKosul} kapalı`);
    }
  }
  return ihlaller;
}

export type ModuleProfileEnsureResult =
  | { action: "absent" }
  | { action: "invalid"; reasons: string[] }
  /** Yedi anahtarın satırı zaten var → DOKUNULMADI. */
  | { action: "exists" }
  | { action: "applied"; profil: ModuleProfileId; yazilan: string[] };

/** `system.profile` damgasının gövdesi (P5 Sistem Profili ekranı okur). */
export interface ModuleProfileStamp {
  profil: ModuleProfileId;
  uygulandiAt: string;
  yazilanAnahtarlar: string[];
}

/**
 * Modül anahtarlarını profilden yazar. İdempotent — ikinci koşum hiçbir satıra
 * dokunmaz.
 */
export async function ensureModuleProfile(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModuleProfileEnsureResult> {
  const parsed = readProfileEnv(env);

  if (parsed.kind === "absent") {
    // ⚠️ MESAJ SATIRLARA BAKARAK KURULUR (2026-09-04 ev provası, BULGU-5).
    // Eskiden env yokluğunda satırlar HİÇ sayılmadan "modül anahtarları
    // YAZILMADI" basılıyordu. Yükseltilen bir kurulumda anahtarlar zaten
    // vardır (grandfathering migration'ı yazar) ve operatör bu satırı okuyup
    // `.env`e gereksiz yere profil ekleyip sunucuyu yeniden başlatıyordu —
    // hiçbir şey değişmeyecekti, çünkü satır varken profil zaten uygulanmaz.
    // Sonuç doğruydu, MESAJ yanıltıcıydı.
    //
    // Dönüş değeri BİLEREK `absent` kalır: sözleşme "env yoksa YAZMA"dır ve
    // bekçi (§7d) onu ölçer. Değişen yalnız operatöre söylenen cümle.
    //
    // Sayım BEST-EFFORT: env yokluğu dalı bugüne dek DB'ye hiç dokunmuyordu ve
    // bu özellik korunur — DB henüz ayakta değilse eski cümleye düşülür,
    // boot bu yüzden gecikmez/başarısız olmaz.
    let mevcutSayi: number | null = null;
    try {
      mevcutSayi = await prisma.systemSetting.count({
        where: { key: { in: [...MODULE_SETTING_KEYS] } },
      });
    } catch {
      mevcutSayi = null;
    }
    if (mevcutSayi !== null && mevcutSayi > 0) {
      bilgi("module-profile", `TEKSERP_PROFIL tanımlı değil; kurulumda ${mevcutSayi}/${MODULE_SETTING_KEYS.size} ` +
          "modül anahtarı ZATEN VAR — yapılacak bir şey yok. " +
          "(Profil yalnız HİÇ anahtarı olmayan TAZE kuruluma uygulanır; " +
          "`.env`e profil eklemek mevcut anahtarları DEĞİŞTİRMEZ.)",
      );
    } else {
      bilgi("module-profile", "TEKSERP_PROFIL tanımlı değil — modül anahtarları YAZILMADI " +
          "(kod varsayılanları geçerli: üretim açık, diğer altısı kapalı).",
      );
    }
    return { action: "absent" };
  }

  if (parsed.kind === "invalid") {
    // GÜRÜLTÜLÜ: kalıcı SystemLog izi + /health sayacı. HİÇBİR satır yazılmaz.
    reportJobFailure(
      "module-profile",
      new Error(`Kurulum profili geçersiz: ${parsed.reasons.join(" · ")}`),
    );
    return { action: "invalid", reasons: parsed.reasons };
  }

  const profil = MODULE_PROFILES[parsed.profil];
  const ihlaller = assertProfileDependencies(profil.moduller as Record<string, boolean>);
  if (ihlaller.length) {
    // Profil SABİTİ bozuk — sahaya çıkmadan yakalanması gereken bir kod hatası.
    // Yine de fail-closed: yarım bir küme yazmaktansa hiç yazmamak doğrudur.
    reportJobFailure(
      "module-profile",
      new Error(
        `"${parsed.profil}" profili modül bağımlılığını ihlal ediyor: ${ihlaller.join(" · ")}`,
      ),
    );
    return { action: "invalid", reasons: ihlaller };
  }

  const beklenen = [...MODULE_SETTING_KEYS];
  const mevcut = await prisma.systemSetting.findMany({
    where: { key: { in: beklenen } },
    select: { key: true },
  });
  const varOlan = new Set(mevcut.map((r) => r.key));
  const eksikler = beklenen.filter((k) => !varOlan.has(k));

  // ⚠️ YÜKLEM "7/7 SATIR VAR MI" DEĞİL, "HİÇ SATIR VAR MI".
  //
  // Profil job'unun sorduğu soru "bu TAZE bir kurulum mu"dur; bir modül satırı
  // bile varsa kurulum kararı ZATEN VERİLMİŞTİR ve eksik satır BİLİNÇLİ
  // olabilir. Fabrikada tam olarak öyle: grandfathering migration'ı ALTI anahtar
  // damgalar, `finance.enabled`i BİLEREK yazmaz (o satırın YOKLUĞU dünkü
  // davranıştır — okuyucu `false` döner).
  //
  // "7/7 ara, eksiği tamamla" yüklemi bunu "eksik" sanıp profilden yazıyordu ve
  // Dilim 1 kabul provası bunu ÖLÇTÜ: mevcut fabrikada `TEKSERP_PROFIL=tam` ile
  // boot edilince `finance.enabled=true` yazılıyor ve ÖN MUHASEBE MODÜLÜ
  // SESSİZCE AÇILIYORDU (`/api/finance/cheques` 403 MODULE_DISABLED → 403 yetki).
  //
  // Bu yüklem sınıfı kalıcı olarak kapatır: yarın sekizinci bir modül anahtarı
  // eklendiğinde migration yedi yazsa bile job "kurulmuş" der ve dokunmaz.
  if (varOlan.size > 0) {
    bilgi("module-profile", `Kurulumda ${varOlan.size}/${beklenen.length} modül anahtarı zaten var — ` +
        "dokunulmadı (profil yalnız HİÇ anahtarı olmayan TAZE kuruluma uygulanır)." +
        (eksikler.length > 0
          ? ` Yazılmayanlar bilinçli kabul edildi: ${eksikler.join(", ")}.`
          : ""),
    );
    return { action: "exists" };
  }

  // TEK İFADE + `skipDuplicates`: iki süreç aynı anda boot etse bile yarış
  // P2002 üretmez ve "hangi sırayla yazılır" sorusu hiç doğmaz.
  await prisma.systemSetting.createMany({
    data: eksikler.map((key) => ({
      key,
      value: profil.moduller[key] === true,
      description: MODULE_DESCRIPTIONS[key],
    })),
    skipDuplicates: true,
  });

  // ⚠️ DAMGA YALNIZ GERÇEKTEN SATIR YAZILDIYSA. Hiç yazılmadığı hâlde damga
  // atılsaydı "profil uygulandı" yalanı doğar ve Sistem Profili ekranı olmayan
  // bir kararı gösterirdi.
  const damga: ModuleProfileStamp = {
    profil: parsed.profil,
    uygulandiAt: new Date().toISOString(),
    yazilanAnahtarlar: eksikler,
  };
  await prisma.systemSetting.upsert({
    where: { key: PROFILE_STAMP_SETTING_KEY },
    create: {
      key: PROFILE_STAMP_SETTING_KEY,
      value: damga as unknown as object,
      description: "Kurulumda uygulanan modül profili (doğuş damgası). Elle DEĞİŞTİRMEYİN.",
    },
    update: { value: damga as unknown as object },
  });

  await AuditService.logEvent({
    category: "SYSTEM",
    action: "MODULE_PROFILE_APPLIED",
    tableName: "system_settings",
    recordId: PROFILE_STAMP_SETTING_KEY,
    payload: { profil: parsed.profil, yazilan: eksikler },
  }).catch(() => undefined);

  bilgi("module-profile", `"${parsed.profil}" profili uygulandı — ${eksikler.length} satır yazıldı: ` +
      eksikler.join(", "),
  );
  return { action: "applied", profil: parsed.profil, yazilan: eksikler };
}

let started = false;

/** Açılışta BİR KEZ koşar. Hata sunucuyu DÜŞÜRMEZ; sınırlı sayıda dener. */
export function startModuleProfileJob(): void {
  if (started) return;
  started = true;

  const attempt = (n: number): void => {
    void ensureModuleProfile().catch((err) => {
      if (n < MAX_ATTEMPTS) {
        uyari("module-profile", `deneme ${n}/${MAX_ATTEMPTS} başarısız (DB hazır olmayabilir), ` +
            `${RETRY_DELAY_MS / 1000}sn sonra tekrar denenecek:`,
          err instanceof Error ? err.message : err,
        );
        setTimeout(() => attempt(n + 1), RETRY_DELAY_MS).unref();
        return;
      }
      reportJobFailure("module-profile", err);
    });
  };

  setTimeout(() => attempt(1), STARTUP_DELAY_MS).unref();
}

/** Test-only: modül durumunu sıfırlar. */
export function __resetModuleProfileJobForTests(): void {
  started = false;
}
