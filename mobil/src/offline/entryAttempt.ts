// =============================================================================
// entryAttempt — "mantıksal kayıt denemesi" durum makinesi (idempotency anahtarı)
// =============================================================================
// SAHA VAKASI (2026-08-03): fabrikada sunucu restart edildi; ham giriş personeli
// etiket çıkmadığı için "Kaydet ve Etiket Bas"a defalarca bastı. Sunucu ayağa
// kalkınca TEK fiziksel top için N ayrı stok kaydı doğdu.
//
// KÖK NEDEN: `clientToken` `handleSubmit`'in İÇİNDE üretiliyordu → her buton
// basışı sunucuya YENİ BİR KİMLİK olarak gidiyordu. Backend koruması
// (`Roll.clientToken @unique` → P2002 → cached Roll) sağlamdı ama hiç devreye
// giremiyordu. Aynı hata Tambur'da daha önce düzeltilmişti (`TamburScreen`
// `takeCutToken`); KK1 o taramada atlanmıştı.
//
// SÖZLEŞME — token neyin kimliğidir:
//   token = FİZİKSEL TOP'un kimliği, buton basışının değil.
//   • `idle`   → basış yeni bir topu anlatır  → TAZE token
//   • `failed` → basış bilinen bir başarısız denemenin TEKRARIDIR → AYNI token
//
// NEDEN "yapışkan tek ref" DEĞİL (bu modülün varlık sebebi):
// KK1 tek yüksek-hacimli SERİ GİRİŞ ekranıdır. Offline'da operatör 5 topu arka
// arkaya girer ve 5 mutation kuyrukta *paused* bekler. Tek bir sabit ref
// kullanılsaydı 2..5. toplar 1.'nin token'ıyla giderdi → backend hepsini aynı
// topun retry'ı sanıp cached kaydı dönerdi → 4 top SESSİZCE YUTULURDU. Bu,
// önlemeye çalıştığımız kopyanın aynadaki ikizi (eksik stok) ve en az onun kadar
// kötüdür. Bu yüzden token yalnız GERÇEK BİR HATA'dan sonra yapışkan olur:
// offline'da mutation *paused* olur, `onError` TETİKLENMEZ → durum `idle` kalır
// → seri giriş bugünkü davranışını birebir korur.
//
// ─────────────────────────────────────────────────────────────────────────────
// UÇUŞ PENCERESİ (2026-08-05) — saha vakasının KAPANMAMIŞ yarısı
//
// Yukarıdaki yapışkanlık yalnız `onError` KOŞTUKTAN sonra kurulur, o da
// `stationRetry` zinciri (4 deneme, ~5-47 sn) tükenince tetiklenir. Yani KISA bir
// sunucu kesintisinde (pm2 restart 2-5 sn) o pencere boyunca durum hâlâ `idle`dır:
// her basış TAZE token alır, her `mutate()` scope'suz yeni bir mutation kurar,
// hepsi paralel uçar ve sunucu dönünce HEPSİ yazılır — orijinal semptomun aynısı.
//
// KURAL: online bir deneme UÇUŞTAYKEN gelen basış, yükü BİREBİR aynıysa uçuştaki
// KİMLİĞİ (token + damga) yeniden kullanır; yük farklıysa yeni bir toptur.
//   • Aynı yük  → aynı token → backend `clientToken @unique` P2002 → idempotent
//     dal → TEK kayıt. (İki istek de uçuştaysa biri kazanır, diğeri cached'i alır.)
//   • Farklı yük → taze kimlik → normal akış. **Hiçbir gerçek top kaybolmaz** —
//     körü körüne "yut" eden bir collapse, 47 sn'lik pencerede sıradaki gerçek
//     topu düşürürdü ve bu, kopyadan daha kötüdür (eksik stok).
//
// PARMAK İZİ backend'in KİMLİK alanlarıdır (ürün + metraj + en). Kalite BİLEREK
// dışarıda: iki basış arasında kalite düzeltilirse parmak izi değişir ve aynı
// fiziksel top İKİNCİ KEZ yazılırdı. "Kayıp kalite düzeltmesi" ile "kopya stok"
// arasında ikincisi daha zararlıdır; kalite sonradan "Düzelt" ile onarılır.
//
// OFFLINE'DA UÇUŞ KAYDI AÇILMAZ: cihaz gerçekten çevrimdışıyken mutation `paused`
// olur, istek hiç çıkmaz ve seri giriş bugünkü davranışını (5 basış = 5 ayrı top)
// birebir korur.
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ Aynı anda birden fazla basış `failed` durumundayken AYNI token'ı gönderir;
// bu KASITLIDIR (operatörün "tuşa üst üste basma" refleksi artık zararsız —
// sunucu hepsine tek kaydı döner).
// =============================================================================

import { generateClientUuid } from './barcode';

/**
 * Bir FİZİKSEL TOP GİRİŞİNİN kimliği. İki alan birlikte doğar, birlikte yolculuk
 * eder, birlikte tazelenir — ayrı üretilirlerse biri tazelenip diğeri unutulur ve
 * backend'in damga penceresi sessizce boşa düşer.
 */
export interface EntryIdentity {
  readonly clientToken: string;
  /** Operatörün "Kaydet"e BASTIĞI an (ISO-8601). Backend'in mükerrer penceresi. */
  readonly clientEnteredAt: string;
}

/**
 * Uçuş kimliğinin yeniden kullanılabileceği azami süre.
 *
 * Backend'in mükerrer penceresiyle (90 sn) BİLEREK aynı: iki katman aynı şeyi
 * söylesin. İstemci "aynı yük, 90 sn içinde → aynı top" derken sunucu da tam
 * bunu soruyor. Süre sınırı LOAD-BEARING: B6'dan sonra uçuş kaydı sunucu ölüyken
 * de AÇIK kalıyor ve bir kesinti 20 dakika sürebilir — sınırsız bırakılsaydı o
 * 20 dakika boyunca girilen İKİNCİ gerçek özdeş top sessizce yutulurdu.
 */
export const INFLIGHT_REUSE_WINDOW_MS = 90_000;

export interface EntryAttemptState {
  /** Son başarısız denemenin token'ı. null = ortada tekrarlanacak deneme yok. */
  readonly failedToken: string | null;
  /**
   * Henüz sonuçlanmamış denemenin kimliği + parmak izi + AÇILMA anı.
   * `null` = uçuşta bir şey yok.
   *
   * Bilinçli olarak ağ linki kopunca (`onAttemptDetached`) temizlenir ama
   * SUNUCU erişilemez olunca KORUNUR — gerekçe `onAttemptDetached` başlığında.
   */
  readonly inFlight: {
    readonly identity: EntryIdentity;
    readonly fingerprint: string;
    readonly at: number;
  } | null;
}

export const IDLE_ATTEMPT: EntryAttemptState = { failedToken: null, inFlight: null };

/** Bu basışın nasıl yorumlanacağı — ekranın tek doğru kaynağı. */
export type SubmitAction = 'resend-failed' | 'reuse-inflight' | 'send-new';

/**
 * Payload'ın KİMLİK parmak izi. Backend'in idempotent dalının baktığı alanlarla
 * hizalıdır (ürün / renk / metraj) + en. Sayılar DB hassasiyetine (3 hane)
 * yuvarlanır: otomatik modda makine 140.0001 ile 140.0004 okursa bu AYNI fiziksel
 * ölçümdür ve iki ayrı top sayılmamalıdır.
 */
export function entryFingerprint(p: {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  width?: number | null;
}): string {
  const dec = (v: number | null | undefined) =>
    v == null || Number.isNaN(v) ? '-' : v.toFixed(3);
  return [p.itemId, p.colorId ?? '-', dec(p.initialQty), dec(p.width)].join('|');
}

/** Yeni bir fiziksel top girişi için taze kimlik (token + damga BİRLİKTE). */
export function freshEntryIdentity(
  gen: () => string = generateClientUuid,
  now: () => string = () => new Date().toISOString(),
): EntryIdentity {
  return { clientToken: gen(), clientEnteredAt: now() };
}

/**
 * Bu basış nasıl yorumlanmalı? Saf okuma — durumu DEĞİŞTİRMEZ.
 *
 * SIRA LOAD-BEARING: `resend-failed` en başta. "Tekrar Dene"ye basıldığında hem
 * `failedToken` hem `inFlight` dolu olabilir; düşmüş denemenin tekrarı uçuş
 * penceresinden ÖNCE gelir (o zaten aynı token'ı taşır).
 */
export function decideSubmit(
  state: EntryAttemptState,
  fingerprint: string,
  nowMs: number = Date.now(),
): SubmitAction {
  if (state.failedToken !== null) return 'resend-failed';
  if (
    state.inFlight &&
    state.inFlight.fingerprint === fingerprint &&
    nowMs - state.inFlight.at <= INFLIGHT_REUSE_WINDOW_MS
  ) {
    return 'reuse-inflight';
  }
  return 'send-new';
}

/**
 * Bir deneme BAŞLADI.
 *
 * `queued: true` = cihazın AĞ LİNKİ yok (operatör çevrimdışı olduğunu BİLİYOR,
 * çip öyle diyor) → uçuş kaydı AÇILMAZ: arka arkaya 5 basış 5 ayrı toptur, seri
 * giriş sözleşmesi korunur.
 *
 * ⚠️ "Sunucuya ulaşılamıyor" (B6) durumu `queued: false` ile gelir — orada
 * operatör kesintiyi yeni fark ediyordur ve basışlar panik olabilir; uçuş kaydı
 * AÇILIR ve aynı yük 90 sn içinde tek kimliğe toplanır.
 */
export function onAttemptStarted(
  state: EntryAttemptState,
  identity: EntryIdentity,
  fingerprint: string,
  opts: { queued: boolean; nowMs?: number },
): EntryAttemptState {
  if (opts.queued) return state.inFlight === null ? state : { ...state, inFlight: null };
  return {
    ...state,
    inFlight: { identity, fingerprint, at: opts.nowMs ?? Date.now() },
  };
}

/**
 * Deneme sonuçlandı (başarı ya da kalıcı hata — `onSettled`). Yalnız BEKLENEN
 * token kapatılır; gecikmiş/ilgisiz bir yanıt yeni bir uçuşu düşüremez.
 */
export function onAttemptSettled(
  state: EntryAttemptState,
  token: string | undefined,
): EntryAttemptState {
  if (!token || state.inFlight?.identity.clientToken !== token) return state;
  return { ...state, inFlight: null };
}

/**
 * AĞ LİNKİ koptu: uçuştaki deneme artık OUTBOX'ın işidir (kuyrukta paused
 * bekliyor). Uçuş kilidi kalkar → offline seri giriş bugünkü hızıyla sürer.
 * Aşırı-kapsayıcı ama yönü güvenli: en kötü ihtimalle sonraki basış yeni bir top
 * açar — ki çevrimdışında doğru olan zaten budur (operatör biliyor).
 *
 * ⚠️ YALNIZ LİNK KOPMASINDA ÇAĞIR. "Sunucuya ulaşılamıyor" (B6) durumunda
 * ÇAĞIRMA: orada uçuş kimliği KORUNMALIDIR, yoksa B6 tam da düzelttiğimiz saha
 * vakasını kuyruk üzerinden geri getirir — sunucu ölüyken her panik basışı ayrı
 * bir kayıt olarak kuyruğa girer ve sunucu dönünce N kopya olarak akar.
 * Korumanın süresi `INFLIGHT_REUSE_WINDOW_MS` ile sınırlıdır.
 */
export function onAttemptDetached(state: EntryAttemptState): EntryAttemptState {
  return state.inFlight === null ? state : { ...state, inFlight: null };
}

/**
 * Çevrimdışına geçtik — uçuş kimliği BIRAKILMALI mı?
 *
 * Kural ekranda `if (reason === 'link')` olarak yaşasaydı bekçi tutamazdı
 * (KK1Screen 3300 satır, RNTL testi yok) ve tersine çevrilmesi SESSİZ olurdu:
 * saha vakası kuyruk üzerinden geri gelir, hiçbir test kırmızı vermezdi.
 *
 *  • `'link'`   → BIRAK. Operatör çevrimdışı olduğunu biliyor (çip söylüyor);
 *                 arka arkaya basışlar ayrı toplardır.
 *  • `'server'` → KORU. Kesinti yeni fark ediliyor, basışlar panik olabilir.
 *  • `null`     → çevrimiçiyiz, bırakılacak bir şey yok.
 */
export function shouldReleaseInFlight(reason: 'link' | 'server' | null): boolean {
  return reason === 'link';
}

/** Bu ekranda tekrarlanmayı bekleyen bir deneme var mı (CTA "Tekrar Dene"ye döner). */
export function isRetrying(state: EntryAttemptState): boolean {
  return state.failedToken !== null;
}

/**
 * Bu basışta hangi token gitmeli? Durumu DEĞİŞTİRMEZ (saf okuma) — geçişler
 * yalnız sunucu yanıtıyla olur.
 *
 * @param gen test edilebilirlik için enjekte edilebilir üretici.
 */
export function tokenForSubmit(
  state: EntryAttemptState,
  gen: () => string = generateClientUuid,
): string {
  return state.failedToken ?? gen();
}

/**
 * Bu hata SONUCU BELİRSİZ mi bıraktı? Yapışkanlığın tek meşru sebebi budur.
 *
 * • Ağ hatası / zaman aşımı (status yok) → istek sunucuya ULAŞMIŞ ve COMMIT
 *   olmuş OLABİLİR. Saha vakasının tam kalbi: 10 sn'lik timeout "yazılmadı"
 *   demek DEĞİLDİR. Sonraki basış aynı token'la gitmeli.
 * • 5xx → sunucu tx'i kapatmış olabilir; aynı belirsizlik.
 * • Kesin 4xx (400 doğrulama, 403 izin, 404, 409) → hiçbir şey YAZILMADI.
 *   Burada yapışmak zararlıdır: "Ürün silinmiş" hatasında operatör ürünü
 *   değiştiremeden aynı payload sonsuza dek yeniden gönderilirdi (döngü).
 */
export function isAmbiguousFailure(error: unknown): boolean {
  const status = (error as { status?: number } | null | undefined)?.status;
  return status === undefined || status >= 500;
}

/**
 * Deneme kalıcı olarak düştü (stationRetry'ın denemeleri de tükendi).
 * Uçuş kaydına DOKUNMAZ — onu `onAttemptSettled` kapatır (tek kapanış noktası;
 * `onError`'ın erken dönüş dalları uçuşu temizlemeden çıkabiliyor).
 */
export function onAttemptFailed(
  state: EntryAttemptState,
  token: string,
): EntryAttemptState {
  return { ...state, failedToken: token };
}

/**
 * Sunucu onayı geldi. Yalnız BEKLENEN token onaylandıysa durum temizlenir —
 * aksi hâlde (gecikmiş/ilgisiz yanıt) tekrar bekleyen deneme düşürülmez.
 */
export function onAttemptSucceeded(
  state: EntryAttemptState,
  token: string,
): EntryAttemptState {
  return state.failedToken === token ? { ...state, failedToken: null } : state;
}

/**
 * Backend 409 `CLIENT_TOKEN_COLLISION` dedi ve operatör "bu farklı bir top"
 * kararını verdi: önceki deneme aslında COMMIT olmuş demektir, yapışkanlık
 * bırakılır ve sıradaki gönderim taze token alır.
 */
export function onCollisionResolvedAsNew(): EntryAttemptState {
  return IDLE_ATTEMPT;
}
