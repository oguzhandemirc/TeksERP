// =============================================================================
// Veritabanı yedeği — pg_dump'ı backend YÖNETİR, ama KENDİ İÇİNDE ÇALIŞTIRMAZ
// =============================================================================
// 2026-07-30: Eskiden yedek zinciri Windows'a bağlıydı — `manage.ps1 -Action backup`
// + "TeksERP Gece Yedek" Görev Zamanlayıcı görevi + `schtasks /run` tetiklemesi.
// Kurulum installer'dan (NSSM) pm2'ye taşınınca o zincir koptu: manage.ps1 ve görev
// artık kurulmuyor. Mantık buraya taşındı.
//
// KORUNAN ÖZELLİK — backend prosesi bloklanmaz: pg_dump/pg_restore AYRI child
// process'lerde koşar; backend yalnızca 'close' event'ini bekler (event-driven,
// event loop'u meşgul etmez). Ağır I/O'yu yine PostgreSQL araçları yapar.
//
// Zincir (`runBackupJob`): pg_dump → BÜTÜNLÜK DOĞRULA → saklama rotasyonu → offsite
// kopya. Sıra load-bearing: doğrulanmamış bir dump rotasyona girip sağlam yedeği
// EVİCT ETMEMELİ (bkz. O-17 gerekçesi aşağıda).
//
// GERİ YÜKLEME BURADA YOK — bilinçli. pg_restore --clean mevcut şemayı düşürür;
// backend'in kendi bağlantı havuzu ayaktayken bunu kendi kendine yapması güvenilir
// değil (kendini durdurup sonra başlatması gerekirdi). Geri yükleme dışarıdan,
// backend durdurulmuş halde yapılır — komutu panel üretir (Backups ekranı) ve
// docs/ops/DEPLOY-RUNBOOK.md anlatır.
// =============================================================================

import fs from "fs";
import path from "path";
import { AuditService } from "./audit.service";
import {
  backupKind,
  NIGHTLY_PREFIX,
  PREMIGRATE_PREFIX,
  stamp,
  type BackupKind,
} from "./helpers/backup-naming.helper";
import {
  parseDatabaseUrl as parseUrl,
  pgToolArgs,
  type PgConn,
} from "./helpers/pg-conn.helper";
import { pgTool, runTool } from "./helpers/pg-tool.helper";

const BACKUP_DIR = process.env.BACKUP_DIR;
// Offsite (makine dışı) ikinci kopya hedefi — NAS/UNC/harici disk. Y-4: tek disk
// arızası / ransomware / yangın hem DB'yi hem yedekleri aynı anda yok etmesin.
// Eskiden backup-offsite.txt dosyasındaydı (gece görevi param'sız koştuğu için);
// artık zamanlayıcı backend'in içinde olduğundan env yeterli.
const OFFSITE_DIR = process.env.BACKUP_OFFSITE_DIR;
// pg_dump/pg_restore konumu: `pgTool()` içinde ÇAĞRI ANINDA okunur (modül-yükleme
// anında değil) — böylece test env'i değiştirip hatalı-yol dalını doğrulayabilir,
// üretimde ise davranış aynı kalır (env pm2 start'ta sabitlenir).
// Yedek alırken kullanılacak DB kullanıcısı — OPSİYONEL geçersiz kılma.
// Neden: `pg_dump` varsayılan olarak DATABASE_URL'deki UYGULAMA kullanıcısıyla koşar.
// O kullanıcı tabloların sahibi/superuser değilse dump "permission denied for table X"
// ile patlar ya da bazı nesneleri atlayarak EKSİK bir yedek üretir — ikincisi sessizdir.
// Eski installer yedekleri `postgres` süper kullanıcısıyla alıyordu. Uygulama kullanıcısı
// sahibi değilse bu ikisini set edin.
// =============================================================================
// Saklama politikası — GÜN bazlı (2026-07-31)
// =============================================================================
// Eskiden "en yeni 14 dosya" idi. Sahadaki sunucuda yedekleri bağımsız bir
// Windows Görev Zamanlayıcı script'i (`yedekle.ps1`) alıyor ve **30 gün**
// saklıyor; aynı klasöre ve aynı `tekserp_*` desenine yazıyor. Sayı bazlı
// rotasyon o geçmişi 14 dosyaya indirip ~16 günü SESSİZCE silerdi.
// Politika artık gün bazlı ve sahadakiyle aynı varsayılana sahip.
const DEFAULT_RETENTION_DAYS = 30;
/** Yaşına bakılmaksızın korunacak en yeni dosya sayısı (saat kayması sigortası). */
const RETENTION_MIN_KEEP = 3;

function retentionDays(): number {
  const raw = Number(process.env.BACKUP_RETENTION_DAYS);
  return Number.isInteger(raw) && raw >= 1 && raw <= 3650 ? raw : DEFAULT_RETENTION_DAYS;
}

// =============================================================================
// Bağlantı bilgisi — DATABASE_URL'den çözülür
// =============================================================================
// Installer döneminde şifre secret.json'dan okunuyordu; pm2 kurulumunda tek
// yetkili kaynak DATABASE_URL (.env / ecosystem.config env). Şifre child process'e
// YALNIZ PGPASSWORD env'i ile geçer (pg-tool.helper) — komut satırına yazılmaz.
//
// Çözümleme `helpers/pg-conn.helper.ts`'te (saf); env okuma burada kalır. Yükseltilmiş
// kimlik (BACKUP_PG_USER) hem yedek hem geri yükleme kopyası akışında AYNI çifttir —
// üçüncü bir env çifti açılmaz. Env **çağrı anında** okunur ki test değiştirebilsin.

/** Yedek/DDL için yükseltilmiş DB kimliği; verilmezse DATABASE_URL kimliği. */
export function backupPgOverride(): { user?: string | undefined; password?: string | undefined } {
  return { user: process.env.BACKUP_PG_USER, password: process.env.BACKUP_PG_PASSWORD };
}

function parseDatabaseUrl(): PgConn | null {
  return parseUrl(process.env.DATABASE_URL, backupPgOverride());
}

// =============================================================================
// Bütünlük doğrulama — `pg_restore --list`
// =============================================================================
// O-17: `pg_dump` exit 0 dönse bile dosya yarım/bozuk olabilir (disk dolması,
// sessiz kesinti). İki yerde gerekir: (a) yedek alındıktan hemen sonra — bozuksa
// rotasyona inip SAĞLAM yedekleri evict etmesin; (b) geri yükleme önizlemesinde —
// `--clean` şemayı düşürdükten SONRA "dosya bozukmuş" öğrenmek felakettir.
//
// `--list` DB bağlantısı GEREKTİRMEZ, yalnız dosyanın TOC'unu okur.

export type BackupVerifyResult = "ok" | "corrupt" | "unknown";

/** (yol, boyut, mtime) anahtarlı süreç-içi cache — dialog yeniden açılışı anında olsun. */
const verifyCache = new Map<string, BackupVerifyResult>();
const VERIFY_TIMEOUT_MS = 30_000;

export async function verifyBackupFile(abs: string): Promise<BackupVerifyResult> {
  let key: string;
  try {
    const st = await fs.promises.stat(abs);
    key = `${abs}|${st.size}|${st.mtimeMs}`;
  } catch {
    return "unknown";
  }
  const cached = verifyCache.get(key);
  if (cached) return cached;

  const conn = parseDatabaseUrl();
  const result = await Promise.race([
    runTool(pgTool("pg_restore"), ["--list", abs], conn?.password ?? ""),
    new Promise<null>((r) => setTimeout(() => r(null), VERIFY_TIMEOUT_MS).unref()),
  ]);

  let verdict: BackupVerifyResult;
  if (result === null) {
    // Çok GB'lık dosyada operatörü bekletme; "bilinmiyor" bloklamaz, uyarır.
    verdict = "unknown";
  } else if (result.spawnError) {
    // PG_BIN_DIR panelde yanlış olabilir ama operatörün shell'inde doğru olabilir —
    // aracı bulamamak dosyanın bozuk olduğu ANLAMINA GELMEZ, özelliği kilitleme.
    verdict = "unknown";
  } else {
    verdict = result.code === 0 ? "ok" : "corrupt";
  }
  // "unknown" cache'lenmez: geçici bir sorun (timeout/PATH) kalıcı hâle gelmesin.
  if (verdict !== "unknown") verifyCache.set(key, verdict);
  return verdict;
}

// =============================================================================
// Yedek işi — tek seferde bir tane
// =============================================================================
// schtasks kalktığı için eşzamanlılığı ARTIK BACKEND engellemek zorunda: iki
// paralel pg_dump aynı dosya adına (saniye çözünürlüğü) yazabilir ve rotasyonla
// yarışır. `running` bayrağı tek-process invariant'ı (server.ts) altında yeterli.

export type BackupTrigger = "manual" | "nightly";

export interface BackupRunResult {
  ok: boolean;
  file: string | null;
  message: string;
  finishedAt: string;
  trigger: BackupTrigger;
  /** İşin toplam süresi (ms). Geri yükleme dialogunda "güvenlik yedeği kesintiyi
   *  bu kadar uzatacak" tahmini için gösterilir — operatör bakım penceresini bilsin. */
  durationMs: number;
}

let running = false;
let lastResult: BackupRunResult | null = null;

export function isBackupRunning(): boolean {
  return running;
}

export function getLastBackupResult(): BackupRunResult | null {
  return lastResult;
}

/**
 * Yedeği baştan sona koşar. Çağıran `await` etmek zorunda DEĞİL — zincir arka
 * planda ilerler (child process'ler işi yapar). Hata fırlatmaz; sonucu döner ve
 * `lastResult`'a yazar.
 */
export async function runBackupJob(trigger: BackupTrigger): Promise<BackupRunResult> {
  const startedMs = Date.now();
  const finish = (ok: boolean, message: string, file: string | null): BackupRunResult => {
    const result: BackupRunResult = {
      ok,
      file,
      message,
      finishedAt: new Date().toISOString(),
      trigger,
      durationMs: Date.now() - startedMs,
    };
    lastResult = result;
    // İz best-effort (CLAUDE.md: audit yazım hatası işi düşürmez).
    void AuditService.logEvent({
      category: "SYSTEM",
      action: ok ? "BACKUP_COMPLETED" : "BACKUP_FAILED",
      payload: { trigger, file: file ? path.basename(file) : null, message },
    });
    return result;
  };

  if (running) {
    // lastResult'a YAZMA — koşmakta olan işin sonucunu ezmesin.
    return {
      ok: false,
      file: null,
      message: "Zaten bir yedek işlemi sürüyor.",
      finishedAt: new Date().toISOString(),
      trigger,
      durationMs: 0,
    };
  }

  if (!BACKUP_DIR) {
    // Eskiden bu durum SESSİZCE boş liste dönüyordu (env NSSM kaydından geliyordu,
    // pm2'ye geçişte düşmesi fark edilmeden yedeksiz kalmaya yol açtı). Artık açık hata.
    return finish(false, "BACKUP_DIR ortam değişkeni tanımlı değil — yedek alınamaz.", null);
  }
  const conn = parseDatabaseUrl();
  if (!conn) {
    return finish(false, "DATABASE_URL çözümlenemedi — yedek alınamaz.", null);
  }

  running = true;
  const out = path.join(BACKUP_DIR, `${NIGHTLY_PREFIX}${stamp(new Date())}.dump`);
  // ⚠️ YARIM DOSYA NİHAİ ADI ALMAZ (denetim 2026-08-09, F-CORE-OPS-001).
  // pg_dump eskiden DOĞRUDAN `out`a yazıyordu. Süreç dump sırasında ölürse
  // (pm2 restart / deploy — gracefulShutdown 5 sn'de `process.exit` zorluyor)
  // temizlik dalları hiç koşmuyor ve yarım `.dump` diskte KALIYORDU. O dosya
  // sonra ÜÇ yerde sağlam yedek gibi davranılıyordu: `/health` `lastBackup`
  // (en yeni .dump'ı mtime ile seçer), rotasyonun MIN_KEEP koruması ve
  // Yedekler ekranı. Artık dump `.part`a yazılır ve YALNIZ bütünlük doğrulaması
  // geçtikten sonra nihai ada alınır (`rename` aynı dizinde atomiktir).
  //
  // `.part` uzantısı her yerde GÖRÜNMEZDİR ve bu tesadüf değil: dosya listeleyen
  // dört yol da `.dump` ile bitmeyi şart koşuyor (app.ts latestBackupInfo,
  // rotasyon filtresi, listBackups, resolveBackupPath) — yeni bir yüzey eklerken
  // aynı şartı koru.
  const partPath = `${out}.part`;
  /** rename başarıyla koştu mu — catch'in doğrulanmış yedeği silmemesi için. */
  let published = false;
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    // Önceki bir çöküşten kalan bayat `.part` dosyalarını buda (24 saatten eski).
    // Görünmez oldukları için zarar vermezler ama sessizce disk yerler.
    await sweepStaleParts();

    // --- 1) pg_dump (custom format: pg_restore ile seçmeli geri yükleme mümkün)
    const dump = await runTool(
      pgTool("pg_dump"),
      [...pgToolArgs(conn), "-Fc", "-f", partPath],
      conn.password,
    );
    if (dump.spawnError) {
      await fs.promises.rm(partPath, { force: true });
      return finish(
        false,
        `pg_dump başlatılamadı: ${dump.spawnError}. ` +
          `PG_BIN_DIR doğru mu? (${process.env.PG_BIN_DIR ?? "PATH"})`,
        null,
      );
    }
    if (dump.code !== 0) {
      await fs.promises.rm(partPath, { force: true });
      return finish(
        false,
        dump.timedOut
          ? `pg_dump ZAMAN AŞIMINA uğradı ve öldürüldü — yarım dosya silindi. ${dump.stderr.trim()}`
          : `pg_dump başarısız (kod ${dump.code}). ${dump.stderr.trim()}`,
        null,
      );
    }

    // --- 2) BÜTÜNLÜK DOĞRULAMA (O-17)
    // Bozuk bir dump 14'lük rotasyonla SAĞLAM yedeklerin yerini alırsa felakete
    // kadar fark edilmez → önce doğrula, bozuksa SİL ve rotasyona İNME.
    // NOT: burada "unknown" da reddedilir (aşağıdaki `!== "ok"`). Geri yükleme
    // önizlemesinin aksine burada muhafazakâr olmak bedava: doğrulanamayan bir
    // dosyayı yedek diye saklamaktansa atıp bir sonraki turda yeniden almak yeğdir.
    const verdict = await verifyBackupFile(partPath);
    if (verdict !== "ok") {
      await fs.promises.rm(partPath, { force: true });
      return finish(
        false,
        `Yedek DOĞRULANAMADI (pg_restore --list: ${verdict}) — bozuk dump silindi, ` +
          `önceki yedekler korundu.`,
        null,
      );
    }

    // --- 2b) YAYINLA: doğrulanmış dosya nihai adını ALIR (aynı dizinde atomik).
    // Bu satırdan ÖNCE hiçbir yüzey bu yedeği göremez; bu satırdan SONRA dosya
    // tam ve doğrulanmıştır. Aradaki "yarım ama taze görünen yedek" penceresi YOK.
    await fs.promises.rename(partPath, out);
    published = true;

    // --- 3) Saklama rotasyonu (GÜN bazlı)
    // Yalnız günlük (tekserp_*) yedekler rotasyona girer; migration öncesi
    // (premigrate_*) ve geri yükleme öncesi (pre-restore_) yedekler geri dönüş
    // noktasıdır, otomatik silinmez.
    const warnings: string[] = [];
    try {
      const names = (await fs.promises.readdir(BACKUP_DIR)).filter(
        (f) => f.startsWith(NIGHTLY_PREFIX) && f.toLowerCase().endsWith(".dump"),
      );
      const withTime = await Promise.all(
        names.map(async (name) => ({
          name,
          mtime: (await fs.promises.stat(path.join(BACKUP_DIR, name))).mtimeMs,
        })),
      );
      const newestFirst = withTime.sort((a, b) => b.mtime - a.mtime);
      const cutoffMs = Date.now() - retentionDays() * 24 * 60 * 60 * 1000;
      // MIN_KEEP tabanı: sistem saati ileri kayarsa (BIOS pili, NTP hatası) gün
      // bazlı hesap TÜM yedekleri "eski" sayıp silerdi. En yeni N dosya yaşına
      // BAKILMAKSIZIN korunur — tek bir saat hatası yedeksiz bırakmasın.
      const doomed = newestFirst.slice(RETENTION_MIN_KEEP).filter((f) => f.mtime < cutoffMs);
      for (const f of doomed) {
        await fs.promises.rm(path.join(BACKUP_DIR, f.name), { force: true });
      }
    } catch (err) {
      // Rotasyon hatası yedeği geçersiz kılmaz — yedek zaten alındı ve doğrulandı.
      warnings.push(`saklama temizliği yapılamadı: ${err instanceof Error ? err.message : err}`);
    }

    // --- 4) Offsite kopya (Y-4)
    if (OFFSITE_DIR) {
      try {
        await fs.promises.mkdir(OFFSITE_DIR, { recursive: true });
        await fs.promises.copyFile(out, path.join(OFFSITE_DIR, path.basename(out)));
      } catch (err) {
        // Offsite başarısızlığı yerel yedeği geçersiz kılmaz, ama SESSİZ KALMAZ.
        warnings.push(
          `OFFSITE KOPYA BAŞARISIZ (${OFFSITE_DIR}): ${err instanceof Error ? err.message : err}`,
        );
      }
    } else {
      warnings.push(
        "OFFSITE YEDEK AYARLANMADI — tüm yedekler DB ile aynı diskte (felaket riski). " +
          "BACKUP_OFFSITE_DIR ortam değişkenini ayarlayın.",
      );
    }

    const suffix = warnings.length > 0 ? ` UYARI: ${warnings.join(" | ")}` : "";
    return finish(true, `Yedek alındı ve doğrulandı: ${path.basename(out)}.${suffix}`, out);
  } catch (err) {
    // Yarım dosyayı her hâlükârda temizle (yoksa no-op).
    await fs.promises.rm(partPath, { force: true }).catch(() => {});
    // ⚠️ DOĞRULANMIŞ yedeği SİLME. Eski hâli koşulsuz `rm(out)` yapıyordu: rename
    // sonrası bir adımda (rotasyon/offsite) beklenmedik bir hata fırlarsa, o gece
    // ALINMIŞ VE DOĞRULANMIŞ yedek yok ediliyordu — yani hata telafisi, korumaya
    // çalıştığı şeyi imha ediyordu. Artık yalnız YAYINLANMAMIŞ dosya silinir.
    if (!published) await fs.promises.rm(out, { force: true }).catch(() => {});
    return finish(
      false,
      `Yedek hatası: ${err instanceof Error ? err.message : String(err)}` +
        (published ? " (yedek dosyası ALINDI ve korundu — hata sonraki adımda oluştu)" : ""),
      published ? out : null,
    );
  } finally {
    running = false;
  }
}

/**
 * Bayat `.part` dosyalarını buda — süreç dump ortasında öldüyse geriye kalanlar.
 * Görünmez oldukları için zarar vermezler ama sessizce disk yerler. 24 saat eşiği:
 * KOŞMAKTA OLAN bir dump'ın dosyasına asla dokunmamak için cömert tutuldu
 * (ayrıca `running` bayrağı zaten ikinci bir turu engelliyor).
 */
async function sweepStaleParts(): Promise<void> {
  if (!BACKUP_DIR) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  try {
    for (const name of await fs.promises.readdir(BACKUP_DIR)) {
      if (!name.endsWith(".dump.part")) continue;
      const full = path.join(BACKUP_DIR, name);
      const st = await fs.promises.stat(full).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fs.promises.rm(full, { force: true }).catch(() => {});
    }
  } catch {
    // Budama başarısızlığı yedeği geçersiz kılmaz — sessizce geç.
  }
}

// =============================================================================
// Manuel tetikleme (panel "Şimdi yedek al")
// =============================================================================
// Fire-and-forget: HTTP isteğini yedek bitene kadar bekletmeyiz (büyük DB'de
// dakikalar sürer, istemci timeout'a düşer). 202 dönülür; panel liste/durum
// yoklamasıyla sonucu görür.

export interface BackupTriggerResult {
  started: boolean;
  message: string;
}

export function triggerManualBackup(): BackupTriggerResult {
  if (running) {
    return { started: false, message: "Zaten bir yedek işlemi sürüyor." };
  }
  if (!BACKUP_DIR) {
    return {
      started: false,
      message: "BACKUP_DIR ortam değişkeni tanımlı değil — sunucu yapılandırmasını kontrol edin.",
    };
  }
  if (!parseDatabaseUrl()) {
    return { started: false, message: "DATABASE_URL çözümlenemedi — yedek alınamaz." };
  }
  void runBackupJob("manual");
  return {
    started: true,
    message: "Yedek başlatıldı. Birkaç dakika içinde tamamlanır; bitince 'son yedek' güncellenir.",
  };
}

// =============================================================================
// Yedek dosyalarını listele / indir (panelden)
// =============================================================================
// Yalnız filesystem okur (DB'ye dokunmaz) → talep üzerine, ucuz. İndirme yolu
// BACKUP_DIR'le SINIRLANIR (path traversal engellenir).

export interface BackupFileInfo {
  name: string;
  sizeBytes: number;
  time: string; // dosya değişiklik zamanı (ISO)
  /** Ön ekten türeyen tür. Ön ek→tür eşlemesi TEK KAYNAKTA (backup-naming.helper)
   *  kalsın diye backend bildirir — panel prefix mantığını KOPYALAMAZ. */
  kind: BackupKind;
}

/**
 * Panelin çalıştırılabilir bir `pg_restore` komutu kurabilmesi için gereken hedef.
 * ŞİFRE YOK — operatör onu sunucuda PGPASSWORD ile verir (bkz. DEPLOY-RUNBOOK).
 * Bu uç zaten `admin:settings` + `admin:users` (AND) ister ve yedek dosyasının
 * kendisi düz-metin giriş sırları içerir; bağlantı metadata'sı ek maruziyet değil.
 */
export interface BackupRestoreTarget {
  host: string;
  port: string;
  user: string;
  database: string;
}

export interface BackupListing {
  files: BackupFileInfo[];
  backupDir: string | null; // mutlak yedek klasörü (geri-yükleme komutu için)
  restoreTarget: BackupRestoreTarget | null; // pg_restore hedefi (şifre hariç)
  pm2AppName: string; // geri-yükleme sırasında durdurulacak pm2 süreç adı
  running: boolean; // yedek şu an koşuyor mu (panel butonu kilitlenir)
  lastResult: BackupRunResult | null; // son işin sonucu (başarısızlık panelde görünsün)
  /**
   * Backend'in KENDİ gece zamanlayıcısı açık mı (`BACKUP_SCHEDULE_ENABLED`).
   *
   * ⚠️ O-1 (2026-09-05 sahada ölçüldü): sahada bu `false` — gece yedeğini harici
   * bir Windows Görev Zamanlayıcı görevi alıyor (bilinçli: backend çökmüşken de
   * yedek alınsın). Ama panel "Otomatik yedek saati" alanını yine düzenlenebilir
   * gösteriyor ve `BACKUP_HOUR` varsayılanını basıyordu. Kullanıcı saati
   * değiştirdi, `system_settings`te satır bile oluşmadı, gerçek yedek başka
   * saatte alınmaya devam etti. **Panel bir saat gösteriyor, sistem başka saatte
   * yedek alıyor ve ikisinin ilgisi yok** — operatör bunu ancak dışarıdan
   * ölçerek anlayabilirdi. ÖLÜ KUMANDA sınıfı.
   *
   * Bu alan panelin o kumandayı devre dışı bırakması ve sebebini yazması için.
   */
  scheduleEnabled: boolean;
}

export async function listBackups(): Promise<BackupListing> {
  const conn = parseDatabaseUrl();
  const base = {
    restoreTarget: conn
      ? { host: conn.host, port: conn.port, user: conn.user, database: conn.database }
      : null,
    // pm2 çalıştırdığı sürece kendi uygulama adını `name` env'iyle enjekte eder.
    pm2AppName: process.env.name || "teks-erp-backend",
    running,
    lastResult,
    // Kapı `backup-scheduler` ile BİREBİR aynı yüklem olmalı — orada
    // `=== "false"` yazıyor (yani tanımsız = AÇIK). Burada `!== "false"` yazmak
    // aynı cümlenin tersidir; iki yerde iki farklı yüklem yazmak, panelin
    // "açık" dediği bir kurulumda zamanlayıcının kapalı olması demekti.
    scheduleEnabled: process.env.BACKUP_SCHEDULE_ENABLED !== "false",
  };
  const dir = BACKUP_DIR;
  if (!dir) return { files: [], backupDir: null, ...base };
  try {
    // F234: async fs — büyük yedek klasöründe readdirSync + per-file statSync
    // istek handler'ını (dolayısıyla event loop'u) bloklamasın.
    const names = (await fs.promises.readdir(dir)).filter((f) =>
      f.toLowerCase().endsWith(".dump"),
    );
    const files = (
      await Promise.all(
        names.map(async (name) => {
          const st = await fs.promises.stat(path.join(dir, name));
          return {
            name,
            sizeBytes: st.size,
            time: new Date(st.mtimeMs).toISOString(),
            kind: backupKind(name),
          };
        }),
      )
    ).sort((a, b) => b.time.localeCompare(a.time)); // en yeni önce
    return { files, backupDir: path.resolve(dir), ...base };
  } catch {
    return { files: [], backupDir: path.resolve(dir), ...base };
  }
}

/** Güvenli yol: yalnız BACKUP_DIR içindeki bir .dump dosyası; traversal engellenir. */
export function resolveBackupPath(name: string): string | null {
  if (!BACKUP_DIR) return null;
  const safe = path.basename(name); // dizin bileşenlerini sıyır (../ vb. düşer)
  if (safe !== name || !/\.dump$/i.test(safe)) return null;
  const root = path.resolve(BACKUP_DIR);
  const abs = path.resolve(root, safe);
  if (abs !== root + path.sep + safe && !abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
}

export { DEFAULT_RETENTION_DAYS, RETENTION_MIN_KEEP, retentionDays };
// Ön ekler için kanonik kaynak `helpers/backup-naming.helper.ts`'tir — buradan
// yeniden ihraç ETMİYORUZ ki iki kaynak izlenimi doğmasın.
