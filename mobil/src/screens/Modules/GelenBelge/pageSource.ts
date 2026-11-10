// Belge Tara — "Sayfa çek" yönlendirmesi. Varsayılan kendi çok çekimli kameramız (`MultiPageCameraModal`: art arda çek,
// "Tamam" → iyileştir → sayfalar; ara ekran yok). Cihaz ayarı ML Kit ise önce belge tarayıcısı (kenar · kırpma ·
// perspektif); kullanılamıyor/hata → kendi kameramız (sebep çağırana döner, sessiz düşüş yok). İptal kameraya düşmez. Sunucu sözleşmesi aynı (ScanPage).
// 'live' → canlı okuma ekranı (motor kullanılabilirliği çağıranda `effectiveScanEngine` ile süzülmüş gelir).
import type { DocScanEngine } from '../../../store/deviceSettingsStore';
import { scanWithDocScanner, type ScanRequest, type ScannerOutcome } from '../../../services/docScannerNative';
import { CAPTURE_QUALITY, MAX_SCAN_BYTES, TARGET_LONG_EDGE_PX, scannedToScanPage, scannerPageLimit, type ScanPage } from './docScan';

export type PageSourceResult =
  | { route: 'pages'; pages: ScanPage[] }
  | { route: 'camera'; error?: string; live?: true; /** Google tarayıcı kullanılamadı (sebep kodu) → bilgi toast'ı. */ unavailable?: string }
  | { route: 'none' };

/** Tarayıcıyı dene; sonucu ekranın yapacağı işe çevir. `scan` testte yerine konur. */
export async function acquirePages(
  currentCount: number,
  scan: (req: ScanRequest) => Promise<ScannerOutcome> = scanWithDocScanner,
  engine: DocScanEngine = 'mlkit',
): Promise<PageSourceResult> {
  const pageLimit = scannerPageLimit(currentCount);
  if (pageLimit <= 0) return { route: 'none' };
  if (engine === 'camera') return { route: 'camera' };
  if (engine === 'live') return { route: 'camera', live: true };
  const r = await scan({ pageLimit, longEdge: TARGET_LONG_EDGE_PX, maxBytes: MAX_SCAN_BYTES, quality: CAPTURE_QUALITY });
  if (r.kind === 'unavailable') return { route: 'camera', unavailable: r.reason };
  if (r.kind === 'error') return { route: 'camera', error: r.message };
  if (r.kind === 'canceled') return { route: 'none' };
  const pages: ScanPage[] = [];
  for (const raw of r.pages.slice(0, pageLimit)) {
    // Özet sayfa başına ağır (≈1–2 MB): her sayfa arasında döndürücü çizilsin.
    await new Promise((res) => setTimeout(res, 0));
    try {
      pages.push(scannedToScanPage(raw));
    } catch {
      // Bozuk base64 tek sayfayı düşürür; kalanlar eklenir.
    }
  }
  if (!pages.length) return { route: 'camera', error: 'Taranan sayfalar okunamadı' };
  return { route: 'pages', pages };
}
