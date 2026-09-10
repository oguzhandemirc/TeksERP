import apiClient from "@/services/apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { RestoreImpact, RestoreImpactResponse } from "./restore-impact.types";

/** Ön ekten türeyen yedek türü — backend bildirir (prefix mantığı tek kaynakta). */
export type BackupKind = "nightly" | "premigrate" | "pre-restore" | "other";

export interface BackupFileInfo {
  name: string;
  sizeBytes: number;
  time: string;
  kind: BackupKind;
}

export interface BackupRestoreTarget {
  host: string;
  port: string;
  user: string;
  database: string;
}

export interface BackupRunResult {
  ok: boolean;
  file: string | null;
  message: string;
  finishedAt: string;
  trigger: "manual" | "nightly";
  /** İşin süresi — güvenlik yedeğinin kesintiyi ne kadar uzatacağını tahmin ettirir. */
  durationMs: number;
}

export interface BackupListing {
  success: boolean;
  files: BackupFileInfo[];
  backupDir: string | null; // mutlak yedek klasörü (yoksa geliştirme ortamı)
  restoreTarget: BackupRestoreTarget | null; // pg_restore hedefi (şifre hariç)
  pm2AppName: string; // geri yüklemede durdurulacak pm2 süreç adı
  running: boolean; // sunucuda yedek koşuyor mu
  lastResult: BackupRunResult | null; // son yedek işinin sonucu
  /**
   * Backend'in KENDİ gece zamanlayıcısı açık mı.
   *
   * ⚠️ `false` ise "Otomatik yedek saati" ÖLÜ BİR KUMANDADIR: saati değiştirmek
   * hiçbir şey yapmaz, gerçek yedeği harici bir görev (Windows Görev
   * Zamanlayıcı) alır. Sahada durum tam olarak budur ve panel bunu söylemeden
   * saati düzenlenebilir gösteriyordu (O-1).
   *
   * Opsiyonel: eski sunucu göndermez → kumanda bugünkü gibi açık kalır.
   */
  scheduleEnabled?: boolean;
}

/** Saf veri erişimi (React'e bağlı değil) — hook'lar `hooks.ts`te. */
export async function fetchBackups(): Promise<BackupListing> {
  const res = await apiClient.get<BackupListing>("/api/admin/backups", {
    suppressErrorToast: true,
  });
  return res.data;
}

export async function fetchRestoreImpact(name: string): Promise<RestoreImpact> {
  const res = await apiClient.get<RestoreImpactResponse>(
    `/api/admin/backups/${encodeURIComponent(name)}/restore-impact`,
    { suppressErrorToast: true },
  );
  return res.data.data;
}

/** Yedeği indirir (blob → kaydet) — admin'in yerel makinesine off-site kopya. */
export async function downloadBackup(name: string): Promise<void> {
  const res = await apiClient.get(`/api/admin/backups/${encodeURIComponent(name)}/download`, {
    responseType: "blob",
    // O7 fix: global 15sn timeout büyük dump dosyasında her seferinde kesiyordu
    // (off-site kopya alınamaz hale geliyordu). Büyük transfer: 5 dk.
    timeout: 300_000,
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Sunucuda çalıştırılacak geri-yükleme komut bloğu (panodan kopyalanır).
 *
 * 2026-07-30: Eskiden `manage.ps1 -Action restore` çağırıyordu; installer (NSSM)
 * kaldırılıp pm2'ye geçilince o script yok. Artık doğrudan pg_restore + ÖNCE
 * doğrulanmış bir güvenlik yedeği. Şifre BİLİNÇLİ yer tutucudur — backend DB
 * şifresini panele göndermez.
 *
 * `impact` YOKSA `null` döner: önizleme yüklenmeden komut üretilmez (CLAUDE.md
 * yıkıcı-işlem kuralı) ve güvenlik yedeğinin adı istemci saatiyle uydurulmaz —
 * damga sunucunun yerel saatiyle üretilmek zorunda (`parseBackupStamp` sözleşmesi).
 *
 * ---------------------------------------------------------------------------
 * BLOĞUN DOĞRULUĞU — dört kural, hepsi load-bearing:
 *
 * 1. `exit`/`throw` KULLANILMAZ. Blok interaktif konsola YAPIŞTIRILIYOR; üst
 *    seviye `throw` yalnız o satırı düşürür, sonraki satırlar KOŞMAYA DEVAM EDER
 *    → `pg_restore` yine çalışır ve güvenlik ağı illüzyona döner. `exit` ise
 *    pencereyi kapatır, backend `pm2 stop`'ta ASILI kalır. Bu yüzden guard iptal
 *    değil, KOŞULLU ÇALIŞTIRMA (`if ($ok) { ... }`).
 * 2. `$LASTEXITCODE = 1` sıfırlaması ŞART. `$LASTEXITCODE` yalnız *native*
 *    çalıştırılabilirlerce yazılır. `pg_dump` PATH'te değilse PowerShell
 *    CommandNotFoundException fırlatır ve değişken ÖNCEKİ değerini korur — ki o,
 *    `pm2 stop`'tan gelen `0`'dır. Sıfırlama olmadan guard sessizce geçer.
 * 3. Her `if` TEK SATIR. Çok satırlı `if (...) {` … `}` bloğu satır-satır
 *    yapıştırmada ve bazı host'larda bozulur.
 * 4. `Remove-Item Env:PGPASSWORD` ve `pm2 start` KOŞULSUZ ve SONDA. Güvenlik
 *    yedeği başarısızsa DB'ye dokunulmamıştır ama backend duruyordur — mutlaka
 *    geri kalkmalı. Bunları asla `$ok`'a bağlamayın.
 * ---------------------------------------------------------------------------
 */
export function restoreCommand(
  listing: BackupListing | undefined,
  name: string,
  impact: RestoreImpact | undefined,
): string | null {
  const t = impact?.restoreTarget;
  const safety = impact?.safetyBackup;
  if (!impact || !t || !safety) return null;

  const app = impact.pm2AppName || listing?.pm2AppName || "teks-erp-backend";
  const cwd = impact.backendCwd;
  // Yollar BACKEND'den geldiği gibi kullanılır — istemcide `${dir}\${name}` diye
  // birleştirmek POSIX sunucuda bozuk yol üretiyordu (`/a/b\c.dump`).
  const file = impact.file.absPath;
  const conn = `-h ${t.host} -p ${t.port} -U ${t.user} -d ${t.database}`;

  // Write-Host metni ASCII: konsol codepage'i 857/850 olabilir, Türkçe bozulur.
  return [
    `# !!! BU BLOK YONETICI PowerShell'de CALISTIRILMALI !!!`,
    `#     PM2 daemon SYSTEM hesabiyla kosuyor (boot'ta kimse giris yapmadan`,
    `#     kalksin diye). Normal pencerede pm2 komutlari "EPERM \\\\.\\pipe\\rpc.sock"`,
    `#     ile duser -> backend AYAKTA kalir -> pg_restore --clean acik baglantilarla`,
    `#     semayi yarim dusurur. Asagidaki guard bunu engeller ama en bastan`,
    `#     yonetici pencere acmak dogrusudur.`,
    ``,
    `# 1) Backend'i durdur - pg_restore --clean acik baglantiyla semayi dusuremez`,
    `$LASTEXITCODE = 1`,
    `pm2 stop ${app}`,
    `$stopped = ($LASTEXITCODE -eq 0)`,
    `if (-not $stopped) { Write-Host "PM2 STOP BASARISIZ - pencere YONETICI mi? GERI YUKLEME YAPILMADI." -ForegroundColor Red }`,
    `$env:PGPASSWORD = "<veritabani-sifresi>"`,
    ``,
    `# 2) GUVENLIK YEDEGI - yanlis yedege donulurse geri donus noktasi`,
    `$safe = "${safety.absPath}"`,
    `$LASTEXITCODE = 1`,
    `if ($stopped) { pg_dump ${conn} -Fc -f "$safe" }`,
    `$ok = $stopped -and ($LASTEXITCODE -eq 0) -and (Test-Path "$safe")`,
    `if ($ok) { pg_restore --list "$safe" > $null; $ok = ($LASTEXITCODE -eq 0) }`,
    ``,
    `# 3) YALNIZ guvenlik yedegi dogrulandiysa geri yukle`,
    `if (-not $ok) { Write-Host "GUVENLIK YEDEGI ALINAMADI - GERI YUKLEME YAPILMADI. Disk/yetki/PATH kontrol edin." -ForegroundColor Red }`,
    `if ($ok) { pg_restore ${conn} --clean --if-exists "${file}" }`,
    `$restored = $ok -and ($LASTEXITCODE -eq 0)`,
    ``,
    `# 4) SEMA GUNCELLEME - ATLANIRSA SESSIZ BOZULMA`,
    `#    Yedek bir migration'dan ONCE alindiysa ve kod yeniyse backend ESKI semaya`,
    `#    baglanir; Prisma P2022 verir ve audit kaydi SESSIZCE kaybolur. migrate`,
    `#    deploy idempotenttir - bekleyen migration yoksa hicbir sey yapmaz.`,
    `if ($restored) { Set-Location "${cwd}" }`,
    `if ($restored) { npx prisma migrate deploy }`,
    ``,
    `# 5) Her durumda: sifreyi temizle, backend'i baslat`,
    `Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue`,
    `pm2 start ${app}`,
  ].join("\n");
}

// ─── OFFSITE YEDEK ────────────────────────────────────────────────────────────
// (denetim 2026-08-10, F-OPS-VER-003) Felaket kurtarma kapsamı. "Yedek var mı"
// ile "yedek BAŞKA YERDE var mı" ayrı sorulardır; ikincisi bu ekrandan önce
// hiçbir yüzeyde görünmüyordu ve sorunun yıllarca fark edilmemesinin sebebi
// tam olarak buydu.

export interface OffsiteStatus {
  offsite: {
    configured: boolean;
    state?: string;
    ok?: boolean;
    localCount?: number;
    remoteCount?: number;
    missingCount?: number;
    missing?: string[];
    durationMs?: number;
    finishedAt?: string;
    warnings?: string[];
  };
  config: {
    remote: string;
    localDir: string;
    configPath: string | null;
    rcloneBin: string;
  };
}

export const OFFSITE_QUERY_KEY = ["admin", "backups", "offsite"] as const;

export async function fetchOffsiteStatus(): Promise<OffsiteStatus> {
  const { data } = await apiClient.get("/api/admin/backups/offsite");
  return data.data as OffsiteStatus;
}

/**
 * ⚠️ AYAR ŞİFRESİ KAPISINDAN GEÇER (2026-09-03 / P3 düzeltme turu).
 * Bu uç `system_settings`e yazar ve yazdığı şey **yedeklerin gideceği yerdir** —
 * yani gece dökümünün (kullanıcı hash'leri, PIN/kart değerleri dahil) hedefi.
 * Kapı bir yetki değil NİYET kapısıdır: şifre tanımlı değilse istek şifresiz
 * gider ve hiçbir şey değişmez.
 *
 * ⚠️ Yük içeride YENİDEN HESAPLANMAZ — `run` aynı `body` ile tekrarlanır
 * (`withSettingsPassword` sözleşmesi).
 */
export async function updateOffsiteConfig(body: {
  remote?: string;
  localDir?: string;
}): Promise<{ remote: string; localDir: string }> {
  return withSettingsPassword(async (headers) => {
    const { data } = await apiClient.patch("/api/admin/backups/offsite", body, { headers });
    return data.data;
  });
}

export async function testOffsiteConnection(): Promise<{ ok: boolean; message: string }> {
  const { data } = await apiClient.post("/api/admin/backups/offsite/test");
  return data.data;
}

export async function sweepOffsiteNow(): Promise<OffsiteStatus["offsite"]> {
  const { data } = await apiClient.post("/api/admin/backups/offsite/sweep");
  return data.data.offsite;
}

/**
 * `rclone authorize "drive"` çıktısındaki token'ı sunucuya yazar.
 *
 * ⚠️ Token buradan SONRA hiçbir yerde tutulmaz: state'e yazılmaz, log'a düşmez,
 * yanıtta geri gelmez. Bir Google yenileme anahtarı, hesabın Drive'ına süresiz
 * erişimdir.
 */
export async function authorizeOffsiteDrive(body: {
  name: string;
  token: string;
}): Promise<{ message: string }> {
  // ⚠️ Kardeş uçla aynı gerekçe: ayar şifresi kapısından geçer.
  return withSettingsPassword(async (headers) => {
    const { data } = await apiClient.post("/api/admin/backups/offsite/authorize", body, { headers });
    return data.data;
  });
}
