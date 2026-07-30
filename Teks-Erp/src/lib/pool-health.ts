// =============================================================================
// TeksERP - Bağlantı Havuzu Sağlığı (pg Pool) — TAMAMEN BELLEKTE
// =============================================================================
// İki iş yapar:
//   1) Havuzun ANLIK durumunu /health'e açar. totalCount/idleCount/waitingCount
//      ücretsiz senkron getter'lardır (SORGU YOK) → 5sn poll'e güvenli ve DB
//      DOWN olsa bile doğru değer döner (havuz durumu tam o anda en çok gereken
//      şeydir).
//   2) Havuz zaman aşımlarını KÜMÜLATİF sayar (AuditService.getHealth() /
//      auditWriteFailures deseninin birebir ikizi). Olay milisaniyeler sürer;
//      anlık okuma poll'lar arasında olayı KAÇIRIR, sayaç kaçırmaz.
//
// NEDEN VAR (canlı olay kaydı, 2026-07):
//   2026-07-23 14:05:34  GET /api/station-capabilities/:stationId  (5071ms)
//   2026-07-28 23:59:19  GET /api/shipping/shipments               (5403ms)
// İki istek havuzdan bağlantı alamayıp ÇIPLAK Error ile generic 500'e düştü
// (system_logs recordId='Error' — "P2024" DEĞİL). Hangi metriğin bozulduğunu
// hiçbir şey göstermedi: /health'teki `dbConnections` `pg_stat_activity` sayımıdır
// → SUNUCU tarafını sayar (psql/pgAdmin/pg_dump dahil), havuzun kaç bağlantı
// tuttuğunu ve KİMİN BEKLEDİĞİNİ bilmez. Bu modül o boşluğu kapatır.
//
// İkisi de havuz DOLULUĞU değildi (o an ~1 bağlantı vardı, 30 tavanına
// yaklaşılmadı): mekanizma SOĞUK CONNECT — bkz. lib/prisma.ts havuz yorumu.
//
// ⚠️ TEK-PROCESS INVARIANT: sayaçlar process-local. pm2 `instances: 1` +
// `exec_mode: "fork"` olduğu için toplam = gerçek toplam (bkz. server.ts
// başındaki blok, ARCHITECTURE.md §10.3). Restart'ta sıfırlanır.
//
// ⚠️ KAPSAM: sayaç YALNIZ HTTP hata yolundan (error.middleware) artar. Zamanlayıcı
// işlerinde (backup-scheduler / archive-scheduler) oluşan bir havuz zaman aşımı
// errorHandler'a hiç uğramaz → sayaçta GÖRÜNMEZ. Gözlenen iki olay da HTTP
// isteğiydi; bilinçli boşluk, buraya yazıldı.
// =============================================================================

import { pool } from "./prisma";

// pg-pool'un iki havuz zaman aşımı hatası. İKİSİ DE ÇIPLAK `Error`: code /
// severity / syscall taşımadıkları için @prisma/adapter-pg'nin
// convertDriverError'ı (isSocketError → isTlsError → isDriverError üçlü kapısını
// geçemedikleri için) onları OLDUĞU GİBİ yeniden fırlatır ve Prisma katmanı da
// sarmalamaz. Bu yüzden P2024/P2028 dalına ASLA uğramazlar.
//   acquire   → pg-pool/index.js:224  (kuyrukta bekleme süresi doldu)
//   handshake → pg-pool/index.js:276  (yeni bağlantının TCP+auth'u bütçeyi aştı)
const ACQUIRE_TIMEOUT_MESSAGE = "timeout exceeded when trying to connect";
const HANDSHAKE_TIMEOUT_MESSAGE = "Connection terminated due to connection timeout";

export type PoolTimeoutKind = "acquire" | "handshake";

/**
 * Hata bir havuz zaman aşımı mı? Değilse null.
 *
 * SAF fonksiyon (sayaç ARTIRMAZ) — test edilebilir olsun diye. Üç birleşik kapı:
 *   1) ÇIPLAK Error olmalı → AppError / SyntaxError / PayloadTooLargeError /
 *      Prisma*Error / ZodError / TypeError hepsi elenir (constructor farklı).
 *   2) `code` taşımamalı → socket/driver hatası buraya çıplak gelmez, adapter
 *      onu Prisma hatasına çevirir; yine de kapıyı kapatıyoruz.
 *   3) Mesaj TAM eşleşmeli (`includes` DEĞİL) → yanlış pozitif yüzeyi sıfır;
 *      bu iki string `src` içinde başka hiçbir yerde üretilmiyor.
 *
 * pg yükseltmesi mesajı değiştirir / bir alt sınıfa sarar / `code` eklerse bu
 * fonksiyon null döner ve istek BUGÜNKÜ davranışa (generic 500) düşer — kapalı
 * devre, 4xx yutulmaz. Metin sözleşmesi runtime heuristic'le değil TEST ile
 * kilitli: scripts/test_pool_health.ts kurulu pg-pool'dan GERÇEK hatayı üretip
 * bu fonksiyonun onu tanıdığını doğrular.
 */
export function classifyPoolTimeout(err: unknown): PoolTimeoutKind | null {
  if (!(err instanceof Error) || err.constructor !== Error) return null;
  if ((err as { code?: unknown }).code !== undefined) return null;
  if (err.message === ACQUIRE_TIMEOUT_MESSAGE) return "acquire";
  if (err.message === HANDSHAKE_TIMEOUT_MESSAGE) return "handshake";
  return null;
}

// --- Kümülatif durum (auditFailureState ikizi) -------------------------------
const timeoutState = {
  count: 0,
  lastError: null as string | null,
  lastAt: null as string | null,
};

let waitingMax = 0;
let connectsTotal = 0;

// Her YENİ FİZİKSEL bağlantıda artar. Havuz sıcak kaldığında bu sayı DURUR; her
// sessizlik sonrası artıyorsa havuz drenaj oluyor demektir (soğuk connect =
// 2026-07 olaylarının mekanizması). idleTimeoutMillis ayarının etkisini ÖLÇEN
// tek metrik budur → değişikliği doğrulamak için /health'ten okunur.
pool.on("connect", () => {
  connectsTotal += 1;
});

// waitingCount anlık okumada neredeyse HER ZAMAN 0'dır (kuyruk milisaniyelerde
// boşalır) → 5sn'lik poll doygunluğu göremez. 'acquire' her checkout'ta
// tetiklenir; o an kuyrukta KALAN istek sayısını okuyup yüksek-su işaretini
// günceller. Maliyet: sorgu başına iki getter okuması, sorgu YOK.
// NOT: kuyruktan bir eleman alındıktan SONRA yayılır → tepe değeri 1 eksik
// raporlar; işaret "doygunluk yaşandı mı" sorusu için yeterli.
pool.on("acquire", () => {
  if (pool.waitingCount > waitingMax) waitingMax = pool.waitingCount;
});

/** error.middleware havuz zaman aşımını 503'e çevirdiğinde çağırır. */
export function recordPoolTimeout(kind: PoolTimeoutKind, message: string): void {
  timeoutState.count += 1;
  timeoutState.lastError = `${kind}: ${message}`;
  timeoutState.lastAt = new Date().toISOString();
}

export interface PoolHealth {
  poolMax: number;
  poolTotalCount: number;
  poolIdleCount: number;
  poolWaitingCount: number;
  poolWaitingMax: number;
  poolConnectsTotal: number;
  poolAcquireTimeouts: number;
  lastPoolTimeoutError: string | null;
  lastPoolTimeoutAt: string | null;
}

/**
 * `/health` için havuz görüntüsü. Senkron + sorgusuz.
 *
 * waitingMax ve poolAcquireTimeouts OKUMADA SIFIRLANMAZ (eventLoopLagMs'in
 * aksine): /health'i birden çok istemci yokluyor (durum sayfası + Electron
 * paneli + heartbeat); yıkıcı okuma nadir olayın kanıtını ilk poll'a yedirir.
 * Anlam: "process başlangıcından beri".
 */
export function getPoolHealth(): PoolHealth {
  return {
    poolMax: pool.options.max,
    poolTotalCount: pool.totalCount,
    poolIdleCount: pool.idleCount,
    poolWaitingCount: pool.waitingCount,
    poolWaitingMax: waitingMax,
    poolConnectsTotal: connectsTotal,
    poolAcquireTimeouts: timeoutState.count,
    lastPoolTimeoutError: timeoutState.lastError,
    lastPoolTimeoutAt: timeoutState.lastAt,
  };
}
