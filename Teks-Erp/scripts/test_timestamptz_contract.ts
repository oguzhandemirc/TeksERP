// =============================================================================
// TIMESTAMPTZ SÖZLEŞMESİ — "tarih kolonu MUTLAK AN saklar" garantisinin bekçisi
//
// NEDEN VAR (2026-08-01)
// ---------------------
// O gece `roll_movements."exitedAt"` kolonunda gerçek bir bozulma yaşandı: ham SQL
// çıplak `NOW()` (yerel saat, Europe/Istanbul) yazarken Prisma AYNI kolona UTC
// yazıyordu → tek kolonda iki saat, istasyon sürelerinde +10800 sn sessiz şişme.
// 13 nokta düzeltildi ve `test_raw_sql_hygiene.ts` eklendi — ama o bir DİSİPLİN
// çözümüydü. `20260801040000_timestamptz_conversion` ile 183 kolon `timestamptz`
// oldu ve hata sınıfı YAPISAL olarak kapandı: timestamptz mutlak anı saklar, kim
// yazarsa yazsın (Prisma / now() / CURRENT_TIMESTAMP / kolon DEFAULT'u) sonuç aynı.
//
// Bu dosya o yapısal garantiyi DÖRT AYRI cepheden kilitler. Dördü de gerekli;
// biri düşerse garanti sessizce buhar olur:
//
//   1) DB tarafı  — `public` şemasında `timestamp without time zone` kolon KALMAMALI.
//      Yeni bir migration (ya da `migrate dev`'in ürettiği bir ALTER) tz'siz kolon
//      doğurursa burada yakalanır.
//
//   2) Şema tarafı — `schema.prisma`'daki her `DateTime` alanı `@db.Timestamptz`
//      taşımalı. Taşımazsa `migrate dev` bir sonraki diff'te kolonu tz'sizE GERİ
//      ÇEVİRMEK ister; kimse fark etmeden 1. maddeyi bozar.
//
//   3) ⚠️ SÜRÜCÜ tarafı — oturumun saat dilimi UTC OLMALI. Bu, sezgiye EN AYKIRI
//      madde ve keşfi bu dönüşümün en pahalı bulgusu oldu:
//
//        `@prisma/adapter-pg`, timestamptz okurken PostgreSQL'in döndürdüğü metnin
//        OFFSET'İNİ ATAR ve yerine körlemesine "+00:00" yazar
//        (dist/index.js → normalize_timestamptz:
//           time.replace(" ","T").replace(/[+-]\d{2}(:\d{2})?$/, "+00:00"))
//
//      Yani adapter oturumun UTC olduğunu VARSAYAR. Europe/Istanbul oturumunda PG
//      "2026-07-30 15:20:08.255+03" döndürür, adapter bunu
//      "2026-07-30T15:20:08.255+00:00" yapar → okunan HER tarih +3 saat kayar.
//      Ölçüldü: düz `pg` 12:20:08Z okurken Prisma ORM 15:20:08Z veriyordu.
//      Çözüm havuzda: `new Pool({ options: "-c timezone=UTC" })` (src/lib/prisma.ts).
//      O satır SÜS DEĞİL, LOAD-BEARING — silinirse tüm tarihler sessizce kayar ve
//      hiçbir hata/log çıkmaz. Bu testin 3. bölümü tam olarak onu bekler.
//
//   4) BİLEŞİK sonuç — sürücü turu. Bilinen bir anı YAZMA ve OKUMA yönlerinde
//      PG'ye gönderip geri alır; epoch birebir korunmalı. Adapter'ın hatası
//      simetrik DEĞİLDİR (yazma −3 saat, okuma +3 saat: iki ayrı mekanizma), bu
//      yüzden iki yön de ölçülür. Bölüm KASITLI olarak ortam verisinden
//      bağımsızdır (bind parametresi + literal; tablo yok) → BOŞ bir CI
//      veritabanında da tam olarak koşar. Gerçek satır üzerindeki mutabakat
//      4b'ye bonus olarak alındı: veri yoksa yalnız O atlanır, güvence atlanmaz.
//
// Salt-okunur: hiçbir veri yazmaz/değiştirmez. Üretim DB'sine karşı güvenle koşar.
// Koşum: npx tsx scripts/test_timestamptz_contract.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
// Tarama derinliği bekçinin kapsamını belirler; tek kaynak (bkz. lib/ts-tarama.ts).
import { walkTs } from "./lib/ts-tarama";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

// `endpoint_latency_daily.day` bilinçli olarak `date` tipidir (saat taşımayan
// takvim günü — günlük gecikme rollup'ının anahtarı). timestamptz'ye ÇEVİRME:
// gün sınırı saat dilimine bağlı hale gelir ve rollup anahtarı kayar.
const DATE_ONLY_FIELDS = new Set([
  "EndpointLatencyDaily.day",
  // Kur bir TAKVİM GÜNÜ anahtarıdır, an değil: timestamptz olsaydı gün sınırı
  // saat dilimine bağlanır ve "13 Ağustos kuru" iki satıra düşebilirdi.
  "ExchangeRate.rateDate",
  // Dönem kapanışının bitiş günü de bir TAKVİM GÜNÜ anahtarıdır ("2025 Aralık
  // kapanışı"), an değil — üstelik `cari_period_close_active_uq` partial
  // unique'inin PARÇASI. Timestamptz olsaydı aynı kapanış, saat dilimine göre
  // iki farklı anahtara düşüp benzersizlik seddini sessizce delerdi
  // (`ExchangeRate.rateDate` ile birebir aynı gerekçe).
  "CariPeriodClose.periodEnd",
  // Kasa/banka kapanışı — CariPeriodClose'un hesap-bazlı ikizi, aynı gerekçe:
  // takvim günü anahtarı + partial unique'lerin parçası.
  "CashPeriodClose.periodEnd",
  // Duruşun FABRİKA GÜNÜ (2026-09-13, dokuma P2b-1) — raporun group-by ekseni ve
  // doğuşta DONDURULUR. Takvim günü anahtarıdır, an değil: gece vardiyası
  // BAŞLADIĞI güne yazılır ve o atıf `constants/time.ts`ten (Europe/Istanbul)
  // türer. Timestamptz olsaydı aynı vardiya, sunucunun saat dilimine göre iki
  // farklı güne düşerdi — `ExchangeRate.rateDate` ile birebir aynı gerekçe.
  // ⚠️ Duruşun MUTLAK anı ayrı kolonlarda (`startedAt`/`endedAt`) ve ikisi de
  // timestamptz; bu alan onların yerine geçmez, yanlarında durur.
  "MachineStopEvent.factoryDay",
  // Karnenin FABRİKA GÜNÜ (2026-09-14, dokuma raporları Dilim 1) — `ShiftInstance.factoryDayKey`ten
  // KOPYA, DONAR; rapor ekseni. `MachineStopEvent.factoryDay` ile aynı gerekçe ve aynı yazım
  // (`factoryDayKeyUtcMidnight`, UTC gece yarısı).
  "MachineShiftStat.factoryDay",
]);

// Prisma'nın kendi defteri — bizim şemamız değil, zaten timestamptz.
const PRISMA_OWN_TABLE = "_prisma_migrations";

/**
 * `pg` havuzu kuran ama UTC oturumu GEREKMEYEN dosyalar — GEREKÇELİ muaflar.
 * Her koşumda basılır (gizli muaf = sessiz delik) ve bayatlığa karşı denetlenir:
 * dosya artık havuz kurmuyorsa muaf kendiliğinden düşmez, bu yüzden test düşürür.
 */
const POOL_EXEMPT: Record<string, string> = {
  "scripts/test_pool_health.ts":
    "havuz TÜKENMESİNİ ölçer (max:1/max:2 + kasıtlı 1ms connect timeout); tarih okumaz",
  "scripts/test_script_guards.ts":
    "havuz KURMAZ — `new Pool(` metnini SABİT olarak taşır (§10 kendi hedefini kuran betiği arar)",
};

async function main(): Promise<void> {
  console.log("\n=== timestamptz sözleşmesi ===\n");

  // ── 1) DB tarafı: tz'siz kolon kalmamalı ───────────────────────────────────
  console.log("── 1) DB: `timestamp without time zone` kolon avı ──");
  const naive = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type = 'timestamp without time zone'
       AND table_name <> '${PRISMA_OWN_TABLE}'
     ORDER BY table_name, column_name
  `);
  check(
    "saat dilimi taşımayan tarih kolonu YOK",
    naive.length === 0,
    naive.length === 0
      ? "tüm tarih kolonları timestamptz"
      : `${naive.length} kolon tz'siz: ${naive.slice(0, 8).map((r) => `${r.table_name}.${r.column_name}`).join(", ")}${naive.length > 8 ? " …" : ""}`,
  );

  const tzCount = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*)::bigint AS n
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type = 'timestamp with time zone'
       AND table_name <> '${PRISMA_OWN_TABLE}'
  `);
  const tzN = Number(tzCount[0].n);
  check("timestamptz kolonlar sayılabildi", tzN > 150, `${tzN} kolon`);

  // ── 2) Şema tarafı: her DateTime alanı @db.Timestamptz ─────────────────────
  console.log("\n── 2) schema.prisma: her `DateTime` alanı `@db.Timestamptz` ──");
  const schemaPath = join(__dirname, "..", "prisma", "schema.prisma");
  const lines = readFileSync(schemaPath, "utf8").split("\n");
  let model: string | null = null;
  const missing: string[] = [];
  const exemptSeen = new Map<string, string>();
  let seen = 0;
  for (const line of lines) {
    const open = line.match(/^model\s+(\w+)\s*\{/);
    if (open) {
      model = open[1];
      continue;
    }
    if (model && /^\}/.test(line)) {
      model = null;
      continue;
    }
    if (!model) continue;
    const field = line.match(/^\s+(\w+)\s+DateTime\??(\s|$)/);
    if (!field) continue;
    const key = `${model}.${field[1]}`;
    if (DATE_ONLY_FIELDS.has(key)) {
      exemptSeen.set(key, line.trim());
      continue;
    }
    seen++;
    if (!/@db\.Timestamptz/.test(line)) missing.push(key);
  }
  check("schema.prisma ayrıştırıldı", seen > 150, `${seen} DateTime alanı tarandı`);
  check(
    "`@db.Timestamptz` taşımayan DateTime alanı YOK",
    missing.length === 0,
    missing.length === 0
      ? "tümü işaretli"
      : `${missing.length} alan eksik: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`,
  );
  // Muaflar HER KOŞUMDA basılır — görünmeyen muaf, sessiz deliktir.
  // Ayrıca BAYAT olmamalı: muaf edilen alan hâlâ var olmalı VE hâlâ `@db.Date`
  // taşımalı. Alan silinir ya da tipi değişirse muaf kendiliğinden düşmez;
  // düşmeyen muaf, gerçek bir tz'siz alanı sessizce taramanın dışında tutar.
  for (const key of DATE_ONLY_FIELDS) {
    console.log(`   muaf: ${key} — ${exemptSeen.get(key) ?? "‼️ ŞEMADA BULUNAMADI"}`);
  }
  const staleExempt = [...DATE_ONLY_FIELDS].filter(
    (key) => !/@db\.Date/.test(exemptSeen.get(key) ?? ""),
  );
  check(
    "bilinçli `@db.Date` muafları güncel (bayat muaf yok)",
    staleExempt.length === 0,
    staleExempt.length === 0
      ? `${DATE_ONLY_FIELDS.size} muaf doğrulandı — takvim günü, saat taşımaz`
      : `BAYAT: ${staleExempt.join(", ")} — alan şemada yok ya da artık @db.Date değil`,
  );

  // ── 3) Sürücü tarafı: oturum saat dilimi UTC ───────────────────────────────
  console.log("\n── 3) Havuz oturumu: TimeZone = UTC (adapter-pg varsayımı) ──");
  const tzRow = await prisma.$queryRawUnsafe<Record<string, string>[]>(`SHOW TimeZone`);
  const sessionTz = Object.values(tzRow[0])[0];
  check(
    "uygulama havuzunun oturum saat dilimi UTC",
    sessionTz === "UTC",
    sessionTz === "UTC"
      ? "src/lib/prisma.ts → options: '-c timezone=UTC'"
      : `TimeZone=${sessionTz} — adapter-pg offset'i ATIP '+00:00' yazdığı için TÜM tarih okumaları kayar! src/lib/prisma.ts havuz 'options' satırını geri koy`,
  );

  // `now()` ile `(now() AT TIME ZONE 'UTC')::timestamptz` UTC oturumda AYNI andır.
  // Bu, üretim kodundaki 13 `AT TIME ZONE 'UTC'` yazımının hâlâ doğru olduğunu
  // gösterir (kimlik dönüşümü). Oturum UTC değilse burası 3 saat sapar.
  const drift = await prisma.$queryRawUnsafe<{ d: number }[]>(`
    SELECT (EXTRACT(EPOCH FROM (now() AT TIME ZONE 'UTC')::timestamptz)
          - EXTRACT(EPOCH FROM now()))::float AS d
  `);
  check(
    "`now() AT TIME ZONE 'UTC'` → timestamptz kimlik dönüşümü (sapma 0)",
    Number(drift[0].d) === 0,
    `sapma ${Number(drift[0].d)} sn`,
  );

  // ── 3b) Kaynak taraması: `new Pool(` kuran her yer UTC'ye sabitlemeli ──────
  // Havuz ayarı TEK KAYNAK'tan (src/lib/pg-session.ts) gelir. Yeni bir havuz
  // (seed, bakım script'i, ikinci servis) onu ATLARSA sessizce 3 saat kayar.
  //
  // ⚠️ Dosya listesi ELLE TUTULMAZ, KEŞFEDİLİR. Elle liste bu bekçinin tam da var
  // olma sebebini kaçırır: korkulan olay "YENİ bir dosya havuz kuruyor" ve elle
  // listeye eklenmeyen yeni dosya sessizce denetim dışı kalır — yani bekçi tam
  // ihtiyaç duyulan anda kör olur. Bu yüzden ağaç taranır; muaflar GEREKÇELİDİR,
  // her koşumda basılır ve bayatlığa karşı denetlenir.
  console.log("\n── 3b) `new Pool(` kuran her yer PG_SESSION_OPTIONS geçiyor mu ──");
  const root = join(__dirname, "..");
  const scanned = ["src", "prisma", "scripts"].flatMap((d) => walkTs(join(root, d)));
  const bad: string[] = [];
  const poolSites: string[] = [];
  const usedExempt: string[] = [];
  for (const abs of scanned) {
    const src = readFileSync(abs, "utf8");
    if (!src.includes("new Pool(")) continue;
    const rel = relative(root, abs).replace(/\\/g, "/");
    if (rel === "scripts/test_timestamptz_contract.ts") continue; // bu dosyanın kendi açıklamaları
    if (POOL_EXEMPT[rel]) {
      usedExempt.push(rel);
      continue;
    }
    // `new Pool({ ... })` bloğunu kabaca yakala; içinde options geçmeli.
    const blocks = src.match(/new Pool\(\{[\s\S]*?\}\)/g) ?? [];
    if (blocks.length === 0) {
      // FAIL-CLOSED: "new Pool(" var ama blok ayrıştırılamadı → sessizce atlama.
      bad.push(`${rel} (havuz bloğu ayrıştırılamadı — elle bak)`);
      continue;
    }
    for (const b of blocks) {
      poolSites.push(rel);
      if (!/options:\s*PG_SESSION_OPTIONS/.test(b)) bad.push(rel);
    }
  }
  for (const rel of Object.keys(POOL_EXEMPT)) {
    console.log(
      `   muaf: ${rel} — ${POOL_EXEMPT[rel]}${usedExempt.includes(rel) ? "" : "  ‼️ BAYAT (artık havuz kurmuyor)"}`,
    );
  }
  check(
    "havuz muafları güncel (bayat muaf yok)",
    usedExempt.length === Object.keys(POOL_EXEMPT).length,
    `${usedExempt.length}/${Object.keys(POOL_EXEMPT).length} muaf gerçekten havuz kuruyor`,
  );
  // Körlük zemini: tarayıcı bozulur (yol değişir, walk boşa düşer) ise liste
  // boşalır ve "hepsi temiz" YALANI yeşil kalırdı. Bilinen taban: app havuzu + 4 seed.
  check(
    "havuz taraması boşa düşmedi",
    poolSites.length >= 5,
    `${poolSites.length} havuz kurulumu bulundu (${scanned.length} .ts tarandı)`,
  );
  check(
    "veri havuzlarının tamamı `options: PG_SESSION_OPTIONS` taşıyor",
    bad.length === 0,
    bad.length === 0
      ? `${new Set(poolSites).size} dosya denetlendi`
      : `EKSİK: ${[...new Set(bad)].join(", ")} — oturum Istanbul kalır, tarihler kayar`,
  );

  // ── 4) İKİ YÖNLÜ tur: sürücü katmanının hem YAZMA hem OKUMA sapması ────────
  // Bu bölüm 3. maddenin BİLEŞİK sonucunu ölçer ve KASITLI olarak ortam
  // verisinden bağımsızdır: hiçbir tabloya dokunmaz, fixture yaratmaz, TEMP
  // tablo bile açmaz (havuz sorguları farklı bağlantılara dağıtabilir → TEMP
  // tablo güvenilmez). Yalnız bind parametresi + literal ile PG'ye gidip döner,
  // dolayısıyla BOŞ bir CI veritabanında da tam olarak koşar.
  //
  // ⚠️ Neden İKİ yön: adapter'ın hatası simetrik DEĞİL, iki ayrı mekanizmadır.
  //    YAZMA — Prisma JS `Date`'i UTC duvar-saati metni olarak gönderir; oturum
  //            Istanbul ise PG onu YEREL sanıp UTC'ye çevirir → −3 saat.
  //    OKUMA — adapter PG'nin döndürdüğü metnin offset'ini ATIP "+00:00" yazar
  //            → +3 saat.
  //    Tek yön test edilseydi diğerini kaçırırdık.
  //
  // NEGATİF SINANDI (2026-08-01, varsayılmadı): `options` olmadan kurulan bir
  // havuzla ölçüldü → YAZMA −10800 sn, OKUMA +10800 sn. İkisi de aşağıdaki
  // eşiklerden düşer. Bu bekçiyi değiştirirsen aynı sınamayı TEKRARLA.
  console.log("\n── 4) Sürücü turu: YAZMA ve OKUMA yönlerinde epoch sapması ──");
  const bilinen = new Date("2026-03-15T12:34:56.789Z");
  const bilinenEpoch = bilinen.getTime() / 1000;

  // YAZMA yönü: JS Date bind parametresi olarak gider, PG epoch'a çevirir.
  const yaz = await prisma.$queryRaw<{ e: number }[]>(
    Prisma.sql`SELECT EXTRACT(EPOCH FROM ${bilinen}::timestamptz)::float AS e`,
  );
  const yazSapma = Number(yaz[0].e) - bilinenEpoch;
  check(
    "YAZMA yönü — JS Date → PG epoch birebir",
    yazSapma === 0,
    yazSapma === 0
      ? `${bilinen.toISOString()} korundu`
      : `SAPMA ${yazSapma} sn — oturum UTC değil, yazılan her tarih kayıyor`,
  );

  // OKUMA yönü: PG'nin ürettiği timestamptz adapter üzerinden JS Date'e döner.
  // Literal bilerek `+03` ofsetiyle yazıldı — adapter'ın "offset'i AT" hatası
  // tam burada yakalanır (aynı an, farklı ofset gösterimi).
  const oku = await prisma.$queryRaw<{ t: Date }[]>(
    Prisma.sql`SELECT TIMESTAMPTZ '2026-03-15 15:34:56.789+03' AS t`,
  );
  const okuSapma = oku[0].t.getTime() / 1000 - bilinenEpoch;
  check(
    "OKUMA yönü — PG timestamptz → JS Date birebir",
    okuSapma === 0,
    okuSapma === 0
      ? `${oku[0].t.toISOString()} (ofsetli literal doğru çözüldü)`
      : `SAPMA ${okuSapma} sn — adapter ofseti atıyor, okunan her tarih kayıyor`,
  );

  // ── 4b) BONUS: gerçek satır üzerinde mutabakat ─────────────────────────────
  // Yukarıdaki tur zorunlu güvenceyi verir; bu ek kontrol veri VARSA gerçek bir
  // kolonda da doğrular. Veri yoksa atlanır — ama artık atlanması bir DELİK
  // DEĞİL, çünkü asıl güvence 4. maddede ortamdan bağımsız olarak koştu.
  console.log("\n── 4b) Bonus: gerçek satırda ham SQL epoch ↔ ORM epoch ──");
  const sample = await prisma.rollMovement.findFirst({
    orderBy: { id: "asc" },
    select: { id: true, enteredAt: true },
  });
  if (!sample) {
    console.log("ℹ️  roll_movements boş — bonus kontrol atlandı (zorunlu güvence 4. maddede koştu)");
  } else {
    const rawRow = await prisma.$queryRawUnsafe<{ e: number }[]>(
      `SELECT EXTRACT(EPOCH FROM "enteredAt")::float AS e FROM roll_movements WHERE id = $1`,
      sample.id,
    );
    const delta = sample.enteredAt.getTime() / 1000 - Number(rawRow[0].e);
    check(
      "ORM okuması ham SQL epoch'u ile birebir",
      delta === 0,
      delta === 0
        ? `${sample.enteredAt.toISOString()}`
        : `SAPMA ${delta} sn — ORM ${sample.enteredAt.toISOString()} vs SQL epoch ${rawRow[0].e}`,
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("❌ beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
