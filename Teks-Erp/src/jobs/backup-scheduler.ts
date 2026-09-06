// =============================================================================
// Otomatik gece yedeği (zamanlayıcı)
// =============================================================================
// 2026-07-30: Eskiden bu iş Windows Görev Zamanlayıcı'da ("TeksERP Gece Yedek",
// her gün 03:00, SYSTEM hesabı) duruyordu ve görevi installer'ın manage.ps1'i
// kuruyordu. pm2'ye geçişte o zincir koptu → zamanlama backend'e taşındı.
//
// archive-scheduler.ts ile AYNI kalıp: node-cron allowed-packages dışında olduğu
// için setInterval + SystemSetting'te son-çalışma damgası. Tek Express process
// varsayımına bağlı (server.ts TEK-PROCESS INVARIANT) — 2. replica eklenirse iki
// process aynı gece iki dump alır; advisory lock gerekir.
//
// Davranış:
//   - Server start'tan 60sn sonra ilk kontrol (DB hazır olsun)
//   - Sonra her 15 dakikada bir kontrol
//   - Hedef saat DB'den (SystemSetting `backup.hour`) her turda okunur → admin
//     panelden değiştirince süreç yeniden başlatılmaz
//   - "Bugünün hedef saati geçti mi ve o saatten sonra çalışmış mı?" → hayırsa koş
//   - KAÇIRILAN yedeği telafi eder: sunucu 03:00'te kapalıysa açıldığında alır
//     (eski Görev Zamanlayıcı'nın -StartWhenAvailable davranışıyla aynı)
//   - Damga işin BAŞINDA yazılır: başarısız bir yedek 15 dakikada bir yeniden
//     denenip log'u doldurmasın (eski görev de günde bir kez deniyordu). Hata
//     BACKUP_FAILED audit kaydına ve konsola düşer.
// =============================================================================

import prisma from "../lib/prisma";
import { runBackupJob } from "../services/backup.service";
import { readBackupHour } from "../services/system-setting.service";
import { reportJobFailure } from "./job-failure";
import { factoryDayStart } from "../constants/time";
import { bilgi, hata, uyari } from "../lib/logger";

const SETTING_KEY = "backup.lastNightlyAt";
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15dk
const STARTUP_DELAY_MS = 60 * 1000; // server start'tan sonra ilk kontrole kadar

let timer: NodeJS.Timeout | null = null;
let checking = false;
let checkingSince: number | null = null;
// A9 (2026-07-31 denetimi): runBackupJob hiç settle olmazsa (asılı pg_dump /
// offsite kopya — ağ paylaşımı donması) finally koşmaz, `checking` sonsuza dek
// true kalır ve scheduler SESSİZCE kalıcı devre dışı düşerdi (yedek alınmamaya
// başlar, alarm yok). Normal koşum dakikalar sürer; 3 saat = kesin asılma.
const WATCHDOG_MS = 3 * 60 * 60 * 1000;

async function getLastRun(): Promise<Date | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  if (typeof row?.value !== "string") return null;
  const d = new Date(row.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function setLastRun(at: Date): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: {
      key: SETTING_KEY,
      value: at.toISOString(),
      description: "Otomatik gece yedeğinin son çalıştığı zaman",
    },
    update: { value: at.toISOString() },
  });
}

async function runIfDue(): Promise<void> {
  if (checking) {
    if (checkingSince !== null && Date.now() - checkingSince > WATCHDOG_MS) {
      hata("backup", `WATCHDOG: önceki koşum ${Math.round((Date.now() - checkingSince) / 60000)} dk'dır ` +
          "bitmedi — bayrak zorla bırakılıyor. Asılı pg_dump/offsite kopya olabilir, elle kontrol edin.",
      );
      checking = false;
      checkingSince = null;
    } else {
      return;
    }
  }
  checking = true;
  checkingSince = Date.now();
  try {
    const now = new Date();
    // Hedef saat HER TURDA okunur (SystemSetting `backup.hour` → env → 3): admin
    // Yedekler ekranından saati değiştirdiğinde pm2 restart GEREKMEZ, en geç bir
    // sonraki kontrol turunda (15dk) yeni saat geçerli olur.
    const hour = await readBackupHour();
    // Bugünün hedef saati — FABRİKA gününe göre (2026-08-09, F-OPS-VER-005).
    // Eskiden `new Date(now).setHours(hour, 0, 0, 0)` idi ve SÜREÇ saat dilimini
    // kullanıyordu; kod tabanındaki TEK üretim `setHours`u buydu ve fabrika günü
    // tek kaynağını (`constants/time.ts`) atlıyordu. Bugün etkisi yok — sahada
    // scheduler KAPALI (BACKUP_SCHEDULE_ENABLED=false) ve dev makinesi zaten
    // Europe/Istanbul. Risk bayrak açıldığı gün doğardı: süreç farklı bir TZ ile
    // başlarsa (pm2 servis olarak başka kullanıcıdan, ya da makine UTC'ye ayarlı)
    // `BACKUP_HOUR=3` yerel 03:00 DEĞİL süreç TZ'sinde 03:00 anlamına gelir —
    // Europe/Istanbul için UTC'de bu yerel 06:00'dır, yani pg_dump VARDİYA İÇİNDE
    // koşup dolu bir DB'de dakikalarca I/O yapardı. Hata, log ya da uyarı YOK.
    const dueAt = new Date(factoryDayStart(now).getTime() + hour * 60 * 60 * 1000);
    if (now < dueAt) return;

    const last = await getLastRun();
    if (last && last >= dueAt) return; // bu gece için zaten koşmuş

    // Damgayı ÖNCE yaz (retry spam'ini engeller — yukarıdaki gerekçe).
    await setLastRun(now);

    const result = await runBackupJob("nightly");
    if (result.ok) {
      bilgi("backup", `gece yedeği tamam — ${result.message}`);
    } else {
      hata("backup", `gece yedeği BAŞARISIZ — ${result.message}`);
    }
  } catch (err) {
    // Konsol + SystemLog + (havuz zaman aşımıysa) /health sayacı — F-CORE-OPS-004.
    // NOT: `runBackupJob`ın KENDİ başarısızlığı zaten BACKUP_FAILED audit'i yazar;
    // buraya düşen şey o zincirin DIŞINDAKİ hatadır (ayar okuma, damga yazma).
    reportJobFailure("backup", err);
  } finally {
    checking = false;
    checkingSince = null;
  }
}

export function startBackupScheduler(): void {
  if (timer) return;
  // 2026-07-31: Sahadaki sunucuda gece yedeğini BAĞIMSIZ bir Windows Görev
  // Zamanlayıcı script'i alıyor (`TeksERP-DB-Backup` → `yedekle.ps1`, 02:00).
  // Bunun bilinçli bir üstünlüğü var: backend çökmüş/kapalıyken bile yedek
  // alınır — tam da en çok ihtiyaç duyulan anda. O yüzden orada backend
  // zamanlayıcısı KAPATILIR (`BACKUP_SCHEDULE_ENABLED=false`); panelin elle
  // yedek / önizleme / kopya özellikleri çalışmaya devam eder.
  // İkisi birden açık kalırsa her gece İKİ yedek alınır.
  if (process.env.BACKUP_SCHEDULE_ENABLED === "false") {
    bilgi("backup", "scheduler KAPALI (BACKUP_SCHEDULE_ENABLED=false) — gece yedeği " +
        "harici bir zamanlanmış görev tarafından alınıyor olmalı.",
    );
    return;
  }
  if (!process.env.BACKUP_DIR) {
    // Dev ortamında normal. Üretimde bu satır log'da görünüyorsa YEDEK ALINMIYOR.
    uyari("backup", "BACKUP_DIR tanımsız — otomatik gece yedeği DEVRE DIŞI.");
    return;
  }
  setTimeout(() => {
    void runIfDue();
    timer = setInterval(() => void runIfDue(), CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("backup", "scheduler aktif — yedek saati Yedekler ekranından ayarlanır " +
      "(SystemSetting backup.hour → BACKUP_HOUR env → 03:00)",
  );
}
