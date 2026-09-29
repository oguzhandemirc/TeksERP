// Ekran açılışı tazelemesi (§14 S47): pano/rapor ekranı açılınca bulut `ozet` zilini çalar; sunucu tesis
// başına aralık uygular (zil çalmazsa kalan süreyi döner). İstemci o süreye SAYGI gösterir: aralık dolmadan
// yeni istek atmaz, hata alınca geri çekilir. Saf durum makinesi — ağ çağrısı dışarıdan verilir.
import type { SnapshotRefresh } from "../api/wire";

/** Sunucu yanıtı yokken (ağ/5xx) tekrar denemeden önceki bekleme. */
export const REFRESH_FAIL_BACKOFF_MS = 30_000;
/** Sunucunun `sonrakiMs`i bundan kısa olsa da istemci en az bu kadar bekler (ardışık ekran geçişleri). */
export const REFRESH_MIN_GAP_MS = 5_000;

export interface RefreshGate {
  /** `nowMs` aralık dolduysa `call`ı bir kez çalıştırır; çalıştırdıysa true. Uçuştayken ikinci çağrı düşer. */
  request(nowMs: number, call: () => Promise<SnapshotRefresh>, clock?: () => number): Promise<boolean>;
}

export function createRefreshGate(): RefreshGate {
  let nextAt = 0;
  let inFlight = false;
  return {
    async request(nowMs, call, clock = Date.now) {
      if (inFlight || nowMs < nextAt) return false;
      inFlight = true;
      try {
        const r = await call();
        nextAt = clock() + Math.max(REFRESH_MIN_GAP_MS, Number.isFinite(r.sonrakiMs) ? r.sonrakiMs : REFRESH_FAIL_BACKOFF_MS);
      } catch {
        nextAt = clock() + REFRESH_FAIL_BACKOFF_MS;
      } finally {
        inFlight = false;
      }
      return true;
    },
  };
}

/** Uygulama genelinde TEK kapı: pano ve rapor ekranı aynı aralığı paylaşır (sunucu tesis başına sayar). */
export const openRefreshGate = createRefreshGate();
