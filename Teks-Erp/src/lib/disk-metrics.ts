// =============================================================================
// Disk kullanımı — `fs.statfs` sarmalayıcısı (yol başına 30sn cache)
// =============================================================================
// `app.ts`'ten ayıklandı: `/health`'in yanında geri yükleme kopyası oluşturma
// akışı da disk ölçmek zorunda (PGDATA volume'ünü doldurmak CANLI veritabanını
// durdurur — o özelliğin üretebileceği en kötü sonuç).
//
// Cache tek değer değil yol başınadır: cwd / PGDATA / BACKUP_DIR farklı
// birimlerde olabilir ve her biri ayrı ölçülmelidir.
// =============================================================================

import fs from "fs";

export interface DiskUsage {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedPct: number;
}

const DISK_CACHE_MS = 30_000;
const cache = new Map<string, { value: DiskUsage; at: number }>();

/**
 * Verilen yolun bulunduğu birimin kullanımı. Ölçülemezse `null`.
 *
 * `freeBytes` = `bavail` (ayrıcalıksız kullanıcının GERÇEKTEN yazabileceği alan);
 * `usedPct` ise `bfree` üzerinden. İkisinin farklı olması bilinçli değil, mevcut
 * davranışın korunmasıdır — `/health` grafiklerinin geçmişiyle tutarlı kalsın
 * diye aynen taşındı. Guard kararlarında **`freeBytes` kullanılmalı**.
 */
export function readDiskFor(p: string): DiskUsage | null {
  const now = Date.now();
  const hit = cache.get(p);
  if (hit && now - hit.at < DISK_CACHE_MS) return hit.value;
  try {
    const s = fs.statfsSync(p);
    const value: DiskUsage = {
      path: p,
      totalBytes: s.blocks * s.bsize,
      freeBytes: s.bavail * s.bsize,
      usedPct: s.blocks > 0 ? Math.round((1 - s.bfree / s.blocks) * 1000) / 10 : 0,
    };
    cache.set(p, { value, at: now });
    return value;
  } catch {
    return null;
  }
}

/**
 * `/health`'in disk alanları. Şekil ve semantik BİREBİR korunur — `serverHealth.ts`
 * `HealthResponse` tipi ve ServerStatus grafikleri buna bağlı; değiştirmek
 * grafiklerde açıklanamayan bir sıçrama yaratır.
 */
export function readAppDiskMetrics(): {
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  diskUsedPct: number | null;
} {
  const d = readDiskFor(process.cwd());
  if (!d) return { diskTotalBytes: null, diskFreeBytes: null, diskUsedPct: null };
  return { diskTotalBytes: d.totalBytes, diskFreeBytes: d.freeBytes, diskUsedPct: d.usedPct };
}
