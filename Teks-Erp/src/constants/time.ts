// =============================================================================
// TeksERP — FABRİKA SAAT DİLİMİ (TEK KAYNAK)
// =============================================================================
// 2026-08-01'de tüm `DateTime` kolonları `timestamptz` oldu (CLAUDE.md → O-11).
// `timestamptz` MUTLAK ANI saklar; "bu olay hangi GÜNE ait" sorusunun cevabı
// artık verinin içinde DEĞİLDİR — bir İŞ KARARIDIR ve açıkça yazılmalıdır.
//
// ── SORU NEDEN ŞİMDİ DOĞDU ───────────────────────────────────────────────────
// Kolonlar tz'siz iken "bugün üretilen" sorguları örtük bir varsayımla
// çalışıyordu: kolon UTC taşır, süreç/oturum saat dilimi neyse gün sınırı
// oradan çıkar. Kimse hangi saat diliminde gün kestiğimizi YAZMADI. timestamptz
// ile bu belirsizlik artık ölçülebilir bir farka dönüşüyor: aynı satır, gün
// sınırını UTC'de mi Europe/Istanbul'da mı çizdiğine göre FARKLI güne düşer.
//
// ── CEVAP: FABRİKA GÜNÜ = Europe/Istanbul TAKVİM GÜNÜ ────────────────────────
// Fabrika tek lokasyonda (Türkiye) ve vardiyalar gece yarısını GEÇER. Operatör
// "bugün 40 top çıktı" derken kendi duvar saatini kastediyor; saat 01:30'da
// okutulan top onun için BUGÜNDÜR. UTC'de kesilen gün o topu DÜNE yazar
// (Türkiye kalıcı UTC+3 → her gece 00:00–03:00 arası, yani vardiyanın tam
// ortası, bir önceki güne kayar). Bu yüzden takvim günü soran her sorgu
// açıkça `AT TIME ZONE 'Europe/Istanbul'` yazar.
//
// ── TAKVİM GÜNÜ mü, MUTLAK PENCERE mi? ───────────────────────────────────────
// İki farklı soru vardır ve karıştırılmamalıdır:
//   • TAKVİM GÜNÜ  — "1 Ağustos'ta ne oldu", "bugünkü sayaç", günlük grafik
//                    çubukları. Saat dilimine BAĞLIDIR → bu dosyayı kullan.
//   • MUTLAK PENCERE — "son 72 saat", "sevkten bu yana geçen gün sayısı",
//                    "termini geçti mi". İki mutlak an arasındaki farktır,
//                    saat diliminden BAĞIMSIZDIR → dokunma, yalnız yorumla
//                    belirt (örn. rulo yaşlandırma kovaları, geciken sipariş).
//
// ── ÇOK ŞUBELİ / ÇOK SAAT DİLİMLİ GELECEK ────────────────────────────────────
// Bugün tek saat dilimi var. İleride şube bazlı saat dilimi gerekirse çözüm
// TEK NOKTADADIR: `FACTORY_TIMEZONE` sabiti yerine şubeden çözülen bir değer
// geçirilir (`factoryDaySql` zaten parametre alacak şekilde yazıldı) ve
// çağıranlar aynı kalır. Kod içine dağıtılmış `'Europe/Istanbul'` literalleri
// bu geçişi imkânsız kılardı — bu yüzden literal YALNIZ burada bulunur.
// =============================================================================

import { Prisma } from "@prisma/client";

/**
 * Fabrikanın takvim günü hangi saat diliminde kesilir.
 * Türkiye 2016'dan beri KALICI UTC+3'tür (yaz saati uygulaması yok) → gün
 * sınırı yıl boyu sabit, "olmayan saat" (DST ileri atlama) riski yoktur.
 * Yine de aşağıdaki JS yardımcıları DST'ye dayanıklı yazıldı: sabit +3 varsaymak
 * ileride başka bir saat dilimine geçilirse sessizce yanlışlanırdı.
 */
export const FACTORY_TIMEZONE = "Europe/Istanbul";

/**
 * Günlük gruplama/etiketleme için SQL ifadesi: `<kolon>` mutlak anını FABRİKA
 * takvim gününe çevirir ve `date` döndürür.
 *
 * Neden `Prisma.raw`: `AT TIME ZONE` bir bind parametresi (`$1`) kabul eder ama
 * o zaman ifade planner için sabit olmaktan çıkar ve
 * `20260801050000_system_log_daily_stats_tz` ile kurulan İFADE İSTATİSTİĞİ
 * eşleşmez (audit raporu sessizce yavaş plana düşer). Bu yüzden saat dilimi
 * SQL metnine gömülür. Enjeksiyon riski yok: hem `FACTORY_TIMEZONE` hem
 * `columnExpr` derleme zamanı sabitleridir — bu fonksiyona ASLA kullanıcı
 * girdisi geçirme.
 *
 * ⚠️ Üretilen metin `system_logs` istatistik nesnesiyle BİREBİR eşleşmelidir.
 *    Buradaki ifadeyi değiştirirsen migration'ı da güncelle
 *    (bekçi: `scripts/test_db_invariants.ts` yalnız nesnenin VARLIĞINI görür,
 *    ifade uyumsuzluğu KIRMIZI vermez — sonuç doğru kalır, sorgu yavaşlar).
 *
 * @param columnExpr Tırnaklanmış kolon ifadesi, örn. `rm."enteredAt"`.
 */
export function factoryDaySql(columnExpr: string, timeZone: string = FACTORY_TIMEZONE): Prisma.Sql {
  return Prisma.raw(`DATE_TRUNC('day', ${columnExpr} AT TIME ZONE '${timeZone}')::date`);
}

/**
 * Verilen anın FABRİKA saat dilimindeki duvar-saati parçaları.
 * `Intl` kullanılır (izinli paket listesinde date kütüphanesi yok) — süreç
 * saat diliminden (`TZ` env) BAĞIMSIZ çalışır. `new Date().setHours(0,0,0,0)`
 * deseni sunucu Europe/Istanbul iken doğru sonuç verir ama bunu HİÇBİR YERDE
 * yazmaz; konteynere alınan ya da UTC kurulan bir sunucuda sessizce 3 saat kayar.
 */
function factoryParts(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Bir anın fabrika saat dilimindeki UTC ofseti (ms). DST'de değişebilir. */
function factoryOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  // Milisaniye kırpılır: formatToParts ms taşımaz, ofset her zaman dakika katıdır.
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * `at` anının ait olduğu FABRİKA takvim gününün başlangıcı (yerel 00:00),
 * MUTLAK AN olarak. Prisma `gte` filtrelerinde doğrudan kullanılır.
 *
 * Örn. Europe/Istanbul'da 2026-08-01 01:30 için dönen değer
 * 2026-07-31T21:00:00Z'dir — yani operatörün "bugün"ü saat 21:00Z'de başlar.
 * İki turlu ofset çözümü DST geçiş günlerinde de doğru sonucu verir.
 */
export function factoryDayStart(at: Date = new Date()): Date {
  const { y, m, d } = factoryParts(at);
  const wallMidnightAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  let guess = wallMidnightAsUtc;
  for (let i = 0; i < 2; i++) {
    guess = wallMidnightAsUtc - factoryOffsetMs(new Date(guess));
  }
  return new Date(guess);
}

/** `at` anının FABRİKA takvim günü, `YYYY-MM-DD` (grafik kategorisi / gün anahtarı). */
export function factoryYmd(at: Date = new Date()): string {
  const { y, m, d } = factoryParts(at);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * `@db.Date` kolonlarına yazılacak takvim günü anahtarı.
 * Prisma + adapter-pg `DateTime`'ı UTC'ye çevirip DATE kolonuna UTC gün-parçasını
 * yazar → kolona UTC-gece-yarısı verilmelidir. Yerel gece yarısı verilseydi
 * (UTC+3'te önceki gün 21:00Z) her satır 1 GÜN GERİ etiketlenirdi.
 * Bkz. `services/latency-persist.service.ts`.
 */
export function factoryDayKeyUtcMidnight(at: Date = new Date()): Date {
  const { y, m, d } = factoryParts(at);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * `at` anının ait olduğu FABRİKA takvim gününün SON anı (yerel 23:59:59.999),
 * MUTLAK AN olarak. `factoryDayStart`in aynası; `lte` filtrelerinde kullanılır.
 *
 * Ertesi günün başlangıcından 1 ms geri sayılır — "23:59:59.999'u elle kur"
 * yaklaşımı DST ileri-atlama günlerinde var olmayan bir duvar saatine denk
 * gelebilir; gün başlangıcı üzerinden türetmek her takvimde doğrudur.
 * (+36 sa: DST kaymasından büyük, iki günden küçük → hedef her zaman ERTESİ gün.)
 */
export function factoryDayEnd(at: Date = new Date()): Date {
  const start = factoryDayStart(at);
  const nextStart = factoryDayStart(new Date(start.getTime() + 36 * 3600_000));
  return new Date(nextStart.getTime() - 1);
}

/**
 * İSTEMCİDEN GELEN TARİH SINIRLARINI mutlak ana çevirir (GÜN-YALNIZ biçim için).
 *
 * ⚠️⚠️ NEDEN VAR: `2026-07-31` biçimindeki gün-yalnız bir değer ECMAScript'te
 * UTC GECE YARISI'dır (`new Date("2026-07-31")` → 03:00 Europe/Istanbul), yani
 * bir gün sınırı DEĞİL, o günün içinde rastgele bir andır. Sonucu YÖNE göre
 * değişir ve İKİSİ DE sessizdir:
 *   • `lte` (bitiş) → o günün neredeyse TAMAMI dışarıda kalır. "31 Temmuz
 *     itibarıyla" diye kesilen DONMUŞ bir resmi belge, 31 Temmuz'un hareketleri
 *     olmadan doğru görünen ama EKSİK bir rakam basar — hata yok, log yok,
 *     kâğıt basılmış olur.
 *   • `gte` (başlangıç) → o günün ilk üç saati (gece vardiyası) düşer.
 * İstemcinin doğru göndermesine güvenmek yetmez: ikinci bir istemci (mobil,
 * entegrasyon, script, Swagger'dan elle deneme) aynı ucu çağırdığı gün hata
 * TAM DA resmi belgede doğar.
 *
 * SÖZLEŞME: gün-yalnız değer → o FABRİKA gününün BAŞI/SONU · tam ISO damgası →
 * AYNEN (istemci anı kendisi seçmiştir, ikinci kez yorumlamak niyeti ezer).
 */
function resolveDayBoundary(value: string, edge: "start" | "end"): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
  // Gün-yalnız değer ÖĞLEN UTC ile çıpalanır: hangi saat diliminde yorumlanırsa
  // yorumlansın aynı takvim gününe düşer (gece yarısı çıpası negatif ofsetli bir
  // sunucuda günü bir geri kaydırırdı).
  const anchor = new Date(`${value}T12:00:00.000Z`);
  return edge === "start" ? factoryDayStart(anchor) : factoryDayEnd(anchor);
}

/** `lte` (bitiş, DAHİL) sınırı — gün-yalnız değer o günün SONUNA çözülür. */
export function resolveRangeEnd(value: string): Date {
  return resolveDayBoundary(value, "end");
}

/** `gte` (başlangıç, DAHİL) sınırı — gün-yalnız değer o günün BAŞINA çözülür. */
export function resolveRangeStart(value: string): Date {
  return resolveDayBoundary(value, "start");
}
