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
// sınırını UTC'de mi fabrikanın diliminde mi çizdiğine göre FARKLI güne düşer.
//
// ── CEVAP: FABRİKA GÜNÜ = FABRİKANIN SAAT DİLİMİNDEKİ TAKVİM GÜNÜ ────────────
// Vardiyalar gece yarısını GEÇER. Operatör
// "bugün 40 top çıktı" derken kendi duvar saatini kastediyor; saat 01:30'da
// okutulan top onun için BUGÜNDÜR. UTC'de kesilen gün o topu DÜNE yazar
// (UTC+3'te her gece 00:00–03:00 arası, yani vardiyanın tam ortası, bir
// önceki güne kayar). Bu yüzden takvim günü soran her sorgu `factoryDaySql`
// üzerinden fabrikanın dilimini açıkça yazar.
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
// ── FABRİKAYA GÖRE SEÇİLEBİLİR (kullanıcı kararı 2026-09-30) ─────────────────
// Saat dilimi PROFİL değeridir: `company.timezone` ayarı (IANA adı), varsayılan
// `DEFAULT_FACTORY_TIMEZONE` = bugünkü davranış. Kural ÇEKİRDEK: gün anahtarı ve
// her görüntü/basım saati bu dosyadan okunur — literal YALNIZ burada durur.
// Süreç içi değer açılışta `listen`den ÖNCE yüklenir (factory-timezone.service),
// yazma ucu ve ayar önbelleği tazelemesi `applyFactoryTimezone` ile günceller.
// Tasarım: docs/design/FABRIKA-SAAT-DILIMI.md.
// =============================================================================

import { Prisma } from "@prisma/client";

/**
 * Kurulumun saat dilimi ayarı yoksa kullanılan değer — bugünkü davranış.
 * Türkiye 2016'dan beri kalıcı UTC+3; yardımcılar yine de DST'ye dayanıklıdır
 * çünkü başka bir fabrika DST'li bir dilim seçebilir.
 */
export const DEFAULT_FACTORY_TIMEZONE = "Europe/Istanbul";

// SQL metnine gömüldüğü için (Prisma.raw) yalnız IANA ad karakterleri kabul edilir.
const IANA_NAME_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

let supportedZones: ReadonlySet<string> | null = null;
function supportedTimeZones(): ReadonlySet<string> {
  if (!supportedZones) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    supportedZones = new Set(intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : []);
  }
  return supportedZones;
}

/** IANA saat dilimi adı mı — `Intl.supportedValuesOf('timeZone')` listesinde (ya da UTC) ve güvenli karakterli. */
export function isValidFactoryTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !IANA_NAME_RE.test(value)) return false;
  return value === "UTC" || supportedTimeZones().has(value);
}

let currentTimezone: string = DEFAULT_FACTORY_TIMEZONE;

/** Fabrikanın ŞU ANKİ saat dilimi — senkron, tx içinde güvenli (bellek içi değer). */
export function getFactoryTimezone(): string {
  return currentTimezone;
}

/**
 * Süreç içi değeri günceller. Geçersiz ad FIRLATIR (fail-closed: yanlış güne yazmaktansa
 * dur); çağıran önbellek tazelemesiyse hatayı yakalayıp son geçerli değerde kalır.
 */
export function applyFactoryTimezone(value: string): void {
  if (!isValidFactoryTimezone(value)) throw new Error(`Geçersiz fabrika saat dilimi: ${String(value)}`);
  currentTimezone = value;
}

/** Sağlık ucu + panel uyarısının kodu: kayıtlı `company.timezone` geçersiz, sunucu başka dilimle koşuyor. */
export const FACTORY_TIMEZONE_INVALID_STORED = "FACTORY_TIMEZONE_INVALID_STORED";

// Kayıtlı değer geçersiz okunduysa ham hâli (uyarıda gösterilir); geçerli okununca null.
let storedInvalidRaw: string | null = null;

/** Son DB okumasının sonucu: geçersizse ham değeri tutar, geçerliyse uyarıyı kaldırır. */
export function noteStoredFactoryTimezone(valid: boolean, raw?: unknown): void {
  storedInvalidRaw = valid ? null : JSON.stringify(raw ?? null).slice(0, 80);
}

/** Kayıtlı dilim geçersizken sağlık ucu ve panelin göstereceği uyarı; sorun yoksa `null`. */
export function factoryTimezoneWarning(): { code: string; message: string; stored: string } | null {
  if (storedInvalidRaw === null) return null;
  const used = currentTimezone === DEFAULT_FACTORY_TIMEZONE ? "İstanbul" : currentTimezone;
  return {
    code: FACTORY_TIMEZONE_INVALID_STORED,
    message: `Kayıtlı saat dilimi geçersiz; ${used} kullanılıyor — Şirket Bilgileri → Saat dilimi'den düzeltin`,
    stored: storedInvalidRaw,
  };
}

function assertSqlZone(timeZone: string): void {
  if (!isValidFactoryTimezone(timeZone)) throw new Error(`SQL'e geçersiz saat dilimi verilemez: ${timeZone}`);
}

/**
 * Günlük gruplama/etiketleme için SQL ifadesi: `<kolon>` mutlak anını FABRİKA
 * takvim gününe çevirir ve `date` döndürür.
 *
 * Neden `Prisma.raw`: `AT TIME ZONE` bir bind parametresi (`$1`) kabul eder ama
 * o zaman ifade planner için sabit olmaktan çıkar ve
 * `20260801050000_system_log_daily_stats_tz` ile kurulan İFADE İSTATİSTİĞİ
 * eşleşmez (audit raporu sessizce yavaş plana düşer). Bu yüzden saat dilimi
 * SQL metnine gömülür. Saat dilimi `assertSqlZone` ile IANA listesine karşı
 * doğrulanır; `columnExpr` derleme zamanı sabitidir — ASLA kullanıcı girdisi geçirme.
 * Varsayılan dışı dilimde metin istatistikle eşleşmez: sonuç doğru, plan yavaş olabilir.
 *
 * ⚠️ Üretilen metin `system_logs` istatistik nesnesiyle BİREBİR eşleşmelidir.
 *    Buradaki ifadeyi değiştirirsen migration'ı da güncelle
 *    (bekçi: `scripts/test_db_invariants.ts` yalnız nesnenin VARLIĞINI görür,
 *    ifade uyumsuzluğu KIRMIZI vermez — sonuç doğru kalır, sorgu yavaşlar).
 *
 * @param columnExpr Tırnaklanmış kolon ifadesi, örn. `rm."enteredAt"`.
 */
export function factoryDaySql(columnExpr: string, timeZone: string = getFactoryTimezone()): Prisma.Sql {
  assertSqlZone(timeZone);
  return Prisma.raw(`DATE_TRUNC('day', ${columnExpr} AT TIME ZONE '${timeZone}')::date`);
}

/**
 * FABRİKA AYI — aylık gruplama (mevsimsellik serileri).
 *
 * `factoryDaySql`in ay ikizidir ve aynı sebeple var: ayın ilk gecesi
 * (yerel 00:00–03:00) UTC'de HÂLÂ ÖNCEKİ AYDIR. Oturum bilinçli olarak UTC
 * (adapter varsayımı) → çıplak `DATE_TRUNC('month', tstz)` her ayın ilk
 * gecesindeki siparişleri bir önceki aya yazar ve mevsimsellik serisi sessizce
 * kayar.
 *
 * ⚠️ Saat dilimi literalini çağıran tarafa KOPYALAMA — bu dosya
 * `test_report_day_boundary.ts` taramasının tek meşru muafıdır; başka bir
 * dosyada yazılan `DATE_TRUNC('month'…)` bekçiyi KIRMIZI yapar (ve haklıdır).
 *
 * @param columnExpr Tırnaklanmış kolon ifadesi, örn. `o."orderDate"`.
 */
export function factoryMonthSql(columnExpr: string, timeZone: string = getFactoryTimezone()): Prisma.Sql {
  assertSqlZone(timeZone);
  return Prisma.raw(`DATE_TRUNC('month', ${columnExpr} AT TIME ZONE '${timeZone}')::date`);
}

/**
 * Verilen anın FABRİKA saat dilimindeki duvar-saati parçaları.
 * `Intl` kullanılır (izinli paket listesinde date kütüphanesi yok) — süreç
 * saat diliminden (`TZ` env) BAĞIMSIZ çalışır. `new Date().setHours(0,0,0,0)`
 * deseni süreç dilimi fabrikanınkiyle aynıyken doğru sonuç verir ama bunu HİÇBİR YERDE
 * yazmaz; konteynere alınan ya da UTC kurulan bir sunucuda sessizce 3 saat kayar.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(kind: "day" | "clock" | "hm", timeZone: string): Intl.DateTimeFormat {
  const cacheKey = `${kind}|${timeZone}`;
  let f = formatterCache.get(cacheKey);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions =
      kind === "day"
        ? { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }
        : kind === "clock"
          ? { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }
          : { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    f = new Intl.DateTimeFormat(kind === "hm" ? "en-GB" : "en-CA", opts);
    formatterCache.set(cacheKey, f);
  }
  return f;
}

function factoryParts(at: Date): { y: number; m: number; d: number } {
  const parts = zoneFormatter("day", getFactoryTimezone()).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Bir anın fabrika saat dilimindeki UTC ofseti (ms). DST'de değişebilir. */
function factoryOffsetMs(at: Date): number {
  const parts = zoneFormatter("clock", getFactoryTimezone()).formatToParts(at);
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

/**
 * `at` anının FABRİKA gününde, yerel gece yarısından `minuteOfDay` dakika sonraki
 * DUVAR SAATİNİN mutlak anı (vardiya penceresi: `startMinute` / `+ durationMinutes`).
 * `factoryDayStart(at) + dk×60_000` DEĞİL: DST gününde duvar saati ile mutlak fark
 * ayrışır; ofset iki turla çözülür (`factoryDayStart` ile aynı yöntem). `minuteOfDay`
 * ≥ 1440 ertesi güne TAŞAR (gece yarısını geçen vardiyanın bitişi).
 */
export function factoryMinuteOfDay(at: Date, minuteOfDay: number): Date {
  const { y, m, d } = factoryParts(at);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minuteOfDay, 0, 0);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    guess = wallAsUtc - factoryOffsetMs(new Date(guess));
  }
  return new Date(guess);
}

/** `at` anının FABRİKA haftagünü (0=Pazar..6=Cumartesi) — `getDay()` süreç dilimini okur. */
export function factoryWeekday(at: Date): number {
  const { y, m, d } = factoryParts(at);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** `at` anının FABRİKA takvim günü, `YYYY-MM-DD` (grafik kategorisi / gün anahtarı). */
export function factoryYmd(at: Date = new Date()): string {
  const { y, m, d } = factoryParts(at);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `at` anının FABRİKA günü, Türkçe belge biçimi `GG.AA.YYYY`. */
export function factoryDateTr(at: Date): string {
  const { y, m, d } = factoryParts(at);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

/**
 * `at` anının FABRİKA günü ve saati, `GG.AA.YYYY SS:DD`. Saat de fabrika
 * dilimindendir — `getHours()` süreç dilimini okur ve UTC sunucuda 3 saat kayar.
 */
export function factoryDateTimeTr(at: Date): string {
  const parts = zoneFormatter("hm", getFactoryTimezone()).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${factoryDateTr(at)} ${get("hour")}:${get("minute")}`;
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
