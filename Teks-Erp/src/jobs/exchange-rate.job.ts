// =============================================================================
// TCMB döviz kuru çekme işi (ön muhasebe — Faz 2)
// =============================================================================
// node-cron allowed-packages dışında olduğu için setInterval ile gidiyoruz
// (archive-scheduler emsali). Tek Express process varsayımı — server.ts'teki
// TEK-PROCESS INVARIANT bloğuna bak.
//
// Davranış:
//   - Server start'tan 60sn sonra ilk kontrol (DB hazır olsun), sonra saatte bir
//   - ⚠️ FABRİKA SIFIR-FARK (load-bearing): `finance.enabled` KAPALIYSA iş
//     HİÇBİR ŞEY yapmaz — dış HTTP denemesi bile atmaz. Üretici fabrika
//     internetsiz; her saat başı bir timeout + log satırı, hem gürültü hem
//     10 sn'lik boş bekleme demekti. Yeni bayrak EKLENMEDİ — modül kapalıyken
//     kur çekmenin de anlamı yok, `finance.enabled` iki soruyu birden cevaplar.
//   - Bugünün (fabrika günü) TCMB satırı DB'de zaten varsa HTTP isteği atılmaz.
//     Not: TCMB bülteni iş günü ~15:30'da yayınlanır; öncesinde today.xml bir
//     ÖNCEKİ bültendir → sabah saatlerindeki koşumlar dünün bültenini bulur,
//     satırlar zaten yazılı olduğu için no-op geçer. Hafta sonu/tatilde "bugünün
//     satırı" hiç doğmaz ve saatlik küçük GET sürer — bilinçli: "en son bülten
//     hangi gün" fetch etmeden bilinemez ve 15:30 bültenini kaçırmamak öncelikli.
//   - Başarısız fetch üretimi DURDURMAZ: console.error + sessiz geç, bir sonraki
//     saat tekrar denenir. `reportJobFailure` BİLİNÇLİ kullanılmıyor: dış ağ
//     hatası beklenen bir durumdur (internet kesintisi), her saat SystemLog'a
//     satır yazmak defteri şişirir; kullanıcı yüzeyi zaten korunuyor —
//     `resolveExchangeRateTx` kur bulamazsa 400 + "elle girin" der.
//
// Kur kaynağı ve yazma kuralı:
//   - VUK md. 280 gereği dövizli işlemlerin TL çevrimi TCMB DÖVİZ ALIŞ
//     (ForexBuying) kuruyla yapılır — efektif/satış değil. Bu yüzden yalnız
//     ForexBuying okunur.
//   - MANUAL KAZANIR: aynı (rateDate, currency) için operatörün elle yazdığı
//     satıra DOKUNULMAZ (bilinçli karar — belki TCMB kuru o gün için
//     düzeltilmiştir). Satır yoksa TCMB olarak yazılır; TCMB satırı varsa rate
//     güncellenir (bülten gün içinde revize edilebilir).
// =============================================================================

import { Prisma, Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { readFinanceEnabled } from "../services/system-setting.service";
import { factoryDayKeyUtcMidnight } from "../constants/time";
import { AuditService } from "../services/audit.service";
import { AppError } from "../utils/app-error";
import { bilgi, hata } from "../lib/logger";

export const TCMB_TODAY_XML_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";
const FETCH_TIMEOUT_MS = 10_000;

/** Çekilen para birimleri — `Currency` enum'unun TRY dışındaki tamamı. */
export const TCMB_TARGET_CURRENCIES = ["USD", "EUR", "GBP", "RUB"] as const satisfies readonly Currency[];
export type TcmbCurrency = (typeof TCMB_TARGET_CURRENCIES)[number];

export interface ParsedTcmbRate {
  currency: TcmbCurrency;
  /** 1 birim döviz kaç TL — Unit'e BÖLÜNMÜŞ, 6 haneye yuvarlanmış. */
  rate: Prisma.Decimal;
}

export interface ParsedTcmbBulletin {
  /** Bülten tarihi (kök elementteki `Tarih` attribute'u) — UTC gece yarısı. */
  bulletinDate: Date;
  rates: ParsedTcmbRate[];
  /** Hedeflenen ama XML'de ForexBuying'i bulunamayan para birimleri. */
  missing: TcmbCurrency[];
}

/**
 * TCMB today.xml ayrıştırıcısı — SAF fonksiyon (bekçi sabit XML ile test eder).
 *
 * Neden regex, neden XML parser değil: Allowed Packages listesi kapalı ve
 * listede XML parser yok. TCMB XML'i onlarca yıldır sabit ve düzenli bir
 * makine çıktısıdır (attribute sırası dahil): `<Currency ... CurrencyCode="X">`
 * blokları + düz `<Unit>/<ForexBuying>` alt elemanları. CDATA, namespace,
 * iç içe Currency yok — regex bu dar sözleşme için yeterli ve bağımlılıksız.
 *
 * ⚠️ `Unit` MUTLAKA okunur ve rate = ForexBuying / Unit olarak normalize
 * edilir. TCMB bazı para birimlerini 1'den büyük birimle yayınlar (örn. JPY
 * Unit=100: "100 JPY = X TL"). Unit atlanırsa o birimlerde kur 100 KAT şişer —
 * hata yok, log yok, yalnız 100 kat yanlış fatura. RUB için de Unit
 * VARSAYILMAZ, XML'den okunur (TCMB geçmişte birim değiştirmiştir).
 */
export function parseTcmbXml(xml: string): ParsedTcmbBulletin {
  const dateMatch = /<Tarih_Date\b[^>]*\bTarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!dateMatch) {
    throw new AppError("TCMB kur verisi ayrıştırılamadı: bülten tarihi (Tarih attribute) bulunamadı.", 502);
  }
  const [, dd, mm, yyyy] = dateMatch;
  // rateDate @db.Date sözleşmesi: takvim günü anahtarı UTC gece yarısı yazılır
  // (factoryDayKeyUtcMidnight emsali) — yerel gece yarısı 1 gün geri etiketlerdi.
  const bulletinDate = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (Number.isNaN(bulletinDate.getTime())) {
    throw new AppError(`TCMB bülten tarihi geçersiz: ${dd}.${mm}.${yyyy}`, 502);
  }

  const wanted = new Set<string>(TCMB_TARGET_CURRENCIES);
  const found = new Map<TcmbCurrency, Prisma.Decimal>();

  const blockRe = /<Currency\b[^>]*\bCurrencyCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g;
  for (let m = blockRe.exec(xml); m !== null; m = blockRe.exec(xml)) {
    const code = m[1] as string;
    if (!wanted.has(code)) continue;
    const body = m[2] as string;
    const unitMatch = /<Unit>\s*(\d+)\s*<\/Unit>/.exec(body);
    const buyMatch = /<ForexBuying>\s*([\d.]+)\s*<\/ForexBuying>/.exec(body);
    if (!unitMatch || !buyMatch) continue; // boş ForexBuying → missing listesine düşer
    const unit = Number(unitMatch[1]);
    if (!Number.isFinite(unit) || unit <= 0) continue;
    // Bölme Decimal ile — float aritmetiği yasak; kolon Decimal(18,6).
    const rate = new Prisma.Decimal(buyMatch[1] as string)
      .div(unit)
      .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
    if (rate.lte(0)) continue;
    found.set(code as TcmbCurrency, rate);
  }

  const rates: ParsedTcmbRate[] = [];
  const missing: TcmbCurrency[] = [];
  for (const c of TCMB_TARGET_CURRENCIES) {
    const r = found.get(c);
    if (r) rates.push({ currency: c, rate: r });
    else missing.push(c);
  }
  if (rates.length === 0) {
    throw new AppError("TCMB kur verisi ayrıştırılamadı: hedef para birimlerinin hiçbiri bulunamadı.", 502);
  }
  return { bulletinDate, rates, missing };
}

export interface TcmbFetchSummary {
  /** Bülten tarihi (YYYY-MM-DD) — fetch günü DEĞİL. */
  fetched: string;
  /** Yeni yazılan ya da güncellenen TCMB satırları. */
  written: Array<{ currency: Currency; rate: string }>;
  /** MANUAL satırı olduğu için DOKUNULMAYANLAR (operatörün kuru geçerli kaldı). */
  skippedManual: Array<{ currency: Currency; rate: string }>;
  /** TCMB satırı zaten aynı değeri taşıyordu — yazım yapılmadı. */
  unchanged: Array<{ currency: Currency; rate: string }>;
  /** XML'de bulunamayan hedef para birimleri. */
  missing: Currency[];
}

/** `@db.Date` kolonundan dönen Date → "YYYY-MM-DD" (UTC parçası). */
function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Ayrıştırılmış bülteni DB'ye uygular — bekçinin sentetik bültenle test
 * ettiği yazma kuralı BURADADIR: MANUAL kazanır · yoksa TCMB yaz · TCMB varsa
 * güncelle. Tek tek upsert yerine önce mevcutlar okunur (4 satır, perf
 * önemsiz; upsert MANUAL satırın üstüne yazardı).
 */
export async function writeTcmbRates(parsed: ParsedTcmbBulletin, userId?: string): Promise<TcmbFetchSummary> {
  const summary: TcmbFetchSummary = {
    fetched: ymdUtc(parsed.bulletinDate),
    written: [],
    skippedManual: [],
    unchanged: [],
    missing: [...parsed.missing],
  };

  const existing = await prisma.exchangeRate.findMany({
    where: { rateDate: parsed.bulletinDate, currency: { in: [...TCMB_TARGET_CURRENCIES] } },
    select: { id: true, currency: true, rate: true, source: true },
  });
  const byCurrency = new Map(existing.map((r) => [r.currency, r]));

  for (const { currency, rate } of parsed.rates) {
    const row = byCurrency.get(currency);

    // MANUAL KAZANIR: operatör o gün için kuru bilinçli elle yazdı — üstüne
    // yazmak, elle düzeltmeyi her saat başı sessizce geri almak olurdu.
    if (row && row.source === "MANUAL") {
      summary.skippedManual.push({ currency, rate: String(row.rate) });
      continue;
    }

    if (row) {
      // source === TCMB → bülten revize edilmiş olabilir; farklıysa güncelle.
      if (new Prisma.Decimal(row.rate).equals(rate)) {
        summary.unchanged.push({ currency, rate: rate.toString() });
        continue;
      }
      await prisma.exchangeRate.update({ where: { id: row.id }, data: { rate } });
      summary.written.push({ currency, rate: rate.toString() });
      // Audit best-effort, tx dışı (kök CLAUDE.md kuralı; log kendi hatasını yutar).
      void AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "EXCHANGE_RATE",
        recordId: row.id,
        oldData: { rate: String(row.rate), source: row.source },
        newData: { rate: rate.toString(), source: "TCMB", rateDate: summary.fetched },
      });
      continue;
    }

    try {
      const created = await prisma.exchangeRate.create({
        data: {
          rateDate: parsed.bulletinDate,
          currency,
          rate,
          source: "TCMB",
          createdById: userId ?? null,
        },
        select: { id: true },
      });
      summary.written.push({ currency, rate: rate.toString() });
      void AuditService.log({
        userId,
        action: "CREATE",
        tableName: "EXCHANGE_RATE",
        recordId: created.id,
        newData: { rate: rate.toString(), source: "TCMB", currency, rateDate: summary.fetched },
      });
    } catch (e) {
      // Yarış: findMany ile create arasında operatör aynı (gün, birim) için elle
      // kur girmiş olabilir (@@unique[rateDate,currency] → P2002). MANUAL kazanır
      // kuralının yarış hali: mevcut satır okunur ve ona göre karar verilir.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await prisma.exchangeRate.findUnique({
          where: { rateDate_currency: { rateDate: parsed.bulletinDate, currency } },
          select: { id: true, rate: true, source: true },
        });
        if (again && again.source === "MANUAL") {
          summary.skippedManual.push({ currency, rate: String(again.rate) });
          continue;
        }
        if (again) {
          await prisma.exchangeRate.update({ where: { id: again.id }, data: { rate } });
          summary.written.push({ currency, rate: rate.toString() });
          continue;
        }
      }
      throw e;
    }
  }

  return summary;
}

/**
 * TCMB today.xml'i çeker, ayrıştırır, DB'ye uygular.
 *
 * Hata durumunda AppError(502) fırlatır — endpoint çağıranı için anlamlı
 * mesaj; zamanlayıcı çağıranı yakalayıp console.error ile geçer.
 */
export async function fetchTcmbRates(userId?: string): Promise<TcmbFetchSummary> {
  let xml: string;
  try {
    const res = await fetch(TCMB_TODAY_XML_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      throw new AppError(`TCMB kur servisi hata döndü (HTTP ${res.status}). Daha sonra tekrar deneyin.`, 502);
    }
    xml = await res.text();
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Ağ hatası / timeout — üretim ortamında beklenen durum (internet kesintisi).
    throw new AppError(
      "TCMB kur servisine ulaşılamadı (internet bağlantısını kontrol edin). Kur gerekiyorsa elle girebilirsiniz.",
      502,
      true,
      { cause: e instanceof Error ? e.message : String(e) },
    );
  }
  return writeTcmbRates(parseTcmbXml(xml), userId);
}

// -----------------------------------------------------------------------------
// ZAMANLAYICI
// -----------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // saatte bir kontrol
const STARTUP_DELAY_MS = 60 * 1000; // server start'tan sonra ilk kontrole kadar

let timer: NodeJS.Timeout | null = null;
let running = false;

export type ExchangeRateJobOutcome = "disabled" | "already" | "fetched" | "failed";

/**
 * Tek koşum — zamanlayıcı ve bekçi aynı fonksiyonu çağırır.
 *
 * @param fetchImpl Test enjeksiyonu: bekçi, bayrak kapalıyken HTTP'nin HİÇ
 *                  denenmediğini sahte fetch sayacıyla kanıtlar. Üretimde
 *                  daima `fetchTcmbRates`.
 */
export async function runExchangeRateJobOnce(
  fetchImpl: () => Promise<TcmbFetchSummary> = () => fetchTcmbRates(),
): Promise<ExchangeRateJobOutcome> {
  // ⚠️ FABRİKA SIFIR-FARK (load-bearing): bayrak kapalıyken dış HTTP denemesi
  // BİLE atılmaz — internetsiz fabrikada her saat 10 sn timeout + log gürültüsü
  // olurdu. Bu kontrol her koşumda taze okunur (bayrak panelden açılınca restart
  // gerekmeden bir sonraki saatte devreye girer).
  if (!(await readFinanceEnabled())) return "disabled";

  // Bugünün (fabrika günü) bülteni zaten DB'deyse HTTP isteği atma.
  const todayKey = factoryDayKeyUtcMidnight();
  const hasToday = await prisma.exchangeRate.findFirst({
    where: { source: "TCMB", rateDate: todayKey },
    select: { id: true },
  });
  if (hasToday) return "already";

  try {
    const summary = await fetchImpl();
    if (summary.written.length > 0) {
      bilgi("exchange-rate", `TCMB ${summary.fetched} bülteni: ${summary.written
          .map((w) => `${w.currency}=${w.rate}`)
          .join(", ")} yazıldı` +
          (summary.skippedManual.length > 0
            ? ` (elle girilmiş ${summary.skippedManual.map((s) => s.currency).join(", ")} korundu)`
            : ""),
      );
    }
    return "fetched";
  } catch (err) {
    // Başarısız fetch üretimi DURDURMAZ; bir sonraki saat tekrar denenir.
    // SystemLog'a yazılmaz (bilinçli — reportJobFailure değil): dış ağ hatası
    // beklenen durumdur ve resolveExchangeRateTx "kur yoksa 400 + elle gir" der.
    hata("exchange-rate", "TCMB kur çekme başarısız (bir sonraki saatte tekrar denenecek):", err);
    return "failed";
  }
}

export function startExchangeRateScheduler(): void {
  if (timer) return;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runExchangeRateJobOnce().finally(() => {
      running = false;
    });
  };
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("exchange-rate", "scheduler aktif — finance.enabled açıkken saatte bir TCMB kuru kontrol edilecek");
}
