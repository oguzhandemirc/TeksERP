// =============================================================================
// Bekçi: B6 — "online" = AĞ LİNKİ **ve** SUNUCU ERİŞİLEBİLİR
// =============================================================================
// Eski tanım yalnız `NetInfo.isConnected`'a bakıyordu: fabrika wifi'si ayakta
// ama sunucu ölüyken uygulama kendini ONLINE sanıyor, kuyruk hiç devreye
// girmiyordu. Bu dosya iki şeyi birden kilitler:
//   • yeni sinyalin doğru AND'lenmesi
//   • ⭐ B6'nın saha vakasını KUYRUK ÜZERİNDEN geri getirmemesi — bu, değişikliğin
//     en tehlikeli yan etkisiydi ve tek başına yapılsaydı gerçekleşirdi.
// =============================================================================

import {
  __resetOnlineSignalForTests,
  offlineReason,
  reportServerReachable,
  reportServerUnreachable,
} from './serverReachability';
import {
  IDLE_ATTEMPT,
  INFLIGHT_REUSE_WINDOW_MS,
  decideSubmit,
  entryFingerprint,
  onAttemptDetached,
  onAttemptStarted,
  shouldReleaseInFlight,
  type EntryAttemptState,
  type EntryIdentity,
} from './entryAttempt';

beforeEach(() => __resetOnlineSignalForTests());

describe('serverReachability — çevrimdışı SEBEBİ', () => {
  it('başlangıçta çevrimiçi (sebep yok)', () => {
    expect(offlineReason()).toBeNull();
  });

  it('⭐ yanıtsız istek → sebep "server" (ağ linki varken bile çevrimdışıyız)', () => {
    reportServerUnreachable();
    expect(offlineReason()).toBe('server');
  });

  it('sunucudan yanıt gelince geri çevrimiçi', () => {
    reportServerUnreachable();
    reportServerReachable();
    expect(offlineReason()).toBeNull();
  });

  it('tekrarlanan bildirimler durumu bozmaz (idempotent)', () => {
    reportServerUnreachable();
    reportServerUnreachable();
    expect(offlineReason()).toBe('server');
    reportServerReachable();
    reportServerReachable();
    expect(offlineReason()).toBeNull();
  });
});

// =============================================================================
// ⭐⭐ B6'NIN EN TEHLİKELİ YAN ETKİSİ
// =============================================================================
// "Sunucu ölü = çevrimdışı" demek, panik basışlarını KUYRUĞA sokar. Çevrimdışı
// sözleşmesi "her basış ayrı toptur" dediği için sunucu dönünce N kopya akardı —
// yani 2026-08-03 saha vakası, düzeltildikten sonra başka bir kapıdan geri gelirdi.
// Ayrım: uçuş kimliği YALNIZ ağ linki koptuğunda bırakılır.
// =============================================================================
describe('⭐ B6 saha vakasını kuyruk üzerinden GERİ GETİRMİYOR', () => {
  const FP = entryFingerprint({ itemId: 'urun-1', initialQty: 140, width: 150 });
  const ID: EntryIdentity = { clientToken: 't1', clientEnteredAt: '2026-08-05T10:00:00.000Z' };
  const T0 = 1_000_000;

  it('SUNUCU ÖLÜ: uçuş kimliği KORUNUR → panik basışları tek kimliğe toplanır', () => {
    let s: EntryAttemptState = IDLE_ATTEMPT;
    // 1. basış: uygulama henüz online sanıyor, istek çıkıyor.
    s = onAttemptStarted(s, ID, FP, { queued: false, nowMs: T0 });
    // İstek yanıtsız düştü → B6 devreye girdi, artık "çevrimdışı (server)".
    reportServerUnreachable();
    expect(offlineReason()).toBe('server');
    // ⚠️ DETACH ÇAĞRILMAZ (ekran yalnız 'link' sebebinde çağırır).
    // 2. ve 3. basış: aynı top, aynı yük → AYNI kimlik.
    expect(decideSubmit(s, FP, T0 + 3_000)).toBe('reuse-inflight');
    s = onAttemptStarted(s, ID, FP, { queued: false, nowMs: T0 + 3_000 });
    expect(decideSubmit(s, FP, T0 + 6_000)).toBe('reuse-inflight');
    expect(s.inFlight?.identity.clientToken).toBe('t1');
  });

  it('AĞ LİNKİ YOK: uçuş kimliği BIRAKILIR → seri giriş sözleşmesi korunur', () => {
    let s: EntryAttemptState = IDLE_ATTEMPT;
    s = onAttemptStarted(s, ID, FP, { queued: false, nowMs: T0 });
    // Ekran 'link' sebebinde detach eder.
    s = onAttemptDetached(s);
    expect(decideSubmit(s, FP, T0 + 3_000)).toBe('send-new');
  });

  it('⭐ KURALIN KENDİSİ: bırakma kararı yalnız "link" sebebinde verilir', () => {
    // Bu üç satır, ekrandaki `if`'in aynası. Kural ekranda kalsaydı tersine
    // çevrilmesi hiçbir testi kırmazdı — saha vakası sessizce geri gelirdi.
    expect(shouldReleaseInFlight('link')).toBe(true);
    expect(shouldReleaseInFlight('server')).toBe(false);
    expect(shouldReleaseInFlight(null)).toBe(false);
  });

  it('⭐ SÜRE SINIRI: uzun kesintide sıradaki gerçek top YUTULMAZ', () => {
    let s: EntryAttemptState = IDLE_ATTEMPT;
    s = onAttemptStarted(s, ID, FP, { queued: false, nowMs: T0 });
    // Pencere içinde: aynı top.
    expect(decideSubmit(s, FP, T0 + INFLIGHT_REUSE_WINDOW_MS - 1)).toBe('reuse-inflight');
    // Pencere dışında: 20 dakikalık bir kesintide operatör gerçekten ikinci bir
    // özdeş top girmiş olabilir — sessizce birleştirmek eksik stok demektir.
    expect(decideSubmit(s, FP, T0 + INFLIGHT_REUSE_WINDOW_MS + 1)).toBe('send-new');
  });

  it('istemci penceresi backend mükerrer penceresiyle AYNI (iki katman aynı şeyi söyler)', () => {
    // Backend: DUPLICATE_ENTRY_WINDOW_MS = 90_000 (duplicate-guard.helper.ts).
    // Sayılar ayrışırsa bir katman "aynı top" derken diğeri "ayrı top" der.
    expect(INFLIGHT_REUSE_WINDOW_MS).toBe(90_000);
  });
});
