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
//   §4 Etki sayısı ÖLÇÜLÜR; kaynağı olmayan seri `null` döner ("0" demez)
//   §5 Önizleme SUNUCUDA hesaplanır ve biçim kapısından geçer
//
// ⭐ NEGATİF SONDA ✓B3 (2026-09-22, ölçüldü): sayaç ve istemci kapılarının sırası
//    TERS çevrilince §1 ❌1 (`…CLIENT_TOO_OLD` geliyor, beklenen `…COUNTER_NOT_SCOPED`) ·
//    `listSeries.editable` yalnız `lockedReason`a bakınca §2 ❌1 (46 seri ayrışıyor) ·
//    `seriesImpactCount` kaynağı olmayan seride 0 dönünce §4 ❌1.
//
// ⚠️ §1'in İLK iddiası (YAPISAL kilit en önce) ilk yazımda KIRMIZI verdi ve bu
//    bir BULGUYDU: `lockedReason` yalnız `assertSeriesFormatAllowed` içinde
//    aranıyordu, o da EN SONDA koşuyordu ⇒ yapısal olarak hiç değişmeyecek bir
//    seri için kullanıcı önce "sayacı hazırla" cevabı alıyordu. Kontrol
//    `updateSeriesFormat`ın başına alındı; `assertSeriesFormatAllowed`taki kopya
//    KALDI çünkü önizleme yolu yalnız oradan geçiyor.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../src/lib/prisma";
import { NUMBER_SERIES_CATALOG } from "../src/constants/number-series-catalog";
import {
  assertSeriesFormatAllowed,
  previewSeriesCode,
  resolveSeriesFormat,
  updateSeriesFormat,
} from "../src/services/number-series.service";
import {
  listSeries,
  seriesImpactCount,
  seriesLock,
} from "../src/services/helpers/series-panel.helper";
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

async function main(): Promise<void> {
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
    const sackSayi = await seriesImpactCount("sack");
    const gercek = await prisma.sack.count();
    check("§4 ⭐ etki sayısı ÖLÇÜLÜYOR (uydurulmuyor)", sackSayi === gercek, `${sackSayi} = ${gercek}`);
    // ⚠️ ÖLÇÜMÜN GÜCÜ BEYAN EDİLİR: tabloda kayıt yoksa "0 = 0" iddiası, her
    // zaman 0 dönen bir fonksiyonu da geçirir. Boş DB'de bu iddia ZAYIFTIR ve
    // sessizce güçlü sanılmamalı.
    if (gercek === 0) {
      console.log("   ⚠️ ZAYIF ÖLÇÜM: `sacks` boş — '0 = 0' sabit-0 bir uygulamayı da geçirir.");
    }
    check("§4 sayım gerçekten DELEGEYE gidiyor (sabit değil): ikinci bir seride de eşleşiyor",
      (await seriesImpactCount("shipment")) === (await prisma.shipment.count()));
    check("§4 ⭐ sayım kaynağı OLMAYAN seri `null` döner ('0' demez)",
      (await seriesImpactCount("packingLotName")) === null);
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
      if (satir === "" || /\?\s/.test(satir)) nullableOlanlar.push(`${e.key}:${e.countTable.field}`);
    }
    check("§4 ⭐ her `countTable` alanı şemada ZORUNLU kolon (satır sayısı = numaralanmış kayıt)",
      nullableOlanlar.length === 0, nullableOlanlar.join(", ") || "3 seri denetlendi");
    check("§4 körlük zemini: şema metni gerçekten okundu", sema.length > 10_000, `${sema.length} bayt`);

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
