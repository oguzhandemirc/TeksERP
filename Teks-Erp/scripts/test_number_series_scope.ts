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
//   §6 ⭐ C0b — OKUTULAN serinin biçimi, saha Faz B'yi taşımadan değiştirilemez;
//      eşik "Faz B'yi taşımayan SON sürüm"dür (tahmin değil, ölçülmüş geçmiş)
//
// ⭐ NEGATİF SONDA ✓B3 (2026-09-22, ölçüldü): `nextSeriesNo`tan kapsam (`since`)
//    süzmesi kalkınca §2 ❌1 · çakışma atlama döngüsü kalkınca §3 ❌2 ·
//    `updateSeriesFormat`taki `scopedCounter` kapısı kalkınca §4 ❌1 ·
//    `FAZ_B_ONCESI` eşiği `0.0.0`a çekilince §6 ❌3 (kapı yanlışlıkla AÇILIR) ·
//    C0b kapısı tamamen kalkınca §6 ❌1 ("KABUL EDİLDİ" — okutulan seri gerçekten
//    düzenlenebilir hâle gelir). ⚠️ İkinci kol ilk yazımda `swatch` üstündeydi ve
//    YÜKÜ ÖLÇEMİYORDU: kartelanın `scopedCounter` beyanı yok, yani C0b kalksa bile
//    C0 kapısı onu reddediyordu. `shipment` her iki kapıyı da geçer ⇒ tek engeli
//    C0b'dir. *Bir sondanın ısırması yetmez; ISIRDIĞI KAPININ ölçmek istediğin kapı
//    olduğu ayrıca doğrulanır.*
//    ⚠️ Üçüncü kol `order` serisine damga YAZAR (kapı kalktığı için güncelleme
//    geçer) — bu yüzden temizlik `order`ı da geri alır; sondanın kendi artığı
//    bir sonraki koşumu kirletmesin.
// =============================================================================
import prisma from "../src/lib/prisma";
import { invalidateNumberSeriesCache, nextSeriesNo, refreshNumberSeriesCache, resolveSeriesFormat } from "../src/services/number-series.service";
import { updateSeriesFormat } from "../src/services/helpers/series-write.helper";
import {
  FAZ_B_ONCESI,
  compareClientVersions,
  scanningClientsCarryFazB,
} from "../src/config/client-version-policy";
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
  /** Bu koşumun yazdığı biçim satırları — sonda SİLİNİR (artık bırakmaz). */
  const temizlenecekSatirlar: Date[] = [];
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
    // ⚠️ FİKSTÜR BİÇİM SATIRINI DA YAZAR (D4①'den beri): biçim artık bir ZAMAN
    // ÇİZGİSİ ve `number_series` kolonları onun ÖNBELLEĞİ. Yalnız kolonlara
    // yazan bir fikstür, vadesi gelen satırları yürürlüğe alan yol tarafından
    // GERİ ALINIRDI — ölçüldü 2026-09-23: bu bekçi kırmızı verdi ve haklıydı,
    // çünkü simüle ettiği "biçim değişikliği" gerçek yazma yolunun bırakacağı
    // izi bırakmıyordu.
    const damgaAni = new Date("2026-09-22T10:00:00.000Z");
    temizlenecekSatirlar.push(damgaAni);
    await prisma.numberSeriesLine.deleteMany({ where: { seriesKey: "sack", effectiveFrom: { gte: damgaAni } } });
    await prisma.numberSeriesLine.create({
      data: {
        seriesKey: "sack", prefix: onceki!.prefix, dateSegment: "NONE",
        digits: onceki!.digits, separator: onceki!.separator,
        effectiveFrom: damgaAni, isSentinel: false, origin: "RECORDED",
      },
    });
    await prisma.numberSeries.update({
      where: { key: "sack" },
      data: { dateSegment: "NONE", formatChangedAt: damgaAni },
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
    // ⚠️ SERİ DEĞİŞTİ (2026-09-23): `order` E2 üretim diliminde AÇILDI. Bu iddia
    // "beyansız seri" gerektirdiği için hedef, açılma sırası EN SONDA olan
    // finans ailesine çekildi (`invoiceSales`) — dilim geldiğinde burası yine
    // güncellenecek ve bu YAPISAL: kapı, kendisi de değişen bir dünyayı ölçüyor.
    const reddedilmeli = await dene(() =>
      updateSeriesFormat("invoiceSales", { prefix: "SF", dateSegment: "DDMMYY", digits: 4, separator: "" }),
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

    // ── §6 C0b — eski istemci kapısı ───────────────────────────────────────
    // ⚠️ "Bugün ölçülemez" DEĞİL, "bugün ölçülüyor ve KAPALI": eşik bir geçmiş
    // olgusunu kaydediyor (`FAZ_B_ONCESI`), sahadaki `minVersion` ise henüz
    // 1.0.0. Kapının AÇILDIĞI hâl de aynı dosyada ölçülür (aşağıda).
    check("§6 ⭐ bugün kapı KAPALI (saha minVersion'ı eşiğin altında)",
      !scanningClientsCarryFazB(), `eşik: electron>${FAZ_B_ONCESI.electron} · mobil>${FAZ_B_ONCESI.mobil}`);
    // ⚠️ SERİ DEĞİŞTİ: `shipment` 2026-09-23'te AÇILDI (E4 simülasyonu: eski
    // istemcilerin hiçbiri o seriyi okutmuyor ⇒ kilidin istemci gerekçesi yok).
    // Yerine `sack` seçildi: `scopedCounter` beyanı VAR (yani C0 onu reddetmez,
    // sonda gerçekten C0b'yi ölçer) ve eski tablet onu HER eksende kırıyor.
    const okutulanRed = await dene(() =>
      updateSeriesFormat("sack", { prefix: "CX", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    check("§6 ⭐ OKUTULAN seri (çuval) bugün düzenlenemez",
      okutulanRed instanceof Error && kod(okutulanRed) === "NUMBER_SERIES_CLIENT_TOO_OLD",
      okutulanRed instanceof Error ? (kod(okutulanRed) ?? okutulanRed.message) : "KABUL EDİLDİ");
    check("§6 okutulMAYAN seri aynı anda düzenlenebilir (kapı yalnız `scanned` kümeye bakıyor)",
      !(kabulEdilmeli instanceof Error));

    // Eşik mantığı kendi başına da ölçülür: sürüm karşılaştırması SAYISAL olmalı
    // ("1.3.10" sözlüksel olarak "1.3.9"dan küçüktür — klasik tuzak).
    check("§6 sürüm karşılaştırması SAYISAL", compareClientVersions("1.3.10", "1.3.9") === 1 &&
      compareClientVersions("1.3.1", "1.3.1") === 0 && compareClientVersions("1.0.7", "1.0.8") === -1);
    check("§6 ⭐ eşik AŞILDIĞINDA kapı AÇILIR (iddianın ikinci yönü)",
      compareClientVersions("1.3.2", FAZ_B_ONCESI.electron) > 0 &&
      compareClientVersions("1.0.8", FAZ_B_ONCESI.mobil) > 0);
    check("§6 TEK eksen yetmez: yalnız panel güncellenirse kapı KAPALI kalır",
      !(compareClientVersions("1.3.2", FAZ_B_ONCESI.electron) > 0 &&
        compareClientVersions("1.0.0", FAZ_B_ONCESI.mobil) > 0));

    check("§1 körlük zemini: seri satırı gerçekten okundu", onceki.key === "sack");
  } finally {
    // ⚠️ Bu koşumun yazdığı BİÇİM SATIRLARI da gider: kolonları geri yazıp satırı
    // bırakmak, bir sonraki tazelemede satırın kolonları YENİDEN ezmesi demekti
    // (biçim artık bir zaman çizgisi ve satır efendidir).
    for (const at of temizlenecekSatirlar) {
      await prisma.numberSeriesLine.deleteMany({ where: { seriesKey: "sack", effectiveFrom: at } });
    }
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
    // `shipment` yalnız NEGATİF SONDA kolunda (C0b kalkınca) damga alır.
    for (const key of ["packingLotCode", "order", "shipment"]) {
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
