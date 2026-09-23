// =============================================================================
// NUMARA SERİSİ PANEL YÜZEYİ — KAPI SIRASI LOAD-BEARING (Faz C1)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts number_series_panel   (DB GEREKİR)
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
import { previewSeriesCode, refreshNumberSeriesCache, resolveSeriesFormat, seriesSeqFrom } from "../src/services/number-series.service";
import {
  assertSeriesCounterAllowed,
  assertSeriesFormatAllowed,
  assertSeriesNumberSourceAllowed,
  updateSeriesCounter,
  updateSeriesFormat,
  updateSeriesNumberSource,
} from "../src/services/helpers/series-write.helper";
import {
  listSeries,
  seriesCounterCapabilities,
  seriesSourceCapability,
  seriesImpactCount,
  seriesLock,
} from "../src/services/helpers/series-panel.helper";
import { seriesPrefix } from "../src/services/helpers/series-format.helper";
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
function throws(fn: () => void, beklenen: string): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    // "ANY" = "herhangi bir hata BEKLENMİYOR" sondası için: hiç fırlamamalı.
    return beklenen === "ANY" ? true : kod(e) === beklenen;
  }
}

const DAMGA = `TEST-${Date.now()}`.slice(0, 14);

async function main(): Promise<void> {
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
    // `swatch`: `scopedCounter` beyanı YOK **ve** okutulan bir seri (C0b de
    // engelliyor). İkisi birden geçerliyken SAYAÇ konuşmalı — fabrikanın
    // çözemeyeceği engel önce.
    const ikisiDe = await dene(() =>
      updateSeriesFormat("swatch", { prefix: "KRT", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    check("§1 ⭐ iki engel birlikteyken SAYAÇ kapısı konuşur (istemci değil)",
      ikisiDe instanceof Error && kod(ikisiDe) === "NUMBER_SERIES_COUNTER_NOT_SCOPED",
      ikisiDe instanceof Error ? (kod(ikisiDe) ?? ikisiDe.message) : "KABUL EDİLDİ");

    // `roll`: YAPISAL kilit + sayaç beyanı yok + okutulan. En önce YAPISAL.
    const ucuBirden = await dene(() =>
      updateSeriesFormat("roll", { prefix: "T", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    check("§1 ⭐ üç engel birlikteyken YAPISAL kilit konuşur",
      ucuBirden instanceof Error && kod(ucuBirden) === "NUMBER_SERIES_LOCKED",
      ucuBirden instanceof Error ? (kod(ucuBirden) ?? ucuBirden.message) : "KABUL EDİLDİ");

    // `shipment`: yalnız İSTEMCİ engeli (yapısal yok, sayaç hazır).
    const yalnizIstemci = await dene(() =>
      updateSeriesFormat("shipment", { prefix: "SVK", dateSegment: "DDMMYY", digits: 4, separator: "" }),
    );
    check("§1 tek engel kaldığında O konuşur (istemci)",
      yalnizIstemci instanceof Error && kod(yalnizIstemci) === "NUMBER_SERIES_CLIENT_TOO_OLD",
      yalnizIstemci instanceof Error ? (kod(yalnizIstemci) ?? yalnizIstemci.message) : "KABUL EDİLDİ");

    // ── §2 Uç ile servis AYNI yüklemden ───────────────────────────────────
    const liste = listSeries();
    const ayrisma = liste.filter((r) => r.editable !== (seriesLock(r.key) === null));
    check("§2 ⭐ `listSeries.editable` ile kapı AYNI yüklemden besleniyor",
      ayrisma.length === 0, ayrisma.map((r) => r.key).join(", ") || `${liste.length} seri`);
    check("§2 körlük zemini: listede hem açık hem kilitli seri var",
      liste.some((r) => r.editable) && liste.some((r) => !r.editable),
      `${liste.filter((r) => r.editable).length} açık / ${liste.filter((r) => !r.editable).length} kilitli`);

    // ── §3 Üç kilit türü ayrı cümle ───────────────────────────────────────
    check("§3 ⭐ yapısal kilit YAPISAL, sayaç kilidi SAYAC, istemci kilidi ISTEMCI",
      seriesLock("roll")?.kind === "YAPISAL" &&
        seriesLock("swatch")?.kind === "SAYAC" &&
        seriesLock("shipment")?.kind === "ISTEMCI");
    check("§3 üç gerekçe metni de BİRBİRİNDEN farklı (panelde aynı cümle çıkmasın)",
      new Set([seriesLock("roll")?.reason, seriesLock("swatch")?.reason, seriesLock("shipment")?.reason]).size === 3);
    check("§3 sevkiyat ailesi panelde görünür (`panelGroup`)",
      ["sack", "shipment", "packingLotCode", "packingLotName", "returnDoc"].every(
        (k) => liste.find((r) => r.key === k)?.panelGroup === "sevkiyat"));

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
    const lotSayi = await seriesImpactCount("packingLotCode");
    check("§4 ⭐ etki sayısı ÖLÇÜLÜYOR — fikstür kaydı sayıya YANSIDI (sabit-0 uygulama ISIRILIR)",
      lotSayi === oncekiSayi + fixtureGroups.length && (lotSayi ?? 0) > 0,
      `${lotSayi} = ${oncekiSayi} + ${fixtureGroups.length}`);
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
      check("§4c ⭐ iki serinin sayısı BİRBİRİNDEN bağımsız: yalnız kendi ön ekini sayıyor",
        sfSayi ===
          (await prisma.invoice.count({ where: { docNo: { startsWith: sfOnek } } })) &&
          afSayi === (await prisma.invoice.count({ where: { docNo: { startsWith: afOnek } } })),
        `SF=${sfSayi} · AF=${afSayi}`);
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
      const oncesi = (await seriesImpactCount("invoiceSales")) ?? -1;
      await prisma.numberSeries.update({
        where: { key: "invoiceSales" },
        data: { retiredPrefixes: [emekliOnek] },
      });
      // ⚠️ `invalidate…` YETMEZ ve bu ÖLÇÜLDÜ (ilk yazımda ❌ verdi): geçersiz
      // önbellekte senkron okuma TOHUMA düşer (beyanlı fail-safe), yani DB'ye
      // yazdığımız emekli ön eki GÖRMEZ. Tazeleme AWAIT edilir.
      await refreshNumberSeriesCache();
      const sonrasi = (await seriesImpactCount("invoiceSales")) ?? -1;
      await prisma.numberSeries.update({ where: { key: "invoiceSales" }, data: { retiredPrefixes: [] } });
      await refreshNumberSeriesCache();
      check("§4c ⭐ EMEKLİ ön ekle yazılmış kayıt da bu serinin sayısına girer",
        sonrasi === oncesi + 1, `${oncesi} → ${sonrasi}`);
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
    check("§6b körlük zemini: kendi sayaç mekanizması BEYANLI seri var",
      kendiSayacli.length >= 3, kendiSayacli.map((e) => e.key).join(", "));
    const kacan = kendiSayacli.filter(
      (e) => !throws(() => assertSeriesCounterAllowed(e.key, { startValue: 5, step: null, maxValue: null }),
        "NUMBER_SERIES_COUNTER_OWN"));
    check("§6b ⭐ kendi sayacı olan seride ayar 400 `NUMBER_SERIES_COUNTER_OWN`",
      kacan.length === 0, kacan.map((e) => e.key).join(", ") || `${kendiSayacli.length} seri reddedildi`);
    check("§6b ⭐ BİÇİM kilidi sayaç kilidi DEĞİL: `workOrder` biçimi kilitli ama sayacı ayarlanabilir",
      numberSeriesCatalogEntry("workOrder").lockedReason !== undefined &&
        seriesCounterCapabilities("workOrder").startValue === true);

    // §6c DEĞER KAPISI — DB CHECK'lerinin uygulama ikizi
    check("§6c sıfır/negatif/ondalık reddedilir",
      throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: 0, step: null, maxValue: null }), "NUMBER_SERIES_COUNTER_INVALID") &&
      throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: null, step: -1, maxValue: null }), "NUMBER_SERIES_COUNTER_INVALID") &&
      throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: null, step: null, maxValue: 1.5 }), "NUMBER_SERIES_COUNTER_INVALID"));
    check("§6c ⭐ üst sınır başlangıcın ALTINDA olamaz",
      throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: 100, step: null, maxValue: 50 }), "NUMBER_SERIES_COUNTER_RANGE_INVALID"));
    check("§6c geçerli ayar KABUL edilir (kapı fazla dar değil)",
      !throws(() => assertSeriesCounterAllowed("packingLotCode", { startValue: 100, step: 10, maxValue: 999 }), "ANY"));

    // §6d YAZMA YOLU — gerçekten yazıyor ve `formatChangedAt`e DOKUNMUYOR
    const oncekiDamga = (await prisma.numberSeries.findUnique({
      where: { key: "packingLotCode" }, select: { formatChangedAt: true },
    }))?.formatChangedAt ?? null;
    await updateSeriesCounter("packingLotCode", { startValue: 500, step: 10, maxValue: 9000 });
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
    await updateSeriesCounter("packingLotCode", { startValue: null, step: null, maxValue: 10 });
    sayacDokunulan.push("packingLotCode");
    const pFull = seriesPrefix(resolveSeriesFormat("packingLotCode"), new Date());
    if (musteri) {
      fixtureGroups.push((await prisma.packingGroup.create({
        data: { customerId: musteri.id, name: `${DAMGA} tük`, code: `${pFull}0009`.slice(0, 16) },
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
  } finally {
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
        data: { startValue: null, step: null, maxValue: null },
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
