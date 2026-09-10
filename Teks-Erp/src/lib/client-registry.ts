// =============================================================================
// TeksERP — BAĞLI İSTEMCİ DEFTERİ (süreç belleğinde)
// =============================================================================
// "Hangi istemci, hangi sürüm, en son ne zaman istek gönderdi, o an kim
// oturumdaydı." Tek tüketicisi Sistem → Bağlı İstemciler ekranı.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEDEN TABLO DEĞİL BELLEK (karar + gerekçe)
// ─────────────────────────────────────────────────────────────────────────────
// ① EMSAL + INVARIANT: `lib/presence.ts` tam bunu yapıyor (online kullanıcı /
//    bağlı cihaz sayısı, `/health`). Aynı tek-process invariantına yaslanır
//    (`ecosystem.config.js` → `instances: 1`, exec_mode cluster DEĞİL).
// ② YAZMA MALİYETİ: PRODUCTION CANLI bir DB'ye, saf telemetri için, istek
//    başına yazma bindirmek istemiyoruz. Burada bir kayıt = `Map.set`.
// ③ MIGRATION YOK: canlı kurulumlarda geri alınamaz kabul edilen bir şema
//    değişikliği, bilgilendirme amaçlı bir ekran için ödenmeyecek bir bedel.
// ④ DÜRÜSTLÜK: ekranın iddiası "son N dakika içinde istek gönderdi". Sunucu
//    yeniden başladıysa HENÜZ KİMSE istek göndermemiştir — boş liste DOĞRUDUR.
//    Kalıcı tablo ise restart'tan önceki bir `lastSeenAt` ile satır göstermeye
//    devam eder ve aylar önce kaldırılmış bir paneli "envanter" diye taşır.
//
// KABUL EDİLEN BEDEL: pm2 restart sonrası ekran boş görünür ve istemciler ilk
// istekleriyle geri dolar. Ekran bunu YAZIYLA söyler (`serverStartedAt`
// alanı yanıtta bu yüzden var) — sessiz bir boşluk bırakmıyoruz.
//
// ⚠️ ÖLÇEKLENİRSE (çok worker / replica): bu Map process-local'dir, toplam
// parçalanır. `presence.ts` ile birlikte Redis'e taşınır.
// =============================================================================

import {
  isClientKind,
  isPlausibleInstanceId,
  isPlausibleVersion,
  type ClientKind,
} from "../constants/client-info";

/**
 * "AKTİF" EŞİĞİ — TEK KAYNAK.
 *
 * ⚠️ Ekran bu sayıyı KENDİ yazmaz; `GET /api/admin/clients` yanıtında
 * `activeWindowMs` olarak döner ve arayüzdeki "son N dakikada istek
 * gönderenler" cümlesi ondan üretilir. İki yerde ayrı yazılsaydı biri
 * değiştiğinde ekran yanlış bir cümle basardı — ölçtüğü eşikten farklı bir
 * eşik iddia eden bir rozet, olmayan bir rozetten kötüdür.
 *
 * `presence.ts`in penceresiyle aynı değer ama AYRI sabit: o `/health`in
 * donmuş sözleşmesini besliyor, bu bir ekranın metnini. Birini değiştirmek
 * ötekini değiştirmek zorunda kalmasın.
 */
export const CLIENT_ACTIVE_WINDOW_MS = 5 * 60_000;

/**
 * YAZMA KISITLAMASI — aynı kurulum için en fazla 30 sn'de bir kayıt.
 *
 * Emsal: `auth.middleware.touchSessionLastSeen` (`lastSeenWrites` Map'i +
 * 60 sn eşiği). Buradaki kazanç ölçülebilir ve isteğin SICAK yolundadır:
 * eşik tutunca middleware başlıkların geri kalanını hiç okumaz, doğrulama
 * regex'lerini hiç çalıştırmaz ve `res.on("finish")` dinleyicisini hiç
 * kurmaz. Yani tipik bir istek için maliyet: bir başlık okuması + bir
 * `Map.get` + bir sayı karşılaştırması.
 *
 * Bedeli: vardiya değişiminde "son kullanıcı" en geç 30 sn gecikmeyle döner —
 * 5 dakikalık aktiflik eşiğinin yanında görünmez.
 */
export const CLIENT_TOUCH_THROTTLE_MS = 30_000;

/**
 * Listede kalma süresi. Aktiflikten AYRI: 5 dk'dan eski bir satır "aktif
 * değil" olur ama 24 saat boyunca görünmeye devam eder — "dün akşam hangi
 * panel hangi sürümdeydi" sorusu ekranın asıl işlerinden biri.
 */
export const CLIENT_RETENTION_MS = 24 * 60 * 60_000;

/** Anahtar tavanı — `latency-stats`in `MAX_ROUTE_KEYS` deseni. Aşılırsa EN ESKİ
 *  görülen satır düşer (yeni bir istemciyi kaydedememek, sınırsız büyümekten
 *  ve eski çöpü tutmaktan kötüdür). */
const MAX_CLIENTS = 500;

export interface ClientRecord {
  instanceId: string;
  /** Tanınmayan/eksik tür → null. Uydurulmaz. */
  kind: ClientKind | null;
  /** Doğrulamayı geçmeyen/eksik sürüm → null. Uydurulmaz. */
  version: string | null;
  /**
   * Bu kurulumdan gelen SON kimlikli isteğin kullanıcısı.
   *
   * ⚠️ "ŞU AN oturumu açık" DEĞİL — "en son bu kişi görüldü". İddia ancak
   * `lastSeenAt` aktiflik penceresi içindeyse bugüne dairdir; ekran sütunu bu
   * yüzden "Son kullanıcı" adını taşır.
   *
   * ⚠️ null = BİLİNMİYOR (giriş ekranındaki panel, sağlık yoklaması gibi
   * kimliksiz istekler). "Kimse yok" DEMEK DEĞİL.
   */
  lastUserId: string | null;
  /**
   * Sürüm/tür AÇIK BEYANDAN mı geldi (`X-Client-*`), yoksa User-Agent'tan mı
   * ÇIKARILDI? Ekran bunu söyler — çıkarılmış bir sürümü beyan edilmiş gibi
   * göstermek okuyucuyu yanıltır. `false` aynı zamanda kendi başına bir
   * bulgudur: künye başlıkları 2026-09-04'te geldi, yani beyan etmeyen istemci
   * ZATEN eskidir.
   */
  declared: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
}

const clients = new Map<string, ClientRecord>();
/** Kısıtlama saati — kayıttan AYRI tutulur ki ilk istek de kısıtlamaya girsin
 *  (kayıt henüz yokken de bir zaman damgası gerekiyor). */
const throttleAt = new Map<string, number>();

/** Bekçinin ölçtüğü sayaçlar — kısıtlamanın GERÇEKTEN tuttuğunun kanıtı. */
let touchCount = 0;
let throttledCount = 0;

/**
 * Sıcak yol kapısı: bu kurulum için şimdi kayıt alınmalı mı?
 *
 * `true` dönerse kısıtlama saatini ANINDA damgalar (claim) — uçuştaki
 * eşzamanlı isteklerin hepsi kapıyı geçip aynı anda kayıt kurmasın.
 */
export function shouldTouchClient(instanceId: string, now = Date.now()): boolean {
  if (!isPlausibleInstanceId(instanceId)) return false;
  const prev = throttleAt.get(instanceId);
  if (prev !== undefined && now - prev < CLIENT_TOUCH_THROTTLE_MS) {
    throttledCount++;
    return false;
  }
  throttleAt.set(instanceId, now);
  return true;
}

export interface TouchInput {
  instanceId: string;
  /** Ham başlık değerleri — doğrulama BURADA yapılır (kapının arkasında). */
  kind?: string | null;
  version?: string | null;
  userId?: string | null;
  /** Künye başlığı yoksa UA'dan çıkarıldı — varsayılan `true` (beyan). */
  declared?: boolean;
}

/** Kaydı kur/güncelle. Çağrı `shouldTouchClient` kapısından SONRA gelir. */
export function touchClient(input: TouchInput, now = Date.now()): void {
  const { instanceId } = input;
  if (!isPlausibleInstanceId(instanceId)) return;

  const kindRaw = (input.kind ?? "").trim().toLowerCase();
  const kind = isClientKind(kindRaw) ? kindRaw : null;
  const versionRaw = (input.version ?? "").trim();
  const version = isPlausibleVersion(versionRaw) ? versionRaw : null;

  const existing = clients.get(instanceId);
  if (existing) {
    existing.lastSeenAt = now;
    // Tür/sürüm YALNIZ yeni bir değer geldiğinde güncellenir: kimliksiz ya da
    // künyesiz tek bir istek, bilinen bir sürümü null'a düşürmemeli.
    if (kind) existing.kind = kind;
    if (version) existing.version = version;
    if (input.userId) existing.lastUserId = input.userId;
    // Beyan TEK YÖNLÜ yükselir: künyesini bildirmeye BAŞLAYAN istemci (güncellendi)
    // "çıkarıldı" damgasını üstünden atar; tersi olmaz — beyan eden bir istemcinin
    // tek künyesiz isteği (varsa) onu eski göstermemeli.
    if (input.declared === true) existing.declared = true;
  } else {
    clients.set(instanceId, {
      instanceId,
      kind,
      version,
      lastUserId: input.userId ?? null,
      declared: input.declared !== false,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    if (clients.size > MAX_CLIENTS) evictOldest(now);
  }
  touchCount++;
}

/** Bayat satırları sil; hâlâ tavan aşılıyorsa en eski görüleni düşür. */
function evictOldest(now: number): void {
  pruneStale(now);
  while (clients.size > MAX_CLIENTS) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, r] of clients) {
      if (r.lastSeenAt < oldestAt) {
        oldestAt = r.lastSeenAt;
        oldestKey = k;
      }
    }
    if (oldestKey === null) break;
    clients.delete(oldestKey);
    throttleAt.delete(oldestKey);
  }
}

function pruneStale(now: number): void {
  const cutoff = now - CLIENT_RETENTION_MS;
  for (const [k, r] of clients) {
    if (r.lastSeenAt < cutoff) {
      clients.delete(k);
      throttleAt.delete(k);
    }
  }
  // Kaydı olmayan (doğrulamayı geçememiş) kısıtlama anahtarları da budanır.
  const throttleCutoff = now - CLIENT_RETENTION_MS;
  for (const [k, t] of throttleAt) {
    if (t < throttleCutoff && !clients.has(k)) throttleAt.delete(k);
  }
}

/** Defterin okunabilir hâli — en son görülen önce. Okuma sırasında budar. */
export function listClients(now = Date.now()): ClientRecord[] {
  pruneStale(now);
  return [...clients.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** Bir satır aktiflik penceresi içinde mi — TEK YÜKLEM (ekran da bunu görür). */
export function isClientActive(rec: { lastSeenAt: number }, now = Date.now()): boolean {
  return now - rec.lastSeenAt < CLIENT_ACTIVE_WINDOW_MS;
}

/** Bekçi/teşhis: kısıtlamanın tuttuğunu ölçmenin tek yolu. */
export function clientRegistryStats(): {
  size: number;
  touchCount: number;
  throttledCount: number;
} {
  return { size: clients.size, touchCount, throttledCount };
}

/** YALNIZ TEST — süreç belleğini sıfırlar. */
export function resetClientRegistryForTest(): void {
  clients.clear();
  throttleAt.clear();
  touchCount = 0;
  throttledCount = 0;
}
