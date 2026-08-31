// =============================================================================
// FASON KABUL — "aynı teslimat mı, yeni teslimat mı" (BULGU-T2-007)
// =============================================================================
// SORUN: `clientToken` her gönderimde yeniden üretiliyordu (payload kurulurken).
// Offline kuyruk replay'i aynı payload'ı yolladığı için KUYRUK yolu korunuyordu;
// açık olan yol operatörün ELLE tekrar basmasıydı:
//
//   100 m'nin 30 m'si döndü → "Kabul Et" → uzun tx timeout → operatör yeniden
//   girip basar → YENİ token → token kapısı boş döner, kısmi olduğu için küme
//   guard'ı da geçer → İKİ makbuz, iki kez 30 m çocuk top, fason hesabından
//   60 m düşer. Fiziksel gerçek 30 m.
//
// ⚠️ DÜZELTMENİN KENDİSİ İKİNCİ BİR RİSK DOĞURUR ve asıl tasarım kararı odur:
// sunucu token eşleşince yükü KARŞILAŞTIRMADAN cached makbuzu döner (KK1'deki
// `CLIENT_TOKEN_COLLISION` fason tarafında YOK — ölçüldü, subcontractor.service
// token kapısı). Yani token'ı süresiz yapıştırmak, saat sonra gelen İKİNCİ
// GERÇEK TESLİMATI sessizce yutardı — kopyanın aynadaki ikizi, yani eksik stok.
// KK1'de bu riski sunucunun çakışma sorusu kapatır; burada kapatan şey bu
// modüldeki İKİ SINIRDIR:
//
//   ① PARMAK İZİ — token yalnız AYNI teslimat yeniden gönderilirken kullanılır.
//   ② ZAMAN PENCERESİ — aynı rakamlar yarın tekrar gelebilir (boyahane 30 m
//      bugün, 30 m yarın gönderir; parmak izi birebir aynıdır). Yapışkanlık
//      operatörün formu yeniden doldurmasına yetecek kadar yaşar, bir sonraki
//      teslimata kadar DEĞİL.
//
// Kural bir kez burada yazılır; Electron ikizi `Electron/src/lib/
// fasonReceiveAttempt.ts` (iki ayrı proje, ortak import YOK — mobil
// `permissions.ts` ile aynı durum) ve iki bekçi aynı senaryoları ölçer.
// =============================================================================
import { generateClientUuid } from '../../../offline/barcode';
import { isAmbiguousFailure } from '../../../offline/entryAttempt';

/**
 * Yapışkanlığın ömrü.
 *
 * ALT SINIR operatörün formu YENİDEN DOLDURMA süresidir: `onMutate` formu
 * temizlediği için "Tekrar Dene" diye tek tuş yoktur — satırlar, parça
 * metrajları ve en yeniden girilir. 90 sn (KK1 uçuş penceresi) bunun için kısa.
 * ÜST SINIR bir sonraki fiziksel teslimattır: boyahane aynı gün ikinci kez,
 * birebir aynı rakamlarla mal göndermez.
 */
export const FASON_RETRY_WINDOW_MS = 10 * 60_000;

/** Düşmüş denemenin izi — başarıda ve kesin 4xx'te temizlenir. */
export interface ReceiveAttempt {
  token: string;
  fingerprint: string;
  at: number;
}

/** `receiveFingerprint`in ihtiyaç duyduğu minimal payload şekli. */
export interface FingerprintablePayload {
  workOrderId: string;
  stepId: string;
  subcontractorId: string;
  returns: Array<{ rollId: string; receivedQty?: number | null }>;
  newRolls?: Array<{ qty: number }>;
}

/**
 * Bu teslimatın KİMLİĞİ: hangi toplar, her birinden ne kadar geldi, kaç parça
 * doğdu.
 *
 * ⚠️ Renk / en / not / irsaliye no BİLEREK DIŞARIDA. Onlar teslimatın kendisi
 * değil, o teslimat hakkında ölçülen niteliklerdir: operatör eni yanlış yazıp
 * düzelterek yeniden gönderdiğinde bu HÂLÂ aynı fiziksel teslimattır ve ikinci
 * bir makbuz doğurmamalıdır. Parmak izine eklenselerdi her düzeltme yeni token
 * üretir, koruma tam da en çok gerektiği anda düşerdi.
 *
 * Sıra bağımsız (satır sırası ekran state'ine göre oynayabilir) ve metrajlar DB
 * hassasiyetine (3 hane) yuvarlanır.
 */
export function receiveFingerprint(p: FingerprintablePayload): string {
  const dec = (v: number | null | undefined): string =>
    v == null || Number.isNaN(v) ? '-' : v.toFixed(3);
  const donusler = p.returns
    .map((r) => `${r.rollId}:${dec(r.receivedQty)}`)
    .sort()
    .join(',');
  const parcalar = (p.newRolls ?? [])
    .map((n) => dec(n.qty))
    .sort()
    .join(',');
  return [p.workOrderId, p.stepId, p.subcontractorId, donusler, parcalar].join('|');
}

/**
 * Bu gönderim hangi token'ı taşımalı?
 *
 * Yapışkan token YALNIZ üç koşul birlikte sağlanınca kullanılır: düşmüş bir
 * deneme var · parmak izi AYNI · pencere dolmamış. Biri bile tutmuyorsa taze
 * token — çünkü o zaman bu YENİ bir mantıksal denemedir.
 */
export function tokenForReceive(
  prev: ReceiveAttempt | null,
  fingerprint: string,
  nowMs: number = Date.now(),
  gen: () => string = generateClientUuid,
): string {
  if (prev && prev.fingerprint === fingerprint && nowMs - prev.at <= FASON_RETRY_WINDOW_MS) {
    return prev.token;
  }
  return gen();
}

/**
 * Deneme düştü. Token YALNIZ sonucu BELİRSİZ bırakan hatada yapışır
 * (ağ/timeout/5xx) — kesin 4xx'te hiçbir şey yazılmadığı KESİNDİR ve yapışmak
 * "renk değişti" gibi bir hatada aynı yükü sonsuza dek yeniden gönderen bir
 * döngü kurardı (2026-08-03 KK1 dersi, `isAmbiguousFailure` tek kaynak).
 */
export function onReceiveFailed(
  token: string,
  fingerprint: string,
  error: unknown,
  nowMs: number = Date.now(),
): ReceiveAttempt | null {
  return isAmbiguousFailure(error) ? { token, fingerprint, at: nowMs } : null;
}

/**
 * Sunucu onayladı → yapışkanlık BİTER.
 *
 * ⚠️ Load-bearing: başarıdan sonra token yaşamaya devam etseydi, bir sonraki
 * MEŞRU teslimat cached makbuzu alır ve sessizce kaybolurdu.
 */
export function onReceiveSucceeded(): ReceiveAttempt | null {
  return null;
}

// =============================================================================
// GÖNDERİM GERİ BİLDİRİMİ — "onay gelmeden yeşil basma" (BULGU-T3-019)
// =============================================================================
/** Kaydet'e basıldığında ekranın ne söyleyeceği ve formu temizleyip temizlemeyeceği. */
export interface GonderimGeriBildirimi {
  tip: 'success' | 'info';
  baslik: string;
  altBaslik: string;
  /** Form ŞİMDİ temizlensin mi? (Aksi hâlde sunucu onayında temizlenir.) */
  formuTemizle: boolean;
}

/**
 * Saf karar — ekrandaki bir `if`'te yaşasaydı tersine çevrilmesi hiçbir testi
 * kırmazdı (`shouldAnnounceFailure` emsali).
 *
 * ⚠️ ÇEVRİMDIŞINDA YEŞİL DOĞRUDUR: kayıt gerçekten diske alınmıştır, kuyruk
 * dürüst konuşur — ve form da orada temizlenir, yoksa operatör çevrimdışıyken
 * sıradaki kabulü giremezdi. Kaldırılan şey ÇEVRİMİÇİ yalanıdır: sunucu cevabı
 * gelmeden "Mal kabul tamamlandı" demek, 409 dönen bir kabulde operatörü yeşil
 * görüp uzaklaşmaya davet ediyordu (mal içeride, sistemde AT_SUBCONTRACTOR).
 */
export function receiveSubmitFeedback(cevrimici: boolean): GonderimGeriBildirimi {
  return cevrimici
    ? {
        tip: 'info',
        baslik: 'Kaydediliyor…',
        altBaslik: 'Sonuç gelene kadar bekleyin, tekrar göndermeyin',
        formuTemizle: false,
      }
    : {
        tip: 'success',
        baslik: 'Mal kabul sıraya alındı (çevrimdışı)',
        altBaslik: 'Ağ gelince kendiliğinden gönderilecek',
        formuTemizle: true,
      };
}
