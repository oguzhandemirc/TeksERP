// =============================================================================
// Yedek şifreleme NİYETİ — backend ile gece görevi (`deploy/yedekle.ps1`) aynı kararı mı veriyor?
// =============================================================================
// Tek kaynak `app\.env`teki `BACKUP_KEY_DIR`dir. Backend onu pm2 açılışında ortamdan okur;
// gece görevi aynı dosyayı her koşumda kendisi okur, satır yoksa `<kök>\yedek-anahtar`
// dizini VARSA şifreler. İkisi ayrışabilir (satır eklenip pm2 yeniden başlatılmadı · dizin
// elle kondu · ortam ecosystem'den geldi) ve ayrışma sessizdir: bir taraf düz döküm üretir.
// Bu modül gece görevinin kararını backend'in gözünden TAKLİT eder; ayrışma sağlıkta uyarıdır.
// =============================================================================

import fs from "fs";
import path from "path";

export const NIGHTLY_DEFAULT_KEY_DIR_NAME = "yedek-anahtar";

/**
 * `.env` satırından değer — `yedekle.ps1`in `EnvDeger`iyle AYNI kural: ilk eşleşen satır,
 * anahtar büyük/küçük harf DUYARLI, çevreleyen tek/çift tırnak soyulur.
 */
export function readEnvFileValue(text: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    let v = (m[1] ?? "").trim();
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return null;
}

export interface BackupCryptoIntent {
  /** `false` = gece görevi bu platformda yok (yalnız Windows kurulumu) — karşılaştırılmadı. */
  measured: boolean;
  backend: { encrypts: boolean; dir: string | null };
  nightly: { encrypts: boolean; dir: string; source: "env-dosyasi" | "varsayilan" } | null;
  /** Ayrışma varsa operatöre tek cümle; yoksa `null`. */
  warning: string | null;
}

function sameDir(a: string, b: string, platform: NodeJS.Platform): boolean {
  const norm = (p: string): string => (platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `appDir` = backend'in çalışma dizini (pm2 cwd = `<kök>\app`); gece görevi `<kök>\app\.env`i okur.
 * Env ve platform parametre: test gerçek ortama dokunmadan ölçebilsin.
 */
export function compareBackupCryptoIntent(
  opts: { env?: NodeJS.ProcessEnv; appDir?: string; platform?: NodeJS.Platform } = {},
): BackupCryptoIntent {
  const env = opts.env ?? process.env;
  const appDir = path.resolve(opts.appDir ?? process.cwd());
  const platform = opts.platform ?? process.platform;
  const rawBackend = env.BACKUP_KEY_DIR?.trim();
  const backend = { encrypts: Boolean(rawBackend), dir: rawBackend ? path.resolve(appDir, rawBackend) : null };
  if (platform !== "win32") return { measured: false, backend, nightly: null, warning: null };

  let fileValue: string | null = null;
  try {
    fileValue = readEnvFileValue(fs.readFileSync(path.join(appDir, ".env"), "utf8"), "BACKUP_KEY_DIR");
  } catch {
    fileValue = null;
  }
  const fromFile = fileValue !== null && fileValue.trim() !== "";
  const nightlyDir = fromFile
    ? path.resolve(appDir, fileValue!.trim())
    : path.resolve(appDir, "..", NIGHTLY_DEFAULT_KEY_DIR_NAME);
  // Satır varsa niyet beyanlıdır (dizin yoksa gece görevi kırmızı biter); yoksa dizinin varlığı.
  const nightly = {
    encrypts: fromFile || isDirectory(nightlyDir),
    dir: nightlyDir,
    source: fromFile ? ("env-dosyasi" as const) : ("varsayilan" as const),
  };

  let warning: string | null = null;
  if (nightly.encrypts && !backend.encrypts) {
    warning =
      `Gece görevi yedekleri ŞİFRELİYOR (${nightlyDir}) ama backend şifrelemeyi KAPALI görüyor (ortamında BACKUP_KEY_DIR yok) — ` +
      `panelden alınan yedekler düz kalır ve düz dosyalar makine dışına kopyalanır. ` +
      (fromFile ? "Satır .env'de var: pm2 restart." : `.env'e BACKUP_KEY_DIR="${nightlyDir.replace(/\\/g, "/")}" ekleyip pm2 restart.`);
  } else if (!nightly.encrypts && backend.encrypts) {
    warning =
      `Backend yedek şifrelemesini AÇIK görüyor (${backend.dir}) ama gece görevi ŞİFRELEMİYOR ` +
      `(.env'de BACKUP_KEY_DIR yok, ${nightlyDir} dizini de yok) — gece yedekleri düz kalır ve makine dışına çıkmaz. ` +
      `BACKUP_KEY_DIR satırını app\\.env'e yazın.`;
  } else if (nightly.encrypts && backend.encrypts && backend.dir && !sameDir(nightlyDir, backend.dir, platform)) {
    warning =
      `Backend ile gece görevi FARKLI anahtar dizinlerini kullanıyor (backend ${backend.dir} · gece görevi ${nightlyDir}) — ` +
      `iki yedek türü farklı alıcılara şifrelenir. Tek dizin app\\.env'deki BACKUP_KEY_DIR olmalı (sonra pm2 restart).`;
  }
  return { measured: true, backend, nightly, warning };
}
