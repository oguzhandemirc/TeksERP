// =============================================================================
// SAYACIN KAPSAMI — biçim değişince sıra eski rejimi SAYMAZ, çakışmaz (C0)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts number_series_scope   (DB GEREKİR)
//
// ⭐ NEDEN VAR: sayaç adayları `startsWith(sabit baş)` ile toplanır. Tarih
//    segmenti düşerse sabit baş kısalır (`CV220926` → `CV`) ve ESKİ rejimin
//    kodları sayaca girer — ölçüldü 2026-09-22 (`test_number_series §10b`,
//    üç kodlu sentetik küme): sıra 4 yerine 2.209.260.004. Arızanın
//    kendisi ve "matchesSeries ile ele" sahte çözümü `test_number_series §10`da
//    DB'siz kilitli; BU dosya DAVRANIŞI ölçer, çünkü `formatChangedAt` satırının
//    gerçekten yazılması gerekir.
//
//   §1 Kapsam damgası YOKKEN davranış bugünküyle BİREBİR (regresyon yok)
//   §2 ⭐ Biçim değişince sayaç eski rejimin kodlarını SAYMAZ (sıra 1'e döner)
//   §3 ⭐ Kapsam boşalınca üretilen kod VAR OLANLARIN üstünden ATLAR — aynı gün
//        biçim değiştirilip geri alınırsa `@unique` P2002 verir ve
//        `withBarcodeRetry` bunu DETERMİNİSTİK tekrarlayıp 409'la biter
//        (`shipping.service.ts:230` bu davranışı yazılı beyan ediyor)
//   §4 ⭐ `scopedCounter` BEYANI OLMAYAN seri düzenlenemez (konfigürasyon sınırı;
//        üretim yolu kapatılmaz — çuval açılamaz hâle gelirdi)
//   §5 `updateSeriesFormat` damgayı GERÇEKTEN yazar
//
// ⭐ NEGATİF SONDA ✓B3 (2026-09-22, ölçüldü): `nextSeriesNo`tan kapsam (`since`)
//    süzmesi kalkınca §2 ❌1 · çakışma atlama döngüsü kalkınca §3 ❌2 ·
//    `updateSeriesFormat`taki `scopedCounter` kapısı kalkınca §4 ❌1.
//    ⚠️ Üçüncü kol `order` serisine damga YAZAR (kapı kalktığı için güncelleme
//    geçer) — bu yüzden temizlik `order`ı da geri alır; sondanın kendi artığı
//    bir sonraki koşumu kirletmesin.
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  invalidateNumberSeriesCache,
  nextSeriesNo,
  refreshNumberSeriesCache,
  resolveSeriesFormat,
  updateSeriesFormat,
} from "../src/services/number-series.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** Create patlarsa bekçi ÇÖKMEZ, o iddia ❌ olur (çöken sonda, sonda değildir). */
async function dene<T>(fn: () => Promise<T>): Promise<T | Error> {
  try {
    return await fn();
  } catch (e) {
    return e as Error;
  }
}

const AT = new Date("2026-09-22T09:00:00.000Z");
const T08 = new Date("2026-09-22T08:00:00.000Z");
/** Eski rejimin kodları: CV + GGAAYY + NNNN, biçim değişiminden ÖNCE doğmuş. */
const ESKI = ["CV2209260001", "CV2209260002", "CV2209260003"].map((code) => ({ code, createdAt: T08 }));

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exit(1);
  }

  const onceki = await prisma.numberSeries.findUnique({ where: { key: "sack" } });
  if (!onceki) {
    console.log("❌ Fikstür eksik: `sack` serisi yok. Boot uzlaştırması koştu mu?");
    process.exit(1);
  }

  try {
    // ── §1 Damga YOKKEN bugünkü davranış ──────────────────────────────────
    await prisma.numberSeries.update({ where: { key: "sack" }, data: { formatChangedAt: null } });
    await refreshNumberSeriesCache();
    const damgasiz = await nextSeriesNo("sack", async () => ESKI, AT);
    check("§1 kapsam damgası YOKKEN eski kodlar sayılır (bugünkü davranış birebir)",
      damgasiz === "CV2209260004", damgasiz);

    // ── §2 Damga VARKEN eski rejim sayaca girmez ───────────────────────────
    // Damga eski kodlardan SONRA: kapsam boşalır, sıra 1'e döner.
    await prisma.numberSeries.update({
      where: { key: "sack" },
      data: { dateSegment: "NONE", formatChangedAt: new Date("2026-09-22T10:00:00.000Z") },
    });
    await refreshNumberSeriesCache();
    const tarihsiz = await nextSeriesNo("sack", async () => ESKI, AT);
    check("§2 ⭐ biçim değişince eski rejimin kodları SAYACA GİRMEZ",
      tarihsiz === "CV0001", `${tarihsiz} (damgasız hâli 2.209.260.004 olurdu)`);

    // ── §3 Geri alınca üretilen kod var olanla ÇAKIŞMAZ ────────────────────
    // Aynı gün DDMMYY'ye dönülürse kapsam yine boş → sıra 1 → "CV2209260001"
    // ZATEN VAR. Atlama döngüsü onu geçmeli.
    await prisma.numberSeries.update({
      where: { key: "sack" },
      data: { dateSegment: "DDMMYY", formatChangedAt: new Date("2026-09-22T11:00:00.000Z") },
    });
    await refreshNumberSeriesCache();
    const geriDonus = await nextSeriesNo("sack", async () => ESKI, AT);
    const carpisti = ESKI.some((e) => e.code === geriDonus);
    check("§3 ⭐ kapsam boşalsa da üretilen kod VAR OLANLA ÇAKIŞMAZ", !carpisti, geriDonus);
    check("§3 atlama en küçük BOŞ sırayı seçer (sessizce ileri atlamaz)",
      geriDonus === "CV2209260004", geriDonus);

    // ── §4 `scopedCounter` beyanı olmayan seri düzenlenemez ────────────────
    // `order` (SIP) bugün beyansız: çağrı yeri zengin biçime geçirilmedi.
    const reddedilmeli = await dene(() =>
      updateSeriesFormat("order", { prefix: "SIP", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    const kod = (e: unknown): string | undefined =>
      (e as { details?: { code?: string } } | null)?.details?.code;
    check("§4 ⭐ sayacı hazır OLMAYAN seri düzenlenemez",
      reddedilmeli instanceof Error && kod(reddedilmeli) === "NUMBER_SERIES_COUNTER_NOT_SCOPED",
      reddedilmeli instanceof Error ? (kod(reddedilmeli) ?? reddedilmeli.message) : "KABUL EDİLDİ");

    // ── §5 Beyanlı seri kabul edilir VE damgayı yazar ──────────────────────
    const kabulEdilmeli = await dene(() =>
      updateSeriesFormat("packingLotCode", { prefix: "PRT", dateSegment: "YYMM", digits: 4, separator: "-" }),
    );
    check("§5 sayacı hazır seri KABUL edilir (kapı her şeyi reddetmiyor)",
      !(kabulEdilmeli instanceof Error),
      kabulEdilmeli instanceof Error ? kabulEdilmeli.message : "kabul");
    const lot = await prisma.numberSeries.findUnique({ where: { key: "packingLotCode" } });
    check("§5 ⭐ `updateSeriesFormat` kapsam damgasını GERÇEKTEN yazar",
      lot?.formatChangedAt instanceof Date, String(lot?.formatChangedAt));
    check("§5 damga biçimle birlikte okunuyor (servis tarafı)",
      resolveSeriesFormat("packingLotCode").formatChangedAt instanceof Date);

    check("§1 körlük zemini: seri satırı gerçekten okundu", onceki.key === "sack");
  } finally {
    // Seriyi BİREBİR geri yükle — global durum yazan bekçi kuralı.
    await prisma.numberSeries.update({
      where: { key: "sack" },
      data: {
        prefix: onceki.prefix,
        dateSegment: onceki.dateSegment,
        digits: onceki.digits,
        separator: onceki.separator,
        formatChangedAt: onceki.formatChangedAt,
      },
    });
    // `packingLotCode` §5'te, `order` ise ÜÇÜNCÜ NEGATİF SONDA kolunda damga alır
    // (kapı kaldırılınca güncelleme geçer). İkisi de geri alınır.
    for (const key of ["packingLotCode", "order"]) {
      const row = await prisma.numberSeries.findUnique({ where: { key } });
      if (row?.formatChangedAt) {
        await prisma.numberSeries.update({ where: { key }, data: { formatChangedAt: null } });
      }
    }
    invalidateNumberSeriesCache();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
