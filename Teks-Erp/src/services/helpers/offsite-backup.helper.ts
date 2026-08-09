// =============================================================================
// OFFSITE YEDEK SÜPÜRÜCÜSÜ — yerel yedek klasörünü uzak hedefe kopyalar
// =============================================================================
// (2026-08-10 denetimi, F-OPS-VER-003)
//
// SORUN: Veritabanı ve 30 günlük yedeklerin TAMAMI aynı fiziksel diskteydi.
// Tek disk arızası, yangın, hırsızlık ya da fidye yazılımı ikisini birden
// götürür — geri dönüş noktası KALMAZ. Fidye yazılımı ayrıca standart olarak
// ÖNCE yedek klasörünü hedefler ve burada saldırgan için tek hedef vardı.
//
// ⚠️ NEDEN AYRI BİR SÜPÜRÜCÜ — "BACKUP_OFFSITE_DIR'i doldur" YETMEZ.
// Sahada gece yedeğini backend ALMIYOR: `BACKUP_SCHEDULE_ENABLED="false"` ve
// yedeği bağımsız bir Windows Görev Zamanlayıcı görevi (`yedekle.ps1`, 02:00)
// alıyor — backend çökmüşken bile yedek alınsın diye, bilinçli. O görev
// `backup.service.ts`ten HİÇ GEÇMEZ, yani oradaki offsite kopyası yalnız
// PANELDEN elle alınan yedeklere uygulanır. Yalnız `BACKUP_OFFSITE_DIR`
// doldurulsaydı sonuç şu olurdu: elle yedekler offsite'a gider, asıl önemli
// olan GECE yedeği tek diskte kalır — ve "OFFSITE YEDEK AYARLANMADI" uyarısı
// sustuğu için bunu söyleyen tek sinyal de kaybolurdu. Sessiz yanlış güven.
//
// Bu yüzden süpürücü YEDEĞİ KİMİN ALDIĞINI UMURSAMAZ: klasöre ne düşerse
// kopyalar. Backend çökse bile `yedekle.ps1` yedeği alır; backend kalkınca
// kopyayı tamamlar.
//
// ⚠️ `rclone copy` — `sync` DEĞİL, ve bu farkın tamamı güvenliktir.
// `sync` hedefi kaynağa EŞİTLER: yerel dosya silinirse/şifrelenirse uzaktaki de
// gider, yani fidye yazılımı offsite kopyayı da imha eder. `copy` yalnız EKLER.
// Bu dosyada uzaktan silen TEK BİR satır yok ve olmamalı.
// =============================================================================

import fs from "fs";
import path from "path";
import { runProcess } from "./pg-tool.helper";
import {
  NIGHTLY_PREFIX,
  PREMIGRATE_PREFIX,
  PRE_RESTORE_PREFIX,
} from "./backup-naming.helper";
import { readOffsiteRemote } from "../system-setting.service";

/**
 * Kopyalanacak dosya adı ön ekleri — `backup-naming.helper` TEK KAYNAĞINDAN.
 *
 * ⚠️ `premigrate_` ve `pre-restore_` DE DAHİL, ve bu bilinçli. Onlar rotasyon
 * DIŞIDIR (yerelde hiç silinmezler) çünkü tam da "bir şey ters giderse" diye
 * alınan güvenlik yedekleridir; offsite kapsamından çıkarmak, en çok ihtiyaç
 * duyulacak yedeği korumasız bırakmak olurdu.
 */
const COPY_PREFIXES = [NIGHTLY_PREFIX, PREMIGRATE_PREFIX, PRE_RESTORE_PREFIX] as const;

/** rclone ikilisinin yolu. Windows'ta PATH'te olmayabilir → env ile verilir. */
const RCLONE_BIN = (): string => (process.env.BACKUP_RCLONE_BIN ?? "rclone").trim() || "rclone";
const BACKUP_DIR = (): string | undefined => process.env.BACKUP_DIR;

/**
 * rclone yapılandırma dosyasının yolu — HER çağrıda `--config` ile verilir.
 *
 * ⚠️ AÇIKÇA VERİLMEK ZORUNDA. rclone varsayılan olarak kullanıcı profilindeki
 * `%APPDATA%\rclone\rclone.conf`u okur; backend'i pm2 hangi Windows hesabıyla
 * çalıştırıyorsa o hesabın profili geçerli olur. Sunucuda `rclone config`
 * çalıştıran kişi başka bir hesapta oturmuşsa (ya da pm2 servis hesabıyla
 * koşuyorsa) yapılandırma "kayıp" görünür ve sebebi hiçbir yerde yazmaz.
 * Sabit bir yol bu belirsizliği tamamen kaldırır — ve panelden token yazan
 * sihirbazın nereye yazacağını da tanımlar.
 *
 * Varsayılan: yedek klasörünün KARDEŞİ (`<BACKUP_DIR>/../rclone.conf`).
 * ⚠️ Yedek klasörünün İÇİNE konmaz — orası süpürülüyor, yani yapılandırma
 * dosyası (içinde Drive yenileme token'ı ile) buluta kopyalanırdı.
 */
function rcloneConfigPath(): string | null {
  const explicit = (process.env.BACKUP_RCLONE_CONFIG ?? "").trim();
  if (explicit) return explicit;
  const dir = BACKUP_DIR();
  return dir ? path.join(path.dirname(path.resolve(dir)), "rclone.conf") : null;
}

/** `--config <yol>` argümanları (yol çözülemezse boş — rclone kendi varsayılanını kullanır). */
function configArgs(): string[] {
  const p = rcloneConfigPath();
  return p ? ["--config", p] : [];
}

/**
 * Yükleme üst sınırı: 3 saat. `pg-tool`un varsayılanıyla ve
 * `backup-scheduler`ın watchdog'uyla bilinçli olarak AYNI — yavaş bir hatta
 * büyük bir dump saatler sürebilir, ama "bu iş artık bitmez" eşiği ortak olsun.
 */
const SWEEP_TIMEOUT_MS = 3 * 60 * 60 * 1000;
/** Listeleme kısa bir iştir; asılırsa süpürmenin tamamını bekletmemeli. */
const LIST_TIMEOUT_MS = 5 * 60 * 1000;

export interface OffsiteSweepResult {
  /** Hedef tanımlı mı — `false` ise hiçbir şey denenmedi (uyarı üretilir). */
  configured: boolean;
  /** Yerel klasörde kopyalanmaya aday dosya sayısı. */
  localCount: number;
  /** Uzak hedefte görülen (aynı ön ekli) dosya sayısı. */
  remoteCount: number;
  /** Yerelde VAR, uzakta YOK — kapsanmayan yedekler. Boş olmalı. */
  missing: string[];
  /** Süpürme başarılı mı (rclone sıfır kodla döndü VE eksik yok). */
  ok: boolean;
  warnings: string[];
  durationMs: number;
  finishedAt: string;
}

function isBackupFile(name: string): boolean {
  return name.toLowerCase().endsWith(".dump") && COPY_PREFIXES.some((p) => name.startsWith(p));
}

async function localNames(dir: string): Promise<string[]> {
  return (await fs.promises.readdir(dir)).filter(isBackupFile).sort();
}

/**
 * Uzak hedefteki dosya adları. `rclone lsf` yalnız adları basar (bir ad / satır).
 *
 * ⚠️ Liste BAŞARISIZ olursa `null` döner — BOŞ DİZİ DEĞİL. Boş dizi dönseydi
 * "uzakta hiçbir şey yok" ile "uzağa bakamadım" aynı sonuca çıkar ve rapor her
 * dosyayı `missing` sayıp sahte alarm üretirdi (ya da tersi bir düzeltmeyle
 * gerçek eksikleri yutardı).
 */
async function remoteNames(remote: string): Promise<string[] | null> {
  const res = await runProcess(RCLONE_BIN(), ["lsf", remote, "--files-only", ...configArgs()], {
    timeoutMs: LIST_TIMEOUT_MS,
    captureStdout: true,
  });
  if (res.spawnError || res.code !== 0) return null;
  return (res.stdout ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(isBackupFile)
    .sort();
}

/**
 * Yerel yedek klasörünü uzak hedefe kopyalar ve KAPSAMI DOĞRULAR.
 *
 * İki adım ayrı tutuldu (kopyala, sonra listele) çünkü ikisi FARKLI soruları
 * yanıtlıyor: `rclone copy`nin sıfır dönmesi "bu koşumda hata olmadı" demektir,
 * `lsf` karşılaştırması ise "yerelde olan her şey gerçekten uzakta mı" der.
 * İkincisi olmadan, aylar önce bir kez başarısız olmuş tek bir dosya sonsuza
 * dek eksik kalır ve hiçbir yerde görünmez.
 */
export async function sweepOffsiteBackups(): Promise<OffsiteSweepResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const done = (r: Partial<OffsiteSweepResult>): OffsiteSweepResult => ({
    configured: false,
    localCount: 0,
    remoteCount: 0,
    missing: [],
    ok: false,
    warnings,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
    ...r,
  });

  const dir = BACKUP_DIR();
  const remote = await readOffsiteRemote();

  if (!dir) {
    warnings.push("BACKUP_DIR tanımsız — offsite süpürme yapılamaz.");
    return done({});
  }
  if (!remote) {
    warnings.push(
      "OFFSITE HEDEF AYARLANMADI (BACKUP_RCLONE_REMOTE boş) — tüm yedekler DB ile aynı diskte (felaket riski).",
    );
    return done({});
  }

  let local: string[];
  try {
    local = await localNames(dir);
  } catch (err) {
    warnings.push(`Yerel yedek klasörü okunamadı (${dir}): ${err instanceof Error ? err.message : err}`);
    return done({ configured: true });
  }

  if (local.length === 0) {
    // Yedek yoksa kopyalanacak da bir şey yok — bu bir hata DEĞİL, ama sessiz de
    // bırakılmaz: "hiç yedek yok" başlı başına bir uyarıdır.
    warnings.push(`Yerel yedek klasöründe kopyalanacak dosya yok (${dir}).`);
    return done({ configured: true, ok: true });
  }

  // ── 1) KOPYALA ────────────────────────────────────────────────────────────
  // `--immutable`: kaynak dosya daha önce kopyalandıktan SONRA değiştiyse rclone
  // sessizce yenisini yüklemek yerine HATA verir. Yedek dump'ı asla değişmez;
  // değiştiyse bu bir kurcalama/bozulma sinyalidir ve duyulmalıdır.
  // `--no-traverse`: hedefi baştan sona taramaz, yalnız gerekli adlara bakar —
  // aylar birikince listeleme maliyeti yüklemeyi gölgede bırakmasın.
  const includeArgs = COPY_PREFIXES.flatMap((p) => ["--include", `${p}*.dump`]);
  const copyRes = await runProcess(
    RCLONE_BIN(),
    [
      "copy",
      dir,
      remote,
      ...includeArgs,
      ...configArgs(),
      "--immutable",
      "--no-traverse",
      "--retries",
      "3",
      // İlerleme çıktısı gerekmez; hata varsa stderr'de.
      "--stats",
      "0",
    ],
    { timeoutMs: SWEEP_TIMEOUT_MS },
  );

  if (copyRes.spawnError) {
    warnings.push(
      `rclone çalıştırılamadı ("${RCLONE_BIN()}"): ${copyRes.spawnError}. ` +
        "Kurulu mu? Windows'ta PATH'te olmayabilir → BACKUP_RCLONE_BIN ile tam yol verin.",
    );
    return done({ configured: true, localCount: local.length });
  }
  if (copyRes.timedOut) {
    warnings.push(`OFFSITE KOPYA ZAMAN AŞIMI (${Math.round(SWEEP_TIMEOUT_MS / 60000)} dk) — süreç öldürüldü.`);
  } else if (copyRes.code !== 0) {
    warnings.push(`OFFSITE KOPYA HATASI (rclone ${copyRes.code}): ${copyRes.stderr.slice(0, 600)}`);
  }

  // ── 2) KAPSAMI DOĞRULA ────────────────────────────────────────────────────
  const remoteList = await remoteNames(remote);
  if (remoteList === null) {
    warnings.push(
      "Uzak hedef LİSTELENEMEDİ — kopyalar gitmiş olabilir ama kapsam doğrulanamadı. " +
        "Bu, 'eksik yok' anlamına GELMEZ.",
    );
    return done({ configured: true, localCount: local.length });
  }

  const remoteSet = new Set(remoteList);
  const missing = local.filter((n) => !remoteSet.has(n));
  if (missing.length > 0) {
    warnings.push(
      `OFFSITE KAPSAM EKSİK — ${missing.length} yerel yedeğin uzak kopyası YOK: ` +
        missing.slice(0, 5).join(", ") +
        (missing.length > 5 ? ` (+${missing.length - 5})` : ""),
    );
  }

  return done({
    configured: true,
    localCount: local.length,
    remoteCount: remoteList.length,
    missing,
    ok: missing.length === 0 && copyRes.code === 0 && !copyRes.timedOut,
  });
}

// ── Son süpürme durumu — /api/admin/health için ──────────────────────────────
// Bellekte tutulur, DB'ye yazılmaz: bu "şu anki sürecin gördüğü son durum"dur.
// Kalıcı iz zaten iki yerde var — başarısızlık `reportJobFailure` ile SystemLog'a
// düşer, ve gerçek kanıt uzak hedefteki dosyaların KENDİSİDİR. Üçüncü bir kayıt
// yeri üçüncü bir gerçek demekti.
let lastSweep: OffsiteSweepResult | null = null;

export function recordSweep(r: OffsiteSweepResult): void {
  lastSweep = r;
}

export async function getOffsiteHealth(): Promise<Record<string, unknown>> {
  if (!lastSweep) {
    const remote = await readOffsiteRemote().catch(() => "");
    return { offsite: { configured: remote.length > 0, state: "henüz-koşmadı" } };
  }
  return {
    offsite: {
      configured: lastSweep.configured,
      ok: lastSweep.ok,
      localCount: lastSweep.localCount,
      remoteCount: lastSweep.remoteCount,
      missingCount: lastSweep.missing.length,
      // İlk beş ad yeter — sağlık ucu bir rapor değil, bir işarettir.
      missing: lastSweep.missing.slice(0, 5),
      durationMs: lastSweep.durationMs,
      finishedAt: lastSweep.finishedAt,
      warnings: lastSweep.warnings,
    },
  };
}

/**
 * Uzak hedefe bağlanabiliyor muyuz — panelin "Bağlantıyı test et" düğmesi.
 * `lsd` (dizinleri listele) seçildi çünkü en ucuz ve en az yetki isteyen çağrı.
 */
export async function testOffsiteRemote(): Promise<{ ok: boolean; message: string }> {
  const remote = await readOffsiteRemote();
  if (!remote) return { ok: false, message: "Uzak hedef ayarlanmamış." };
  const res = await runProcess(RCLONE_BIN(), ["lsd", remote, ...configArgs()], {
    timeoutMs: LIST_TIMEOUT_MS,
    captureStdout: true,
  });
  if (res.spawnError) {
    return {
      ok: false,
      message:
        `rclone çalıştırılamadı ("${RCLONE_BIN()}"): ${res.spawnError}. ` +
        "Sunucuda kurulu mu? Tam yolu BACKUP_RCLONE_BIN ile verin.",
    };
  }
  if (res.timedOut) return { ok: false, message: "Bağlantı zaman aşımına uğradı." };
  if (res.code !== 0) {
    // ⚠️ stderr KIRPILIR ama YUTULMAZ: rclone'un hata metni ("didn't find section
    // in config file", "token expired") sorunu çözen tek bilgidir.
    return { ok: false, message: `Bağlanılamadı (rclone ${res.code}): ${res.stderr.trim().slice(0, 400)}` };
  }
  return { ok: true, message: `Bağlantı başarılı — hedefte ${(res.stdout ?? "").split(/\r?\n/).filter(Boolean).length} klasör görüldü.` };
}

/**
 * `rclone authorize "drive"` çıktısındaki token'ı yapılandırma dosyasına yazar.
 *
 * ⚠️ GÜVENLİK SÖZLEŞMESİ — üçü de zorunlu:
 *  1. Token HİÇBİR yere loglanmaz ve yanıtta GERİ DÖNMEZ. Bir Google yenileme
 *     token'ı, hesabın Drive'ına süresiz erişimdir.
 *  2. Dosya `0600` ile yazılır (Windows'ta etkisiz ama POSIX'te gerçek koruma).
 *  3. Yedek klasörünün İÇİNE yazılmaz — orası buluta süpürülüyor.
 *
 * Kendi Google OAuth istemcimizi GÖMMÜYORUZ (client secret depoya girerdi —
 * `.env` bulgusunun aynısını üretirdi). rclone'un kendi istemcisi kullanılır;
 * bu, rclone'un belgelenmiş "başsız sunucu" akışıdır.
 */
export async function writeRcloneDriveToken(
  remoteName: string,
  tokenJson: string,
): Promise<{ ok: boolean; message: string; configPath?: string }> {
  const cfg = rcloneConfigPath();
  if (!cfg) return { ok: false, message: "Yapılandırma yolu çözülemedi (BACKUP_DIR tanımsız)." };

  const name = remoteName.trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
    return { ok: false, message: "Hedef adı yalnız harf/rakam/alt çizgi/tire içerebilir (en fazla 32)." };
  }

  // Token bir JSON nesnesi olmalı ve yenileme token'ı taşımalı. Doğrulama, yanlış
  // yapıştırmayı ("Paste the following into your remote machine --->" satırı da
  // kopyalanmış olabilir) SESSİZ bir bozuk config'e çevirmemek için.
  let parsed: unknown;
  try {
    parsed = JSON.parse(tokenJson.trim());
  } catch {
    return { ok: false, message: "Token geçerli bir JSON değil — yalnız süslü parantezle başlayan bölümü yapıştırın." };
  }
  const t = parsed as Record<string, unknown>;
  if (!t || typeof t !== "object" || typeof t.access_token !== "string") {
    return { ok: false, message: "Token beklenen alanları taşımıyor (access_token yok)." };
  }
  if (typeof t.refresh_token !== "string" || !t.refresh_token) {
    // Yenileme token'ı yoksa erişim ~1 saatte biter ve gece yedeği sessizce
    // kopyalanamaz hale gelir. Bunu kabul etmek, çalıştığını sanıp korumasız
    // kalmak demektir.
    return {
      ok: false,
      message: "Token yenileme anahtarı (refresh_token) içermiyor — erişim 1 saatte biterdi. Yetkilendirmeyi tekrarlayın.",
    };
  }

  const section = `[${name}]\ntype = drive\nscope = drive\ntoken = ${JSON.stringify(parsed)}\n`;

  try {
    await fs.promises.mkdir(path.dirname(cfg), { recursive: true });
    let existing = "";
    try {
      existing = await fs.promises.readFile(cfg, "utf8");
    } catch {
      /* dosya yok — ilk yazım */
    }
    // Aynı adlı bölüm varsa DEĞİŞTİR, yoksa EKLE. Diğer hedefler korunur.
    const re = new RegExp(`^\\[${name}\\][^\\[]*`, "m");
    const next = re.test(existing) ? existing.replace(re, section) : `${existing.trimEnd()}\n\n${section}`.trimStart();
    await fs.promises.writeFile(cfg, next, { mode: 0o600 });
    return { ok: true, message: `"${name}" hedefi yapılandırıldı.`, configPath: cfg };
  } catch (err) {
    return { ok: false, message: `Yapılandırma yazılamadı (${cfg}): ${err instanceof Error ? err.message : err}` };
  }
}

export { COPY_PREFIXES, SWEEP_TIMEOUT_MS, rcloneConfigPath, RCLONE_BIN };
