// =============================================================================
// Yedek şifreleme — kurulumun anahtar dizini (`BACKUP_KEY_DIR`)
// =============================================================================
// Dizin YOKSA özellik KAPALIDIR ve yedekler bugünkü gibi düz `.dump` kalır (kök kural:
// yeni davranışın varsayılanı bugünkü davranış). Dizin DB'de değil diskte durur ve
// `BACKUP_DIR`in DIŞINDA olmak zorundadır: offsite süpürücü yedek klasörünü makine
// dışına kopyalar, sarılı yerel anahtar oraya gitmemeli.
//
//   <dizin>/<ad>.tkpub   alıcı açık anahtarları (her dosya bir alıcı; ad = dosya adı)
//   <dizin>/yerel.tkkey  yerel anahtarın YEDEK PAROLASIYLA sarılı özel yarısı
//
// Üç sonuç: kapalı (env yok) · açık · GEÇERSİZ (env var ama alıcı yok/okunamıyor ya
// da dizin yedek klasörünün içinde). Geçersiz = şifreleme niyeti var → düz dosya
// makine dışına çıkmaz.
// =============================================================================

import fs from "fs";
import path from "path";
import type { KeyObject } from "crypto";
import { BackupCryptoError, LOCAL_KEY_FILE, LOCAL_KEY_NAME, PUBLIC_KEY_EXT } from "./format";
import {
  decodePublicKey,
  fingerprint,
  firstKeyLine,
  parseWrappedKeyFile,
  privateKeyFromRaw,
  unwrapSecretKey,
} from "./keys";
import type { Recipient } from "./stream";

export type BackupCryptoState = "kapali" | "acik" | "gecersiz";

export interface BackupCryptoConfig {
  state: BackupCryptoState;
  dir: string | null;
  recipients: Array<Recipient & { parmakIzi: string }>;
  /** Sarılı yerel özel anahtarın yolu; yoksa sunucu yedekleri kendisi ÇÖZEMEZ. */
  localKeyPath: string | null;
  /** Şifrelemeyi engelleyen sorunlar (`gecersiz`in sebebi). */
  problems: string[];
  /** Engellemeyen ama bilinmesi gereken durumlar. */
  warnings: string[];
}

const RECIPIENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Env çağrı anında okunur — test değiştirebilsin, üretimde pm2 başlangıcında sabittir. */
export async function readBackupCryptoConfig(
  env: { keyDir?: string | undefined; backupDir?: string | undefined } = {
    keyDir: process.env.BACKUP_KEY_DIR,
    backupDir: process.env.BACKUP_DIR,
  },
): Promise<BackupCryptoConfig> {
  const raw = env.keyDir?.trim();
  const cfg: BackupCryptoConfig = {
    state: "kapali",
    dir: null,
    recipients: [],
    localKeyPath: null,
    problems: [],
    warnings: [],
  };
  if (!raw) return cfg;
  const dir = path.resolve(raw);
  cfg.dir = dir;

  if (env.backupDir && isInside(dir, env.backupDir)) {
    cfg.problems.push(
      `Anahtar dizini (${dir}) yedek klasörünün İÇİNDE — offsite kopya anahtarı da taşır. Dizini BACKUP_DIR dışına alın.`,
    );
  }

  let names: string[] = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch (e) {
    cfg.problems.push(`Anahtar dizini okunamadı (${dir}): ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const name of names.filter((n) => n.toLowerCase().endsWith(PUBLIC_KEY_EXT)).sort()) {
    const ad = name.slice(0, -PUBLIC_KEY_EXT.length).toLowerCase();
    if (!RECIPIENT_NAME_RE.test(ad)) {
      cfg.problems.push(`Alıcı dosyasının adı geçersiz (${name}) — küçük harf, rakam ve tire, en çok 32 karakter.`);
      continue;
    }
    try {
      const publicRaw = decodePublicKey(firstKeyLine(await fs.promises.readFile(path.join(dir, name), "utf8")));
      cfg.recipients.push({ ad, publicRaw, parmakIzi: fingerprint(publicRaw) });
    } catch (e) {
      cfg.problems.push(`Alıcı anahtarı okunamadı (${name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (names.length > 0 && cfg.recipients.length === 0 && cfg.problems.length === 0) {
    cfg.problems.push(`Anahtar dizininde alıcı yok (${path.join(dir, `*${PUBLIC_KEY_EXT}`)}).`);
  } else if (names.length === 0 && cfg.problems.length === 0) {
    cfg.problems.push(`Anahtar dizini boş (${dir}).`);
  }

  if (names.includes(LOCAL_KEY_FILE)) {
    const p = path.join(dir, LOCAL_KEY_FILE);
    try {
      const w = parseWrappedKeyFile(await fs.promises.readFile(p, "utf8"));
      cfg.localKeyPath = p;
      const fp = fingerprint(decodePublicKey(w.acik));
      if (!cfg.recipients.some((r) => r.parmakIzi === fp)) {
        cfg.warnings.push(
          `Yerel anahtar alıcılar arasında değil (${LOCAL_KEY_NAME}${PUBLIC_KEY_EXT} yok ya da farklı) — sunucu yeni yedekleri çözemez.`,
        );
      }
    } catch (e) {
      cfg.warnings.push(`Yerel anahtar okunamadı (${LOCAL_KEY_FILE}): ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (cfg.recipients.length > 0) {
    cfg.warnings.push(
      `Yerel anahtar (${LOCAL_KEY_FILE}) yok — sunucu şifreli yedekleri kendisi çözemez; geri yükleme müşteri anahtarıyla yapılır.`,
    );
  }

  cfg.state = cfg.problems.length === 0 && cfg.recipients.length > 0 ? "acik" : "gecersiz";
  return cfg;
}

/** Panele/ağa giden özet — anahtar baytı ve parola TAŞIMAZ. */
export interface BackupCryptoSummary {
  state: BackupCryptoState;
  keyDir: string | null;
  recipients: Array<{ ad: string; parmakIzi: string }>;
  localKey: boolean;
  problems: string[];
  warnings: string[];
}

export function summarizeBackupCrypto(cfg: BackupCryptoConfig): BackupCryptoSummary {
  return {
    state: cfg.state,
    keyDir: cfg.dir,
    recipients: cfg.recipients.map((r) => ({ ad: r.ad, parmakIzi: r.parmakIzi })),
    localKey: cfg.localKeyPath !== null,
    problems: cfg.problems,
    warnings: cfg.warnings,
  };
}

/** Yerel anahtarı yedek parolasıyla açar. Yanlış parola: `YANLIS_PAROLA`. */
export async function unlockLocalKey(cfg: BackupCryptoConfig, password: string): Promise<KeyObject> {
  if (!cfg.localKeyPath) {
    throw new BackupCryptoError("ANAHTAR_BICIMI", "Bu sunucuda yerel yedek anahtarı yok.");
  }
  const w = parseWrappedKeyFile(await fs.promises.readFile(cfg.localKeyPath, "utf8"));
  const raw = await unwrapSecretKey(w, password);
  try {
    return privateKeyFromRaw(raw);
  } finally {
    raw.fill(0);
  }
}
