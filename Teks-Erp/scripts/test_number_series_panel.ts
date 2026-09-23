// =============================================================================
// NUMARA SERİSİ PANEL YÜZEYİ — KAPI SIRASI LOAD-BEARING (Faz C1)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts number_series_panel   (DB GEREKİR)
//
// ⚠️ KAPSAM BEYANI — BU BEKÇİ KOŞARKEN `number_series` YAPILANDIRMASININ SAHİBİDİR:
// §6/§7 gerçek biçim ve sayaç YAZAR (ölçtüğü şey zaten yazma yolu) ve o satırlar
// GLOBAL'dir. Bu yüzden bekçinin İKİ KOPYASI aynı veritabanında AYNI ANDA
// koşturulamaz; koşucu (`run-all-tests.ts`) sıralıdır, sözleşme oradan gelir.
// Sahiplik gerektirmeyen ölçümler ise satıra HİÇ yazmaz (2026-09-23'te üçü
// düzeltildi: §4c biçim enjeksiyonuyla · §11c geri sarılan tx ile · §11d sentetik
// satırlarla) — çünkü onların yazması bir ölçüm ihtiyacı değil, bir kolaylıktı ve
// aralıklı kırmızı üretiyordu.
//
// ⭐ NEDEN SIRA ÖNEMLİ: birden çok engel aynı anda geçerliyse, İLK SÖYLENEN
//    engel kullanıcının gününü belirler. Önce çözebileceği engeli söylersek
//    (ör. "istemcileri güncelle"), fabrika bir gün harcayıp bütün tabletleri
//    günceller ve İKİNCİ duvara toslar. Bu yüzden sıra, engelin KİME iş
//    çıkardığına göre kurulur:
//      ① YAPISAL (`lockedReason`) — hiç kalkmayabilir, en önce
//      ② SAYAÇ (`scopedCounter`)  — BİZİM iç hazırlığımız, fabrika çözemez
//      ③ İSTEMCİ (C0b)            — fabrikanın çözebileceği tek engel
//      ④ DEĞER (`assertSeriesFormatAllowed`) — "bu seriye dokunulabilir mi"
//         sorusu bittikten SONRA "önerilen DEĞER geçerli mi"
//
//   §1 Kapı sırası: iki engel birlikteyken ÖNCE gelen konuşur
//   §2 `listSeries` ile uç AYNI yüklemden besleniyor (ayrışan yüzey yok)
//   §3 Üç kilit türü AYRI cümleler (panelde farklı metin göstermeli)
//   §4 Etki sayısı ÖLÇÜLÜR (fikstürlü — boş tablo sabit-0'ı gizlerdi); kaynağı
//      olmayan seri `null` döner ("0" demez)
//  §4b PAYLAŞILAN TABLO: aynı (model, alan) çiftini ≥2 seri kullanıyorsa `kapsam`
//      beyanı ZORUNLU, ve o serilerin ön ekleri birbirinin BAŞLANGICI olamaz
//  §4c Kapsam DAVRANIŞTA daralıyor (fikstürlü: aynı tabloya iki serinin kodu) ve
//      EMEKLİ ön ekle yazılmış kayıt da sayıya giriyor
//  §4d Her seri bir panel BÖLÜMÜNE ait (görünmez seri yok), liste grup sırasında
//      gelir ve bölüm başlığını taşır
//  §4e Sayım kaynağı olmayan seri `uretecBagi` ile BEYANLI (kaynaksızlık bir KARAR)
//  §4f Kaynaklı HER seri gerçekten sayılabiliyor — yanlış model adı sessizce
//      `null` döndürür ve hiçbir statik kontrol göremez
//  §10 C0b İKİ EŞİK (Faz B + Faz D) · sınıflandırma sözleşmesi: alan EKLENDİ,
//      var olan `prefixes` DEĞİŞTİRİLMEDİ
//   §9 ELLE NUMARA KAPISI: FREE/SYSTEM/MANUAL davranışı · okutulan seride elle
//      değer kendi türüne çözülmeli · beyan edilen her yol kapıyı ÇAĞIRIYOR
//   §8 NUMARA KAYNAĞI: beyan gerçek · elle yolu olmayan seride 400 · varsayılan
//      `FREE` (bugünkü davranış) · yetenek yalnız 4 seride · okutulan sınırı ölçülü
//   §7 KAPASİTE ve TÜKENME: kapasite envanteri şemayla birebir · kolona sığmayan
//      biçim 400 · tükenme ÜÇ SONUÇLU (%90 eşiği tek kaynak, iki yüzey)
//   §6 SAYAÇ AYARLARI: varsayılan satır = BUGÜNKÜ davranış (52 seri) · kendi
//      mekanizması olan seri 400 · değer kapısı · yazma yolu damgaya dokunmaz ·
//      yetenek listesi sunucudan, `reset` hep kapalı ve GEREKÇELİ
//   §5 Önizleme SUNUCUDA hesaplanır ve biçim kapısından geçer
//
// ⭐ NEGATİF SONDA ✓B3 (2026-09-22, ölçüldü): sayaç ve istemci kapılarının sırası
//    TERS çevrilince §1 ❌1 (`…CLIENT_TOO_OLD` geliyor, beklenen `…COUNTER_NOT_SCOPED`) ·
//    `listSeries.editable` yalnız `lockedReason`a bakınca §2 ❌1 (46 seri ayrışıyor) ·
//    `countTable`tan `birim` silinince §4 ❌1 ·
//    `seriesImpactCount` kaynağı olmayan seride 0 dönünce §4 ❌1 · sayım SABİT 0
//    dönünce §4 ❌1 (fikstür sayesinde; fikstürsüz hâlinde bu kol YEŞİL kalıyordu).
//
// ⚠️ §1'in İLK iddiası (YAPISAL kilit en önce) ilk yazımda KIRMIZI verdi ve bu
//    bir BULGUYDU: `lockedReason` yalnız `assertSeriesFormatAllowed` içinde
//    aranıyordu, o da EN SONDA koşuyordu ⇒ yapısal olarak hiç değişmeyecek bir
//    seri için kullanıcı önce "sayacı hazırla" cevabı alıyordu. Kontrol
//    `updateSeriesFormat`ın başına alındı; `assertSeriesFormatAllowed`taki kopya
//    KALDI çünkü önizleme yolu yalnız oradan geçiyor.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../src/lib/prisma";
import {
  NUMBER_SERIES_CATALOG,
  NUMBER_SERIES_PANEL_GROUPS,
  numberSeriesCatalogEntry,
} from "../src/constants/number-series-catalog";
import {
  previewSeriesCode,
  refreshNumberSeriesCache,
  resolveSeriesFormat,
  seriesClassifierTable,
  seriesSeqFrom,
} from "../src/services/number-series.service";
import {
  assertSeriesCounterAllowed,
  assertSeriesFormatAllowed,
  assertSeriesFormatWritable,
  assertSeriesNumberSourceAllowed,
  updateSeriesCounter,
  updateSeriesFormat,
  updateSeriesNumberSource,
} from "../src/services/helpers/series-write.helper";
import {
  listSeries,
  seriesCounterCapabilities,
  seriesSourceCapability,
  previewNextNumber,
  seriesImpactCount,
  seriesFullyLocked,
  seriesLock,
} from "../src/services/helpers/series-panel.helper";
import { seriesPrefix } from "../src/services/helpers/series-format.helper";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import {
  planRetiredPrefixCleanup,
  retiredPrefixesAfterChange,
} from "../src/services/helpers/series-retired.helper";
import { cancelPendingSeriesFormat } from "../src/services/helpers/series-pending.helper";
import { pendingSeriesLine } from "../src/services/number-series.service";
import {
  scanningClientsCarryFazB,
  scanningClientsCarryFazD,
  scanningClientsMissingPhases,
} from "../src/config/client-version-policy";
import {
  assertManualNumberAllowed,
  manualNumberModes,
} from "../src/services/helpers/manual-number.helper";
import { NUMBER_SERIES_CODE_CAPACITY } from "../src/constants/number-series-capacity";
import {
  EXHAUSTION_WARN_RATIO,
  seriesExhaustion,
  seriesExhaustionWarnings,
} from "../src/services/helpers/series-exhaustion.helper";
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

/** Patlayan çağrı bekçiyi ÇÖKERTMEZ; hata nesnesi döner (çöken sonda, sonda değildir). */
async function dene<T>(fn: () => Promise<T>): Promise<T | Error> {
  try {
    return await fn();
  } catch (e) {
    return e as Error;
  }
}
const kod = (e: unknown): string | undefined =>
  (e as { details?: { code?: string } } | null)?.details?.code;

/** SENKRON kapı sondası — fırlatmazsa false, farklı kodla fırlatırsa da false. */
/** Herhangi bir hata fırlattı mı? ("hiç fırlamamalı" iddiaları için.) */
function throwsAny(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function throws(fn: () => void, beklenen: string): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    // "ANY" = "herhangi bir hata BEKLENMİYOR" sondası için: hiç fırlamamalı.
    return beklenen === "ANY" ? true : kod(e) === beklenen;
  }
}

// ⚠️ DAMGA SÜREÇ-TEKİL: `TEST-${Date.now()}`.slice(0, 14) ms hanelerini KESİYORDU,
// yani aynı saniyede başlayan iki koşum AYNI damgayı üretiyor ve `PackingGroup.code`
// üzerinde P2002 veriyordu (ölçüldü 2026-09-23: iki kopya eşzamanlı koşturulunca biri
// çöktü). Süreç kimliği (base36) damgayı koşuma bağlar; `TEST-` ön eki fikstür
// sözleşmesi gereği korunur, toplam 14 karakter (kod kolonları 16).
const DAMGA = `TEST-${process.pid.toString(36).padStart(3, "0").slice(-3)}${Date.now()
  .toString(36)
  .slice(-6)}`.slice(0, 14);

async function main(): Promise<void> {
  const fixtureLines: string[] = [];
  let kasaTasindi = false;
  let emekliDokunulan: string | null = null;
  let emekliOnceki: string[] = [];
  const fixtureGroups: string[] = [];
  const fixtureInvoices: string[] = [];
  let fixtureCari: string | null = null;
  const sayacDokunulan: string[] = [];
  const kaynakDokunulan: string[] = [];
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exit(1);
  }

  try {
    // ── §1 Kapı sırası ────────────────────────────────────────────────────
    // Hedef: `scopedCounter` beyanı OLMAYAN **ve** okutulan bir seri — iki engel
    // birlikteyken SAYAÇ konuşmalı (fabrikanın çözemeyeceği engel önce).
    // ⚠️ HEDEF ELLE SEÇİLMEZ, KEŞİFLE BULUNUR: eski hâli `swatch`ı adıyla
    // yazıyordu ve o seri açıldığı gün iddia sessizce ölçmeyi bıraktı. Böyle bir
    // seri kalmadığında sonuç ÜÇÜNCÜ hâldir — "ölçülemedi", "uyumlu" değil.
    const ikiEngelli = NUMBER_SERIES_CATALOG.find(
      (e) => !e.lockedReason && !e.scopedCounter && e.kind !== undefined,
    );
    if (!ikiEngelli) {
      console.log(
        "⏭️  §1 ÖLÇÜLEMEDİ — hem sayacı hazır olmayan hem OKUTULAN seri kalmadı; " +
          "kapı sırası iddiası bu ağaçta gözlemlenemiyor.",
      );
    } else {
      const tohum = { prefix: ikiEngelli.seedPrefix, dateSegment: ikiEngelli.seedDateSegment,
        digits: ikiEngelli.seedDigits, separator: ikiEngelli.seedSeparator };
      const ikisiDe = await dene(() => updateSeriesFormat(ikiEngelli.key, tohum));
      check(`§1 ⭐ iki engel birlikteyken SAYAÇ kapısı konuşur (istemci değil) — ${ikiEngelli.key}`,
        ikisiDe instanceof Error && kod(ikisiDe) === "NUMBER_SERIES_COUNTER_NOT_SCOPED",
        ikisiDe instanceof Error ? (kod(ikisiDe) ?? ikisiDe.message) : "KABUL EDİLDİ");
    }

    // `roll`: YAPISAL kilit + sayaç beyanı yok + okutulan. En önce YAPISAL.
    const ucuBirden = await dene(() =>
      updateSeriesFormat("roll", { prefix: "T", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    check("§1 ⭐ üç engel birlikteyken YAPISAL kilit konuşur",
      ucuBirden instanceof Error && kod(ucuBirden) === "NUMBER_SERIES_LOCKED",
      ucuBirden instanceof Error ? (kod(ucuBirden) ?? ucuBirden.message) : "KABUL EDİLDİ");

    // `sack`: yalnız İSTEMCİ engeli ve TÜM eksenlerde (tablet 1.0.6 çuvalı
    // `/^CV\d{10}$/` ile tanıyor — uzunluk ve ayraç dahil her değişiklik kırıyor).
    const yalnizIstemci = await dene(() =>
      updateSeriesFormat("sack", { prefix: "CX", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    check("§1 tek engel kaldığında O konuşur (istemci)",
      yalnizIstemci instanceof Error && kod(yalnizIstemci) === "NUMBER_SERIES_CLIENT_TOO_OLD",
      yalnizIstemci instanceof Error ? (kod(yalnizIstemci) ?? yalnizIstemci.message) : "KABUL EDİLDİ");
    // ⚠️ `shipment` ARTIK AÇIK ve bu ÖLÇÜLMÜŞ bir karar: eski panel/tablet o
    // seriyi hiç okutmuyor, yani kilidin istemci gerekçesi YOKTU (E4 simülasyonu).
    // Eski iddia burada `shipment`ı kilitli varsayıyordu — genellemenin kendisi
    // ölçülmemişti.
    const sevkiyatAcik = await dene(() =>
      updateSeriesFormat("shipment", { prefix: "SVK", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    check("§1 ⭐ eski istemcide KIRILMAYAN seri (sevkiyat) kilitlenmiyor",
      !(sevkiyatAcik instanceof Error),
      sevkiyatAcik instanceof Error ? (kod(sevkiyatAcik) ?? sevkiyatAcik.message) : "kabul edildi");

    // ── §2 Uç ile servis AYNI yüklemden ───────────────────────────────────
    const liste = listSeries();
    // ⚠️ YÜKLEM `seriesFullyLocked` — "kilit var mı" DEĞİL. Eksen kilidi bir
    // SERİ kilidi değildir: kısmi kilitli seri düzenlenebilir ve panel yalnız
    // kilitli ALANI pasifleştirir. Eski iddia "kilit varsa düzenlenemez" diyordu
    // ve kartela/fason serileri açıldığı gün kırmızı verdi — kodun değil
    // İDDİANIN eskimesi (ölçüldü 2026-09-23).
    const ayrisma = liste.filter((r) => r.editable !== !seriesFullyLocked(r.key));
    check("§2 ⭐ `listSeries.editable` ile kapı AYNI yüklemden besleniyor",
      ayrisma.length === 0, ayrisma.map((r) => r.key).join(", ") || `${liste.length} seri`);
    check("§2 körlük zemini: listede hem açık hem kilitli seri var",
      liste.some((r) => r.editable) && liste.some((r) => !r.editable),
      `${liste.filter((r) => r.editable).length} açık / ${liste.filter((r) => !r.editable).length} kilitli`);

    // ── §3 Üç kilit türü ayrı cümle ───────────────────────────────────────
    // ⚠️ SAYAÇ örneği KEŞİFLE: adıyla yazılan hedef, o seri açıldığı gün ölçmeyi
    // bırakır (`swatch` böyle düştü). Üç türden biri kalmadıysa iddia o tür için
    // ÖLÇÜLEMEZ ve bunu söyler.
    const sayacOrnegi = NUMBER_SERIES_CATALOG.find((e) => seriesLock(e.key)?.kind === "SAYAC");
    check("§3 ⭐ yapısal kilit YAPISAL, istemci kilidi ISTEMCI",
      seriesLock("roll")?.kind === "YAPISAL" && seriesLock("sack")?.kind === "ISTEMCI");
    if (!sayacOrnegi) {
      console.log("⏭️  §3 SAYAÇ kolu ÖLÇÜLEMEDİ — sayacı hazır olmayan seri kalmadı.");
    } else {
      check(`§3 ⭐ sayaç kilidi SAYAC (keşfedilen: ${sayacOrnegi.key})`,
        seriesLock(sayacOrnegi.key)?.kind === "SAYAC");
    }
    // ⚠️ İSTEMCİ kilidi EKSEN düzeyinde: kırılan ekseni olmayan seri hiç kilitlenmez.
    check("§3 ⭐ istemci kilidi EKSEN taşıyor, kırılmayan seri (sevkiyat) kilitsiz",
      (seriesLock("sack")?.lockedAxes?.length ?? 0) === 5 && seriesLock("shipment") === null);
    // ⚠️ Gerekçeler KİLİT TÜRÜ BAŞINA farklı olmalı; örnekler keşiften gelir.
    const turGerekceleri = [...new Set(
      NUMBER_SERIES_CATALOG.map((e) => seriesLock(e.key))
        .filter((l): l is NonNullable<typeof l> => l !== null)
        .map((l) => `${l.kind}::${l.reason}`),
    )];
    const turSayisi = new Set(turGerekceleri.map((x) => x.split("::")[0])).size;
    check("§3 her kilit TÜRÜ kendi gerekçe cümlesini taşıyor (panelde aynı cümle çıkmasın)",
      turGerekceleri.length >= turSayisi && turSayisi > 0, `${turSayisi} tür / ${turGerekceleri.length} cümle`);
    check("§3 sevkiyat ailesi panelde görünür (`panelGroup`)",
      ["sack", "shipment", "packingLotCode", "packingLotName", "returnDoc"].every(
        (k) => liste.find((r) => r.key === k)?.panelGroup === "sevkiyat"));

    // ── §3b KİLİT CÜMLESİ TEK KAYNAK + AÇILMA KOŞULU (2026-09-23) ──────────
    // Panel kendi kilit cümlesini yazıyordu ve sunucununkiyle ÇELİŞİYORDU
    // (rozet "yapısal", diyalog "Faz B"). Cümle artık YALNIZ buradan gider ve
    // iki soruyu AYRI alanlarda cevaplar: neden kilitli (`reason`) · ne zaman
    // açılır (`acilma`). İkincisi olmadan kullanıcı kendi yapabileceği tek şeyi
    // ("tabletleri güncelle") ekranda göremez.
    // Kilit yükleminin İKİ FAZLI olduğu METİNDEN de ölçülür: davranış bugün
    // aynı sonucu veriyor (iki eşik de karşılanmamış), yani yalnız sonuca bakan
    // bir iddia tek fazlı bir yüklemi de geçirirdi — `scanningClientsMissingPhases`
    // listesinin doğuş dersi tam buydu.
    const seriesPanelKaynagi = readFileSync(
      join(__dirname, "..", "src", "services", "helpers", "series-panel.helper.ts"),
      "utf-8",
    );
    const kilitliler = NUMBER_SERIES_CATALOG.map((e) => ({ key: e.key, lock: seriesLock(e.key) }))
      .filter((x): x is { key: string; lock: NonNullable<ReturnType<typeof seriesLock>> } => x.lock !== null);
    check("§3b körlük zemini: kilitli seri VAR", kilitliler.length > 0, `${kilitliler.length} kilitli`);
    const acilmasiz = kilitliler.filter((x) => !x.lock.acilma || x.lock.acilma.length < 10);
    check("§3b ⭐ her kilit AÇILMA KOŞULUNU söylüyor (`acilma`)",
      acilmasiz.length === 0, acilmasiz.map((x) => x.key).join(", ") || `${kilitliler.length} kilit`);
    const kimdesiz = kilitliler.filter((x) => !["kimse", "biz", "siz"].includes(x.lock.kimde));
    check("§3b ⭐ her kilit EYLEMİN KİMDE olduğunu söylüyor (`kimde`)",
      kimdesiz.length === 0, kimdesiz.map((x) => x.key).join(", "));
    // ⚠️ Panel `lockedReason`/`lockUnlock`/`lockActor` alanlarını OKUR; biri
    // listeden düşerse ekranda cümle yarım kalır (ayrışan yüzey).
    const eksikAlan = liste.filter((r) => r.lockKind && (!r.lockedReason || !r.lockUnlock || !r.lockActor));
    check("§3b ⭐ liste ucu kilidin ÜÇ alanını da taşıyor (reason · unlock · actor)",
      eksikAlan.length === 0, eksikAlan.map((r) => r.key).join(", "));

    // YAPISAL küme KAPALIDIR: "gerekçesi çürüyen kilit, kilit değil kalıntıdır"
    // (returnDoc emsali). Bugün ÖLÇÜLMÜŞ tek yapısal bağ kaldı: top barkodundaki
    // faz harfi. `workOrder` 2026-09-23 sabahı çıktı (gerekçesi Faz B'ydi, Faz B
    // indi); `batchDaily` aynı gün akşam çıktı — gerekçesi ÖTEKİ rejimin biçimiydi
    // (P01…P99 sarması) ve o rejim kendi serisine (`batchShort`) taşındı, sarma
    // da `number_series.wrap` kolonuna indi.
    const yapisal = kilitliler.filter((x) => x.lock.kind === "YAPISAL").map((x) => x.key).sort();
    check("§3b ⭐ YAPISAL kilit kümesi kapalı: yalnız `roll`",
      yapisal.join(",") === "roll", yapisal.join(", ") || "(yok)");

    // ── §3c OKUMA YÜKLEMİ = YAZMA KAPISI (iki fazlı eşik dahil) ───────────
    // `seriesLock` yalnız Faz B'ye bakıyordu, `assertSeriesFormatWritable` ise
    // Faz B + Faz D'ye. İki eşik AYRI AYRI yükselebildiği için soru gerçekten
    // ayrışabilirdi: panel seriyi AÇIK gösterir, uç 400 dönerdi.
    const pariteBozuk = NUMBER_SERIES_CATALOG.filter((e) => {
      const kilitli = seriesFullyLocked(e.key); // SERİ düzeyinde red — eksen kilidi değil
      let yazilabilir = true;
      try { assertSeriesFormatWritable(e.key); } catch { yazilabilir = false; }
      return kilitli === yazilabilir;
    });
    check("§3c ⭐ okuma yüklemi (`seriesLock`) ile yazma kapısı AYNI cevabı veriyor",
      pariteBozuk.length === 0, pariteBozuk.map((e) => e.key).join(", ") || `${NUMBER_SERIES_CATALOG.length} seri`);
    check("§3c ⭐ okutulan serinin kilidi İKİ fazı da arıyor (B ve D)",
      seriesPanelKaynagi.includes("scanningClientsMissingPhases"),
      "series-panel.helper.ts");

    // ── §4 Etki sayısı ─────────────────────────────────────────────────────
    // ⚠️ FİKSTÜR ŞART: boş tabloda "0 = 0" iddiası, HER ZAMAN 0 dönen bir
    // uygulamayı da geçirirdi. Beyan etmek yetmez — "yeşil ≠ kapsandı" tam
    // bunun için yazılmış. Bu yüzden sayım serisinde GERÇEK kayıt yaratılır.
    const oncekiSayi = await prisma.packingGroup.count();
    // ⚠️ İŞ ANAHTARIYLA aranır, "ortamda ne varsa" DEĞİL: `findFirst` ile herhangi
    // bir cari bulmak, temiz bir CI DB'sinde düşer ya da vakumen yeşil kalır
    // (`npm run seed:fixtures` MUS-001'i garanti eder).
    const musteri = await prisma.customer.findFirst({
      where: { code: "MUS-001" },
      select: { id: true },
    });
    check("§4 körlük zemini: fikstür carisi (MUS-001) bulundu — yoksa `npm run seed:fixtures`",
      musteri !== null);
    if (musteri) {
      fixtureGroups.push(
        (
          await prisma.packingGroup.create({
            data: { customerId: musteri.id, name: `${DAMGA} grup`, code: `${DAMGA}-1`.slice(0, 16) },
            select: { id: true },
          })
        ).id,
      );
    }
    // ⚠️ İKİ SINIRLI OKUMA: sayım ile canlı `count()` arasına başka bir yazar
    // girebilir (paralel fikstür), yani DÜZ EŞİTLİK yanlış kırmızı verir. Doğru
    // iddia bir ARALIK: sayım, aynı anın iki gözleminin ARASINDA olmalı. Sabit-0
    // uygulamayı ısıran şey eşitlik değil, bu aralık + artışın kendisidir.
    const canliOnce = await prisma.packingGroup.count();
    const lotSayi = await seriesImpactCount("packingLotCode");
    const canliSonra = await prisma.packingGroup.count();
    const alt = Math.min(canliOnce, canliSonra);
    const ust = Math.max(canliOnce, canliSonra);
    check("§4 ⭐ etki sayısı ÖLÇÜLÜYOR — fikstür kaydı sayıya YANSIDI (sabit-0 uygulama ISIRILIR)",
      lotSayi !== null && lotSayi >= alt && lotSayi <= ust &&
        lotSayi >= oncekiSayi + fixtureGroups.length && lotSayi > 0,
      `${lotSayi} ∈ [${alt}, ${ust}] · önce ${oncekiSayi} + ${fixtureGroups.length}`);
    check("§4 sayım gerçekten DELEGEYE gidiyor: ikinci bir seride de canlı sayıyla eşleşiyor",
      (await seriesImpactCount("sack")) === (await prisma.sack.count()));
    // ⚠️ Hedef seri KATALOGDAN SEÇİLİR, elle yazılmaz: `packingLotName` bu
    // dilimde `countTable` kazandı ve iddia sessizce yanlış seriyi ölçmeye
    // başlardı. Kaynağı olmayan İLK seri hangisiyse o ölçülür.
    const kaynaksiz = NUMBER_SERIES_CATALOG.find((e) => !e.countTable);
    check("§4 körlük zemini: kataloğda sayım kaynağı OLMAYAN seri var", kaynaksiz !== undefined);
    check("§4 ⭐ sayım kaynağı OLMAYAN seri `null` döner ('0' demez)",
      kaynaksiz !== undefined && (await seriesImpactCount(kaynaksiz.key)) === null,
      kaynaksiz?.key ?? "(yok)");
    // ⚠️ SÖZLEŞME BEKÇİDE: `countTable.field` ZORUNLU bir kolon olmalı, yoksa
    // "satır sayısı" ile "numaralanmış kayıt sayısı" ayrışır. Çalışma anında
    // doğrulanamıyor (ölçüldü: Prisma 7 DMMF alanı `isRequired` taşımıyor),
    // bu yüzden şema METNİNDEN okunur.
    const sema = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf-8");
    const nullableOlanlar: string[] = [];
    for (const e of NUMBER_SERIES_CATALOG) {
      if (!e.countTable) continue;
      const govde = sema.split(new RegExp(`\\bmodel ${e.countTable.model.replace(/^./, (c) => c.toUpperCase())}\\b`))[1]?.split("\n}")[0] ?? "";
      const satir = govde.split("\n").find((l) => new RegExp(`^\\s*${e.countTable?.field}\\s`).test(l)) ?? "";
      // ⚠️ İKİ KOL: kolon ZORUNLU olabilir, YA DA null'ları eleyen bir kapsam
      // BEYAN edilmiş olabilir. İkisi de yoksa sayım sessizce satır sayar.
      const nullable = satir === "" || /\?\s/.test(satir);
      if (nullable && !e.countTable.kapsam) nullableOlanlar.push(`${e.key}:${e.countTable.field}`);
    }
    check("§4 ⭐ her `countTable` alanı ZORUNLU kolon YA DA beyanlı kapsam taşıyor",
      nullableOlanlar.length === 0, nullableOlanlar.join(", ") || `${NUMBER_SERIES_CATALOG.filter((e) => e.countTable).length} seri denetlendi`);
    // ⭐ BİRİM BEYANI ZORUNLU: satır ile belge aynı şey değil.
    const birimsiz = NUMBER_SERIES_CATALOG.filter((e) => e.countTable && !e.countTable.birim);
    check("§4 ⭐ her `countTable` BİRİMİNİ beyan ediyor (kayıt ↔ belge)",
      birimsiz.length === 0, birimsiz.map((e) => e.key).join(", ") || "hepsi beyanlı");
    check("§4 körlük zemini: şema metni gerçekten okundu", sema.length > 10_000, `${sema.length} bayt`);

    // ── §4b PAYLAŞILAN TABLO ────────────────────────────────────────────────
    // ⚠️ §4'ün ÜSTTEKİ kolu yalnız NULLABILITY'ye bakıyor ve paylaşımı GÖREMEZ:
    // `Invoice.docNo` ZORUNLU bir kolon, yani o kol yeşil kalır — ama dört seri
    // aynı tabloyu paylaştığı için düz `count(*)` dördünün TOPLAMINI basar ve
    // "bugüne kadarki N satış faturası" cümlesi YANLIŞ bir sayı söyler (null
    // değil, yanlış: sessiz ve inandırıcı). Ölçüldü 2026-09-23: 10 seri 3
    // tabloyu paylaşıyor (`Invoice.docNo` ×4 · `Cheque.docNo` ×4 · `Payment.docNo` ×2).
    const cifteGore = new Map<string, string[]>();
    for (const e of NUMBER_SERIES_CATALOG) {
      if (!e.countTable) continue;
      const cift = `${e.countTable.model}.${e.countTable.field}`;
      cifteGore.set(cift, [...(cifteGore.get(cift) ?? []), e.key]);
    }
    const paylasan = [...cifteGore.entries()].filter(([, keys]) => keys.length > 1);
    const kapsamsizPaylasan: string[] = [];
    for (const [cift, keys] of paylasan) {
      for (const k of keys) {
        if (!numberSeriesCatalogEntry(k).countTable?.kapsam) kapsamsizPaylasan.push(`${k}@${cift}`);
      }
    }
    check("§4b ⭐ aynı (model, alan) çiftini paylaşan her seri `kapsam` BEYAN ediyor",
      kapsamsizPaylasan.length === 0,
      kapsamsizPaylasan.join(", ") || `${paylasan.length} paylaşılan çift · ${paylasan.reduce((n, [, k]) => n + k.length, 0)} seri`);
    check("§4b körlük zemini: paylaşılan çift GERÇEKTEN var (yoksa iddia boş kümede yeşil kalırdı)",
      paylasan.length >= 3, paylasan.map(([c, k]) => `${c}×${k.length}`).join(" · "));

    // ⚠️ §9'un (tarama uzayı) TABLO-PAYLAŞIMI KARDEŞİ: ön ek kapsamı ancak ön
    // ekler birbirinin BAŞLANGICI değilse ayırt eder. Bugün doğru (SF/AF/SI/AI ·
    // CKA/CKV/SNA/SNV · TH/OD), ama yarın `SF` yanına `SFX` yazılırsa iki serinin
    // sayısı SESSİZCE karışır — `SFX…` kodları `SF` aramasına da girerdi.
    const cakisanPaylasim: string[] = [];
    let karsilastirilan = 0;
    for (const [cift, keys] of paylasan) {
      // ⚠️ BEYANLI İKİZLER MUAF: `exclusiveWith` çifti aynı kolonu paylaşır ama
      // bir anda yalnız BİRİ kod üretir (rejim bayrağı), yani sayıları karışamaz.
      // Muafiyet ÇİFT YÖNLÜ aranır — tek yönlüsü kapıyı çağrı yönüne göre açardı.
      if (
        keys.length === 2 &&
        numberSeriesCatalogEntry(keys[0] as string).exclusiveWith?.key === keys[1] &&
        numberSeriesCatalogEntry(keys[1] as string).exclusiveWith?.key === keys[0]
      ) {
        continue;
      }
      const onekler = keys.flatMap((k) => {
        const f = resolveSeriesFormat(k);
        return [f.prefix, ...f.retiredPrefixes].map((onek) => ({ k, onek }));
      });
      for (let i = 0; i < onekler.length; i++) {
        for (let j = i + 1; j < onekler.length; j++) {
          const a = onekler[i]!, b = onekler[j]!;
          if (a.k === b.k) continue;
          karsilastirilan++;
          if (a.onek.startsWith(b.onek) || b.onek.startsWith(a.onek)) {
            cakisanPaylasim.push(`${cift}: ${a.k}:${a.onek} ↔ ${b.k}:${b.onek}`);
          }
        }
      }
    }
    check("§4b ⭐ aynı tabloyu paylaşan serilerin ön ekleri birbirinin BAŞLANGICI değil",
      cakisanPaylasim.length === 0, cakisanPaylasim.join(" · ") || `${karsilastirilan} çift temiz`);
    check("§4b körlük zemini: ön ek karşılaştırması koştu", karsilastirilan >= 12, `${karsilastirilan} çift`);

    // ── §4c DAVRANIŞ: kapsam GERÇEKTEN daraltıyor mu? (fikstürlü) ───────────
    // ⚠️ Beyan + statik kontrol yetmez: `seri-onekli` kolu hiç koşmasa da yukarıdaki
    // iki iddia yeşil kalırdı. Bu yüzden AYNI TABLOYA iki FARKLI serinin kodunu
    // yazıp sayıların AYRIŞTIĞI ölçülür.
    // ⚠️ Cari HESAP fikstürü burada kurulur, `seed:fixtures`e bırakılmaz: MUS-001
    // kartı var ama hesabı YOK (ölçüldü 2026-09-23, `tekserp_ca_test`). Bekçi
    // kendi ön koşulunu kurmalı — kurmazsa temiz bir CI DB'sinde sessizce düşer.
    let cari = musteri
      ? await prisma.cariAccount.findFirst({ where: { customerId: musteri.id }, select: { id: true } })
      : null;
    if (musteri && !cari) {
      cari = await prisma.cariAccount.create({
        data: { kind: "CUSTOMER", customerId: musteri.id },
        select: { id: true },
      });
      fixtureCari = cari.id;
    }
    check("§4c körlük zemini: fikstür carisinin cari HESABI bulundu/kuruldu", cari !== null);
    if (cari) {
      const sfOnek = resolveSeriesFormat("invoiceSales").prefix;
      const afOnek = resolveSeriesFormat("invoicePurchase").prefix;
      for (const [tip, onek] of [["SALES", sfOnek], ["PURCHASE", afOnek]] as const) {
        fixtureInvoices.push(
          (
            await prisma.invoice.create({
              data: {
                docNo: `${onek}${DAMGA}`.slice(0, 32),
                type: tip,
                cariId: cari.id,
                issueDate: new Date(),
              },
              select: { id: true },
            })
          ).id,
        );
      }
      const sfSayi = (await seriesImpactCount("invoiceSales")) ?? -1;
      const afSayi = (await seriesImpactCount("invoicePurchase")) ?? -1;
      const hamSayi = await prisma.invoice.count();
      check("§4c ⭐ paylaşılan tabloda sayım SERİYE göre daralıyor (düz `count(*)` DEĞİL)",
        sfSayi < hamSayi && afSayi < hamSayi && sfSayi >= 1 && afSayi >= 1,
        `SF=${sfSayi} · AF=${afSayi} · ham=${hamSayi}`);
      // ⚠️ ARALIK İDDİASI: sayım ile karşılaştırma okuması arasına başka bir yazar
      // girebilir (paralel fikstür) ⇒ düz eşitlik yanlış kırmızı verir. Doğru
      // iddia "aynı anın iki gözleminin ARASINDA" olmaktır.
      const sfHam1 = await prisma.invoice.count({ where: { docNo: { startsWith: sfOnek } } });
      const sfTekrar = (await seriesImpactCount("invoiceSales")) ?? -1;
      const sfHam2 = await prisma.invoice.count({ where: { docNo: { startsWith: sfOnek } } });
      const afHam1 = await prisma.invoice.count({ where: { docNo: { startsWith: afOnek } } });
      const afTekrar = (await seriesImpactCount("invoicePurchase")) ?? -1;
      const afHam2 = await prisma.invoice.count({ where: { docNo: { startsWith: afOnek } } });
      const aralikta = (v: number, a: number, b: number): boolean =>
        v >= Math.min(a, b) && v <= Math.max(a, b);
      check("§4c ⭐ iki serinin sayısı BİRBİRİNDEN bağımsız: yalnız kendi ön ekini sayıyor",
        aralikta(sfTekrar, sfHam1, sfHam2) && aralikta(afTekrar, afHam1, afHam2),
        `SF=${sfTekrar} ∈ [${sfHam1},${sfHam2}] · AF=${afTekrar} ∈ [${afHam1},${afHam2}]`);
      // Emekli ön ek de sayılmalı — ön ek değişince eski kayıtlar kaybolmaz.
      // ⚠️ Ön ek KOŞUM BAŞINA taze: sabit bir damga ikinci koşumda `docNo @unique`
      // çakışması verirdi (`DAMGA`nın ilk 6 karakteri her koşumda AYNI: "ZTEST-").
      const emekliOnek = `Z${String(Date.now()).slice(-5)}`;
      fixtureInvoices.push(
        (
          await prisma.invoice.create({
            data: { docNo: `${emekliOnek}0001`.slice(0, 32), type: "SALES", cariId: cari.id, issueDate: new Date() },
            select: { id: true },
          })
        ).id,
      );
      // ⚠️ GLOBAL SATIRA YAZMADAN ölçülür (2026-09-23): bu bölüm eskiden
      // `number_series.invoiceSales.retiredPrefixes`i geçici olarak değiştirip
      // geri alıyordu. Satır GLOBAL olduğu için aynı bekçinin iki koşumu
      // çakıştığında biri ötekinin emekli ön ekini siliyor ve ARALIKLI kırmızı
      // doğuyordu ("1 → 1"); üç kırmızı, ardından iki temiz koşum ölçüldü.
      // Biçim artık ÇAĞRIYA verilir — yan etki sıfır, ölçülen yüklem aynı.
      // ⚠️ İDDİA SÜREÇ-TEKİL ÖN EK ÜZERİNDEN kurulur, TOPLAM ÜZERİNDEN DEĞİL:
      // "toplam bir arttı" iddiası, aynı tabloya yazan paralel bir koşumda
      // yanlış kırmızı verir. Burada sayılan şey YALNIZ bu koşumun yarattığı
      // kayıttır: yürürlükteki ön ek imkânsız bir değere çekilir ve kaydı YALNIZ
      // EMEKLİ LİSTE eşleştirebilir — yani ölçülen eksen tam olarak "emekli ön
      // ek sayıma giriyor mu" sorusudur.
      const yurur = resolveSeriesFormat("invoiceSales");
      const yalnizEmekli =
        (await seriesImpactCount("invoiceSales", {
          ...yurur, prefix: "ZZZYOK", retiredPrefixes: [emekliOnek],
        })) ?? -1;
      check("§4c ⭐ EMEKLİ ön ekle yazılmış kayıt da bu serinin sayısına girer",
        yalnizEmekli === 1, `emekli ön ek "${emekliOnek}" → ${yalnizEmekli}`);
      // Körlük zemini: emekli liste BOŞKEN aynı biçim o kaydı SAYMAZ (yoksa
      // yukarıdaki 1, emekli listeden değil başka bir eşleşmeden gelirdi).
      check("§4c körlük zemini: emekli liste BOŞKEN aynı kayıt sayılmıyor",
        ((await seriesImpactCount("invoiceSales", {
          ...yurur, prefix: "ZZZYOK", retiredPrefixes: [],
        })) ?? -1) === 0);
    }

    // ── §4d PANELDE GÖRÜNÜRLÜK ──────────────────────────────────────────────
    // ⚠️ Etiketsiz seri ekrandan DÜŞER ve bu SESSİZDİR: "çuval numarası neden
    // burada yok?" sorusunun ekranda cevabı yoktur, "neden kilitli?" sorusununki
    // vardır (C3 kararı). Bu yüzden `panelGroup` ZORUNLU, opsiyonel değil.
    const grupsuz = NUMBER_SERIES_CATALOG.filter((e) => !e.panelGroup);
    check("§4d ⭐ her seri bir panel bölümüne ait (görünmez seri YOK)",
      grupsuz.length === 0, grupsuz.map((e) => e.key).join(", ") || `${NUMBER_SERIES_CATALOG.length} seri`);
    // §2'de kurulan liste yeniden kullanılır (aynı kapsam, saf katalog okuması).
    check("§4d ⭐ liste GRUP SIRASINDA geliyor (panel kendi sırasını uydurmuyor)",
      (() => {
        const sira = NUMBER_SERIES_PANEL_GROUPS.map((g) => g.key);
        const gorulen = liste.map((r) => sira.indexOf(r.panelGroup));
        return gorulen.every((n, i) => n >= 0 && (i === 0 || n >= gorulen[i - 1]!));
      })(),
      liste.map((r) => r.panelGroup).filter((g, i, a) => g !== a[i - 1]).join(" → "));
    check("§4d ⭐ her satır bölüm BAŞLIĞINI taşıyor (panel etiket kopyası tutmasın)",
      liste.every((r) => typeof r.panelGroupLabel === "string" && r.panelGroupLabel.length > 0));
    check("§4d körlük zemini: bölüm sayısı beklendiği gibi çoğul",
      new Set(liste.map((r) => r.panelGroup)).size === NUMBER_SERIES_PANEL_GROUPS.length,
      `${new Set(liste.map((r) => r.panelGroup)).size} / ${NUMBER_SERIES_PANEL_GROUPS.length} bölüm`);

    // ── §4e SAYIM KAYNAĞI ZORUNLU — istisnası BEYANLI ───────────────────────
    // ⚠️ "Kaynağı yok ⇒ `null` döner" kuralı doğru ama YETERSİZ: her yeni seri
    // sessizce kaynaksız doğabilir ve panel hiçbir zaman sayı göstermezdi.
    // Kaynaksızlık artık BİR KARAR ve o karar `uretecBagi` ile beyan edilir:
    // üretecini SÜRMEYEN bir serinin hangi kayıtları numaraladığını BİLEMEYİZ,
    // bu yüzden sayamayız (ve saymaya kalkışmak `T` gibi tek harfli bir ön ekte
    // eski `TEKS…`/`TEST-…` barkodlarını da toplardı).
    const kaynaksizBeyansiz = NUMBER_SERIES_CATALOG.filter((e) => !e.countTable && !e.uretecBagi);
    check("§4e ⭐ sayım kaynağı olmayan seri `uretecBagi` ile BEYAN edilmiş",
      kaynaksizBeyansiz.length === 0,
      kaynaksizBeyansiz.map((e) => e.key).join(", ") ||
        `${NUMBER_SERIES_CATALOG.filter((e) => !e.countTable).length} kaynaksız seri, hepsi beyanlı`);

    // ── §4f SAYIM GERÇEKTEN KOŞUYOR MU? ─────────────────────────────────────
    // ⚠️ `seriesImpactCount` delege bulunamazsa SESSİZCE `null` döner (fail-safe).
    // Yani katalogdaki bir model adı yanlış yazılırsa (`cashAccount` ↔ `cashBox`
    // — bu dilimde GERÇEKTEN yaşandı: şemada `CashAccount` diye bir model yok)
    // panel sonsuza kadar "ölçülmedi" gösterir ve HİÇBİR statik kontrol görmez.
    // Bu yüzden her kaynaklı seride sayım BİR KEZ KOŞTURULUR.
    const sayilamayan: string[] = [];
    let sayilanSeri = 0;
    for (const e of NUMBER_SERIES_CATALOG) {
      if (!e.countTable) continue;
      sayilanSeri++;
      if ((await seriesImpactCount(e.key)) === null) {
        sayilamayan.push(`${e.key}→${e.countTable.model}.${e.countTable.field}`);
      }
    }
    check("§4f ⭐ `countTable` taşıyan HER seri gerçekten sayılabiliyor (delege adı doğru)",
      sayilamayan.length === 0, sayilamayan.join(", ") || `${sayilanSeri} seri sayıldı`);
    check("§4f körlük zemini: sayım gerçekten koştu", sayilanSeri >= 50, `${sayilanSeri} seri`);

    // ── §6 SAYAÇ AYARLARI (D2②) ─────────────────────────────────────────────
    // ⭐ EN ÖNEMLİ İDDİA §6a: kolonlar indi ama HİÇBİRİ dolu değil ⇒ 52 serinin
    // HEPSİ bugünküyle birebir aynı numarayı üretmeli. §1'in tohum eşitliği bunu
    // KARŞILAMAZ: o katalog TOHUMUNU eski biçimlendiriciyle karşılaştırır, sayaç
    // ayarlarına hiç bakmaz ve DB satırını okumaz.
    const varsayilanBozuk: string[] = [];
    for (const e of NUMBER_SERIES_CATALOG) {
      const f = resolveSeriesFormat(e.key);
      const p0 = seriesPrefix(f, new Date("2026-09-23T08:00:00.000Z"));
      const bos = seriesSeqFrom(f, [], p0);
      const ucKod = seriesSeqFrom(f, [1, 2, 3].map((n) => `${p0}${String(n).padStart(f.digits, "0")}`), p0);
      if (bos !== 1 || ucKod !== 4) varsayilanBozuk.push(`${e.key}(boş=${bos}, üç=${ucKod})`);
    }
    check("§6a ⭐ VARSAYILAN satırla 52 serinin sayacı bugünküyle BİREBİR aynı (boş→1, üç kod→4)",
      varsayilanBozuk.length === 0,
      varsayilanBozuk.join(", ") || `${NUMBER_SERIES_CATALOG.length} seri denetlendi`);

    // §6b KENDİ MEKANİZMASI — ayar 400 ile reddedilir (sessiz etkisizlik YASAK)
    const kendiSayacli = NUMBER_SERIES_CATALOG.filter((e) => e.ownCounter);
    // ⚠️ ZEMİN 3 → 2'YE İNDİ (2026-09-23) ve sebebi ÖLÇÜLDÜ, gevşetme DEĞİL:
    // `batchDaily` kendi mekanizmasını KAYBETTİ — kısa rejim ayrı seriye taşınınca
    // günlük rejim `nextSeriesNo`nun birebir kalıbına oturdu, yani sayaç ayarları
    // orada artık ANLAMLI. Zemin popülasyonu takip eder; sabit kalsaydı gerçek bir
    // sadeleşme kırmızı verirdi.
    check("§6b körlük zemini: kendi sayaç mekanizması BEYANLI seri var",
      kendiSayacli.length >= 2, kendiSayacli.map((e) => e.key).join(", "));
    const kacan = kendiSayacli.filter(
      (e) => !throws(() => assertSeriesCounterAllowed(e.key, { startValue: 5, step: null, maxValue: null, wrap: false }),
        "NUMBER_SERIES_COUNTER_OWN"));
    check("§6b ⭐ kendi sayacı olan seride ayar 400 `NUMBER_SERIES_COUNTER_OWN`",
      kacan.length === 0, kacan.map((e) => e.key).join(", ") || `${kendiSayacli.length} seri reddedildi`);
    // ⚠️ İDDİA `lockedReason` ALANINA DEĞİL KİLİDİN KENDİSİNE çapalı: `workOrder`
    // 2026-09-23'te YAPISAL kümeden çıktı (gerekçesi çürüdü) ama biçimi hâlâ
    // kilitli (sayaç kapsamı + okutulan seri). Sorulan şey alan değil DAVRANIŞ:
    // biçim kilitliyken sayaç ayarlanabiliyor mu?
    check("§6b ⭐ BİÇİM kilidi sayaç kilidi DEĞİL: `workOrder` biçimi kilitli ama sayacı ayarlanabilir",
      seriesLock("workOrder") !== null && seriesCounterCapabilities("workOrder").startValue === true);

    // §6c DEĞER KAPISI — DB CHECK'lerinin uygulama ikizi
    check("§6c sıfır/negatif/ondalık reddedilir",
      throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: 0, step: null, maxValue: null, wrap: false }), "NUMBER_SERIES_COUNTER_INVALID") &&
      throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: null, step: -1, maxValue: null, wrap: false }), "NUMBER_SERIES_COUNTER_INVALID") &&
      throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: null, step: null, maxValue: 1.5, wrap: false }), "NUMBER_SERIES_COUNTER_INVALID"));
    check("§6c ⭐ üst sınır başlangıcın ALTINDA olamaz",
      throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: 100, step: null, maxValue: 50, wrap: false }), "NUMBER_SERIES_COUNTER_RANGE_INVALID"));
    check("§6c geçerli ayar KABUL edilir (kapı fazla dar değil)",
      !throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: 100, step: 10, maxValue: 999, wrap: false }), "ANY"));

    // §6d YAZMA YOLU — gerçekten yazıyor ve `formatChangedAt`e DOKUNMUYOR
    const oncekiDamga = (await prisma.numberSeries.findUnique({
      where: { key: "packingLotCode" }, select: { formatChangedAt: true },
    }))?.formatChangedAt ?? null;
    await updateSeriesCounter("packingLotCode", { startValue: 500, step: 10, maxValue: 9000, wrap: false });
    sayacDokunulan.push("packingLotCode");
    const yazildi = resolveSeriesFormat("packingLotCode");
    check("§6d ⭐ yazılan ayar YÜRÜRLÜKTEKİ biçime yansıyor (önbellek tazelendi)",
      yazildi.startValue === 500 && yazildi.step === 10 && yazildi.maxValue === 9000,
      `${yazildi.startValue}/${yazildi.step}/${yazildi.maxValue}`);
    const p1 = seriesPrefix(yazildi, new Date("2026-09-23T08:00:00.000Z"));
    check("§6d ⭐ ayar SAYACA yansıyor: boş kapsamda başlangıç, dolu kapsamda ADIM",
      seriesSeqFrom(yazildi, [], p1) === 500 &&
      seriesSeqFrom(yazildi, [`${p1}0500`], p1) === 510,
      `${seriesSeqFrom(yazildi, [], p1)} / ${seriesSeqFrom(yazildi, [`${p1}0500`], p1)}`);
    const sonrakiDamga = (await prisma.numberSeries.findUnique({
      where: { key: "packingLotCode" }, select: { formatChangedAt: true },
    }))?.formatChangedAt ?? null;
    check("§6d ⭐ sayaç ayarı `formatChangedAt` damgasına DOKUNMAZ (biçim değişmedi)",
      String(oncekiDamga) === String(sonrakiDamga), `${String(oncekiDamga)} → ${String(sonrakiDamga)}`);
    check("§6d ⭐ üst sınır aşımı yazma yolundan da 409 verir",
      (() => {
        try { seriesSeqFrom(yazildi, [`${p1}9000`], p1); return false; } catch (e) { return kod(e) === "NUMBER_SERIES_RANGE_EXHAUSTED"; }
      })());

    // §6e YETENEK LİSTESİ — panel hesaplamaz, okur
    const liste2 = listSeries();
    check("§6e ⭐ her satır sayaç yeteneklerini TAŞIYOR",
      liste2.every((r) => r.counter !== undefined && typeof r.counter.startValue === "boolean"));
    check("§6e ⭐ `reset` HER satırda kapalı ve GEREKÇELİ (sessiz 'hiçbir şey olmadı' yok)",
      liste2.every((r) => r.counter.reset === false && r.counter.resetReason.length > 40));
    check("§6e ⭐ kendi sayacı olan satırlar kapalı ve gerekçeli, diğerleri açık",
      liste2.every((r) =>
        numberSeriesCatalogEntry(r.key).ownCounter
          ? !r.counter.startValue && !r.counter.step && !r.counter.maxValue && (r.counter.lockedReason ?? "").length > 20
          : r.counter.startValue && r.counter.step && r.counter.maxValue),
      `${liste2.filter((r) => r.counter.startValue).length} açık / ${liste2.filter((r) => !r.counter.startValue).length} kapalı`);

    // ── §11 EMEKLİ ÖN EK HİJYENİ (K7, 2026-09-23) ──────────────────────────
    // Emekli liste "eskiden bu ön ek kullanılıyordu" DİYE OKUNUR ve tarama
    // uzayındaki çakışma kapısı onu da sorgular. d3'ün panel turunda iki tür çöp
    // ölçüldü: ① geri alınan ön ek yürürlükteki değerle BİRLİKTE listede kalıyor
    // (`prefix=PRT`, `retired={PRT,ZQ}`) ② hiç kod üretmemiş DENEME ön eki
    // (`ZQ`) kalıcı emekli oluyor.
    check("§11a ⭐ kullanılmış ön ek emekliye AYRILIR",
      retiredPrefixesAfterChange({ mevcutEmekliler: [], mevcutOnEk: "CV", yeniOnEk: "CX", mevcutOnEkKullanimi: 12 })
        .join(",") === "CV");
    check("§11a ⭐ HİÇ KOD ÜRETMEMİŞ ön ek emekliye ayrılmaz (deneme çöpü)",
      retiredPrefixesAfterChange({ mevcutEmekliler: [], mevcutOnEk: "ZQ", yeniOnEk: "CV", mevcutOnEkKullanimi: 0 })
        .length === 0);
    // ⚠️ ÜÇÜNCÜ SONUÇ: "ölçülemedi" ile "kullanılmamış" AYNI ŞEY DEĞİL. Emekli
    // listeden düşürmek sahadaki etiketi okutulamaz kılar ⇒ bilinmezlikte KORU.
    check("§11a ⭐ ÖLÇÜLEMEYEN ön ek KORUNUR (fail-safe: 'bilmiyorum' ≠ 'yok')",
      retiredPrefixesAfterChange({ mevcutEmekliler: [], mevcutOnEk: "ZQ", yeniOnEk: "CV", mevcutOnEkKullanimi: null })
        .join(",") === "ZQ");
    check("§11b ⭐ ESKİ ön eke dönmek onu emekli listeden ÇIKARIR",
      retiredPrefixesAfterChange({ mevcutEmekliler: ["CV", "ZQ"], mevcutOnEk: "CX", yeniOnEk: "CV", mevcutOnEkKullanimi: 5 })
        .join(",") === "ZQ,CX");
    check("§11b ⭐ yürürlükteki ön ek listede DURAMAZ (kirli satır onarılır)",
      retiredPrefixesAfterChange({ mevcutEmekliler: ["PRT", "ZQ"], mevcutOnEk: "PRT", yeniOnEk: "PRT", mevcutOnEkKullanimi: null })
        .join(",") === "ZQ");

    // DB SEDİ — uygulama yükleminin İKİZİ (çift yüklem): tek yazar düşürse bile
    // ham SQL ya da içe aktarım bu satırı yazamaz.
    const sedVar = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM pg_constraint WHERE conname = 'number_series_retired_not_current'`;
    check("§11c ⭐ DB sedi kurulu (`number_series_retired_not_current`)",
      Number(sedVar[0]?.n ?? 0) === 1);
    // ⚠️ SEDİ SINAYAN YAZMA GERİ SARILAN BİR TX'İN İÇİNDE: sed DÜŞÜKSE yazma
    // BAŞARILI olur ve satır kirli kalırdı — sondanın kendisi, ölçtüğü arızayı
    // ÜRETİRDİ (2026-09-23'te tam bu oldu: `packingLotCode` `{PRT}` ile kaldı ve
    // sed geri eklenemedi). `finally`li temizlik de yetmez: eşzamanlı koşan ikinci
    // bir kopya o pencerede kirli satırı GÖRÜR. Tx hiçbir pencere bırakmaz.
    let sedIsirdi = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "number_series" SET "retiredPrefixes" = ARRAY["prefix"] WHERE key = 'packingLotCode'`;
        throw new Error("SONDA-GERI-SAR");
      });
    } catch (e) {
      // Sed ısırdıysa hata CHECK'ten (23514) gelir; ısırmadıysa bizim geri sarma
      // işaretimizden. İkisini AYIRT ETMEK şart, yoksa her hâl "ısırdı" sayılırdı.
      sedIsirdi = !(e instanceof Error && e.message === "SONDA-GERI-SAR");
    }
    check("§11c ⭐ sed GERÇEKTEN ısırıyor (yürürlükteki ön ek yazılamıyor)", sedIsirdi);

    // ONARIM PLANI — karar yüklemi SENTETİK satırlarla ölçülür: canlı satıra
    // yazmak, eşzamanlı koşan ikinci kopyaya kirli veri gösterirdi (§4c'nin
    // öğrettiği ders). IO tarafı (findMany) ayrıca ve SALT-OKUNUR doğrulanır.
    const temizPlan = await planRetiredPrefixCleanup();
    check("§11d onarım planı CANLI veride boş (idempotent, damgasız)",
      temizPlan.length === 0, temizPlan.map((x) => x.key).join(", "));
    const sentetikPlan = await planRetiredPrefixCleanup([
      { key: "packingLotCode", prefix: "PRT", retiredPrefixes: ["ZQTEST", "PRT"] },
      { key: "workOrder", prefix: "IE", retiredPrefixes: ["RK"] },
      { key: "BILINMEYEN_ANAHTAR", prefix: "XX", retiredPrefixes: ["YY"] },
    ]);
    const lotPlan = sentetikPlan.find((x) => x.key === "packingLotCode");
    check("§11d ⭐ hiç kod üretmemiş emekli ön ek + yürürlükteki ön ek plana DÜŞÜRÜLECEK olarak girer",
      lotPlan !== undefined && lotPlan.sonraki.length === 0,
      lotPlan ? lotPlan.gerekceler.join(" · ") : "plan satırı YOK");
    check("§11d ⭐ TOHUM emekli ön ek (RK) plana girmez",
      !sentetikPlan.some((x) => x.key === "workOrder"));
    check("§11d ⭐ katalogda OLMAYAN anahtara dokunulmaz (neyi numaraladığı bilinmiyor)",
      !sentetikPlan.some((x) => x.key === "BILINMEYEN_ANAHTAR"));

    // ── §12 ÖRNEK BELGE NUMARASI İSTEK ANINDA ÜRETİLİR (2026-09-23) ────────
    // ⚠️ "Seriden türet" kuralı MODÜL YÜKLENİRKEN uygulanınca amacına ULAŞMIYOR:
    // önbellek o an boş olduğu için örnek katalog TOHUMUNA donuyor ve fabrikanın
    // gerçek ön ekini bir daha hiç göstermiyor (d3 ölçtü). Yapısal kural
    // `test_seri_modul_yuklemesi`te; burada ÖRNEK VERİNİN kendisi ölçülür.
    const ornekBelge = SAMPLE_PRINTED_DOCS.SUBCONTRACTOR_DISPATCH as Record<string, unknown>;
    const woOrnek = ornekBelge.workOrder as Record<string, unknown>;
    const betim = Object.getOwnPropertyDescriptor(woOrnek, "workOrderNumber");
    check("§12 ⭐ örnek belge numarası HER OKUMADA üretilir (getter, donmuş değer değil)",
      typeof betim?.get === "function", betim?.get ? "getter" : "DÜZ DEĞER");
    check("§12 ⭐ örnek numara YÜRÜRLÜKTEKİ biçimden geliyor",
      woOrnek.workOrderNumber === previewSeriesCode(resolveSeriesFormat("workOrder"), 1),
      `${String(woOrnek.workOrderNumber)}`);

    // ── §13 KULLANICIYA DÖNEN METİNDE JARGON YOK (K2, 2026-09-23) ──────────
    // ⚠️ Bu metinler EKRANDA görünür: kilit gerekçesi, sayaç kilidi gerekçesi,
    // seri adı. İçlerinde tablo/fonksiyon adı, backtick ya da dosya yolu geçmesi
    // kullanıcıya hiçbir şey söylemez — "RollBarcodeCounter anahtarının parçası"
    // cümlesi d3'ün panel turunda tam olarak böyle göründü. Teknik ayrıntı
    // YORUMDA yaşar; ekrana çıkan cümle kullanıcı dilindedir.
    const ekranMetinleri: Array<{ nerede: string; metin: string }> = [];
    for (const e of NUMBER_SERIES_CATALOG) {
      ekranMetinleri.push({ nerede: `${e.key}.label`, metin: e.label });
      if (e.lockedReason) ekranMetinleri.push({ nerede: `${e.key}.lockedReason`, metin: e.lockedReason });
      if (e.ownCounter) ekranMetinleri.push({ nerede: `${e.key}.ownCounter`, metin: e.ownCounter.not });
    }
    for (const e of NUMBER_SERIES_CATALOG) {
      const lock = seriesLock(e.key);
      if (lock) {
        ekranMetinleri.push({ nerede: `${e.key}.lock.reason`, metin: lock.reason });
        ekranMetinleri.push({ nerede: `${e.key}.lock.acilma`, metin: lock.acilma });
      }
      ekranMetinleri.push({ nerede: `${e.key}.resetReason`, metin: seriesCounterCapabilities(e.key).resetReason });
    }
    // Jargon ölçütü: backtick · dosya uzantısı · fonksiyon çağrısı · camelCase ya
    // da snake_case TANIMLAYICI. Türkçe cümlede geçen büyük harfli kısaltmalar
    // (P01, H/F, KK) jargon DEĞİLDİR — onlar sahada kullanılan adlardır.
    const jargonlu = ekranMetinleri.filter(({ metin }) =>
      metin.includes("`") ||
      /\.(ts|tsx|sql|mjs)\b/.test(metin) ||
      /[A-Za-z_][\w.]*\(\)/.test(metin) ||
      /\b[a-z]+[A-Z][A-Za-z]*\b/.test(metin) ||
      /\b[a-z]+_[a-z_]+\b/.test(metin));
    check("§13 körlük zemini: ekran metinleri toplandı", ekranMetinleri.length > 100, `${ekranMetinleri.length} metin`);
    check("§13 ⭐ kullanıcıya dönen metinde jargon YOK (backtick · dosya · tanımlayıcı)",
      jargonlu.length === 0,
      jargonlu.map((x) => `${x.nerede}: "${x.metin.slice(0, 60)}…"`).join(" · "));

    // ── §14 SONUÇ KAPISI (K6): ön ek eşitliği değil, KODUN ÇÖZÜLDÜĞÜ TÜR ──────
    // ⚠️ Okutulmayan bir serinin ürettiği kod, okutulan bir türe ÇÖZÜLEBİLİR ve
    // ön ek karşılaştırması bunu SORAMIYORDU (ölçüldü 2026-09-23: okutulmayan 43
    // seri × okutulan ön ekler = 215 deneme, çakışma reddi 0).
    const cv = resolveSeriesFormat("sack");
    check("§14 ⭐ okutulmayan seri, OKUTULAN bir türe çözülen kod üretemez",
      throws(() => assertSeriesFormatAllowed("packingLotCode", {
        ...resolveSeriesFormat("packingLotCode"), prefix: cv.prefix, dateSegment: cv.dateSegment,
        digits: cv.digits, separator: cv.separator, separator2: cv.separator2,
      }), "NUMBER_SERIES_SCAN_COLLISION"));
    // ⚠️ KAPI YENİ İHLALİ ENGELLER, BUGÜNKÜ DURUMU YASAKLAMAZ: `cashAccount` (KS)
    // bugün `kartelaDispatch` (KS) biçimine uyuyor ve bu çakışma BEYANLI/zararsız.
    // Koşulsuz bir kapı, o serinin hane sayısını bile değiştirilemez yapardı.
    const devralinanOrnek = NUMBER_SERIES_CATALOG.filter((e) => !e.lockedReason && !throwsAny(() =>
      assertSeriesFormatAllowed(e.key, resolveSeriesFormat(e.key))));
    check("§14 ⭐ 52 serinin BUGÜNKÜ biçimi kapıdan geçiyor (devralınan çakışma yasaklanmaz)",
      devralinanOrnek.length === NUMBER_SERIES_CATALOG.filter((e) => !e.lockedReason).length,
      `${devralinanOrnek.length}/${NUMBER_SERIES_CATALOG.filter((e) => !e.lockedReason).length}`);
    check("§14 ⭐ devralınan çakışmada BİÇİMİN BAŞKA EKSENİ değiştirilebiliyor (hane)",
      !throwsAny(() => assertSeriesFormatAllowed("cashAccount", { ...resolveSeriesFormat("cashAccount"), digits: 5 })));

    // ── §7 KAPASİTE ve TÜKENME (D2③) ────────────────────────────────────────
    // ⭐ §7a ENVANTER ŞEMAYLA AYRIŞMIYOR: kapasite dosyası `@db.VarChar(n)`
    // kopyalarıdır; kopya bayatlarsa kapı yanlış yerde durur ya da hiç durmaz.
    const kapasiteHatasi: string[] = [];
    let kapasiteDenetlenen = 0;
    for (const e of NUMBER_SERIES_CATALOG) {
      const beyan = NUMBER_SERIES_CODE_CAPACITY[e.key];
      if (!e.countTable) { if (beyan !== undefined) kapasiteHatasi.push(`${e.key}: kaynaksız ama beyan var`); continue; }
      const M = e.countTable.model.replace(/^./, (c) => c.toUpperCase());
      const govde = sema.split(new RegExp(`\\bmodel ${M}\\b`))[1]?.split("\n}")[0] ?? "";
      const satir = govde.split("\n").find((l) => new RegExp(`^\\s*${e.countTable?.field}\\s`).test(l)) ?? "";
      const m = /@db\.VarChar\((\d+)\)/.exec(satir);
      const gercek = m ? Number(m[1]) : undefined;
      kapasiteDenetlenen++;
      if (gercek !== beyan) kapasiteHatasi.push(`${e.key}: beyan=${String(beyan)} şema=${String(gercek)}`);
    }
    check("§7a ⭐ kapasite envanteri `schema.prisma` ile BİREBİR (bayat kopya yok)",
      kapasiteHatasi.length === 0, kapasiteHatasi.join(", ") || `${kapasiteDenetlenen} seri denetlendi`);
    check("§7a körlük zemini: envanter gerçekten dolu", Object.keys(NUMBER_SERIES_CODE_CAPACITY).length >= 45,
      `${Object.keys(NUMBER_SERIES_CODE_CAPACITY).length} kayıt`);

    // ⭐ §7b KAPI — ölçülmüş açık: `PRT-2609-` (9) + 8 hane = 17 > VarChar(16).
    // Bu ayar bugüne kadar KABUL EDİLİYORDU ve hata sahada, YAZMA anında patlardı.
    check("§7b ⭐ kolona sığmayan biçim 400 `NUMBER_SERIES_CODE_TOO_LONG`",
      throws(() => assertSeriesFormatAllowed("packingLotCode",
        { prefix: "PRT", dateSegment: "YYMM", digits: 8, separator: "-", retiredPrefixes: [] }),
        "NUMBER_SERIES_CODE_TOO_LONG"));
    check("§7b kapı FAZLA DAR değil: sığan biçim kabul edilir",
      !throws(() => assertSeriesFormatAllowed("packingLotCode",
        { prefix: "PRT", dateSegment: "YYMM", digits: 4, separator: "-", retiredPrefixes: [] }), "ANY"));
    check("§7b kapasitesi BEYAN EDİLMEMİŞ seride kontrol yok (bilmiyorum ≠ reddet)",
      NUMBER_SERIES_CODE_CAPACITY.directShipment === undefined);

    // ⭐ §7c TÜKENME — ÜÇ SONUÇ
    // ⚠️ SERİ SEÇİMİ LOAD-BEARING: `packingLotCode` bu bekçide §6d'de sınır
    // ALMIŞTI ve "sınırsız" iddiası orada sessizce yanlış seriyi ölçerdi (ilk
    // yazımda KIRMIZI verdi ve doğrusu buydu). Hiç dokunulmamış bir seri seçilir.
    const sinirsiz = await seriesExhaustion("customer");
    check("§7c ⭐ üst sınır yoksa yüzde ÖLÇÜLEMEDİ (`null`) ve GEREKÇE var — '0 %' demez",
      sinirsiz.percent === null && sinirsiz.limit === null && (sinirsiz.reason ?? "").length > 20,
      sinirsiz.reason ?? "(gerekçe yok)");
    const rollDurum = await seriesExhaustion("roll");
    check("§7c ⭐ top barkodunda sınır GERÇEK ve ölçülüyor (sayaç ayarları kapalı olsa da)",
      rollDurum.limit === 9999 && rollDurum.source === "rollCounter" && rollDurum.percent !== null,
      `${rollDurum.used}/${rollDurum.limit}`);
    // Fikstür: sınır koy + o sınırın %90'ına gelen bir kod yaz.
    await updateSeriesCounter("packingLotCode", { startValue: null, step: null, maxValue: 10, wrap: false });
    sayacDokunulan.push("packingLotCode");
    const pFull = seriesPrefix(resolveSeriesFormat("packingLotCode"), new Date());
    if (musteri) {
      // ⚠️ ÖNCEKİ KOŞUMUN ARTIĞI TEMİZLENİR: bu fikstürün kodu SABİT (`…0009`)
      // ve `@unique` — çöken bir koşum satırı bırakırsa sonraki koşum P2002 ile
      // DÜŞER, üstelik ölçtüğü şeyle ilgisiz bir sebepten. Sabit kimlikli her
      // fikstür, kendi artığına karşı da dayanıklı olmak zorundadır.
      const tukKod = `${pFull}0009`.slice(0, 16);
      await prisma.packingGroup.deleteMany({ where: { code: tukKod } });
      fixtureGroups.push((await prisma.packingGroup.create({
        data: { customerId: musteri.id, name: `${DAMGA} tük`, code: tukKod },
        select: { id: true },
      })).id);
    }
    const dolu = await seriesExhaustion("packingLotCode");
    check("§7c ⭐ sınır varken kullanım ÖLÇÜLÜYOR ve eşiği geçince UYARI (%90)",
      dolu.limit === 10 && dolu.used === 9 && dolu.percent === 0.9 && dolu.warn,
      `${dolu.used}/${dolu.limit} = %${Math.round((dolu.percent ?? 0) * 100)}`);
    check("§7c ⭐ eşik TEK KAYNAK: helper'ın sabiti kullanılıyor",
      EXHAUSTION_WARN_RATIO === 0.9 && (dolu.percent ?? 0) >= EXHAUSTION_WARN_RATIO);
    const uyarilar = await seriesExhaustionWarnings();
    check("§7c ⭐ sağlık yüzeyi AYNI helper'dan besleniyor (iki yüzey tek hesap)",
      uyarilar.some((u) => u.key === "packingLotCode"),
      uyarilar.map((u) => u.key).join(", ") || "(boş)");

    // ── §15 BEKLEYEN DEĞİŞİKLİK: göster · değiştir · iptal et (K4) ─────────
    // ⚠️ Vadesi GELMEMİŞ satır bir TASLAKTIR: onunla numara doğmadı, silinmesi
    // raporlanan hiçbir sayıyı değiştirmez ⇒ defter doktrininin ④ sınıfı, sert
    // silme meşru (ATOMİK CLAIM ile). Yürürlüğe girmiş satır bu yoldan SİLİNEMEZ.
    const KOSUM_BASI = new Date(Date.now() - 5 * 60 * 1000);
    const lotDamgaOncesi = (await prisma.numberSeries.findUnique({
      where: { key: "packingLotCode" }, select: { formatChangedAt: true },
    }))?.formatChangedAt ?? null;
    const yarin = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const obur = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const lotYurur = resolveSeriesFormat("packingLotCode");
    // ⚠️ YALNIZ BİÇİM ALANLARI: `resolveSeriesFormat` sayaç/kaynak alanlarını da
    // taşır ve onlar satır şemasında YOK — yazma ucunun sözleşmesi beş alandır.
    const lotFmt = {
      prefix: lotYurur.prefix, dateSegment: lotYurur.dateSegment, digits: lotYurur.digits,
      separator: lotYurur.separator, separator2: lotYurur.separator2 ?? null,
    };
    try {
      await updateSeriesFormat("packingLotCode", { ...lotFmt, prefix: "PRT" }, undefined, yarin);
      sayacDokunulan.push("packingLotCode");
      const bekleyen = pendingSeriesLine("packingLotCode");
      check("§15 ⭐ bekleyen değişiklik panele GÖRÜNÜR (liste ucu taşır)",
        bekleyen !== null && bekleyen.effectiveFrom.getTime() === yarin.getTime(),
        bekleyen ? bekleyen.effectiveFrom.toISOString() : "(yok)");
      const satir = listSeries().find((r) => r.key === "packingLotCode");
      check("§15 ⭐ liste ucu bekleyen değişikliği örnek koduyla taşıyor",
        satir?.pending !== undefined && satir.pending.preview.length > 0,
        satir?.pending?.preview ?? "(yok)");
      // AYNI TARİHE yeniden kayıt: ham tekillik hatası DEĞİL, DEĞİŞTİRME.
      const ikinci = await dene(async () =>
        updateSeriesFormat("packingLotCode", { ...lotFmt, prefix: "PRT", digits: 5 }, undefined, yarin));
      check("§15 ⭐ aynı tarihe yeniden kayıt bekleyen satırı DEĞİŞTİRİR (P2002 yok)",
        !(ikinci instanceof Error), ikinci instanceof Error ? (kod(ikinci) ?? ikinci.message) : "değiştirildi");
      const bekleyen2 = pendingSeriesLine("packingLotCode");
      check("§15 ⭐ değiştirilen satır TEK kalır ve yeni biçimi taşır",
        (await prisma.numberSeriesLine.count({ where: { seriesKey: "packingLotCode", effectiveFrom: { gt: new Date() } } })) === 1 &&
          bekleyen2?.fmt.digits === 5,
        `hane ${bekleyen2?.fmt.digits}`);
      // İPTAL: taslak silinir, YÜRÜRLÜKTEKİ biçim DEĞİŞMEZ.
      const oncekiYururluk = resolveSeriesFormat("packingLotCode");
      const iptalAdet = await cancelPendingSeriesFormat("packingLotCode");
      const sonrakiYururluk = resolveSeriesFormat("packingLotCode");
      check("§15 ⭐ iptal bekleyen satırı siler, YÜRÜRLÜKTEKİ biçime dokunmaz",
        iptalAdet === 1 && pendingSeriesLine("packingLotCode") === null &&
          sonrakiYururluk.prefix === oncekiYururluk.prefix && sonrakiYururluk.digits === oncekiYururluk.digits);
      const bosIptal = await dene(async () => cancelPendingSeriesFormat("packingLotCode"));
      check("§15 ⭐ bekleyen yokken iptal 409 `NUMBER_SERIES_NO_PENDING` (sessiz başarı YOK)",
        bosIptal instanceof Error && kod(bosIptal) === "NUMBER_SERIES_NO_PENDING");
      // ⭐ ATOMİK CLAIM: YÜRÜRLÜĞE GİRMİŞ satır bu yoldan silinemez.
      const yururlukteSatir = await prisma.numberSeriesLine.count({
        where: { seriesKey: "packingLotCode", effectiveFrom: { lte: new Date() } },
      });
      await updateSeriesFormat("packingLotCode", { ...lotFmt, prefix: "PRT" }, undefined, obur);
      await cancelPendingSeriesFormat("packingLotCode");
      check("§15 ⭐ iptal YÜRÜRLÜKTEKİ (geçmiş) satırlara DOKUNMAZ — defter korunur",
        (await prisma.numberSeriesLine.count({
          where: { seriesKey: "packingLotCode", effectiveFrom: { lte: new Date() } },
        })) === yururlukteSatir,
        `${yururlukteSatir} satır`);
    } finally {
      // ⚠️ TEMİZLİK "VADESİ GELMEMİŞ" DEĞİL, "BU KOŞUMUN YARATTIĞI" satırları siler
      // (ölçüldü 2026-09-23): yalnız gelecek satırları silen bir teardown,
      // yürürlüğe girmiş bir fikstür satırını bırakıyor ve SONRAKİ koşumda
      // `activateDueLines` onu vadesi gelmiş sanıp `formatChangedAt`i yazıyor —
      // §6d bir sonraki koşumda kırmızı veriyordu. Artık `fixtureLines` ile
      // id bazlı silinir (dosyanın ortak teardown'ı).
      const kalanlar = await prisma.numberSeriesLine.findMany({
        where: { seriesKey: "packingLotCode", isSentinel: false, createdAt: { gte: KOSUM_BASI } },
        select: { id: true },
      });
      fixtureLines.push(...kalanlar.map((x) => x.id));
      await prisma.numberSeriesLine.deleteMany({ where: { id: { in: kalanlar.map((x) => x.id) } } });
      await prisma.numberSeries.update({
        where: { key: "packingLotCode" },
        data: { formatChangedAt: lotDamgaOncesi },
      });
      await refreshNumberSeriesCache();
    }

    // ── §16 ÖRNEK KOD ÜRETECİNDEN + SIRADAKİ NUMARA (K8 · K19) ─────────────
    // ⚠️ `previewSeriesCode` katalog `infix`ini YAZMAZ: top barkodunun faz harfi
    // düşüyor ve ekranda GERÇEKTE ÜRETİLMEYEN bir kod görünüyordu (d3 ölçtü:
    // ekranda `T2309260001`, gerçeği `T140926H0113`).
    const rollSatir = listSeries().find((r) => r.key === "roll");
    check("§16 ⭐ top barkodu örneği FAZ HARFİNİ taşıyor (kendi üretecinden)",
      /^T\d{6}[HF]\d{4}$/.test(rollSatir?.preview ?? ""), rollSatir?.preview ?? "(yok)");
    // Sıradaki numara: GERÇEKTEN açılan bir sonraki kaydın numarası (yarış yoksa).
    // ⚠️ ÖNCE ÜST SINIR KALDIRILIR: §7c bu seride sınırı 10'a çekiyor ve sıra ona
    // dayandığında "sıradaki numara" ölçülemez olur (doğru davranış, ama ölçmek
    // istediğimiz eksen bu değil). Bölümler arası bağımlılık BEYANLIDIR.
    await updateSeriesCounter("packingLotCode", { startValue: null, step: null, maxValue: null, wrap: false });
    const siradaki = await previewNextNumber("packingLotCode");
    check("§16 ⭐ sıradaki numara ölçülüyor (sayaç kaynağı olan seride)",
      siradaki !== null && siradaki.startsWith(seriesPrefix(resolveSeriesFormat("packingLotCode"), new Date())),
      siradaki ?? "(null)");
    if (musteri && siradaki) {
      const yeniGrup = await prisma.packingGroup.create({
        data: { customerId: musteri.id, name: `${DAMGA} sira`, code: siradaki.slice(0, 16) },
        select: { id: true, code: true },
      });
      fixtureGroups.push(yeniGrup.id);
      check("§16 ⭐ sıradaki numara GERÇEKTEN bir sonraki kayda yazılabiliyor (tekil)",
        yeniGrup.code === siradaki.slice(0, 16));
      const sonraki = await previewNextNumber("packingLotCode");
      check("§16 ⭐ kayıt açılınca sıradaki numara İLERLİYOR (donmuş değer değil)",
        sonraki !== null && sonraki !== siradaki, `${siradaki} → ${sonraki}`);
    }
    // ÜÇ SONUÇ: kendi sayacı olan seride "ölçülemedi" (null) — ekran "—" yazar.
    check("§16 ⭐ kendi sayacı olan seride sıradaki numara `null` (uydurulmaz)",
      (await previewNextNumber("roll")) === null);

    // ── §8 NUMARA KAYNAĞI (D3①) ─────────────────────────────────────────────
    // ⭐ §8a BEYAN GERÇEK Mİ: `manualEntry.path` var olmayan bir dosyayı
    // gösteriyorsa beyan bir temenni olur ve ayar hiçbir yere bağlanmaz.
    const elleliler = NUMBER_SERIES_CATALOG.filter((e) => e.manualEntry);
    const yokYol = elleliler.filter((e) => !existsSync(join(__dirname, "..", "src", e.manualEntry!.path)));
    check("§8a ⭐ elle yolu BEYANI gerçek bir dosyayı gösteriyor",
      yokYol.length === 0, yokYol.map((e) => `${e.key}→${e.manualEntry?.path}`).join(", ") ||
        elleliler.map((e) => e.key).join(", "));
    check("§8a körlük zemini: elle yolu olan seri sayısı ÖLÇÜLDÜ (52'nin 4'ü)",
      elleliler.length === 4, `${elleliler.length} seri`);

    // ⭐ §8b Elle yolu OLMAYAN seride ayar 400 — etkisiz düğme verilmez.
    const elleYok = NUMBER_SERIES_CATALOG.find((e) => !e.manualEntry)!;
    check("§8b ⭐ elle yolu olmayan seride ayar 400 `NUMBER_SERIES_NO_MANUAL_PATH`",
      throws(() => assertSeriesNumberSourceAllowed(elleYok.key, "MANUAL"), "NUMBER_SERIES_NO_MANUAL_PATH"),
      elleYok.key);
    check("§8b elle yolu OLAN seride kabul edilir (kapı fazla dar değil)",
      !throws(() => assertSeriesNumberSourceAllowed("sack", "SYSTEM"), "ANY"));

    // ⭐ §8c VARSAYILAN = BUGÜNKÜ DAVRANIŞ. İki değerli bir ayar bunu ifade
    // edemezdi: sistem üretiyor AMA elle geleni de kabul ediyor ⇒ `FREE`.
    const kaynakBozuk = NUMBER_SERIES_CATALOG.filter(
      (e) => (resolveSeriesFormat(e.key).numberSource ?? "FREE") !== "FREE",
    );
    check("§8c ⭐ 52 serinin hepsi varsayılanda `FREE` (bugünkü davranış)",
      kaynakBozuk.length === 0, kaynakBozuk.map((e) => e.key).join(", ") || `${NUMBER_SERIES_CATALOG.length} seri`);

    // ⭐ §8d Yazma yolu + yetenek listesi
    await updateSeriesNumberSource("sack", "SYSTEM");
    kaynakDokunulan.push("sack");
    check("§8d ⭐ yazılan kaynak YÜRÜRLÜKTEKİ biçime yansıyor",
      resolveSeriesFormat("sack").numberSource === "SYSTEM",
      String(resolveSeriesFormat("sack").numberSource));
    const liste3 = listSeries();
    check("§8d ⭐ yetenek YALNIZ elle yolu olan 4 seride açık (panel 48 kutu çizmez)",
      liste3.filter((r) => r.source.editable).length === 4 &&
        liste3.filter((r) => r.source.editable).every((r) => numberSeriesCatalogEntry(r.key).manualEntry !== undefined),
      `${liste3.filter((r) => r.source.editable).length} açık`);
    check("§8d ⭐ satır yürürlükteki DEĞERİ de taşıyor (panel hesaplamaz)",
      liste3.find((r) => r.key === "sack")?.source.value === "SYSTEM");

    // ⭐ §8e TARANAN SERİ SINIRI — D3②'nin kapsamı burada ÖLÇÜLÜYOR, tahmin
    // edilmiyor: elle yolu olan 4 serinin İKİSİ okutuluyor (çuval + iş emri /
    // refakat kartı), ikisi okutulmuyor (sipariş + sevk partisi adı). Elle değer
    // kapısı yalnız okutulanlara uygulanacak.
    const elleVeTaranan = elleliler.filter((e) => e.kind !== undefined).map((e) => e.key).sort();
    check("§8e ⭐ elle yolu olan serilerden OKUTULANLAR ölçüldü",
      elleVeTaranan.join(",") === "sack,workOrder", elleVeTaranan.join(", ") || "(yok)");
    check("§8e körlük zemini: okutulmayan elle yol da var (sınır gerçek)",
      elleliler.some((e) => e.kind === undefined),
      elleliler.filter((e) => e.kind === undefined).map((e) => e.key).join(", "));
    check("§8e ⭐ yetenek nesnesi elle yolun YERİNİ de taşıyor (beyan kayıtlı)",
      seriesSourceCapability("sack").manualPath === "services/shipping.service.ts");

    // ── §9 ELLE NUMARA KAPISI (D3②) ─────────────────────────────────────────
    // Ayarı panel yazar; ayarın BİR ŞEY YAPTIĞI yer üretim yoludur.
    // ⚠️ `sack` bu noktada `SYSTEM`e alınmış durumda (§8d) — modu ölçen her
    // iddia hedefini AÇIKÇA ayarlar, "ortamda ne varsa"ya güvenmez.
    const sackFull = seriesPrefix(resolveSeriesFormat("sack"), new Date());
    const gecerliCuval = `${sackFull}0001`;

    await updateSeriesNumberSource("sack", "FREE");
    check("§9a ⭐ FREE: elle değer KABUL edilir (bugünkü davranış korunuyor)",
      !throws(() => assertManualNumberAllowed("sack", gecerliCuval), "ANY"));
    check("§9a ⭐ OKUTULAN seride küçük harfli elle değer 400 (okutulunca tanınmaz)",
      throws(() => assertManualNumberAllowed("sack", gecerliCuval.toLowerCase()),
        "NUMBER_SERIES_MANUAL_NOT_SCANNABLE"));
    const fasonKod = `${seriesPrefix(resolveSeriesFormat("subcontractorDispatch"), new Date())}0001`;
    check("§9a ⭐ BAŞKA okutulan serinin kodu 400 — yanlış dala düşme engellendi",
      throws(() => assertManualNumberAllowed("sack", fasonKod), "NUMBER_SERIES_MANUAL_NOT_SCANNABLE"),
      fasonKod);
    check("§9a ⭐ hiçbir seriye çözülmeyen serbest metin de 400",
      throws(() => assertManualNumberAllowed("sack", "CUVAL1"), "NUMBER_SERIES_MANUAL_NOT_SCANNABLE"));

    await updateSeriesNumberSource("sack", "SYSTEM");
    check("§9b ⭐ SYSTEM: elle değer REDDEDİLİR",
      throws(() => assertManualNumberAllowed("sack", gecerliCuval), "NUMBER_SERIES_MANUAL_NOT_ALLOWED"));
    check("§9b SYSTEM: elle değer YOKSA sorun yok (sunucu üretir)",
      !throws(() => assertManualNumberAllowed("sack", null), "ANY"));

    await updateSeriesNumberSource("sack", "MANUAL");
    check("§9c ⭐ MANUAL: elle değer YOKSA 400 (otomatik üretim kapalı)",
      throws(() => assertManualNumberAllowed("sack", null), "NUMBER_SERIES_MANUAL_REQUIRED"));
    check("§9c MANUAL: geçerli elle değer kabul edilir",
      !throws(() => assertManualNumberAllowed("sack", gecerliCuval), "ANY"));
    await updateSeriesNumberSource("sack", "FREE");

    check("§9d ⭐ OKUTULMAYAN seride biçim sınaması YOK (grup adı barkod değil)",
      !throws(() => assertManualNumberAllowed("packingLotName", "P3 sağ taraf"), "ANY"));

    // ⭐ §9e BEYAN ile BAĞLANTI: `manualEntry` beyanı olan her serinin BEYAN
    // ETTİĞİ dosyada kapı gerçekten çağrılıyor mu? Beyan varsa ama çağrı yoksa
    // ayar sessizce etkisizdir — ekranda seçenek görünür, üretim yolu umursamaz.
    const bagsiz: string[] = [];
    for (const e of NUMBER_SERIES_CATALOG) {
      if (!e.manualEntry) continue;
      const govde = readFileSync(join(__dirname, "..", "src", e.manualEntry.path), "utf-8");
      if (!govde.includes(`assertManualNumberAllowed("${e.key}"`)) bagsiz.push(e.key);
    }
    check("§9e ⭐ beyan edilen her elle yolu kapıyı GERÇEKTEN çağırıyor",
      bagsiz.length === 0, bagsiz.join(", ") ||
        `${NUMBER_SERIES_CATALOG.filter((e) => e.manualEntry).length} yol bağlı`);

    // ⭐ §9f İSTEMCİ YÜZEYİ: form çizimi için gereken yük üretiliyor ve
    // `feature-flags` yanıtına giriyor (yeni bare-auth uç AÇILMADI).
    const modlar = manualNumberModes();
    check("§9f ⭐ istemci yükü 4 seriyi taşıyor (mod + okutulur mu)",
      modlar.length === 4 && modlar.every((m) => typeof m.mode === "string" && typeof m.scanned === "boolean"),
      modlar.map((m) => `${m.key}=${m.mode}${m.scanned ? "/okutulur" : ""}`).join(" "));
    check("§9f ⭐ yük `GET /api/feature-flags` yanıtına bağlı (yeni uç yok)",
      readFileSync(join(__dirname, "..", "src", "routes", "feature-flag.routes.ts"), "utf-8")
        .includes("numberSources: manualNumberModes()"));

    // ── §10 C0b İKİ EŞİK + SINIFLANDIRMA SÖZLEŞMESİ (D4②) ──────────────────
    // ⭐ "minVersion yükseldi" TEK BAŞINA kilidi açmaz: Faz B "biçimi tablodan
    // oku" der, Faz D "tablodaki EMEKLİ BİÇİMLERİ de dene" der ve biri ötekini
    // KAPSAMAZ. Faz B'li ama Faz D'siz bir tablet, hane değiştiği gün dünkü
    // etiketi okuyamaz (ölçüldü 2026-09-23, `test_number_series §13a`: hane 4 → 6).
    // ⚠️ SERİ SEÇİMİ LOAD-BEARING: `swatch` SAYAÇ kapısında duruyor (kapı sırası
    // doğru çalışıyor) ve C0b'ye hiç gelmiyordu — ilk yazımda bu iddia
    // `…COUNTER_NOT_SCOPED` görüp kırmızı verdi. Okutulan VE sayacı hazır bir
    // seri seçilir; `sack` ikisini de karşılıyor.
    const c0bHatasi = await dene(async () =>
      updateSeriesFormat("sack", { prefix: "CV", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    check("§10a ⭐ okutulan seri BUGÜN kilitli (iki eşikten en az biri karşılanmadı)",
      c0bHatasi instanceof Error && kod(c0bHatasi) === "NUMBER_SERIES_CLIENT_TOO_OLD",
      kod(c0bHatasi) ?? "KABUL EDİLDİ");
    check("§10a körlük zemini: iki eşik de BUGÜN karşılanmıyor (kapı vakumen yeşil değil)",
      !scanningClientsCarryFazB() || !scanningClientsCarryFazD(),
      `FazB=${scanningClientsCarryFazB()} · FazD=${scanningClientsCarryFazD()}`);
    // ⭐ İDDİA GÜÇLENDİRİLDİ (2026-09-23) çünkü ESKİSİ ZAYIFTI ve bunu ÖLÇTÜM:
    // "hata kodu `…CLIENT_TOO_OLD` mı" diye sormak, YALNIZ Faz B'ye bakan bir
    // kapıyı da geçiriyordu — iki eşik de bugün karşılanmadığı için `false &&
    // false` ile `false` aynı sonucu veriyor. Kapı artık EKSİK FAZLARI ADIYLA
    // döndürüyor ve iddia ikisinin de arandığını görebiliyor.
    check("§10a ⭐ kapı EKSİK FAZLARI ADIYLA bildiriyor — ikisi de aranıyor",
      (() => {
        const d = (c0bHatasi as { details?: { missingPhases?: string[] } })?.details?.missingPhases;
        return Array.isArray(d) && d.includes("B") && d.includes("D");
      })(),
      JSON.stringify((c0bHatasi as { details?: { missingPhases?: string[] } })?.details?.missingPhases ?? null));
    check("§10a tek yüklem: kapı ile bildirilen eksik fazlar AYNI kaynaktan",
      scanningClientsMissingPhases().length === 2);
    // ⭐ D5② ÖN KOŞULU, BEYAN — YENİ BİR TARİH SEGMENTİ DE BU KAPININ ARKASINDADIR.
    // Kapı okutulan serinin HERHANGİ bir biçim yazımına bakar (`katalog.kind`),
    // değişen ALANA değil; yukarıdaki iddia bunu zaten ölçüyor çünkü fikstür
    // bugünkü biçmin AYNISINI gönderiyor — kapıyı hangi eksene daraltırsanız
    // daraltın (yalnız ön ek · ön ek+hane+ayraç) bu iddia KIRMIZI verir
    // (ölçüldü 2026-09-23, iki sonda). ⇒ Segment ekseni için AYRI bir iddia
    // yazmadım: hiçbir sondada ayrışmıyordu, yani KAPSAM EKLEMİYORDU — sırf
    // okunsun diye eklenen iddia, kapının ölçtüğünü büyütmeden tabanı şişirir.
    // İstemci tarafı ayrı ölçülür: tanımadığı segmentli SATIRI atar, tabloyu
    // düşürmez (`test_tarih_segmenti_aynasi §2`).

    // ⭐ SÖZLEŞME: alan EKLENDİ, var olan DEĞİŞTİRİLMEDİ — eski istemci
    // `retiredFormats`ı tanımaz ve görmezden gelir; `prefixes` yerinde durur.
    // ⚠️ EMEKLİ SATIR FİKSTÜRDEN, BOOT'TAN DEĞİL (2026-09-23 iniş kırmızısı).
    // Emekli biçimleri D4 göçü yazar ve göç BOOT'ta koşar, `migrate deploy`de
    // değil — ayrıca `test_number_series_lines` teardown'u kendi koşumunda
    // doğan satırları siler. ⇒ Bu bölüm "boot koştu mu" / "komşu bekçi ne
    // bıraktı" varsayımlarına dayanırsa temiz CI DB'sinde kırmızı, benim
    // DB'mde yeşil olur; ortama bağımlı bir iddia HİÇBİR ŞEY ölçmez.
    // İKİ satır gerekir: en yenisi YÜRÜRLÜKTEKİDİR, emekli listesine girmez.
    // İkisi de serinin `formatChangedAt`ından ESKİ ⇒ aktivasyon tetiklenmez
    // (ölçüt "daha YENİ bir satır vadesi geldi"), yani ortak durum kirlenmez.
    // ⚠️ ÖNCE KENDİ ARTIĞINI SİL: koşum SIGKILL ile düşerse `finally` koşmaz ve
    // sızan satırı `test_number_series_lines`in normalizasyonu KORUR (göç satırı
    // sanır). Kendi tarih penceresini süpürmek bu bekçiyi kendi geçmişine karşı
    // da bağışık yapar — "geri alma, sondadan ÖNCEKİ ana döner".
    await prisma.numberSeriesLine.deleteMany({
      where: {
        seriesKey: "sack",
        effectiveFrom: { gte: new Date("2001-01-01T00:00:00Z"), lte: new Date("2002-01-01T00:00:00Z") },
      },
    });
    for (const [i, hane] of [3, 4].entries()) {
      const satir = await prisma.numberSeriesLine.create({
        data: {
          seriesKey: "sack", prefix: "CV", dateSegment: "DDMMYY", digits: hane, separator: "",
          effectiveFrom: new Date(`200${i + 1}-01-01T00:00:00Z`),
          isSentinel: true, origin: "MIGRATED_GUESS",
        },
        select: { id: true },
      });
      fixtureLines.push(satir.id);
    }
    await refreshNumberSeriesCache();
    const tablo = seriesClassifierTable();
    check("§10b ⭐ sınıflandırma satırı `prefixes` alanını KORUYOR (eski istemci kırılmaz)",
      tablo.length > 0 && tablo.every((r) => Array.isArray(r.prefixes) && r.prefixes.length >= 1),
      `${tablo.length} satır`);
    check("§10b ⭐ `retiredFormats` OPSİYONEL: emeklisi olmayan seride alan HİÇ YOK",
      tablo.some((r) => r.retiredFormats === undefined),
      `${tablo.filter((r) => r.retiredFormats !== undefined).length} satırda var`);
    const emeklili = tablo.find((r) => (r.retiredFormats?.length ?? 0) > 0);
    check("§10b körlük zemini: emekli biçimi OLAN bir seri gerçekten var",
      emeklili !== undefined, emeklili?.key ?? "(yok)");

    // ── §5 Önizleme sunucuda + biçim kapısı ───────────────────────────────
    const fmt = resolveSeriesFormat("packingLotCode");
    check("§5 önizleme serinin kendi biçimiyle kuruluyor",
      previewSeriesCode(fmt).startsWith(fmt.prefix));
    const cakisma = dene(async () =>
      assertSeriesFormatAllowed("swatch", {
        prefix: "CV", dateSegment: "DDMMYY", digits: 4, separator: "", retiredPrefixes: [],
      }),
    );
    const c = await cakisma;
    check("§5 ⭐ önizleme yolu ÇAKIŞMAYI da yakalar (kullanıcı kaydetmeden önce görür)",
      c instanceof Error && kod(c) === "NUMBER_SERIES_PREFIX_COLLISION",
      c instanceof Error ? (kod(c) ?? c.message) : "KABUL EDİLDİ");

    // ── §5c PAYLAŞILAN KOLON — ÖN EK TEKİLLİĞİ (kapı ④) ──────────────────
    // Fatura · ödeme · çek/senet serileri AYNI `docNo` kolonunu ÖN EKLE bölüyor
    // ve üreteç sırayı `startsWith: <ön ek + tarih>` taramasıyla buluyor. İki
    // seri aynı ön eke düşerse kapsam damgaları ayrışır, ikisi aynı kodu
    // üretebilir ve `@unique` P2002 verir.
    //
    // ⚠️ HEDEF KEŞİFLE: paylaşılan kolonu olan İLK seri çifti katalogdan bulunur.
    // Böyle bir çift kalmazsa iddia ÖLÇÜLEMEZ ve bunu söyler.
    const paylasimlar = new Map<string, string[]>();
    for (const e of NUMBER_SERIES_CATALOG) {
      if (!e.countTable) continue;
      const anahtar = `${e.countTable.model}.${e.countTable.field}`;
      paylasimlar.set(anahtar, [...(paylasimlar.get(anahtar) ?? []), e.key]);
    }
    // ⚠️ BEYANLI İKİZLER HEDEF OLAMAZ: `exclusiveWith` çifti kapıdan MUAFTIR
    // (bir anda yalnız biri kod üretir) ve aynı ön eki taşır — hedef olarak
    // seçilirse körlük zemini ("ön ekleri FARKLI") haklı olarak kırmızı verir
    // ve kapı ölçülmemiş kalır.
    const ikiz = (a: string, b: string): boolean =>
      numberSeriesCatalogEntry(a).exclusiveWith?.key === b &&
      numberSeriesCatalogEntry(b).exclusiveWith?.key === a;
    const paylasilan = [...paylasimlar.values()].find(
      (lst) => lst.length > 1 && !(lst.length === 2 && ikiz(lst[0] as string, lst[1] as string)),
    );

    // ── §5c2 MUAFİYETİN KENDİSİ ÖLÇÜLÜR ──────────────────────────────────
    // Muafiyet beyanlı olduğu için "kapı buraya bakmıyor" demek YETMEZ: beyanın
    // GERÇEKTEN çalıştığı (ikizin ön ekine dokunmanın engellenmediği) ve
    // TEK YÖNLÜ beyanın muafiyet vermediği ayrı ayrı ölçülür.
    const ikizCifti = [...paylasimlar.values()].find(
      (lst) => lst.length === 2 && ikiz(lst[0] as string, lst[1] as string),
    );
    if (!ikizCifti) {
      console.log("⏭️  §5c2 ÖLÇÜLEMEDİ — beyanlı ikiz seri çifti yok.");
    } else {
      const [iA, iB] = ikizCifti as [string, string];
      const fA = resolveSeriesFormat(iA);
      const fB = resolveSeriesFormat(iB);
      check(`§5c2 körlük zemini: ikizler AYNI ön eki taşıyor (${iA} ↔ ${iB})`,
        fA.prefix === fB.prefix, `${fA.prefix} / ${fB.prefix}`);
      const ikizGecti = dene(async () =>
        assertSeriesFormatAllowed(iA, {
          prefix: fB.prefix, dateSegment: fA.dateSegment, digits: fA.digits,
          separator: fA.separator, retiredPrefixes: [],
        }),
      );
      const ikizSonuc = await ikizGecti;
      check("§5c2 ⭐ BEYANLI ikiz paylaşılan-kolon kapısına TAKILMAZ",
        !(ikizSonuc instanceof Error) || kod(ikizSonuc) !== "NUMBER_SERIES_SHARED_TABLE_PREFIX",
        ikizSonuc instanceof Error ? (kod(ikizSonuc) ?? ikizSonuc.message) : "kabul");
    }

    if (!paylasilan) {
      console.log("⏭️  §5c ÖLÇÜLEMEDİ — aynı kolonu paylaşan (ikiz olmayan) seri çifti kalmadı.");
    } else {
      const [aKey, bKey] = paylasilan as [string, string];
      const aFmt = resolveSeriesFormat(aKey);
      const bFmt = resolveSeriesFormat(bKey);
      check(`§5c körlük zemini: paylaşılan kolon GERÇEKTEN var (${aKey} ↔ ${bKey})`,
        aFmt.prefix !== bFmt.prefix, `${aFmt.prefix} / ${bFmt.prefix}`);
      // (a) KARDEŞİN ÖN EKİNE geçmek REDDEDİLİR.
      const esit = dene(async () =>
        assertSeriesFormatAllowed(aKey, {
          prefix: bFmt.prefix, dateSegment: aFmt.dateSegment, digits: aFmt.digits,
          separator: aFmt.separator, retiredPrefixes: [],
        }),
      );
      const es = await esit;
      check("§5c ⭐ aynı kolonu paylaşan iki seri AYNI ön eki taşıyamaz",
        es instanceof Error && kod(es) === "NUMBER_SERIES_SHARED_TABLE_PREFIX",
        es instanceof Error ? (kod(es) ?? es.message) : "KABUL EDİLDİ");
      // (b) KARDEŞİN ÖN EKİNİN BAŞLANGICI olmak da reddedilir (`SF` ↔ `S`).
      const basi = dene(async () =>
        assertSeriesFormatAllowed(aKey, {
          prefix: bFmt.prefix.slice(0, 1), dateSegment: aFmt.dateSegment, digits: aFmt.digits,
          separator: aFmt.separator, retiredPrefixes: [],
        }),
      );
      const bs = await basi;
      check("§5c ⭐ kardeşin ön ekinin BAŞLANGICI olmak da reddedilir",
        bs instanceof Error && kod(bs) === "NUMBER_SERIES_SHARED_TABLE_PREFIX",
        bs instanceof Error ? (kod(bs) ?? bs.message) : "KABUL EDİLDİ");
      // (c) KARDEŞİN EMEKLİ ön eki de karşılaştırmaya girer — kardeşin DÜNKÜ
      // ön ekine geçmek, onun eski belgelerini bu serinin sayacına karıştırır.
      const bOnce = await prisma.numberSeries.findUnique({
        where: { key: bKey }, select: { retiredPrefixes: true },
      });
      await prisma.numberSeries.update({
        where: { key: bKey }, data: { retiredPrefixes: ["ZQX"] },
      });
      emekliDokunulan = bKey;
      emekliOnceki = bOnce?.retiredPrefixes ?? [];
      await refreshNumberSeriesCache();
      const emekliCakisma = dene(async () =>
        assertSeriesFormatAllowed(aKey, {
          prefix: "ZQX", dateSegment: aFmt.dateSegment, digits: aFmt.digits,
          separator: aFmt.separator, retiredPrefixes: [],
        }),
      );
      const ec = await emekliCakisma;
      check("§5c ⭐ kardeşin EMEKLİ ön ekine geçmek de reddedilir (eski belgeler sayaca karışır)",
        ec instanceof Error && kod(ec) === "NUMBER_SERIES_SHARED_TABLE_PREFIX",
        ec instanceof Error ? (kod(ec) ?? ec.message) : "KABUL EDİLDİ");
      // (d) KARŞI KOL — bugünkü ayarlar kapıdan GEÇİYOR (kapı her şeyi reddetmiyor).
      const bugunku = dene(async () =>
        assertSeriesFormatAllowed(aKey, {
          prefix: aFmt.prefix, dateSegment: aFmt.dateSegment, digits: aFmt.digits,
          separator: aFmt.separator, retiredPrefixes: aFmt.retiredPrefixes,
        }),
      );
      const bg = await bugunku;
      check("§5c ⭐ bugünkü ayar kapıdan GEÇİYOR (doğduğu gün kırmızı vermiyor)",
        !(bg instanceof Error), bg instanceof Error ? (kod(bg) ?? bg.message) : "kabul");
    }

    // ── §5b DEVRALINAN ÇAKIŞMA SERİNİN KENDİ ZAMAN ÇİZGİSİDİR (K24) ───────
    // Ölçülen saha vakası (d3, 2026-09-23): kasa kodu `KS → KSZ` yapıldıktan
    // SONRA `KS`e geri dönülemiyordu — devralınan istisnası yalnız YÜRÜRLÜKTEKİ
    // biçime bakıyordu. Kasa kodu okutulmaz ama ürettiği kod kartela sevk belge
    // no biçimine uyar; bu çakışma yıllardır var ve beyanlı.
    //
    // ⚠️ İDDİA SERİYİ GERÇEKTEN `KSZ`YE TAŞIR ve bu ölçülerek öğrenildi: ilk
    // yazımda seri `KS`te kalıyordu, yani "bugünkü biçim" zaten `KS`ti ve
    // DÜZELTME GERİ ALINDIĞINDA BİLE iddia yeşil kalıyordu — vakumen bir kontrol.
    // *Bir sondanın ısırmaması, korunan durumun sondada hiç kurulmamış olmasının
    // da işareti olabilir.*
    const kasaOnce = resolveSeriesFormat("cashAccount");
    check("§5b körlük zemini: kasa serisi çakışan tohumu (`KS`) taşıyor",
      kasaOnce.prefix === "KS", kasaOnce.prefix);
    await updateSeriesFormat("cashAccount", {
      prefix: "KSZ", dateSegment: kasaOnce.dateSegment, digits: kasaOnce.digits,
      separator: kasaOnce.separator, separator2: kasaOnce.separator2 ?? null,
    });
    kasaTasindi = true;
    await refreshNumberSeriesCache();
    check("§5b körlük zemini: seri GERÇEKTEN taşındı (iddia vakumen değil)",
      resolveSeriesFormat("cashAccount").prefix === "KSZ",
      resolveSeriesFormat("cashAccount").prefix);
    const gd = await dene(async () =>
      assertSeriesFormatAllowed("cashAccount", {
        prefix: "KS", dateSegment: kasaOnce.dateSegment, digits: kasaOnce.digits,
        separator: kasaOnce.separator, retiredPrefixes: ["KSZ"],
      }),
    );
    check("§5b ⭐ KENDİ eski biçimine DÖNÜŞ kabul edilir (o kodlar dünyada zaten var)",
      !(gd instanceof Error), gd instanceof Error ? (kod(gd) ?? gd.message) : "kabul");
    // KARŞI KOL — hiç kullanılmamış, çakışan başka bir şekil YİNE reddedilmeli.
    // `KRT` kartela KART no'nun ön ekidir: kasa bu şekle hiç girmedi.
    const yc = await dene(async () =>
      assertSeriesFormatAllowed("cashAccount", {
        prefix: "KRT", dateSegment: kasaOnce.dateSegment, digits: kasaOnce.digits,
        separator: kasaOnce.separator, retiredPrefixes: [],
      }),
    );
    check("§5b ⭐ hiç kullanılmamış çakışan şekil YİNE reddedilir (istisna genişlemedi)",
      yc instanceof Error && kod(yc) === "NUMBER_SERIES_SCAN_COLLISION",
      yc instanceof Error ? (kod(yc) ?? yc.message) : "KABUL EDİLDİ");
  } finally {
    // ⚠️ KASA SERİSİ GERİ ALINIR ve bu DOĞRUDAN yazmayla yapılır: geri alma bir
    // TEMİZLİKTİR, ölçülen kod yolu DEĞİL — `updateSeriesFormat` üzerinden geri
    // dönmek, düzeltme bozulduğunda teardown'ı da düşürür ve artık bırakırdı.
    // §5c'nin dokunduğu emekli listesi ID/DEĞER ile geri alınır.
    if (emekliDokunulan) {
      await prisma.numberSeries.update({
        where: { key: emekliDokunulan }, data: { retiredPrefixes: emekliOnceki },
      });
      await refreshNumberSeriesCache();
    }
    if (kasaTasindi) {
      await prisma.numberSeriesLine.deleteMany({
        where: { seriesKey: "cashAccount", prefix: "KSZ" },
      });
      await prisma.numberSeries.update({
        where: { key: "cashAccount" },
        data: { prefix: "KS", retiredPrefixes: [] },
      });
      await refreshNumberSeriesCache();
    }
    if (fixtureLines.length > 0) {
      await prisma.numberSeriesLine.deleteMany({ where: { id: { in: fixtureLines } } });
      await refreshNumberSeriesCache();
    }
    if (fixtureGroups.length > 0) {
      await prisma.packingGroup.deleteMany({ where: { id: { in: fixtureGroups } } });
    }
    // ⚠️ SIRA: fatura ÖNCE (cari `onDelete: Restrict`), cari SONRA.
    if (fixtureInvoices.length > 0) {
      await prisma.invoice.deleteMany({ where: { id: { in: fixtureInvoices } } });
    }
    if (fixtureCari) await prisma.cariAccount.delete({ where: { id: fixtureCari } });
    if (kaynakDokunulan.length > 0) {
      await prisma.numberSeries.updateMany({
        where: { key: { in: kaynakDokunulan } },
        data: { numberSource: "FREE" },
      });
      await refreshNumberSeriesCache();
    }
    if (sayacDokunulan.length > 0) {
      await prisma.numberSeries.updateMany({
        where: { key: { in: sayacDokunulan } },
        data: { startValue: null, step: null, maxValue: null, wrap: false },
      });
      await refreshNumberSeriesCache();
    }
    // Emekli ön ek sondası satırı geri yazar, ama sonda ortasında düşülebilir.
    await prisma.numberSeries.updateMany({
      where: { key: "invoiceSales", retiredPrefixes: { isEmpty: false } },
      data: { retiredPrefixes: [] },
    });
    // Bu bekçi hiçbir seriyi BAŞARIYLA değiştirmez (hepsi kapıda durur), ama
    // negatif sonda kolları kapıları kaldırabilir ⇒ damga kalmış olabilir.
    const damgalilar = await prisma.numberSeries.findMany({
      where: { formatChangedAt: { not: null } },
      select: { key: true },
    });
    if (damgalilar.length > 0) {
      await prisma.numberSeries.updateMany({
        where: { key: { in: damgalilar.map((d) => d.key) } },
        data: { formatChangedAt: null },
      });
    }
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
