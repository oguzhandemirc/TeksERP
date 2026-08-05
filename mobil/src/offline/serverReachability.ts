// =============================================================================
// Çevrimiçi sinyali = AĞ LİNKİ **ve** SUNUCU ERİŞİLEBİLİRLİĞİ (B6, 2026-08-05)
// =============================================================================
// ÖNCESİ: `onlineManager` yalnız `NetInfo.isConnected`'a bakıyordu — yani
// uygulamanın "online" tanımı *cihazın ağ linki var* demekti, *sunucuya
// ulaşabiliyorum* değil. Fabrika wifi'si ayakta ama sunucu ölüyken uygulama
// kendini ONLINE sanıyor, istekler HTTP'ye çıkıp düşüyor, kuyruk hiç devreye
// girmiyordu. 2026-08-03 saha vakasının zemini tam olarak buydu.
//
// SONRASI: iki sinyal AND'lenir. İkisi de doğruysa online.
//
// NEDEN AKTİF POLLING DEĞİL, KANIT TABANLI: sağlıklı durumda hiçbir ek istek
// atılmaz. Sunucuya "ulaşılamıyor" hükmü gerçek bir isteğin YANITSIZ düşmesiyle
// verilir (`api.ts` interceptor'ı bildirir); ancak o andan sonra hafif bir
// `/health` yoklaması başlar ve sunucu dönünce durur. Tabletin pili ve fabrika
// ağı boşuna meşgul edilmez.
//
// ⚠️ 5xx "ULAŞILAMIYOR" DEĞİLDİR — sunucu CEVAP VERMİŞTİR. Yalnız **yanıtsız**
// düşen istek (ağ hatası / zaman aşımı) erişilemezlik kanıtıdır. Aksi hâlde
// sunucunun tek bir hatalı ucu tüm kuyruğu durdururdu.
//
// ⚠️ NEDEN ÖNCE TEHLİKELİYDİ, ŞİMDİ GÜVENLİ: bu değişiklik tek başına yapılsaydı
// saha vakasını ÇÖZMEZ, TAŞIRDI — sunucu ölüyken basışlar kuyruğa girer, sunucu
// dönünce N kayıt olarak akardı (panik basışları bu kez kuyruk yoluyla kopya
// doğururdu). Güvenli kılan üç şey: (1) `entryAttempt` uçuş kimliği artık
// çevrimdışına GEÇİLDİĞİNDE de korunur (sebep "sunucu" ise — bkz. offlineReason),
// (2) sunucudaki tuzak atomik, (3) mükerrer penceresi istemci damgasıyla ölçülüyor.
// =============================================================================

import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { API_URL } from '../constants/api';
import { jitteredBackoff } from './backoff';

/** Çevrimdışıysak SEBEBİ. UI bunu farklı anlatır, `entryAttempt` farklı davranır. */
export type OfflineReason = 'link' | 'server' | null;

let hasLink = true;
let serverReachable = true;
let emit: ((online: boolean) => void) | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeAttempt = 0;

const listeners = new Set<() => void>();

function apply(): void {
  emit?.(hasLink && serverReachable);
  for (const l of listeners) l();
}

export function offlineReason(): OfflineReason {
  if (!hasLink) return 'link';
  if (!serverReachable) return 'server';
  return null;
}

/** UI'ın sebebi izlemesi için (useSyncExternalStore uyumlu). */
export function subscribeOfflineReason(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// -----------------------------------------------------------------------------
// Sunucu yoklaması
// -----------------------------------------------------------------------------
/** `/health` kökü: API_URL `.../api` ile biter, sağlık ucu onun KARDEŞİDİR. */
function healthUrl(): string {
  return `${API_URL.replace(/\/api\/?$/, '')}/health`;
}

async function probeOnce(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      // Ham `fetch` — axios interceptor'ından geçmesin, yoksa yoklamanın kendi
      // başarısızlığı "sunucuya ulaşılamıyor" olarak yeniden bildirilir (döngü).
      const res = await fetch(healthUrl(), { method: 'GET', signal: ctrl.signal });
      // 5xx bile "ulaşılabilir"dir — sunucu cevap veriyor.
      return res.status > 0;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

function stopProbe(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
  probeAttempt = 0;
}

function scheduleProbe(): void {
  if (probeTimer) return;
  // Jitter'lı backoff: onlarca tablet aynı anda ölü sunucuya yüklenmesin
  // (SAHA-AG-DAYANIKLILIK §S5 ile aynı gerekçe). Taban 2 sn, tavan 30 sn.
  const delay = jitteredBackoff(probeAttempt, 2000, 30_000);
  probeTimer = setTimeout(() => {
    probeTimer = null;
    void (async () => {
      // Link yokken yoklama anlamsız — NetInfo zaten offline diyor.
      if (!hasLink) return;
      probeAttempt += 1;
      if (await probeOnce()) {
        reportServerReachable();
      } else {
        scheduleProbe();
      }
    })();
  }, delay);
}

// -----------------------------------------------------------------------------
// api.ts'in bildirdiği kanıtlar
// -----------------------------------------------------------------------------

/** Bir istek YANITSIZ düştü (ağ hatası / zaman aşımı) → sunucu erişilemez. */
export function reportServerUnreachable(): void {
  if (!hasLink) return; // zaten çevrimdışı; sebebi link
  if (!serverReachable) return; // zaten biliniyor
  serverReachable = false;
  apply();
  scheduleProbe();
}

/** Sunucudan HERHANGİ bir yanıt geldi (2xx de 5xx de) → erişilebilir. */
export function reportServerReachable(): void {
  if (serverReachable) return;
  serverReachable = true;
  stopProbe();
  apply();
}

// -----------------------------------------------------------------------------
// onlineManager bağlantısı — TEK giriş noktası
// -----------------------------------------------------------------------------
export function installOnlineSignal(): void {
  onlineManager.setEventListener((setOnline) => {
    emit = setOnline;
    const unsub = NetInfo.addEventListener((state) => {
      hasLink = state.isConnected === true;
      // Link yokken sunucu hakkında hüküm VERME: link geri geldiğinde sunucu
      // ayakta olabilir. Aksi hâlde kısa bir wifi kesintisi, sunucu sağlamken
      // bile bizi gereksiz bir yoklama döngüsüne sokardı.
      if (!hasLink) {
        serverReachable = true;
        stopProbe();
      }
      apply();
    });
    return () => {
      unsub();
      stopProbe();
      emit = null;
    };
  });
}

/** Yalnız test için — modül durumunu sıfırlar. */
export function __resetOnlineSignalForTests(): void {
  hasLink = true;
  serverReachable = true;
  stopProbe();
}
