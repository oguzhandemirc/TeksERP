// Çok çekimli belge kamerası (saf): art arda çekim listesi, kalan yer, "Tamam"da iyileştirilmiş sayfalar.
// İyileştirme native'de (`enhancePageAsync`, çekimden hemen sonra arka planda başlar); sonucu yoksa ham fotoğraf gider —
// tarama hiçbir yolda durmaz. Çıktı ML Kit yoluyla aynı `ScanPage` sözleşmesi (özet gönderilecek baytın kendisinden).
import type { RawScannedPage } from '../../../services/docScannerNative';
import { scannedToScanPage, scannerPageLimit, type ScanPage } from './docScan';

export interface Shot {
  id: string;
  uri: string;
  base64: string;
  width: number;
  height: number;
}

/** Bu oturumda daha kaç çekim alınabilir (belgedeki sayfalar + çekilmiş olanlar sınırı). */
export function shotCapacity(currentCount: number, shots: number): number {
  return Math.max(0, scannerPageLimit(currentCount) - shots);
}

/** Çekim eklenir; yer yoksa liste değişmez. `full` = bu çekimle yer bitti (ekran kendiliğinden bitirir). */
export function addShot(shots: readonly Shot[], shot: Shot, capacity: number): { shots: Shot[]; added: boolean; full: boolean } {
  if (shots.length >= capacity) return { shots: [...shots], added: false, full: true };
  const next = [...shots, shot];
  return { shots: next, added: true, full: next.length >= capacity };
}

export function removeShot(shots: readonly Shot[], id: string): Shot[] {
  return shots.filter((s) => s.id !== id);
}

export interface FinishResult {
  pages: ScanPage[];
  /** İyileştirilmeden (ham) giden sayfa sayısı — eski APK ya da native hata. */
  plain: number;
  /** Verisi bozuk olduğu için düşen çekim sayısı. */
  dropped: number;
}

/** "Tamam": her çekimin iyileştirilmiş hâli beklenir (sırayla, ilerleme bildirilir); yoksa ham çekim sayfa olur. */
export async function finishShots(
  shots: readonly Shot[],
  enhanced: (shot: Shot) => Promise<RawScannedPage | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<FinishResult> {
  const out: FinishResult = { pages: [], plain: 0, dropped: 0 };
  for (const [i, shot] of shots.entries()) {
    onProgress?.(i, shots.length);
    let better: RawScannedPage | null = null;
    try {
      better = await enhanced(shot);
    } catch {
      better = null;
    }
    // Özet sayfa başına ağır (≈1–2 MB): her sayfa arasında döndürücü çizilsin.
    await new Promise((r) => setTimeout(r, 0));
    try {
      out.pages.push(scannedToScanPage(better ?? shot));
      if (!better) out.plain++;
    } catch {
      out.dropped++;
    }
  }
  onProgress?.(shots.length, shots.length);
  return out;
}
