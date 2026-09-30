// Windows hizmeti düzeni: backend `TeksERP-Backend` hizmetinde düşük yetkili sanal hesapla koşar,
// program dizini salt okunurdur ve yolların tek kaynağı konağın verdiği `TEKSERP_KOK`tur.
// `TEKSERP_KOK` yoksa (pm2 düzeni, geliştirme) bu modül hiçbir şeyi değiştirmez — bugünkü davranış.
import path from "node:path";

export const ROOT_ENV = "TEKSERP_KOK";
export const SERVICE_NAME_ENV = "TEKSERP_HIZMET_ADI";
export const SHUTDOWN_CHANNEL_ENV = "TEKSERP_KAPANIS";
export const DEFAULT_SERVICE_NAME = "TeksERP-Backend";

/**
 * Kökün altındaki adlar. `deploy/hizmet/backend-hizmeti.ps1` (dizin + izin) ve hizmet konağı AYNI
 * adları kullanır; bekçi `test_hizmet_duzeni` betikle bu tabloyu karşılaştırır.
 */
export const SERVICE_DIRS = Object.freeze({
  versions: "surumler",
  current: "current",
  config: "yapilandirma",
  license: "lisans",
  backups: "backups",
  backupKeys: "yedek-anahtar",
  logs: "logs",
  data: "veri",
  mobileUpdates: "mobil-guncelleme",
  rclone: "rclone",
  pgsql: "pgsql",
  pgCredentials: "pg-setup",
  host: "hizmet",
} as const);

export const ENV_FILE_NAME = ".env";

/** Yol taşıyan ayarlar: hizmet düzeninde göreli değer sürüm dizinine göre çözülür — uyarılır. */
export const PATH_SETTINGS: readonly string[] = Object.freeze([
  "BACKUP_DIR",
  "BACKUP_KEY_DIR",
  "BACKUP_OFFSITE_DIR",
  "BACKUP_RCLONE_BIN",
  "BACKUP_RCLONE_CONFIG",
  "LICENSE_DIR",
  "MOBILE_UPDATE_DIR",
  "PG_BIN_DIR",
  "PGDATA_DIR",
]);

export type ProcessManager = "service" | "pm2" | "none";

/** Hizmet adı PowerShell komutuna girer: yalnız güvenli karakterler. */
const SERVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Sürücü harfli (`C:\`), UNC (`\\sunucu`) ya da POSIX mutlak yol; `\yol` gibi sürücüsüz kök MUTLAK DEĞİL. */
function isAbsoluteLayoutPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value) || /^\/(?!\/)/.test(value);
}

/** Ayırıcıları `/`a çevirip sondaki ayırıcıyı atar (ecosystem değerleriyle aynı biçim). */
function toForwardSlashes(value: string): string {
  const s = value.replace(/\\/g, "/");
  return /^[A-Za-z]:\/$/.test(s) || s === "/" ? s : s.replace(/\/+$/, "");
}

/** `TEKSERP_KOK` → kök; tanımsızsa `null`. Göreliyse düzen belirsizdir: `error` dolu döner (fail-closed). */
export function resolveServiceRoot(env: NodeJS.ProcessEnv): { root: string | null; error: string | null } {
  const raw = env[ROOT_ENV]?.trim();
  if (!raw) return { root: null, error: null };
  if (!isAbsoluteLayoutPath(raw)) return { root: null, error: `${ROOT_ENV} mutlak bir yol olmalı: "${raw}"` };
  return { root: toForwardSlashes(raw), error: null };
}

export function underRoot(root: string, ...parts: string[]): string {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return [base, ...parts].join("/");
}

/** `.env` yolu: açık `DOTENV_CONFIG_PATH` > hizmet düzeninde `<Kök>/yapilandirma/.env` > `<cwd>/.env`. */
export function resolveEnvFilePath(env: NodeJS.ProcessEnv, cwd: string): string {
  const explicit = env.DOTENV_CONFIG_PATH?.trim();
  if (explicit) return explicit;
  const { root } = resolveServiceRoot(env);
  return root ? underRoot(root, SERVICE_DIRS.config, ENV_FILE_NAME) : path.resolve(cwd, ENV_FILE_NAME);
}

/**
 * pm2 düzeninde `ecosystem.config.js` env bloğunun taşıdığı ve kodun varsayılanından FARKLI olan
 * değerler. Yalnız `.env`de olmayan (ya da boş) anahtar dolar; `.env` her zaman kazanır.
 */
export function serviceDefaults(root: string): Readonly<Record<string, string>> {
  const d = SERVICE_DIRS;
  return Object.freeze({
    NODE_ENV: "production",
    APP_ENV: "production",
    // Gece yedeğini SYSTEM görevi alır (yedekle.ps1); ikisi birden açıksa her gece iki döküm.
    BACKUP_SCHEDULE_ENABLED: "false",
    BACKUP_DIR: underRoot(root, d.backups),
    LICENSE_DIR: underRoot(root, d.license),
    PG_BIN_DIR: underRoot(root, d.pgsql, "bin"),
    BACKUP_RCLONE_BIN: underRoot(root, d.rclone, "rclone.exe"),
    // rclone jetonu yenilerken dosyanın yanına yazar: backend'in yazabildiği dizinde durmalı.
    BACKUP_RCLONE_CONFIG: underRoot(root, d.data, "rclone.conf"),
    MOBILE_UPDATE_DIR: underRoot(root, d.mobileUpdates),
  });
}

/** Eksik anahtarları doldurur; doldurulanların adını döner. `env` yerinde değişir. */
export function applyServiceDefaults(env: NodeJS.ProcessEnv, root: string): string[] {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(serviceDefaults(root))) {
    if ((env[key] ?? "").trim() !== "") continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

/** Hizmet düzeninde göreli verilmiş yol ayarları (sürüm dizinine göre çözülürdü). */
export function relativePathSettings(env: NodeJS.ProcessEnv): string[] {
  return PATH_SETTINGS.filter((k) => {
    const v = env[k]?.trim();
    return !!v && !isAbsoluteLayoutPath(v);
  });
}

export function detectProcessManager(env: NodeJS.ProcessEnv): ProcessManager {
  if (resolveServiceRoot(env).root) return "service";
  // pm2 her uygulamaya `pm_id` enjekte eder.
  if (env.pm_id !== undefined) return "pm2";
  return "none";
}

/**
 * Durdurma/başlatma komutlarındaki hizmet adı. Geçersiz ad komuta GİRMEZ, varsayılan kullanılır:
 * yanlış adla `Stop-Service` düşer ve komut bloğunun kapısı işi durdurur (güvenli yön).
 */
export function serviceName(env: NodeJS.ProcessEnv): string {
  const name = env[SERVICE_NAME_ENV]?.trim();
  return name && SERVICE_NAME_PATTERN.test(name) ? name : DEFAULT_SERVICE_NAME;
}

export function isServiceNameInvalid(env: NodeJS.ProcessEnv): boolean {
  const name = env[SERVICE_NAME_ENV]?.trim();
  return !!name && !SERVICE_NAME_PATTERN.test(name);
}

/** Geri yükleme/takas komut bloklarının süreç bilgisi: hizmette SCM, değilse pm2 (bugünkü). */
export interface ProcessControlInfo {
  processManager: "service" | "pm2";
  /** pm2 uygulama adı ya da Windows hizmet adı. */
  name: string;
}

export function processControlInfo(env: NodeJS.ProcessEnv): ProcessControlInfo {
  if (detectProcessManager(env) === "service") return { processManager: "service", name: serviceName(env) };
  // pm2 her uygulamaya kendi adını `name` env'iyle enjekte eder.
  return { processManager: "pm2", name: env.name || "teks-erp-backend" };
}

/** Program dizini (sürümler + etkin sürüm bağlantısı) altında mı — hizmet hesabı orayı YAZAMAZ. */
export function isInProgramDir(target: string, root: string): boolean {
  const norm = (p: string): string => toForwardSlashes(p).toLowerCase();
  const t = norm(target);
  return [SERVICE_DIRS.versions, SERVICE_DIRS.current].some((dir) => {
    const base = norm(underRoot(root, dir));
    return t === base || t.startsWith(`${base}/`);
  });
}

export type ShutdownChannel = "stdin";

/** Konağın seçtiği kapanış kanalı; tanınmayan değer `unknown`da döner (kanal açılmaz). */
export function shutdownChannel(env: NodeJS.ProcessEnv): { channel: ShutdownChannel | null; unknown: string | null } {
  const v = env[SHUTDOWN_CHANNEL_ENV]?.trim();
  if (!v) return { channel: null, unknown: null };
  return v === "stdin" ? { channel: "stdin", unknown: null } : { channel: null, unknown: v };
}
