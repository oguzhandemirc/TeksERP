// =============================================================================
// BEKÇİ — TCMB KUR ÇEKME: ayrıştırıcı + yazma kuralı + bayrak no-op
// =============================================================================
// Çalıştırma: npx tsx scripts/test_exchange_rate_fetch.ts
//
// ⚠️ CANLI HTTP'YE BAĞIMLI DEĞİL (CLAUDE.md: ortama bağımlı test yasak):
// ayrıştırıcı SABİT örnek XML string'iyle, yazma kuralı sentetik bültenle
// (geçmiş bir tarihe, 1990-01-02) test edilir. TCMB'ye tek istek atılmaz.
//
// ÖLÇÜLENLER:
//   §1 parseTcmbXml — bülten tarihi Tarih attribute'undan (fetch günü değil),
//      UTC gece yarısı; ForexBuying okunur; ⚠️ Unit NORMALİZASYONU (Unit=100
//      satırda rate 100'e bölünmeli — atlanırsa kur 100 kat şişer, hata/log
//      çıkmaz); hedef dışı para birimi yok sayılır; boş ForexBuying → missing;
//      bozuk XML → anlamlı hata.
//   §2 writeTcmbRates — boş güne TCMB yazar · MANUAL satıra DOKUNMAZ
//      (skippedManual) · mevcut TCMB satırını günceller · aynı değer →
//      unchanged (yazım yok).
//   §3 runExchangeRateJobOnce — finance.enabled KAPALIYKEN tam no-op: sahte
//      fetch sayacı 0 kalmalı (dış HTTP denemesi bile yok). Körlük zemini:
//      bayrak AÇIKKEN iş kapıdan geçer ("fetched" ya da bugünün satırı varsa
//      "already").
//
// Negatif sonda (elle, bir kez koşuldu ve kırmızı verdiği doğrulandı):
// exchange-rate.job.ts'te `.div(unit)` kaldırılınca §1 Unit kontrolleri düşer.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  parseTcmbXml,
  writeTcmbRates,
  runExchangeRateJobOnce,
  type TcmbFetchSummary,
} from "../src/jobs/exchange-rate.job";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Sabit örnek — gerçek today.xml yapısının birebir kopyası (attribute sırası
// dahil). RUB kasıtlı olarak Unit=100 ile yazıldı: hedef bir para biriminde
// normalizasyonu ölçmek için (TCMB geçmişte birim değiştirmiştir; varsayılamaz).
// JPY hedef dışıdır ve yok sayılmalı; GBP'nin ForexBuying'i boş → missing.
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="isokur.xsl"?>
<Tarih_Date Tarih="02.01.1990" Date="01/02/1990" Bulten_No="1990/1">
	<Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
		<Unit>1</Unit>
		<Isim>ABD DOLARI</Isim>
		<CurrencyName>US DOLLAR</CurrencyName>
		<ForexBuying>32.8547</ForexBuying>
		<ForexSelling>32.9139</ForexSelling>
		<BanknoteBuying>32.8317</BanknoteBuying>
		<BanknoteSelling>32.9633</BanknoteSelling>
		<CrossRateUSD/>
		<CrossRateOther/>
	</Currency>
	<Currency CrossOrder="9" Kod="EU" CurrencyCode="EUR">
		<Unit>1</Unit>
		<Isim>EURO</Isim>
		<CurrencyName>EURO</CurrencyName>
		<ForexBuying>35.6421</ForexBuying>
		<ForexSelling>35.7063</ForexSelling>
		<BanknoteBuying>35.6172</BanknoteBuying>
		<BanknoteSelling>35.7599</BanknoteSelling>
		<CrossRateUSD/>
		<CrossRateOther>1.0848</CrossRateOther>
	</Currency>
	<Currency CrossOrder="4" Kod="GB" CurrencyCode="GBP">
		<Unit>1</Unit>
		<Isim>İNGİLİZ STERLİNİ</Isim>
		<CurrencyName>POUND STERLING</CurrencyName>
		<ForexBuying></ForexBuying>
		<ForexSelling></ForexSelling>
		<CrossRateUSD/>
		<CrossRateOther/>
	</Currency>
	<Currency CrossOrder="15" Kod="JP" CurrencyCode="JPY">
		<Unit>100</Unit>
		<Isim>JAPON YENİ</Isim>
		<CurrencyName>JAPENESE YEN</CurrencyName>
		<ForexBuying>21.4567</ForexBuying>
		<ForexSelling>21.5989</ForexSelling>
		<CrossRateUSD>153.12</CrossRateUSD>
		<CrossRateOther/>
	</Currency>
	<Currency CrossOrder="16" Kod="RU" CurrencyCode="RUB">
		<Unit>100</Unit>
		<Isim>RUS RUBLESİ</Isim>
		<CurrencyName>RUSSIAN ROUBLE</CurrencyName>
		<ForexBuying>36.5200</ForexBuying>
		<ForexSelling>36.9800</ForexSelling>
		<CrossRateUSD/>
		<CrossRateOther/>
	</Currency>
</Tarih_Date>`;

// 1990-01-02 — canlı/dev veriyle çakışması imkânsız sentetik gün.
const PROBE_DATE = new Date(Date.UTC(1990, 0, 2));

// Bayrak doğrudan SystemSetting satırıyla yazılır: `setFeatureFlags` userId
// ister (401), test kullanıcısı yaratmaya değmez; `readFinanceEnabled` DB'yi
// cache'siz okuduğu için doğrudan yazım işi birebir görür. Orijinal durum
// SATIR DÜZEYİNDE geri konur (satır yoktu ise silinir — bayrağı bulduğu gibi bırak).
const FLAG_KEY = "finance.enabled";
let originalFlagValue: unknown = undefined; // undefined = satır yoktu
let flagTouched = false;

async function setFlag(value: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: FLAG_KEY },
    create: { key: FLAG_KEY, value, description: "Ön muhasebe modülü (bekçi geçici yazımı)" },
    update: { value },
  });
}

async function main(): Promise<void> {
  console.log("=== TCMB kur çekme bekçisi ===\n");

  // ── §1 AYRIŞTIRICI ───────────────────────────────────────────────────────
  const parsed = parseTcmbXml(SAMPLE_XML);

  check(
    "§1a Bülten tarihi Tarih attribute'undan, UTC gece yarısı",
    parsed.bulletinDate.getTime() === PROBE_DATE.getTime(),
    parsed.bulletinDate.toISOString(),
  );
  const usd = parsed.rates.find((r) => r.currency === "USD");
  check("§1b USD ForexBuying okundu (Unit=1 → bölme kimlik)", usd?.rate.equals("32.8547") === true, String(usd?.rate));
  const eur = parsed.rates.find((r) => r.currency === "EUR");
  check("§1c EUR okundu", eur?.rate.equals("35.6421") === true, String(eur?.rate));
  const rub = parsed.rates.find((r) => r.currency === "RUB");
  check(
    "§1d ⚠️ Unit NORMALİZASYONU: RUB Unit=100 → rate = 36.52/100",
    rub?.rate.equals("0.3652") === true,
    `beklenen 0.3652, gelen ${String(rub?.rate)}`,
  );
  check(
    "§1e Hedef dışı para birimi (JPY) yok sayıldı",
    !parsed.rates.some((r) => (r.currency as string) === "JPY"),
  );
  check("§1f Boş ForexBuying → missing (GBP)", parsed.missing.includes("GBP"), parsed.missing.join(","));
  check(
    "§1g missing'e düşen kur rates'e girmedi",
    !parsed.rates.some((r) => r.currency === "GBP"),
  );
  let threw = false;
  try {
    parseTcmbXml("<html>bakim sayfasi</html>");
  } catch {
    threw = true;
  }
  check("§1h Bozuk XML anlamlı hata fırlatır (sessiz boş dönmez)", threw);

  // ── §2 YAZMA KURALI ──────────────────────────────────────────────────────
  // Sentetik bülten: USD + EUR. Gün 1990-01-02 → gerçek veriye değmez.
  await prisma.exchangeRate.deleteMany({ where: { rateDate: PROBE_DATE } });

  const bulletin = (usdRate: string, eurRate: string) => ({
    bulletinDate: PROBE_DATE,
    rates: [
      { currency: "USD" as const, rate: new Prisma.Decimal(usdRate) },
      { currency: "EUR" as const, rate: new Prisma.Decimal(eurRate) },
    ],
    missing: [],
  });

  // 2a — boş güne yaz: ikisi de TCMB olarak doğar.
  const w1 = await writeTcmbRates(bulletin("30.000000", "35.000000"));
  check(
    "§2a Boş güne iki kur TCMB olarak yazıldı",
    w1.written.length === 2 && w1.skippedManual.length === 0 && w1.unchanged.length === 0,
    JSON.stringify(w1.written),
  );
  const rows1 = await prisma.exchangeRate.findMany({
    where: { rateDate: PROBE_DATE },
    select: { currency: true, rate: true, source: true },
  });
  check(
    "§2b DB'de iki satır, source=TCMB",
    rows1.length === 2 && rows1.every((r) => r.source === "TCMB"),
    rows1.map((r) => `${r.currency}=${r.rate}(${r.source})`).join(", "),
  );

  // 2c — USD satırını operatör eline geçir (MANUAL, farklı değer).
  await prisma.exchangeRate.update({
    where: { rateDate_currency: { rateDate: PROBE_DATE, currency: "USD" } },
    data: { source: "MANUAL", rate: new Prisma.Decimal("31.500000") },
  });
  const w2 = await writeTcmbRates(bulletin("32.000000", "35.000000"));
  const usdAfter = await prisma.exchangeRate.findUnique({
    where: { rateDate_currency: { rateDate: PROBE_DATE, currency: "USD" } },
    select: { rate: true, source: true },
  });
  check(
    "§2c ⚠️ MANUAL KAZANIR: elle girilen USD satırına dokunulmadı",
    usdAfter?.source === "MANUAL" && new Prisma.Decimal(usdAfter.rate).equals("31.5"),
    `source=${usdAfter?.source} rate=${String(usdAfter?.rate)}`,
  );
  check(
    "§2d MANUAL atlanan kur özette skippedManual olarak raporlandı",
    w2.skippedManual.length === 1 && w2.skippedManual[0]?.currency === "USD",
    JSON.stringify(w2.skippedManual),
  );
  check(
    "§2e Aynı değeri taşıyan TCMB satırı unchanged (yazım yok)",
    w2.unchanged.length === 1 && w2.unchanged[0]?.currency === "EUR" && w2.written.length === 0,
    JSON.stringify({ unchanged: w2.unchanged, written: w2.written }),
  );

  // 2f — TCMB satırı revize bültenle güncellenir.
  const w3 = await writeTcmbRates(bulletin("32.000000", "36.250000"));
  const eurAfter = await prisma.exchangeRate.findUnique({
    where: { rateDate_currency: { rateDate: PROBE_DATE, currency: "EUR" } },
    select: { rate: true, source: true },
  });
  check(
    "§2f TCMB satırı güncellendi (bülten revizyonu)",
    eurAfter?.source === "TCMB" &&
      new Prisma.Decimal(eurAfter.rate).equals("36.25") &&
      w3.written.some((w) => w.currency === "EUR"),
    `rate=${String(eurAfter?.rate)} written=${JSON.stringify(w3.written)}`,
  );

  // ── §3 BAYRAK KAPALIYKEN TAM NO-OP ───────────────────────────────────────
  const flagRow = await prisma.systemSetting.findUnique({ where: { key: FLAG_KEY }, select: { value: true } });
  originalFlagValue = flagRow ? flagRow.value : undefined;
  flagTouched = true;

  let fetchCalls = 0;
  const spyFetch = (): Promise<TcmbFetchSummary> => {
    fetchCalls++;
    return Promise.resolve({
      fetched: "1990-01-02",
      written: [],
      skippedManual: [],
      unchanged: [],
      missing: [],
    });
  };

  await setFlag(false);
  const offOutcome = await runExchangeRateJobOnce(spyFetch);
  check("§3a Bayrak KAPALI → iş 'disabled' döner", offOutcome === "disabled", offOutcome);
  check(
    "§3b ⚠️ Bayrak KAPALIYKEN fetch HİÇ çağrılmadı (dış HTTP denemesi bile yok)",
    fetchCalls === 0,
    `çağrı=${fetchCalls}`,
  );

  // Körlük zemini: bayrak AÇIKKEN iş kapıdan geçmeli. Bugünün TCMB satırı
  // ortamda var olabilir (bekçi gerçek veriye satır YAZMAZ) → iki meşru sonuç:
  //   - satır yok  → sahte fetch 1 kez çağrılır, "fetched"
  //   - satır var  → HTTP atlanır, "already" (kapıdan geçtiğini DB okuması kanıtlar)
  await setFlag(true);
  const todayRow = await prisma.exchangeRate.findFirst({
    where: { source: "TCMB", rateDate: factoryDayKeyUtcMidnight() },
    select: { id: true },
  });
  const onOutcome = await runExchangeRateJobOnce(spyFetch);
  if (todayRow) {
    check(
      "§3c KÖRLÜK ZEMİNİ: bayrak AÇIK + bugünün satırı var → 'already', HTTP atlanır",
      onOutcome === "already" && fetchCalls === 0,
      `outcome=${onOutcome} çağrı=${fetchCalls}`,
    );
  } else {
    check(
      "§3c KÖRLÜK ZEMİNİ: bayrak AÇIK + bugünün satırı yok → sahte fetch 1 kez çağrıldı",
      onOutcome === "fetched" && fetchCalls === 1,
      `outcome=${onOutcome} çağrı=${fetchCalls}`,
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      // ⚠️ Bayrağı BULDUĞU GİBİ bırak (test_finance_flag_off dersi) — satır
      // yoktu ise satırı SİL (yalnız değeri değil, varlığı da geri konur).
      if (flagTouched) {
        if (originalFlagValue === undefined) {
          await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEY } });
        } else {
          await prisma.systemSetting.update({
            where: { key: FLAG_KEY },
            data: { value: originalFlagValue as Prisma.InputJsonValue },
          });
        }
      }
    } catch {
      /* geri yazılamadıysa da testi düşürme */
    }
    try {
      await prisma.exchangeRate.deleteMany({ where: { rateDate: PROBE_DATE } });
    } catch {
      /* cleanup hatası sonucu değiştirmesin */
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
