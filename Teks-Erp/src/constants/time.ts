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
// ── FABRİKAYA GÖRE SEÇİLEBİLİR, TARİHLİ DÖNEMLERLE (kullanıcı kararı 2026-09-30) ──
// Saat dilimi PROFİL değeridir ve bir DÖNEM DEFTERİDİR (`factory_timezone_periods`):
// satır yoksa bütün zaman `DEFAULT_FACTORY_TIMEZONE` = bugünkü davranış. Bir kaydın
// saati, günü, vardiyası ve rapor günü KAYDIN ANINDAKİ dilimle yorumlanır
// (`factoryTimezoneAt`) — değişiklik yalnız yürürlüğe girdiği andan SONRAKİ kayıtları
// etkiler, geçmiş kayıtların saati/günü asla kaymaz. "Bugün" şimdiki dilimde bugündür.
// Kural ÇEKİRDEK: gün anahtarı, her görüntü/basım saati ve ham `AT TIME ZONE` YALNIZ
// bu dosyadan. Dönem listesi açılışta `listen`den ÖNCE yüklenir (factory-timezone.service).
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

/** Etkin dönem: `from` anından (ms; ilk dönem -∞) sonraki dönem başlayana dek `zone`. */
interface ZoneSegment {
  from: number;
  zone: string;
}

/** Dönem defterinin (`factory_timezone_periods`) bir satırı — çözümleyicinin gördüğü kadarı. */
export interface FactoryTimezonePeriodRow {
  id: string;
  timeZone: string;
  validFrom: Date;
  createdAt: Date;
  /** Ters kayıt: iptal ettiği satır. Çift birbirini söndürür. */
  reversesPeriodId: string | null;
}

/** Bir anın saat dilimi değişimi: `validFrom`dan itibaren `timeZone` (istemciye ve buluta giden biçim). */
export interface FactoryTimezonePeriod {
  validFrom: Date;
  timeZone: string;
}

let segments: ZoneSegment[] = [{ from: -Infinity, zone: DEFAULT_FACTORY_TIMEZONE }];

/**
 * Defter satırlarından etkin dönemler. İptal, aynı ana önceki dilimle yazılan ters kayıttır (`reversesPeriodId`) ve
 * çift BİRBİRİNİ SÖNDÜRÜR: sonradan daha erken başlayan bir değişiklik, iptal satırındaki eski dilimi yeniden
 * yürürlüğe sokamaz. Kalanlarda aynı `validFrom`da en son satır (createdAt, sonra id) kazanır; geçersiz dilim o
 * dönemde `base` ile yorumlanır (I9 şık 2); ardışık aynı dilimler birleşir.
 */
export function resolveFactoryTimezonePeriods(
  rows: readonly FactoryTimezonePeriodRow[],
  base: string = DEFAULT_FACTORY_TIMEZONE,
): { periods: Array<FactoryTimezonePeriod & { id: string }>; invalid: FactoryTimezonePeriodRow[] } {
  const latest = new Map<number, FactoryTimezonePeriodRow>();
  const reversed = new Set(rows.map((r) => r.reversesPeriodId).filter((x): x is string => x !== null));
  for (const r of rows) {
    if (r.reversesPeriodId !== null || reversed.has(r.id)) continue;
    const k = r.validFrom.getTime();
    const cur = latest.get(k);
    const newer = !cur || r.createdAt.getTime() > cur.createdAt.getTime() ||
      (r.createdAt.getTime() === cur.createdAt.getTime() && r.id > cur.id);
    if (newer) latest.set(k, r);
  }
  const invalid: FactoryTimezonePeriodRow[] = [];
  const periods: Array<FactoryTimezonePeriod & { id: string }> = [];
  let prev = base;
  for (const k of [...latest.keys()].sort((a, b) => a - b)) {
    const r = latest.get(k)!;
    const valid = isValidFactoryTimezone(r.timeZone);
    if (!valid) invalid.push(r);
    const zone = valid ? r.timeZone : base;
    if (zone === prev) continue;
    periods.push({ id: r.id, validFrom: new Date(k), timeZone: zone });
    prev = zone;
  }
  return { periods, invalid };
}

/**
 * Süreç içi dönem listesini değiştirir (`resolveFactoryTimezonePeriods` çıktısı). `base` ilk dönemden önceki
 * dilimdir (varsayılan = bugünkü davranış). Geçersiz ad FIRLATIR: yanlış güne yazmaktansa dur.
 */
export function applyFactoryTimezonePeriods(
  periods: readonly FactoryTimezonePeriod[],
  base: string = DEFAULT_FACTORY_TIMEZONE,
): void {
  if (!isValidFactoryTimezone(base)) throw new Error(`Geçersiz fabrika saat dilimi: ${String(base)}`);
  const next: ZoneSegment[] = [{ from: -Infinity, zone: base }];
  for (const p of [...periods].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())) {
    if (!isValidFactoryTimezone(p.timeZone)) throw new Error(`Geçersiz fabrika saat dilimi: ${String(p.timeZone)}`);
    const t = p.validFrom.getTime();
    if (!Number.isFinite(t)) throw new Error("Geçersiz dönem başlangıcı");
    const last = next[next.length - 1]!;
    if (last.zone === p.timeZone) continue;
    if (last.from === t) last.zone = p.timeZone;
    else next.push({ from: t, zone: p.timeZone });
  }
  segments = next;
}

/** Bütün zamanı TEK dilimle yorumlar (dönemsiz kurulum / bekçi). Geçersiz ad FIRLATIR. */
export function applyFactoryTimezone(value: string): void {
  applyFactoryTimezonePeriods([], value);
}

/**
 * `fn`i VARSAYIMSAL bir dönem listesiyle SENKRON koşar ve süreç değerini geri koyar (önizleme: "değişiklik
 * yazılsaydı geçiş günü kaç saat olurdu"). `fn` asenkron olamaz — `await` araya başka isteği sokar.
 */
export function withFactoryTimezonePeriods<T>(
  periods: readonly FactoryTimezonePeriod[],
  base: string,
  fn: () => T,
): T {
  const saved = segments;
  try {
    applyFactoryTimezonePeriods(periods, base);
    return fn();
  } finally {
    segments = saved;
  }
}

/** Etkin dönemler (ilk dönemden önceki dilim `DEFAULT_FACTORY_TIMEZONE`); dönemsiz kurulumda boş. */
export function getFactoryTimezonePeriods(): FactoryTimezonePeriod[] {
  return segments.slice(1).map((s) => ({ validFrom: new Date(s.from), timeZone: s.zone }));
}

/** İlk dönemden önceki dilim — normalde varsayılan; tek dilimli yorumda (bekçi) o dilim. */
export function getFactoryBaseTimezone(): string {
  return segments[0]!.zone;
}

function segmentIndexAt(ms: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.from <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * `at` anında yürürlükteki fabrika dilimi — kaydın saati, günü, vardiyası ve rapor günü BU dilimle yorumlanır
 * (kayıt ANINDAKİ dilim; sonradan yapılan değişiklik geçmişi kaydırmaz). Senkron, tx içinde güvenli.
 */
export function factoryTimezoneAt(at: Date): string {
  return segments[segmentIndexAt(at.getTime())]!.zone;
}

/** Fabrikanın ŞU ANKİ saat dilimi ("bugün" bu dilimde bugündür). */
export function getFactoryTimezone(): string {
  return factoryTimezoneAt(new Date());
}

/** Sağlık ucu + panel uyarısının kodu: kayıtlı dilim geçersiz, o dönem varsayılanla yorumlanıyor. */
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
  const used = getFactoryTimezone();
  const label = used === DEFAULT_FACTORY_TIMEZONE ? "İstanbul" : used;
  return {
    code: FACTORY_TIMEZONE_INVALID_STORED,
    message: `Kayıtlı saat dilimi geçersiz; ${label} kullanılıyor — Şirket Bilgileri → Saat dilimi'den düzeltin`,
    stored: storedInvalidRaw,
  };
}

function assertSqlZone(timeZone: string): void {
  if (!isValidFactoryTimezone(timeZone)) throw new Error(`SQL'e geçersiz saat dilimi verilemez: ${timeZone}`);
}

/**
 * `<kolon>` mutlak anını FABRİKA duvar saatine (timestamp) çeviren SQL metni — ham `AT TIME ZONE` YALNIZ burada.
 * Dönemsiz kurulumda bugünkü tek ifade (`col AT TIME ZONE 'Europe/Istanbul'`, ifade istatistiğiyle birebir);
 * dönem varsa her satır kendi ANINDAKİ dilimle çevrilir:
 * `CASE WHEN col < TIMESTAMPTZ '<t1>' THEN col AT TIME ZONE 'Z0' … ELSE col AT TIME ZONE 'Zn' END`.
 * Dilimler `assertSqlZone` ile, anlar `toISOString()` ile üretilir — `columnExpr` derleme zamanı sabitidir.
 */
function factoryLocalTimestampSqlText(columnExpr: string): string {
  const segs = segments;
  for (const s of segs) assertSqlZone(s.zone);
  if (segs.length === 1) return `${columnExpr} AT TIME ZONE '${segs[0]!.zone}'`;
  let sql = "CASE";
  for (let i = 1; i < segs.length; i++) {
    sql += ` WHEN ${columnExpr} < TIMESTAMPTZ '${new Date(segs[i]!.from).toISOString()}' THEN ${columnExpr} AT TIME ZONE '${segs[i - 1]!.zone}'`;
  }
  return `${sql} ELSE ${columnExpr} AT TIME ZONE '${segs[segs.length - 1]!.zone}' END`;
}

/** `factoryLocalTimestampSqlText`in `Prisma.Sql` hâli (saat/vardiya gruplaması gibi gün dışı çözünürlükler). */
export function factoryLocalTimestampSql(columnExpr: string): Prisma.Sql {
  return Prisma.raw(factoryLocalTimestampSqlText(columnExpr));
}

/**
 * Günlük gruplama/etiketleme için SQL ifadesi: `<kolon>` mutlak anını FABRİKA
 * takvim gününe çevirir ve `date` döndürür — her satır kendi anındaki dilimle.
 *
 * Neden `Prisma.raw`: `AT TIME ZONE` bir bind parametresi (`$1`) kabul eder ama
 * o zaman ifade planner için sabit olmaktan çıkar ve
 * `20260801050000_system_log_daily_stats_tz` ile kurulan İFADE İSTATİSTİĞİ
 * eşleşmez (audit raporu sessizce yavaş plana düşer). Bu yüzden saat dilimi
 * SQL metnine gömülür. Dönemli kurulumda metin istatistikle eşleşmez: sonuç
 * doğru, plan yavaş olabilir (DEPLOY-RUNBOOK §12).
 *
 * ⚠️ Dönemsiz kurulumda üretilen metin `system_logs` istatistik nesnesiyle BİREBİR
 *    eşleşmelidir. Buradaki ifadeyi değiştirirsen migration'ı da güncelle
 *    (bekçi: `scripts/test_db_invariants.ts` yalnız nesnenin VARLIĞINI görür,
 *    ifade uyumsuzluğu KIRMIZI vermez — sonuç doğru kalır, sorgu yavaşlar).
 *
 * @param columnExpr Tırnaklanmış kolon ifadesi, örn. `rm."enteredAt"`.
 */
export function factoryDaySql(columnExpr: string): Prisma.Sql {
  return Prisma.raw(`DATE_TRUNC('day', ${factoryLocalTimestampSqlText(columnExpr)})::date`);
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
export function factoryMonthSql(columnExpr: string): Prisma.Sql {
  return Prisma.raw(`DATE_TRUNC('month', ${factoryLocalTimestampSqlText(columnExpr)})::date`);
}

/**
 * Verilen anın bir dilimdeki duvar-saati parçaları.
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

type DayParts = { y: number; m: number; d: number };

function partsIn(at: Date, timeZone: string): DayParts {
  const parts = zoneFormatter("day", timeZone).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** `at` anının kendi dönemindeki (kayıt anındaki dilim) takvim günü parçaları. */
function factoryParts(at: Date): DayParts {
  return partsIn(at, factoryTimezoneAt(at));
}

/** Bir anın verilen dilimdeki UTC ofseti (ms). DST'de değişebilir. */
function offsetMsIn(at: Date, timeZone: string): number {
  const parts = zoneFormatter("clock", timeZone).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  // Milisaniye kırpılır: formatToParts ms taşımaz, ofset her zaman dakika katıdır.
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Duvar saati (gün + gece yarısından dakika) → mutlak an, TEK dilimde; iki turlu ofset çözümü DST'de de doğru. */
function wallToInstantIn(p: DayParts, minuteOfDay: number, timeZone: string): number {
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d, 0, minuteOfDay, 0, 0);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    guess = wallAsUtc - offsetMsIn(new Date(guess), timeZone);
  }
  return guess;
}

const ymdNum = (p: DayParts): number => p.y * 10_000 + p.m * 100 + p.d;
const segmentEnd = (i: number): number => (i + 1 < segments.length ? segments[i + 1]!.from : Infinity);

function nextDayParts(p: DayParts): DayParts {
  const x = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
}

/**
 * Fabrika gününün İLK anı. Dönem sınırı gün içine düşerse gün iki dilimde sürer (uzar/kısalır, bölünmez):
 * ilk parçanın başı döner. Dönemsiz kurulumda tek dilimli iki turlu çözüm (bugünkü hesap, birebir).
 */
function dayStartMs(p: DayParts): number {
  if (segments.length === 1) return wallToInstantIn(p, 0, segments[0]!.zone);
  const key = ymdNum(p);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const midnight = wallToInstantIn(p, 0, seg.zone);
    const start = Math.max(midnight, seg.from);
    if (start >= segmentEnd(i)) continue;
    if (start === midnight || ymdNum(partsIn(new Date(start), seg.zone)) === key) return start;
  }
  // Gün hiçbir dönemde yok (tarih çizgisi ötesi geçiş): anahtarı bu günü aşan ilk sınır — boş gün.
  for (let i = 1; i < segments.length; i++) {
    if (ymdNum(partsIn(new Date(segments[i]!.from), segments[i]!.zone)) > key) return segments[i]!.from;
  }
  return wallToInstantIn(p, 0, segments[segments.length - 1]!.zone);
}

/** Fabrika gününde duvar saati → an: o duvar saatini TAŞIYAN dönemin dilimiyle (iki dönemde varsa erkeni). */
function wallInstantMs(p: DayParts, minuteOfDay: number): number {
  if (segments.length === 1) return wallToInstantIn(p, minuteOfDay, segments[0]!.zone);
  for (let i = 0; i < segments.length; i++) {
    const t = wallToInstantIn(p, minuteOfDay, segments[i]!.zone);
    if (t >= segments[i]!.from && t < segmentEnd(i)) return t;
  }
  return wallToInstantIn(p, minuteOfDay, factoryTimezoneAt(new Date(dayStartMs(p))));
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
  return new Date(dayStartMs(factoryParts(at)));
}

/**
 * `at` anının FABRİKA gününde, yerel gece yarısından `minuteOfDay` dakika sonraki
 * DUVAR SAATİNİN mutlak anı (vardiya penceresi: `startMinute` / `+ durationMinutes`).
 * `factoryDayStart(at) + dk×60_000` DEĞİL: DST gününde duvar saati ile mutlak fark
 * ayrışır; ofset iki turla çözülür (`factoryDayStart` ile aynı yöntem). `minuteOfDay`
 * ≥ 1440 ertesi güne TAŞAR (gece yarısını geçen vardiyanın bitişi).
 */
export function factoryMinuteOfDay(at: Date, minuteOfDay: number): Date {
  return new Date(wallInstantMs(factoryParts(at), minuteOfDay));
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
 * `at` anının FABRİKA günü ve saati, `GG.AA.YYYY SS:DD`. Saat de kaydın anındaki
 * dilimdendir — `getHours()` süreç dilimini okur ve UTC sunucuda 3 saat kayar.
 */
export function factoryDateTimeTr(at: Date): string {
  const parts = zoneFormatter("hm", factoryTimezoneAt(at)).formatToParts(at);
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
 * gelebilir; gün başlangıcı üzerinden türetmek her takvimde ve dönem sınırında doğrudur.
 */
export function factoryDayEnd(at: Date = new Date()): Date {
  return new Date(dayStartMs(nextDayParts(factoryParts(at))) - 1);
}

function parseDayKey(value: string): DayParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** `YYYY-MM-DD` fabrika gününün ilk anı; bozuk anahtar → `Invalid Date`. */
export function factoryDayStartOfKey(dayKey: string): Date {
  const p = parseDayKey(dayKey);
  return p ? new Date(dayStartMs(p)) : new Date(NaN);
}

/** `YYYY-MM-DD` fabrika gününün son anı (ertesi günün ilk anı − 1 ms); bozuk anahtar → `Invalid Date`. */
export function factoryDayEndOfKey(dayKey: string): Date {
  const p = parseDayKey(dayKey);
  return p ? new Date(dayStartMs(nextDayParts(p)) - 1) : new Date(NaN);
}

/**
 * Dilim değişikliğinin yürürlük anı: YENİ dilimde şimdiden sonraki ilk yerel gece yarısı — gün bölünmez,
 * değişiklik o günün başından geçerli olur. Eski dilimin E'den hemen önceki günü yeni günden ileride olmamalı
 * ve aradan gün atlanmamalı; olmuyorsa sonraki gece yarısı denenir. İki dilim arası 24 saati aşıyorsa
 * (tarih çizgisi ötesi) bu hiçbir gece yarısında sağlanmaz: ilk gece yarısı döner, bir takvim günü iki kez yaşanır.
 */
export function factoryTimezoneChangeStart(newZone: string, now: Date = new Date()): Date {
  if (!isValidFactoryTimezone(newZone)) throw new Error(`Geçersiz fabrika saat dilimi: ${newZone}`);
  let p = partsIn(now, newZone);
  let first: number | null = null;
  for (let k = 1; k <= 3; k++) {
    p = nextDayParts(p);
    let e = wallToInstantIn(p, 0, newZone);
    if (ymdNum(partsIn(new Date(e), newZone)) !== ymdNum(p)) e = wallToInstantIn(p, 60, newZone);
    if (e <= now.getTime()) continue;
    first ??= e;
    const old = factoryParts(new Date(e - 1));
    const gapDays = (Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(old.y, old.m - 1, old.d)) / 86_400_000;
    if (gapDays === 0 || gapDays === 1) return new Date(e);
  }
  if (first === null) throw new Error(`Saat dilimi geçiş anı bulunamadı: ${newZone}`);
  return new Date(first);
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
  // Gün-yalnız değer doğrudan gün anahtarıdır: sınır o FABRİKA gününün kendisinden çözülür (dönem sınırındaki
  // uzamış/kısalmış gün dahil) — bir çıpa anını dilime göre yorumlamak +12 ve ötesi dilimde günü kaydırırdı.
  return edge === "start" ? factoryDayStartOfKey(value) : factoryDayEndOfKey(value);
}

/** `lte` (bitiş, DAHİL) sınırı — gün-yalnız değer o günün SONUNA çözülür. */
export function resolveRangeEnd(value: string): Date {
  return resolveDayBoundary(value, "end");
}

/** `gte` (başlangıç, DAHİL) sınırı — gün-yalnız değer o günün BAŞINA çözülür. */
export function resolveRangeStart(value: string): Date {
  return resolveDayBoundary(value, "start");
}
