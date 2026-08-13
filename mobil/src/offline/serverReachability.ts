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
// ⚠️ `constants/api`nin API_URL'i DEĞİL — o DERLEME ZAMANI sabitidir. Gerçek
// istekler `getCurrentBaseUrl()` ile operatörün Ayarlar'dan girdiği adrese
// gidiyor (api.ts request interceptor'ı). Yoklama sabiti kullandığı sürece
// BAŞKA BİR SUNUCUYU sorar ve adres düzeltilse bile asla yeşile dönmez.
// İçe aktarma tek yönlüdür: baseUrlStore bu dosyayı import ETMEZ (döngü olurdu);
// adres değişimini aşağıda `subscribe` ile biz dinliyoruz.
import { useBaseUrlStore, getCurrentBaseUrl } from '../store/baseUrlStore';
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
/**
 * `/health` kökü: taban adres `.../api` ile biter, sağlık ucu onun KARDEŞİDİR.
 *
 * ⚠️ ADRES HER ÇAĞRIDA CANLI OKUNUR — modül yüklenirken bir kez değil. Operatör
 * adresi kesinti sırasında düzeltebilir; sabitlenen bir URL, düzeltmeden sonra
 * da eski sunucuyu yoklar ve uygulama kalıcı olarak çevrimdışı kalır.
 */
function healthUrl(): string {
  return `${getCurrentBaseUrl().replace(/\/api\/?$/, '')}/health`;
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
  // (SAHA-AG-DAYANIKLILIK §S5 ile aynı gerekçe). Taban 2 sn, tavan 10 sn.
  //
  // ⚠️ TAVAN 30 → 10 sn (2026-08-12): yoklama YALNIZ kesinti sürerken koşar
  // (sağlıklı durumda tek bir ek istek bile atılmaz — dosya başlığındaki
  // "kanıt tabanlı" kuralı), yani bu sıklık sunucu ayaktayken hiçbir maliyet
  // doğurmaz. 30 sn ise sunucu döndükten sonra operatörü yarım dakika kilitli
  // ekranda bekletiyordu ve o süre "bozuk" diye okunuyordu.
  const delay = jitteredBackoff(probeAttempt, 2000, 10_000);
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

/**
 * ŞİMDİ DENE — backoff'u beklemeden tek seferlik yoklama.
 *
 * NEDEN GEREKLİ (2026-08-12, gerçek kilitlenme): çevrimdışı sayılırken
 * TanStack Query sorguları duraklatır, yani HİÇBİR gerçek istek çıkmaz →
 * `reportServerReachable`ın tek tetikleyicisi yoklama kalır. Yoklama bir sebeple
 * tutmuyorsa (bugün: yanlış adresi soruyordu) uygulama yeniden başlatılana kadar
 * çevrimdışı KİLİTLENİR. Bu fonksiyon o döngünün elle açılan kapısıdır:
 * operatörün bandındaki "Şimdi dene" ve adres değişimi bunu çağırır.
 *
 * Dönüş: sunucuya ulaşıldı mı (UI "denendi, hâlâ yok" diyebilsin).
 */
export async function revalidateServer(): Promise<boolean> {
  if (!hasLink) return false; // link yokken yoklama anlamsız
  stopProbe(); // bekleyen backoff'u iptal et — kullanıcı ŞİMDİ istedi
  if (await probeOnce()) {
    reportServerReachable();
    return true;
  }
  // Hâlâ yok: sıfırdan backoff ile otomatik yoklamaya devam.
  if (!serverReachable) scheduleProbe();
  return false;
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
    // ADRES DEĞİŞİNCE HEMEN YENİDEN DEĞERLENDİR. Kesinti sırasında operatörün
    // yapacağı ilk şey adresi düzeltmektir; backoff'u beklemek o düzeltmeyi
    // "işe yaramadı" gibi gösterirdi. Abonelik BU YÖNDEDİR (store bizi değil,
    // biz store'u dinleriz) — tersi içe aktarma döngüsü olurdu.
    const unsubUrl = useBaseUrlStore.subscribe((state, prev) => {
      if (state.baseUrl === prev?.baseUrl) return;
      // Yalnız çevrimdışıyken anlamlı: çevrimiçiyken zaten ek istek atmıyoruz
      // ve yeni adres yanlışsa ilk gerçek istek bunu zaten bildirir.
      if (!serverReachable) void revalidateServer();
    });

    return () => {
      unsub();
      unsubUrl();
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
