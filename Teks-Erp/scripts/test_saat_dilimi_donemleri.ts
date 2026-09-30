// =============================================================================
// BEKÇİ — SAAT DİLİMİ DÖNEMLERİ: geçmiş kayıtlar etkilenmez (kullanıcı kararı 2026-09-30: "geçmiş kayıtlar
// etkilenmesin, saat dilimi değiştirildikten sonraki kayıtları etkilesin")
// =============================================================================
//   §1 saf ⭐ geçmiş değişmezlik: E'den önceki anların saati/günü/gün başı dönem eklenince AYNI; E ve sonrası yeni
//       dilimde. NEGATİF sonda: tek değerli yorum (I9: bütün zaman yeni dilim) aynı ölçümde ısırır
//   §2 saf ⭐ geçiş günü: gün anahtarı E çevresinde azalmaz, günler boşluksuz ve çakışmasız; süreler 25/23/31/17 sa.
//       NEGATİF sonda: dönem bilmeyen gün başı (tek dilim) boşluk/çakışma üretir
//   §3 saf ⭐ altın: dönem yokken SQL metni ve gün/saat çıktıları bugünküyle birebir. NEGATİF: dönem varken metin farklı
//   §4 DB ⭐ SQL CASE ↔ JS `factoryTimezoneAt` eşdeğerliği (sınır + rastgele anlar, dört geçiş yönü).
//       NEGATİF sonda: tek dilimli SQL aynı anlarda ayrışır
//   §5 DB ⭐ eşzamanlı iki değişiklik tek kazanır (8037); iptal ↔ değişiklik yarışında en çok bir bekleyen.
//       · iptal çifti söner (daha erken başlayan yeni değişiklik iptal edilmişi diriltmez).
//       NEGATİF sondalar: kilitsiz iki satır "en çok bir bekleyen"i · ters bağsız çözümleme dirilmeyi ısırır
//   §6 saf ⭐ istemci (Electron `factory-time.ts`, üç ayna bayt-eşit) ↔ backend aynı çıktı. NEGATİF: dönemsiz istemci
// Koşum: npx tsx scripts/test_saat_dilimi_donemleri.ts   (§4–§5 kendi `_test` DB'sini ister)
// =============================================================================
import * as path from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  DEFAULT_FACTORY_TIMEZONE, type FactoryTimezonePeriod, applyFactoryTimezone, applyFactoryTimezonePeriods,
  factoryDateTimeTr, factoryDayEnd, factoryDayEndOfKey, factoryDaySql, factoryDayStart, factoryDayStartOfKey,
  factoryLocalTimestampSql, factoryMinuteOfDay, factoryMonthSql, factoryTimezoneAt, factoryTimezoneChangeStart,
  factoryYmd, resolveFactoryTimezonePeriods, resolveRangeEnd, resolveRangeStart, withFactoryTimezonePeriods,
} from "../src/constants/time";
import { cancelFactoryTimezoneChange, loadFactoryTimezoneAtBoot, setFactoryTimezone } from "../src/services/factory-timezone.service";
import { pendingFactoryTimezone } from "../src/services/helpers/factory-timezone-state.helper";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

interface Senaryo { ad: string; from: string; to: string; gun: string; saat: number }
const NOW = new Date("2026-09-30T12:00:00.000Z");
// Geçişin dokunduğu gün ve süresi (saat): gün bölünmez, uzar ya da kısalır.
const IST = DEFAULT_FACTORY_TIMEZONE;
const SENARYOLAR: Senaryo[] = [
  { ad: "İstanbul→Berlin", from: IST, to: "Europe/Berlin", gun: "2026-10-01", saat: 25 },
  { ad: "Berlin→İstanbul", from: "Europe/Berlin", to: IST, gun: "2026-09-30", saat: 23 },
  { ad: "İstanbul→New York", from: IST, to: "America/New_York", gun: "2026-10-01", saat: 31 },
  { ad: "New York→İstanbul", from: "America/New_York", to: IST, gun: "2026-09-30", saat: 17 },
];

/** Senaryonun yürürlük anı ve dönem listesi (yazma yolunun kuralıyla: yeni dilimde ertesi gece yarısı). */
function kur(sc: Senaryo): { e: Date; periods: FactoryTimezonePeriod[] } {
  applyFactoryTimezone(sc.from);
  const e = factoryTimezoneChangeStart(sc.to, NOW);
  return { e, periods: [{ validFrom: e, timeZone: sc.to }] };
}
const uygula = (sc: Senaryo, periods: FactoryTimezonePeriod[]): void => applyFactoryTimezonePeriods(periods, sc.from);

/** Deterministik sözde-rastgele (koşumlar arası aynı anlar — kırmızı tekrar üretilebilsin). */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
function anlar(e: Date, gunGeri: number, gunIleri: number, n: number, seed: number): Date[] {
  const r = rng(seed);
  const t = e.getTime();
  const sinir = [-3_600_000, -1, 0, 1, 3_600_000].map((d) => new Date(t + d));
  const rast = Array.from({ length: n }, () => new Date(t - gunGeri * 86_400_000 + Math.floor(r() * (gunGeri + gunIleri) * 86_400_000)));
  return [...sinir, ...rast];
}

// Kaydın saati, günü ve gününün başı. Gün SONU bilerek yok: E'yi içine alan geçiş günü uzar/kısalır (§2 ölçer).
const iz = (at: Date): string => [factoryDateTimeTr(at), factoryYmd(at), factoryDayStart(at).toISOString()].join("|");

/** E'den önceki anlardan kaçının izi `sonra()` uygulanınca değişti. */
function gecmisKayan(sc: Senaryo, e: Date, sonra: () => void): number {
  applyFactoryTimezone(sc.from);
  const once = anlar(e, 60, 0, 300, 7).filter((a) => a < e);
  const izler = once.map(iz);
  sonra();
  return once.filter((a, i) => iz(a) !== izler[i]).length;
}

function gecmisBolumu(): void {
  console.log("\n§1 — geçmiş kayıt değişmezliği");
  for (const sc of SENARYOLAR) {
    const { e, periods } = kur(sc);
    check(`§1a ⭐ ${sc.ad}: E'den önceki 300+ anın saati/günü/gün sınırı AYNI`, gecmisKayan(sc, e, () => uygula(sc, periods)) === 0);
    const sonra = anlar(e, 0, 60, 200, 11).filter((a) => a >= e);
    const yeni = sonra.every((a) => factoryTimezoneAt(a) === sc.to &&
      factoryDateTimeTr(a) === new Intl.DateTimeFormat("tr-TR", { timeZone: sc.to, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(a).replace(",", ""));
    check(`§1b ${sc.ad}: E ve sonrası yeni dilimde`, yeni);
    check(`§1c ⭐ NEGATİF sonda ${sc.ad}: tek değerli yorum (bütün zaman yeni dilim) geçmişi kaydırır — ölçüm ısırır`,
      gecmisKayan(sc, e, () => applyFactoryTimezone(sc.to)) > 0);
  }
}

/** Gün anahtarı aralığın her yerinde azalmıyor, her günün [baş, son] aralığı boşluksuz/çakışmasız mı. */
function surekli(e: Date, basOf: (k: string) => Date, sonOf: (k: string) => Date): string | null {
  let onceki = "";
  const gunler: string[] = [];
  for (let t = e.getTime() - 3 * 86_400_000; t <= e.getTime() + 3 * 86_400_000; t += 15 * 60_000) {
    const at = new Date(t);
    const k = factoryYmd(at);
    if (k < onceki) return `anahtar geriledi ${onceki} → ${k}`;
    if (k !== onceki) gunler.push(k);
    onceki = k;
    if (basOf(k) > at || sonOf(k) < at) return `${at.toISOString()} kendi günü ${k} dışında`;
  }
  for (let i = 1; i < gunler.length; i++) {
    if (basOf(gunler[i]!).getTime() !== sonOf(gunler[i - 1]!).getTime() + 1) return `${gunler[i - 1]} ↔ ${gunler[i]} arası boşluk/çakışma`;
  }
  return null;
}

function gecisBolumu(): void {
  console.log("\n§2 — geçiş günü (bölünmez, uzar/kısalır)");
  for (const sc of SENARYOLAR) {
    const { e, periods } = kur(sc);
    uygula(sc, periods);
    const hata = surekli(e, factoryDayStartOfKey, factoryDayEndOfKey);
    check(`§2a ⭐ ${sc.ad}: gün anahtarı azalmaz, günler boşluksuz ve çakışmasız`, hata === null, hata ?? "");
    const saat = (factoryDayEndOfKey(sc.gun).getTime() + 1 - factoryDayStartOfKey(sc.gun).getTime()) / 3_600_000;
    check(`§2b ${sc.ad}: geçiş günü ${sc.gun} ${sc.saat} saat`, saat === sc.saat, `${saat} sa`);
    // Dönem bilmeyen hesap: günü ilk anının dilimiyle TEK dilimde keser (I9'un gün sınırı).
    const tek = (k: string, f: (k: string) => Date): Date => withFactoryTimezonePeriods([], factoryTimezoneAt(factoryDayStartOfKey(k)), () => f(k));
    check(`§2c ⭐ NEGATİF sonda ${sc.ad}: dönem bilmeyen gün sınırı süreklilik ölçümünü ısırır`,
      surekli(e, (k) => tek(k, factoryDayStartOfKey), (k) => tek(k, factoryDayEndOfKey)) !== null);
  }
  applyFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
}

function altinBolumu(): void {
  console.log("\n§3 — altın: dönem yokken bugünkü çıktı birebir");
  applyFactoryTimezonePeriods([], DEFAULT_FACTORY_TIMEZONE);
  // Beklenen metinler BUGÜNKÜ davranışın kendisidir (ifade istatistiği `sl_day_exact` bu metinle eşleşir).
  // eslint-disable-next-line no-restricted-syntax
  const ist = "Europe/Istanbul";
  const gunSql = factoryDaySql('rm."enteredAt"').sql;
  const aySql = factoryMonthSql('o."orderDate"').sql;
  // eslint-disable-next-line no-restricted-syntax -- altın metin: ölçülen şeyin kendisi
  check("§3a ⭐ gün SQL'i birebir", gunSql === `DATE_TRUNC('day', rm."enteredAt" AT TIME ZONE '${ist}')::date`, gunSql);
  // eslint-disable-next-line no-restricted-syntax -- altın metin: ölçülen şeyin kendisi
  check("§3b ⭐ ay SQL'i birebir", aySql === `DATE_TRUNC('month', o."orderDate" AT TIME ZONE '${ist}')::date`, aySql);
  const at = new Date("2026-07-31T21:30:00.000Z"); // İstanbul 1 Ağu 00:30
  const cikti = [
    factoryYmd(at), factoryDayStart(at).toISOString(), factoryDayEnd(at).toISOString(), factoryDateTimeTr(at),
    factoryMinuteOfDay(at, 450).toISOString(), resolveRangeStart("2026-08-01").toISOString(), resolveRangeEnd("2026-08-01").toISOString(),
  ];
  const beklenen = [
    "2026-08-01", "2026-07-31T21:00:00.000Z", "2026-08-01T20:59:59.999Z", "01.08.2026 00:30",
    "2026-08-01T04:30:00.000Z", "2026-07-31T21:00:00.000Z", "2026-08-01T20:59:59.999Z",
  ];
  check("§3c ⭐ gün/saat/sınır çıktıları birebir", JSON.stringify(cikti) === JSON.stringify(beklenen), JSON.stringify(cikti));
  const donemli = withFactoryTimezonePeriods([{ validFrom: new Date("2027-01-01T00:00:00Z"), timeZone: "Europe/Berlin" }], DEFAULT_FACTORY_TIMEZONE,
    () => factoryDaySql('rm."enteredAt"').sql);
  check("§3d NEGATİF sonda: dönem varken metin tek ifade DEĞİL (altın karşılaştırma ısırır)", donemli !== gunSql && donemli.includes("CASE WHEN"), donemli);
}

async function sqlBolumu(): Promise<void> {
  console.log("\n§4 — SQL CASE ↔ JS eşdeğerliği");
  const ayrisan = async (liste: Date[], gunSql: Prisma.Sql, duvarSql: Prisma.Sql): Promise<number> => {
    const iso = liste.map((a) => a.toISOString());
    const rows = await prisma.$queryRaw<Array<{ d: string; w: string }>>(Prisma.sql`
      SELECT to_char(${gunSql}, 'YYYY-MM-DD') AS d, to_char(${duvarSql}, 'DD.MM.YYYY HH24:MI') AS w
      FROM unnest(${iso}::timestamptz[]) WITH ORDINALITY AS t(at, i) ORDER BY t.i`);
    return liste.filter((a, i) => rows[i]?.d !== factoryYmd(a) || rows[i]?.w !== factoryDateTimeTr(a)).length;
  };
  for (const sc of SENARYOLAR) {
    const { e, periods } = kur(sc);
    uygula(sc, periods);
    const liste = anlar(e, 5, 5, 400, 23);
    const n = await ayrisan(liste, factoryDaySql("t.at"), factoryLocalTimestampSql("t.at"));
    check(`§4a ⭐ ${sc.ad}: SQL gün/duvar saati = JS (${liste.length} an, sınırlar dahil)`, n === 0, `${n} ayrışan`);
    const tekGun = withFactoryTimezonePeriods([], sc.to, () => factoryDaySql("t.at"));
    const tekDuvar = withFactoryTimezonePeriods([], sc.to, () => factoryLocalTimestampSql("t.at"));
    check(`§4b ⭐ NEGATİF sonda ${sc.ad}: tek dilimli SQL aynı anlarda ayrışır`, (await ayrisan(liste, tekGun, tekDuvar)) > 0);
  }
  applyFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
}

/** Bekçinin KENDİ dönem satırları (bu koşumda doğanlar) — defter yalnız teardown'da ve yalnız `_test` DB'de silinir. */
async function temizleDonemler(): Promise<void> {
  const ids = (await prisma.factoryTimezonePeriod.findMany({ where: { createdAt: { gte: DB_BASLANGIC } }, select: { id: true } })).map((r) => r.id);
  if (ids.length === 0) return;
  await prisma.factoryTimezonePeriod.updateMany({ where: { id: { in: ids } }, data: { reversesPeriodId: null } });
  await prisma.factoryTimezonePeriod.deleteMany({ where: { id: { in: ids } } });
}

// Koşumun başı DB saatinden: satırların `createdAt`i DB'nin saatidir (konteyner saati süreçten kayabilir).
let DB_BASLANGIC = new Date(0);

/** Dönem defteri bu koşumdan ÖNCE boş olmalı: bekçi yalnız kendi satırlarını siler, başkasınınkini yorumlayamaz. */
async function defterBosMu(): Promise<boolean> {
  DB_BASLANGIC = (await prisma.$queryRaw<Array<{ t: Date }>>`SELECT clock_timestamp() AS t`)[0]!.t;
  const onceki = await prisma.factoryTimezonePeriod.count({ where: { createdAt: { lt: DB_BASLANGIC } } });
  check("§0 dönem defteri koşum öncesi boş (değilse ÖLÇÜLEMEDİ — başka bir koşumun satırları)", onceki === 0, `${onceki} satır`);
  return onceki === 0;
}

const kod = (r: PromiseSettledResult<unknown>): string =>
  r.status === "fulfilled" ? "OK" : String((r.reason as { details?: { code?: string } }).details?.code ?? (r.reason as Error).message);

/** "En çok bir bekleyen değişiklik": etkin dönemlerden şimdiden sonra başlayan sayısı ≤ 1. */
async function bekleyenSayisi(): Promise<number> {
  await loadFactoryTimezoneAtBoot();
  const rows = await prisma.factoryTimezonePeriod.findMany({ select: { id: true, timeZone: true, validFrom: true, createdAt: true, reversesPeriodId: true } });
  return resolveFactoryTimezonePeriods(rows).periods.filter((p) => p.validFrom.getTime() > Date.now()).length;
}

async function eszamanliBolumu(): Promise<void> {
  console.log("\n§5 — eşzamanlı değişiklik");
  const admin = await ensureTestAdmin();
  await temizleDonemler();
  await loadFactoryTimezoneAtBoot();
  const cur = factoryTimezoneAt(new Date());
  const [a, b] = await Promise.allSettled([
    setFactoryTimezone({ timeZone: "Europe/Berlin", expectedCurrent: cur }, admin.id),
    setFactoryTimezone({ timeZone: "America/New_York", expectedCurrent: cur }, admin.id),
  ]);
  const kodlar = [kod(a!), kod(b!)].sort();
  check("§5a ⭐ eşzamanlı iki değişiklikten TEK biri yazılır, öteki 409 PENDING", JSON.stringify(kodlar) === JSON.stringify(["FACTORY_TIMEZONE_PENDING", "OK"]) &&
    (await prisma.factoryTimezonePeriod.count()) === 1, kodlar.join(" · "));
  const p = pendingFactoryTimezone();
  const [c, d] = await Promise.allSettled([
    cancelFactoryTimezoneChange({ periodId: p?.id ?? "" }, admin.id),
    setFactoryTimezone({ timeZone: "Asia/Tokyo", expectedCurrent: cur }, admin.id),
  ]);
  const bekleyen = await bekleyenSayisi();
  const satir = await prisma.factoryTimezonePeriod.count();
  check("§5b ⭐ iptal ↔ değişiklik yarışı: iptal yazılır, en çok bir bekleyen kalır, satır silinmez",
    kod(c!) === "OK" && bekleyen <= 1 && satir >= 2, `${kod(c!)} · ${kod(d!)} · bekleyen ${bekleyen} · satır ${satir}`);
  // İptalden sonra DAHA ERKEN başlayan değişiklik: iptal satırındaki eski dilim yeniden yürürlüğe girmemeli.
  await temizleDonemler();
  await loadFactoryTimezoneAtBoot();
  // Koşum saatinden bağımsız: gece yarısı GEÇ gelen dilim önce planlanıp iptal edilir, ERKEN gelen sonra.
  const [gec, erkenZ] = ["America/New_York", "Asia/Tokyo"]
    .map((z) => ({ z, e: factoryTimezoneChangeStart(z).getTime() }))
    .sort((x, y) => y.e - x.e) as [{ z: string; e: number }, { z: string; e: number }];
  const ilk = await setFactoryTimezone({ timeZone: gec.z, expectedCurrent: cur }, admin.id);
  await cancelFactoryTimezoneChange({ periodId: ilk.pending!.id }, admin.id);
  const ikinci = await setFactoryTimezone({ timeZone: erkenZ.z, expectedCurrent: cur }, admin.id);
  const sonra = new Date(new Date(ilk.effectiveFrom!).getTime() + 3_600_000);
  const erken = new Date(ikinci.effectiveFrom!) < new Date(ilk.effectiveFrom!);
  check("§5d ⭐ ters kayıt çifti söner: daha erken başlayan yeni değişiklik iptal edilmişi diriltmez",
    erken && (await bekleyenSayisi()) === 1 && factoryTimezoneAt(sonra) === erkenZ.z, `${ikinci.effectiveFrom} < ${ilk.effectiveFrom}: ${erken}`);
  const ciplak = (await prisma.factoryTimezonePeriod.findMany({ select: { id: true, timeZone: true, validFrom: true, createdAt: true } }))
    .map((r) => ({ ...r, reversesPeriodId: null }));
  check("§5e ⭐ NEGATİF sonda: ters bağı yok sayan çözümleme ikinci bekleyeni diriltir (ölçüm ısırır)",
    resolveFactoryTimezonePeriods(ciplak).periods.filter((p2) => p2.validFrom.getTime() > Date.now()).length === 2);
  await temizleDonemler();
  const ileri = Date.now() + 5 * 86_400_000;
  await prisma.factoryTimezonePeriod.createMany({ data: [
    { timeZone: "Europe/Berlin", validFrom: new Date(ileri), createdById: admin.id, reason: "bekçi §5c" },
    { timeZone: "America/New_York", validFrom: new Date(ileri + 86_400_000), createdById: admin.id, reason: "bekçi §5c" },
  ] });
  check("§5c ⭐ NEGATİF sonda: kilitsiz iki satır 'en çok bir bekleyen' yüklemini ısırır", (await bekleyenSayisi()) === 2);
  await temizleDonemler();
  await loadFactoryTimezoneAtBoot();
}

interface IstemciSaat {
  setFactoryTimezone(z: unknown): boolean;
  setFactoryTimezonePeriods(p: unknown, base?: unknown): boolean;
  factoryDayKey(a: Date): string;
  fmtFactoryDateTime(a: Date): string;
  factoryDayStartIso(k: string): string;
  factoryDayEndIso(k: string): string;
  factoryWallTimeToDate(k: string, t: string): Date | null;
}

/** İstemci ile backend'in ayrıştığı ölçüm sayısı (anlar + bu anların günleri). */
function istemciAyrisan(ist: IstemciSaat, liste: Date[]): number {
  let n = 0;
  const gunler = new Set<string>();
  for (const a of liste) {
    if (ist.factoryDayKey(a) !== factoryYmd(a) || ist.fmtFactoryDateTime(a) !== factoryDateTimeTr(a)) n++;
    gunler.add(factoryYmd(a));
  }
  for (const k of gunler) {
    const vardiya = factoryMinuteOfDay(factoryDayStartOfKey(k), 450).toISOString();
    if (ist.factoryDayStartIso(k) !== factoryDayStartOfKey(k).toISOString() || ist.factoryDayEndIso(k) !== factoryDayEndOfKey(k).toISOString() ||
      ist.factoryWallTimeToDate(k, "07:30")?.toISOString() !== vardiya) n++;
  }
  return n;
}

async function istemciBolumu(): Promise<void> {
  console.log("\n§6 — istemci (Electron · mobil · patron aynası) ↔ backend");
  const ist = (await import(path.resolve(__dirname, "../../Electron/src/lib/factory-time.ts"))) as IstemciSaat;
  for (const sc of SENARYOLAR) {
    const { e, periods } = kur(sc);
    uygula(sc, periods);
    const liste = anlar(e, 10, 10, 400, 31);
    ist.setFactoryTimezonePeriods(periods.map((p) => ({ validFrom: p.validFrom.toISOString(), timeZone: p.timeZone })), sc.from);
    const n = istemciAyrisan(ist, liste);
    check(`§6a ⭐ ${sc.ad}: istemci gün/saat/gün sınırı/vardiya saati = backend`, n === 0, `${n} ayrışan`);
    ist.setFactoryTimezone(sc.from);
    check(`§6b ⭐ NEGATİF sonda ${sc.ad}: dönemsiz istemci ayrışır`, istemciAyrisan(ist, liste) > 0);
  }
  ist.setFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
  applyFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
}

async function main(): Promise<void> {
  gecmisBolumu();
  gecisBolumu();
  altinBolumu();
  await istemciBolumu();
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n⛔ §4–§5 DURDURULDU — ${engel}`);
    fail++;
    return;
  }
  console.log(`\nHedef veritabanı: ${hedefDbAdi()}`);
  if (!(await defterBosMu())) return;
  try {
    await sqlBolumu();
    await eszamanliBolumu();
  } finally {
    await temizleDonemler();
    await prisma.systemLog.deleteMany({ where: { tableName: "FACTORY_TIMEZONE_PERIOD", createdAt: { gte: BASLANGIC } } });
    applyFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
  }
}

const BASLANGIC = new Date();
main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
