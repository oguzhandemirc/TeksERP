// =============================================================================
// FASON KABUL — "aynı teslimat mı, yeni teslimat mı" (BULGU-T2-007)
// =============================================================================
// ⚠️ MOBİL İKİZİ: `mobil/src/screens/Modules/FasonKabul/receiveAttempt.ts`.
// İki ayrı proje, ortak import YOK (mobil `permissions.ts` ile aynı durum) —
// kural iki yerde yaşar, bekçi çifti aynı senaryoları ölçer. Buradaki bir
// davranışı değiştirirsen mobil ikizini de değiştir.
//
// SORUN: `clientToken` `mutationFn` GÖVDESİNDE üretiliyordu
// (`FasonReceiveDialog.tsx`), yani hem TanStack'in otomatik retry'ı hem de
// operatörün ikinci tıklaması YENİ token gönderiyordu. Oradaki yorum
// ("retry aynı isteği tekrarlarsa ikinci makbuz doğmaz") fiilen YANLIŞTI.
//
// ⚠️ Panelde mobildeki kısmi koruma da YOK: mobilde offline kuyruk aynı
// payload'ı yeniden yolladığı için hiç değilse kuyruk yolu korunuyordu; panelin
// kuyruğu yok, iki yol da açıktı.
//
// ⚠️ DÜZELTMENİN KENDİ RİSKİ — asıl tasarım kararı: sunucu token eşleşince yükü
// KARŞILAŞTIRMADAN cached makbuzu döner (KK1'in `CLIENT_TOKEN_COLLISION`ı
// fasonda YOK). Token'ı süresiz yapıştırmak, sonraki GERÇEK teslimatı sessizce
// yutardı — eksik stok, yani kopyadan daha kötüsü. Onu kapatan iki sınır:
//   ① PARMAK İZİ — token yalnız AYNI teslimat yeniden gönderilirken kullanılır.
//   ② ZAMAN PENCERESİ — aynı rakamlar yarın tekrar gelebilir.
// =============================================================================

/** Yapışkanlığın ömrü — operatörün yeniden denemesine yeter, ertesi teslimata yetmez. */
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
 * Bu teslimatın KİMLİĞİ: hangi toplar, her birinden ne kadar geldi, kaç parça doğdu.
 *
 * ⚠️ Renk / en / not / irsaliye no BİLEREK DIŞARIDA — onlar teslimatın kendisi
 * değil, o teslimat hakkında ölçülen niteliklerdir. Operatör eni düzeltip
 * yeniden gönderdiğinde bu HÂLÂ aynı fiziksel teslimattır.
 */
export function receiveFingerprint(p: FingerprintablePayload): string {
  const dec = (v: number | null | undefined): string =>
    v == null || Number.isNaN(v) ? "-" : v.toFixed(3);
  const donusler = p.returns
    .map((r) => `${r.rollId}:${dec(r.receivedQty)}`)
    .sort()
    .join(",");
  const parcalar = (p.newRolls ?? [])
    .map((n) => dec(n.qty))
    .sort()
    .join(",");
  return [p.workOrderId, p.stepId, p.subcontractorId, donusler, parcalar].join("|");
}

/**
 * Bu hata SONUCU BELİRSİZ mi bıraktı? Yapışkanlığın tek meşru sebebi budur.
 *
 * Ağ hatası / zaman aşımı (status yok) ve 5xx → istek COMMIT olmuş OLABİLİR.
 * Kesin 4xx → hiçbir şey yazılmadığı KESİNDİR; yapışmak, düzeltilemeyen bir
 * hatada aynı yükü sonsuza dek yeniden gönderen bir döngü kurardı.
 *
 * ⚠️ Panelin hata nesnesi axios'tan gelir: durum kodu `response.status`tedir,
 * `status` DEĞİL (mobil ikizinden ayrıldığı tek yer). İkisi de okunur — biri
 * eksikse "durum yok" sayılır ve BELİRSİZ tarafa düşer (güvenli yön: fazladan
 * korumak, eksik korumaktan iyidir).
 */
export function isAmbiguousFailure(error: unknown): boolean {
  const e = error as { status?: number; response?: { status?: number } } | null | undefined;
  const status = e?.response?.status ?? e?.status;
  return status === undefined || status >= 500;
}

/**
 * Bu gönderim hangi token'ı taşımalı? Yapışkan token YALNIZ üç koşul birlikte
 * sağlanınca kullanılır: düşmüş deneme var · parmak izi AYNI · pencere dolmamış.
 */
export function tokenForReceive(
  prev: ReceiveAttempt | null,
  fingerprint: string,
  nowMs: number = Date.now(),
  gen: () => string = () => crypto.randomUUID(),
): string {
  if (prev && prev.fingerprint === fingerprint && nowMs - prev.at <= FASON_RETRY_WINDOW_MS) {
    return prev.token;
  }
  return gen();
}

/** Deneme düştü — token yalnız BELİRSİZ hatada yapışır. */
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
 * ⚠️ Load-bearing: sürseydi bir sonraki MEŞRU teslimat cached makbuzu alırdı.
 */
export function onReceiveSucceeded(): ReceiveAttempt | null {
  return null;
}
