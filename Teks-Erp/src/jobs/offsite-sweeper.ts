// =============================================================================
// OFFSITE SÜPÜRÜCÜ — yedek klasörüne düşen her dosyayı uzak hedefe taşır
// =============================================================================
// (2026-08-10 denetimi, F-OPS-VER-003)
//
// ⚠️⚠️ NEDEN `backup-scheduler` İÇİNDE DEĞİL — bu ayrımın tamamı load-bearing.
// `startBackupScheduler()` sahadaki ayarda ERKEN DÖNER:
//
//     if (process.env.BACKUP_SCHEDULE_ENABLED === "false") { ...; return; }
//
// ve sahada tam olarak öyle ayarlıdır (gece yedeğini bağımsız bir Windows Görev
// Zamanlayıcı görevi alıyor — backend çökmüşken bile yedek alınsın diye,
// bilinçli bir tercih). Süpürme oraya konsaydı, ihtiyaç duyulan TEK ortamda
// hiç koşmazdı; üstelik dev'de sorunsuz çalıştığı için bu hiçbir testte
// görünmezdi. Bu yüzden süpürücü AYRI bir iştir ve `server.ts`ten AYRI çağrılır.
//
// Süpürücü yedeği KİMİN aldığını umursamaz: klasöre ne düşerse kopyalar.
// Backend kapalıyken `yedekle.ps1` yedeği alır, backend kalkınca süpürücü
// kopyayı tamamlar. İki mekanizma birbirinin yokluğunu telafi eder.
// =============================================================================

import { sweepOffsiteBackups, recordSweep } from "../services/helpers/offsite-backup.helper";
import { reportJobFailure } from "./job-failure";
import { bilgi, uyari } from "../lib/logger";

/**
 * Süpürme sıklığı. Gece yedeği 02:00'de alınıyor; saatlik süpürme "sabaha kadar
 * offsite'ta olsun" garantisini fazlasıyla verir. Daha sık koşmanın kazancı yok
 * (`rclone copy` yeni dosya yoksa yalnız bir listeleme yapar) ama bulut API
 * çağrısı da bedava değil.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/**
 * Açılışta hemen koşma: server start'ında DB/havuz ısınıyor ve asıl iş
 * (yükleme) ağ bekletebilir. `backup-scheduler`ın 60 sn'lik gecikmesiyle
 * bilinçli olarak aynı hizada, ama ondan sonra gelsin diye biraz daha uzun.
 */
const STARTUP_DELAY_MS = 90 * 1000;

let timer: NodeJS.Timeout | null = null;
/** Yeniden giriş kilidi: yavaş bir yükleme bir sonraki turu üst üste bindirmesin. */
let running = false;

async function sweepOnce(): Promise<void> {
  if (running) {
    uyari("offsite", "önceki süpürme hâlâ sürüyor — bu tur atlandı.");
    return;
  }
  running = true;
  try {
    const res = await sweepOffsiteBackups();
    recordSweep(res);

    if (!res.configured) {
      // Hedef yoksa bu bir İŞ HATASI değil, bir KURULUM eksiğidir: her saat
      // SystemLog'a hata yazmak gürültü olur ve gerçek hataları gömer.
      // Uyarı `/api/admin/health` üzerinden zaten görünür.
      uyari("offsite", `${res.warnings.join(" | ")}`);
      return;
    }
    if (!res.ok) {
      // Kalıcı iz ŞART: süpürme sessizce başarısız olursa, felaket anına kadar
      // kimse fark etmez — ve o an fark etmenin bir faydası yoktur.
      reportJobFailure("offsite-sweep", new Error(res.warnings.join(" | ") || "bilinmeyen hata"));
      return;
    }
    bilgi("offsite", `süpürme tamam — yerel ${res.localCount}, uzak ${res.remoteCount}, ` +
        `eksik 0 (${Math.round(res.durationMs / 1000)} sn)`,
    );
  } catch (err) {
    reportJobFailure("offsite-sweep", err);
  } finally {
    running = false;
  }
}

export function startOffsiteSweeper(): void {
  if (timer) return;

  // ⚠️ `BACKUP_SCHEDULE_ENABLED` BURADA KONTROL EDİLMEZ ve edilmemeli — o bayrak
  // "yedeği kim ALIR" sorusunu yanıtlar, "kopyası nereye GİDER" sorusunu değil.
  // İkisini birbirine bağlamak, sahadaki kurulumu (harici görev yedek alır,
  // backend kopyalar) yapısal olarak imkânsız kılardı.

  if (!process.env.BACKUP_DIR) {
    uyari("offsite", "BACKUP_DIR tanımsız — offsite süpürme DEVRE DIŞI.");
    return;
  }
  if (!(process.env.BACKUP_RCLONE_REMOTE ?? "").trim()) {
    // Sessiz kalmak yasak: bu, felaket kurtarma yolunun KAPALI olduğu anlamına
    // GELEBİLİR ve sunucu log'unda görünmesi gereken bir cümledir.
    //
    // ⚠️ "GELEBİLİR" — kesin değil. Hedefin YETKİLİ kaynağı panel ayarıdır
    // (`readOffsiteRemote` → önce `SETTING_KEYS.BACKUP_OFFSITE_REMOTE`, env
    // yalnız YEDEK). Burada ayarı okuyamayız: bu kod boot'ta koşar ve DB'ye
    // gitmek açılışı veritabanı hazırlığına bağlardı. Bu yüzden cümle
    // KOŞULLU kuruldu.
    //
    // Eski hâli düz "TÜM YEDEKLER AYNI DİSKTE" diyordu ve panelden ayarlanmış
    // bir kurulumda bu YANLIŞ ALARM'dı — yedekler sorunsuz gidiyorken her
    // açılışta felaket uyarısı basılır, ekip de uyarıları okumamayı öğrenirdi.
    uyari("offsite", "BACKUP_RCLONE_REMOTE ortam değişkeni boş. Hedef PANELDEN " +
        "ayarlanmadıysa tüm yedekler veritabanıyla AYNI DİSKTE demektir ve tek " +
        "disk arızası/fidye yazılımı ikisini birden götürür. " +
        "Kontrol: Sistem → Yedekler → Makine Dışı Yedek.",
    );
  }

  setTimeout(() => {
    void sweepOnce();
    timer = setInterval(() => void sweepOnce(), SWEEP_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("offsite", `süpürücü aktif — her ${Math.round(SWEEP_INTERVAL_MS / 60000)} dk'da bir ` +
      `${process.env.BACKUP_DIR} → ${process.env.BACKUP_RCLONE_REMOTE || "<panelden çözülecek>"}`,
  );
}

/** Test/elle tetikleme için. */
export { sweepOnce as runOffsiteSweepNow };
