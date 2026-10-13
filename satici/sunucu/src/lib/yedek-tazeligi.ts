// YEDEK TAZELİĞİ (Bölge 7 B3) — yedek konteyneri yalnız günlüğe yazar; satıcı, yedek dizinini SALT OKUNUR görüp en yeni
// DB dökümü ile anahtar arşivinin yaşını ölçer (JWKS yaşıyla aynı yol: dosya yaşı → güvenlik olayı). Dosya içeriği okunmaz.
// Kademe değişince hemen, aynı bayat kademede 6 saatte bir `YEDEK_ALINAMADI`; TAZE'ye dönüş sessizdir.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { securityEvent } from "./security-events";

export type BackupLevel = "TAZE" | "DB_BAYAT" | "ANAHTAR_BAYAT" | "DIZIN_YOK";

const DUMP = /^satici_\d{8}_\d{6}\.dump\.tkenc$/;
/** Tek katman (B8 öncesi) ve çift katman adı; tazelik yaşla ölçülür, yeni döngü yalnız çift katman üretir. */
const KEYS = /^anahtarlar_\d{8}_\d{6}\.tar\.tkenc(\.tkenc)?$/;
export const BACKUP_REPEAT_MS = 6 * 3_600_000;

export interface BackupFreshnessOptions {
  readonly dir: string;
  readonly maxAgeMs: number;
  readonly now?: () => number;
  readonly warn?: (msg: string) => void;
}

export class BackupFreshness {
  private lastLevel: BackupLevel = "TAZE";
  private lastEventAt = 0;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;

  constructor(private readonly opts: BackupFreshnessOptions) {
    this.now = opts.now ?? Date.now;
    this.warn = opts.warn ?? ((m) => console.warn(m));
  }

  async measure(): Promise<BackupLevel> {
    let names: string[];
    try {
      names = await readdir(this.opts.dir);
    } catch {
      return "DIZIN_YOK";
    }
    const newest = async (re: RegExp): Promise<number> => {
      let best = 0;
      for (const n of names.filter((x) => re.test(x))) {
        const s = await stat(path.join(this.opts.dir, n)).catch(() => null);
        if (s?.isFile() && s.mtimeMs > best) best = s.mtimeMs;
      }
      return best;
    };
    const limit = this.now() - this.opts.maxAgeMs;
    if ((await newest(DUMP)) < limit) return "DB_BAYAT";
    if ((await newest(KEYS)) < limit) return "ANAHTAR_BAYAT";
    return "TAZE";
  }

  /** Periyodik ölçüm (sunucu zamanlayıcısı); kademe güvenlik olayına döner. */
  async check(): Promise<BackupLevel> {
    const level = await this.measure();
    const changed = level !== this.lastLevel;
    this.lastLevel = level;
    if (level === "TAZE" || (!changed && this.now() - this.lastEventAt < BACKUP_REPEAT_MS)) return level;
    this.lastEventAt = this.now();
    securityEvent("YEDEK_ALINAMADI", level, this.now());
    this.warn(`[satici] UYARI yedek alınamadı (${level}): tavan ${Math.round(this.opts.maxAgeMs / 3_600_000)} sa — satici-yedek günlüğüne bakın`);
    return level;
  }
}
