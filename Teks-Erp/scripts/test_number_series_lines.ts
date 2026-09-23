// =============================================================================
// BEKÇİ — BİÇİM ZAMAN ÇİZGİSİ (`number_series_lines`, D4①, 2026-09-23)
// =============================================================================
//   §1 GÖÇ tek seferlik + damgalı; satırlar YARATILDIKTAN SONRA koşar
//   §2 ⭐ ÖNBELLEK = YÜRÜRLÜKTEKİ SATIR: `number_series` biçim kolonları, o
//      serinin EN SON `effectiveFrom`lu satırıyla birebir
//   §3 ⭐ EMEKLİ ÖN EK KÜMESİ = GEÇMİŞ SATIRLARIN ön ekleri (iki yönlü)
//   §4 ⭐ TEK YAZAR: biçim yazınca hem YENİ SATIR doğar hem önbellek güncellenir
//      ve ikisinin anı AYNIDIR (`effectiveFrom` == `formatChangedAt`)
//   §5 Sentinel BEYANLI: tarihi bilinmeyen geçmiş satır `isSentinel` taşır
//   §7 İLERİ TARİHLİ GEÇİŞ: geçmişe yazılamaz · bugünü değiştirmez (ama önizleme
//      gösterir) · vadesi gelince kendiliğinden yürürlüğe girer ve ÖNBELLEK
//      kolonlarını da günceller
//   §6 KÖKEN AYRI BEYAN: göçün ürettiği emekli satır `MIGRATED_GUESS`, panelden
//      doğan satır `RECORDED` — tarihin sentinel olması BİÇİMİN tahmin olduğunu
//      söylemez, ikisi AYRI sorudur
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-23): tek yazar tx'inden satır yazımı
//    kaldırılınca §4 ❌ · `formatChangedAt` ile `effectiveFrom` farklı anlara
//    konunca §4 ❌ · göç damgası kaldırılınca §1 ❌ · emekli ön ek satır olarak
//    yazılmayınca §3 ❌.
//
// Çalıştır: npx tsx scripts/test_number_series_lines.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  FORMAT_LINES_MIGRATION_STAMP,
  reconcileNumberSeries,
} from "../src/jobs/number-series-catalog.job";
import { refreshNumberSeriesCache, resolveSeriesFormat } from "../src/services/number-series.service";
import { updateSeriesFormat } from "../src/services/helpers/series-write.helper";
import { formatSeriesCode } from "../src/services/helpers/series-format.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Serinin YÜRÜRLÜKTEKİ satırı — en büyük `effectiveFrom` (gelecek satır hariç). */
async function yururlukteki(key: string) {
  return prisma.numberSeriesLine.findFirst({
    where: { seriesKey: key, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(engel); process.exit(1); }

  // ⚠️ TEMİZLİK ANLIK GÖRÜNTÜYLE, SAYIYLA DEĞİL: ilk yazımda teardown "fazladan
  // kaç satır var" diye sayıyordu ve bir koşum ORTASINDA düşünce artık kalıyordu
  // (ölçüldü 2026-09-23: `packingLotCode`ta altı artık satır birikti ve sonraki
  // koşumları kırmızıya düşürdü). Şimdi başta var olan id'ler kaydediliyor;
  // sonda o kümede OLMAYAN her satır siliniyor — koşum nerede düşerse düşsün.
  const baslangicSatirlari = new Set(
    (await prisma.numberSeriesLine.findMany({ select: { id: true } })).map((x) => x.id),
  );
  const seriDurumu = new Map(
    (await prisma.numberSeries.findMany({
      select: { key: true, prefix: true, dateSegment: true, digits: true, separator: true,
        retiredPrefixes: true, formatChangedAt: true },
    })).map((s) => [s.key, s]),
  );

  // ⚠️ HEDEF SERİ BİLİNEN BİR HÂLE ÇEKİLİR — "ortamda ne varsa" ile koşmak, bu
  // bekçiyi ÖNCEKİ koşumların artığına bağımlı yapıyordu (ölçüldü 2026-09-23:
  // arka arkaya iki tur koşunca ikincisi kırmızı veriyordu ve sebep ÜRÜN DEĞİL
  // fikstürdü). Göç satırları (`MIGRATED_GUESS`) KORUNUR; onların üstüne yazılmış
  // her deneme satırı silinir ve kolonlar en eski satıra eşitlenir.
  for (const hedef of ["packingLotCode", "sack"]) {
    const satirlar = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: hedef }, orderBy: { effectiveFrom: "asc" },
      select: { id: true, prefix: true, dateSegment: true, digits: true, separator: true, origin: true },
    });
    for (const s of satirlar.slice(1)) {
      if (s.origin !== "MIGRATED_GUESS") await prisma.numberSeriesLine.delete({ where: { id: s.id } });
    }
    const kalan = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: hedef }, orderBy: { effectiveFrom: "desc" }, take: 1,
      select: { prefix: true, dateSegment: true, digits: true, separator: true },
    });
    const y = kalan[0];
    if (y) {
      await prisma.numberSeries.update({
        where: { key: hedef },
        data: { prefix: y.prefix, dateSegment: y.dateSegment, digits: y.digits, separator: y.separator,
          retiredPrefixes: [], formatChangedAt: null },
      });
    }
  }
  await refreshNumberSeriesCache();

  // ── §1 GÖÇ ────────────────────────────────────────────────────────────────
  const r1 = await reconcileNumberSeries();
  const damga = await prisma.systemSetting.findUnique({
    where: { key: FORMAT_LINES_MIGRATION_STAMP }, select: { key: true },
  });
  check("§1a göç damgası basıldı", damga !== null);
  const r2 = await reconcileNumberSeries();
  check("§1b ⭐ damga varken göç BİR DAHA KOŞMAZ", r2.formatLinesCreated === null,
    `ilk koşum: ${String(r1.formatLinesCreated)} · ikinci: ${String(r2.formatLinesCreated)}`);

  const seriler = await prisma.numberSeries.findMany({
    select: { key: true, prefix: true, dateSegment: true, digits: true, separator: true,
      retiredPrefixes: true, formatChangedAt: true },
  });
  check("§1 körlük zemini: seri satırı var", seriler.length >= 40, `${seriler.length} seri`);
  const toplamSatir = await prisma.numberSeriesLine.count();
  check("§1 körlük zemini: biçim satırı YAZILDI", toplamSatir >= seriler.length,
    `${toplamSatir} satır / ${seriler.length} seri`);

  // ── §2 ÖNBELLEK = YÜRÜRLÜKTEKİ SATIR ──────────────────────────────────────
  const ayrisan: string[] = [];
  for (const s of seriler) {
    const line = await yururlukteki(s.key);
    if (!line) { ayrisan.push(`${s.key}: satır YOK`); continue; }
    if (line.prefix !== s.prefix || line.dateSegment !== s.dateSegment ||
        line.digits !== s.digits || line.separator !== s.separator) {
      ayrisan.push(`${s.key}: ${line.prefix}/${line.dateSegment}/${line.digits} ≠ ${s.prefix}/${s.dateSegment}/${s.digits}`);
    }
  }
  check("§2 ⭐ `number_series` biçim kolonları YÜRÜRLÜKTEKİ satırla BİREBİR (önbellek ayrışmıyor)",
    ayrisan.length === 0, ayrisan.slice(0, 3).join(" · ") || `${seriler.length} seri denetlendi`);

  // ── §3 EMEKLİ ÖN EKLER = GEÇMİŞ SATIRLAR (iki yönlü) ──────────────────────
  const emekliAyrisan: string[] = [];
  for (const s of seriler) {
    const line = await yururlukteki(s.key);
    if (!line) continue;
    const gecmis = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: s.key, effectiveFrom: { lt: line.effectiveFrom } },
      select: { prefix: true },
    });
    const satirOnekleri = new Set(gecmis.map((g) => g.prefix));
    const kolonOnekleri = new Set(s.retiredPrefixes);
    const eksik = [...kolonOnekleri].filter((x) => !satirOnekleri.has(x));
    const fazla = [...satirOnekleri].filter((x) => !kolonOnekleri.has(x) && x !== line.prefix);
    if (eksik.length || fazla.length) {
      emekliAyrisan.push(`${s.key}: eksik=[${eksik.join(",")}] fazla=[${fazla.join(",")}]`);
    }
  }
  check("§3 ⭐ emekli ön ek kümesi geçmiş SATIRLARLA birebir (iki yönlü)",
    emekliAyrisan.length === 0, emekliAyrisan.slice(0, 3).join(" · ") || "ayrışma yok");

  // ── §5 SENTINEL BEYANLI ───────────────────────────────────────────────────
  const sentinelsiz = await prisma.numberSeriesLine.count({
    where: { isSentinel: false, effectiveFrom: { lt: new Date("2000-01-01T00:00:00.000Z") } },
  });
  check("§5 ⭐ 2000 öncesi her satır SENTİNEL olarak beyanlı (rapor '1970'te değişti' demez)",
    sentinelsiz === 0, `${sentinelsiz} beyansız`);

  // ── §6 KÖKEN: tahmin mi, kayıt mı? (D4②) ─────────────────────────────────
  // ⚠️ AYRI ALAN, not değil: "ölçüldü mü, elle mi, TAHMİN mi" beyanı bu depoda
  // VERİDE durur — makine okuyamazsa kapı da kuramaz.
  //
  // ⚠️ İDDİA İKİ KEZ DÜZELTİLDİ ve ikisi de BULGUYDU: ① "geçmiş satır ⇒ tahmin"
  // yanlış (panelden yazılmış bir biçim sonradan geçmişe düşer ama TAHMİN
  // DEĞİLDİR) ② "sentinel + geçmiş ⇒ tahmin" de yanlış (göçün yazdığı
  // YÜRÜRLÜKTEKİ satır da sentinel tarihlidir ve panelden bir değişiklik
  // gelince geçmişe düşer — biçimi yine tahmin değildir).
  // Doğru değişmez KONUMDAN değil YAZARDAN türer: tahmini YALNIZ göç üretir ve
  // yalnız `retiredPrefixes`ten; panelin yazdığı her satır kayıttır.
  const tahminler = await prisma.numberSeriesLine.findMany({
    where: { origin: "MIGRATED_GUESS" },
    select: { seriesKey: true, prefix: true, isSentinel: true },
  });
  check("§6a ⭐ her TAHMİN satırı sentinel tarihli (tahmini yalnız göç üretir)",
    tahminler.every((x) => x.isSentinel),
    tahminler.filter((x) => !x.isSentinel).map((x) => `${x.seriesKey}:${x.prefix}`).join(", ") ||
      `${tahminler.length} tahmin satırı`);
  const panelYazimlari = await prisma.numberSeriesLine.findMany({
    where: { isSentinel: false },
    select: { seriesKey: true, prefix: true, origin: true },
  });
  check("§6b ⭐ PANELDEN yazılan (gerçek tarihli) her satır KAYIT — tahmin değil",
    panelYazimlari.every((x) => x.origin === "RECORDED"),
    panelYazimlari.filter((x) => x.origin !== "RECORDED").map((x) => `${x.seriesKey}:${x.prefix}`).join(", ") ||
      `${panelYazimlari.length} kayıt satırı`);
  check("§6 körlük zemini: tahmin satırı GERÇEKTEN var (iddia boş kümede yeşil değil)",
    tahminler.length >= 1, `${tahminler.length} tahmin satırı`);

  // ── §4 TEK YAZAR ──────────────────────────────────────────────────────────
  const HEDEF = "packingLotCode";
  const once = resolveSeriesFormat(HEDEF);
  const oncekiSatir = await prisma.numberSeriesLine.count({ where: { seriesKey: HEDEF } });
  try {
    await updateSeriesFormat(HEDEF, {
      prefix: once.prefix, dateSegment: once.dateSegment, digits: once.digits, separator: once.separator,
    });
    const sonrakiSatir = await prisma.numberSeriesLine.count({ where: { seriesKey: HEDEF } });
    check("§4a ⭐ biçim yazınca YENİ SATIR doğar", sonrakiSatir === oncekiSatir + 1,
      `${oncekiSatir} → ${sonrakiSatir}`);
    const seri = await prisma.numberSeries.findUnique({
      where: { key: HEDEF }, select: { formatChangedAt: true },
    });
    const line = await yururlukteki(HEDEF);
    check("§4b ⭐ `formatChangedAt` ile yürürlükteki satırın `effectiveFrom`u AYNI AN",
      seri?.formatChangedAt !== null && line !== null &&
        seri!.formatChangedAt!.getTime() === line!.effectiveFrom.getTime(),
      `${seri?.formatChangedAt?.toISOString() ?? "—"} ↔ ${line?.effectiveFrom.toISOString() ?? "—"}`);
    await refreshNumberSeriesCache();
    const sonra = resolveSeriesFormat(HEDEF);
    check("§4c yazma davranışı DEĞİŞMEDİ: biçim aynı kaldı (aynı değerler yazıldı)",
      sonra.prefix === once.prefix && sonra.digits === once.digits);
    const yeniSatir = await yururlukteki(HEDEF);
    check("§4d ⭐ PANELDEN doğan satır TAHMİN DEĞİL (`RECORDED`)",
      yeniSatir?.origin === "RECORDED", String(yeniSatir?.origin));
  } finally {
    // Fikstür satırını ve damgayı geri al: bu bekçi GERÇEK seri satırına yazıyor.
    const fazlalik = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: HEDEF }, orderBy: { effectiveFrom: "desc" }, take: 1, select: { id: true, isSentinel: true },
    });
    const kalan = await prisma.numberSeriesLine.count({ where: { seriesKey: HEDEF } });
    if (kalan > oncekiSatir && fazlalik[0]) {
      await prisma.numberSeriesLine.delete({ where: { id: fazlalik[0].id } });
    }
    await prisma.numberSeries.update({
      where: { key: HEDEF },
      data: { formatChangedAt: once.formatChangedAt ?? null },
    });
    await refreshNumberSeriesCache();
  }

  // ── §7 İLERİ TARİHLİ GEÇİŞ (D4③) ─────────────────────────────────────────
  // ⭐ Üç ayrı soru: ① geçmişe yazılamaz ② ileri tarihli yazma BUGÜNÜ değiştirmez
  // ③ vadesi gelince KENDİLİĞİNDEN yürürlüğe girer (ayrı zamanlayıcı yok).
  const H2 = "packingLotName"; // sayacı `sayac-yok`… biçim kapısı için uygun değil
  const HEDEF2 = "packingLotCode";
  const oncekiFmt = resolveSeriesFormat(HEDEF2);
  const satirOnce = await prisma.numberSeriesLine.count({ where: { seriesKey: HEDEF2 } });
  const eklenen: string[] = [];
  try {
    // ① GEÇMİŞE YAZMA → 400
    let gecmisHata: unknown = null;
    try {
      await updateSeriesFormat(
        HEDEF2,
        { prefix: oncekiFmt.prefix, dateSegment: oncekiFmt.dateSegment, digits: oncekiFmt.digits, separator: oncekiFmt.separator },
        undefined,
        new Date(Date.now() - 3 * 86_400_000),
      );
    } catch (e) { gecmisHata = e; }
    check("§7a ⭐ GEÇMİŞ tarihli geçiş 400 (`NUMBER_SERIES_EFFECTIVE_FROM_PAST`)",
      (gecmisHata as { details?: { code?: string } })?.details?.code === "NUMBER_SERIES_EFFECTIVE_FROM_PAST",
      String((gecmisHata as { details?: { code?: string } })?.details?.code));

    // ② İLERİ TARİHLİ yazma BUGÜNÜ DEĞİŞTİRMEZ
    const yarin = new Date(Date.now() + 86_400_000);
    const yeniOnek = oncekiFmt.prefix === "PRT" ? "PRX" : "PRT";
    await updateSeriesFormat(
      HEDEF2,
      { prefix: yeniOnek, dateSegment: oncekiFmt.dateSegment, digits: oncekiFmt.digits, separator: oncekiFmt.separator },
      undefined,
      yarin,
    );
    eklenen.push(HEDEF2);
    await refreshNumberSeriesCache();
    const bugunFmt = resolveSeriesFormat(HEDEF2);
    check("§7b ⭐ ileri tarihli geçiş BUGÜNKÜ biçime DOKUNMAZ",
      bugunFmt.prefix === oncekiFmt.prefix, `${oncekiFmt.prefix} → ${bugunFmt.prefix}`);
    check("§7b ⭐ ama ÖNİZLEME o tarihte yeni biçimi gösterir (`resolveSeriesFormat(key, at)`)",
      resolveSeriesFormat(HEDEF2, new Date(Date.now() + 2 * 86_400_000)).prefix === yeniOnek,
      resolveSeriesFormat(HEDEF2, new Date(Date.now() + 2 * 86_400_000)).prefix);
    check("§7b ⭐ ÜRETİM yolu (tarihsiz çağrı) hâlâ bugünkü rejimi veriyor",
      resolveSeriesFormat(HEDEF2).prefix === oncekiFmt.prefix);

    // ③ VADESİ GELİNCE kendiliğinden yürürlüğe girer
    // ⚠️ Vadeyi "şimdi"ye çekiyoruz; `formatChangedAt`ten SONRA olmalı çünkü
    // aktivasyonun ölçütü "DAHA YENİ bir satır vadesi geldi"dir (fark değil).
    await prisma.numberSeries.update({
      where: { key: HEDEF2 },
      data: { formatChangedAt: new Date(Date.now() - 10_000) },
    });
    await prisma.numberSeriesLine.updateMany({
      where: { seriesKey: HEDEF2, effectiveFrom: yarin },
      data: { effectiveFrom: new Date(Date.now() - 1000) },
    });
    await refreshNumberSeriesCache();
    check("§7c ⭐ vadesi gelen satır KENDİLİĞİNDEN yürürlüğe girdi (ayrı zamanlayıcı yok)",
      resolveSeriesFormat(HEDEF2).prefix === yeniOnek, resolveSeriesFormat(HEDEF2).prefix);
    const kolonlar = await prisma.numberSeries.findUnique({
      where: { key: HEDEF2 }, select: { prefix: true, retiredPrefixes: true },
    });
    check("§7c ⭐ aktivasyon ÖNBELLEK KOLONLARINI da güncelledi (D4① eşitliği korunuyor)",
      kolonlar?.prefix === yeniOnek, String(kolonlar?.prefix));
    // ⭐ §7d B2 BEYANI: "Rejimi (hangi biçim) ÜRETİM ANI seçer; tarih
    // segmentinin DEĞERİNİ belge tarihi verir." Geçiş yürürlüğe girdikten SONRA
    // girilen ESKİ TARİHLİ bir belge YENİ biçimi alır ama tarih segmentinde
    // KENDİ tarihini taşır. Ters kurgu (rejimi belge tarihi seçsin) o belgeyi
    // KAPANMIŞ bir sayaç kapsamına yazardı.
    const aralik = new Date("2026-12-28T10:00:00.000Z");
    const rejim = resolveSeriesFormat(HEDEF2); // ÜRETİM ANI (tarihsiz çağrı)
    const uretilen = formatSeriesCode(rejim, 7, aralik); // DEĞER: belge tarihi
    check("§7d ⭐ REJİM üretim anından: eski tarihli belge YENİ ön eki alıyor",
      uretilen.startsWith(yeniOnek), uretilen);
    check("§7d ⭐ ama TARİH SEGMENTİ belge tarihinden (Aralık) — ikisi AYRI kaynak",
      uretilen.includes("2612") || uretilen.includes("281226") || uretilen.includes("2612"),
      `${uretilen} (belge 28.12.2026)`);

    check("§7c ⭐ eski ön ek EMEKLİYE ayrıldı (geçmiş kod okunmaya devam eder)",
      (kolonlar?.retiredPrefixes ?? []).includes(oncekiFmt.prefix),
      (kolonlar?.retiredPrefixes ?? []).join(","));
  } finally {
    // Seriyi eski hâline döndür: fazla satırları sil, kolonları geri yaz.
    if (eklenen.length > 0) {
      const hepsi = await prisma.numberSeriesLine.findMany({
        where: { seriesKey: HEDEF2 }, orderBy: { effectiveFrom: "asc" }, select: { id: true },
      });
      for (const l of hepsi.slice(satirOnce)) {
        await prisma.numberSeriesLine.delete({ where: { id: l.id } });
      }
      await prisma.numberSeries.update({
        where: { key: HEDEF2 },
        data: {
          prefix: oncekiFmt.prefix, dateSegment: oncekiFmt.dateSegment, digits: oncekiFmt.digits,
          separator: oncekiFmt.separator, retiredPrefixes: oncekiFmt.retiredPrefixes,
          formatChangedAt: oncekiFmt.formatChangedAt ?? null,
        },
      });
      await refreshNumberSeriesCache();
    }
    void H2;
  }

  // ── SON TEMİZLİK: bu koşumun yarattığı HER satır gider, seriler eski hâline döner.
  const sonSatirlar = await prisma.numberSeriesLine.findMany({ select: { id: true } });
  for (const l of sonSatirlar) {
    if (!baslangicSatirlari.has(l.id)) await prisma.numberSeriesLine.delete({ where: { id: l.id } });
  }
  for (const [key, s] of seriDurumu) {
    await prisma.numberSeries.update({
      where: { key },
      data: {
        prefix: s.prefix, dateSegment: s.dateSegment, digits: s.digits, separator: s.separator,
        retiredPrefixes: s.retiredPrefixes, formatChangedAt: s.formatChangedAt,
      },
    });
  }
  await refreshNumberSeriesCache();

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
