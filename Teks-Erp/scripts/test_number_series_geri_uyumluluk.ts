// =============================================================================
// GERİYE DÖNÜK UYUMLULUK MATRİSİ — biçim değişince ESKİ VERİ BOZULMAZ (E3)
// =============================================================================
// Kullanıcının cümlesi (2026-09-23): *"geriye dönük uyumluluk kesinlikle olmalı,
// bir kod değişince eski verileri bozmamalı"*. Bu bekçi o cümlenin ölçüsüdür ve
// E2'nin (sayaç kapsamı açılan seriler) KABUL KAPISIDIR: bir seri açıldığı anda
// kapsama kendiliğinden girer, çünkü seri listesi KATALOGDAN KEŞFEDİLİR.
//
// İKİ KATMAN, çünkü iki ayrı şey sorulur:
//   L1 (DB'siz, HER açık seri) — BİÇİM ekseni: aynı kayıt kümesi üzerinde ön ek ·
//      her tarih segmenti · tarihsiz · hane ± · iki ayraç dönüşümleri uygulanır ve
//      ESKİ kodların tanınırlığı, YENİ kodun geçerliliği/tekilliği ve SAYACIN
//      DOĞRU YERDEN başlaması ölçülür. Kayıt yaratmaz: `nextSeriesNo` zaten kod
//      listesini ENJEKTE edilebilir bir yükleyiciden alır, yani üretim yolunun
//      KENDİ hesabı sentetik veriyle koşturulabilir (ikinci bir hesap YAZILMAZ).
//   L2 (DB'li, ucuz yaratma yolu OLAN seride) — KAYIT ekseni: gerçek kayıt açılır,
//      biçim değiştirilir, eski kaydın kodu BAYT BAYT karşılaştırılır, yeni kod
//      üretilip aranır, etki sayısı ölçülür.
//
// ⚠️ ÖLÇÜLEMEYEN SERİ KIRMIZI DEĞİL, BEYANLI: hangi serinin hangi katmanda
// ölçüldüğü her koşumda BASILIR (yeşil ≠ kapsandı). Kapsam dışı kalan seri için
// gerekçe L2_YOLU tablosunda yazılıdır — beyansız sessizlik kırmızıdır.
//
// Koşum: npx tsx scripts/run-all-tests.ts number_series_geri_uyumluluk
// =============================================================================
import type { NumberSeriesDateSegment } from "@prisma/client";

import { NUMBER_SERIES_CATALOG } from "../src/constants/number-series-catalog";
import prisma from "../src/lib/prisma";
import {
  DATE_SEGMENTS,
  matchesSeries,
  previewSeriesCode,
  seriesPrefix,
  type NumberSeriesFormat,
} from "../src/services/helpers/series-format.helper";
import { seriesLock } from "../src/services/helpers/series-panel.helper";
import { nextSeriesNo, resolveSeriesFormat } from "../src/services/number-series.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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

const SEGMENTLER = Object.keys(DATE_SEGMENTS) as NumberSeriesDateSegment[];
const AYRACLAR = ["", "-", "_", "/", "."];

/**
 * L2 YOLU — gerçek kayıt yaratma maliyeti DÜŞÜK olan seriler. Tablo BEYANDIR:
 * burada olmayan seri L1'de ölçülür ve gerekçesi basılır ("kayıt yaratmak fikstür
 * zinciri ister"). Beyan olmadan "ölçüldü" denmez.
 */
const L2_YOLU: Record<string, { not: string }> = {
  packingLotCode: { not: "PackingGroup: müşteri + ad + kod, başka zincir yok." },
};

/** Bu koşumda üretilen aday biçimler — her eksen ayrı bir dönüşüm. */
function adayBicimler(taban: NumberSeriesFormat): Array<{ eksen: string; fmt: NumberSeriesFormat }> {
  const out: Array<{ eksen: string; fmt: NumberSeriesFormat }> = [];
  out.push({ eksen: "ön ek", fmt: { ...taban, prefix: "ZZQ" } });
  for (const seg of SEGMENTLER) {
    if (seg === taban.dateSegment) continue;
    out.push({ eksen: `tarih ${seg}`, fmt: { ...taban, dateSegment: seg } });
  }
  out.push({ eksen: "hane +2", fmt: { ...taban, digits: Math.min(8, taban.digits + 2) } });
  out.push({ eksen: "hane -1", fmt: { ...taban, digits: Math.max(1, taban.digits - 1) } });
  for (const a of AYRACLAR) {
    if (a === taban.separator) continue;
    out.push({ eksen: `ayraç1 "${a}"`, fmt: { ...taban, separator: a } });
  }
  for (const a of AYRACLAR) {
    if (a === (taban.separator2 ?? "")) continue;
    out.push({ eksen: `ayraç2 "${a}"`, fmt: { ...taban, separator2: a } });
  }
  return out;
}

/** Sentetik "var olan kayıtlar" — eski biçimle üretilmiş kodlar + doğuş anları. */
function eskiKayitlar(fmt: NumberSeriesFormat, adet: number, dun: Date): Array<{ code: string; createdAt: Date }> {
  const prefix = seriesPrefix(fmt, dun);
  return Array.from({ length: adet }, (_, i) => ({
    code: `${prefix}${String(i + 1).padStart(fmt.digits, "0")}`,
    createdAt: dun,
  }));
}

async function main(): Promise<void> {
  console.log("=== Geriye dönük uyumluluk matrisi (E3) ===\n");

  const acikSeriler = NUMBER_SERIES_CATALOG.filter((e) => seriesLock(e.key) === null);
  check("körlük zemini: ölçülecek AÇIK seri var", acikSeriler.length > 0, `${acikSeriler.length} seri`);
  console.log(`   ℹ️ açık seriler: ${acikSeriler.map((e) => e.key).join(", ")}`);
  const l2Disi = acikSeriler.filter((e) => !L2_YOLU[e.key]);
  console.log(
    `   ℹ️ L2 (gerçek kayıt) kapsamı: ${acikSeriler.filter((e) => L2_YOLU[e.key]).map((e) => e.key).join(", ") || "(yok)"}` +
      `${l2Disi.length > 0 ? ` · L1'de kalan: ${l2Disi.map((e) => e.key).join(", ")}` : ""}`,
  );

  const dun = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const bugun = new Date();

  // ── L1: BİÇİM EKSENİ — her açık seri × her dönüşüm ─────────────────────────
  let olculenDonusum = 0;
  const bozulanEski: string[] = [];
  const gecersizYeni: string[] = [];
  const yanlisSayac: string[] = [];

  for (const e of acikSeriler) {
    const taban = resolveSeriesFormat(e.key);
    const eskiler = eskiKayitlar(taban, 3, dun);
    for (const { eksen, fmt } of adayBicimler(taban)) {
      olculenDonusum++;
      // (a) ESKİ NUMARALAR BAYT BAYT AYNI: dönüşüm var olan kodlara DOKUNMAZ —
      // dizeler zaten kayıtta; ölçülen şey, yeni biçimin onları TANIMAYA devam
      // etmesidir (emekli ön ek + emekli biçim mekanizması).
      const emekliyle: NumberSeriesFormat = {
        ...fmt,
        retiredPrefixes: [...new Set([...fmt.retiredPrefixes, taban.prefix])],
        retiredFormats: [
          ...(fmt.retiredFormats ?? []),
          {
            prefix: taban.prefix, dateSegment: taban.dateSegment, digits: taban.digits,
            separator: taban.separator, separator2: taban.separator2 ?? null,
          },
        ],
      };
      for (const eski of eskiler) {
        if (!matchesSeries(emekliyle, eski.code)) bozulanEski.push(`${e.key} · ${eksen} · ${eski.code}`);
      }

      // (b) YENİ NUMARA GEÇERLİ ve (c) SAYAÇ DOĞRU YERDEN: üretim yolunun KENDİ
      // hesabı, eski kayıtlar enjekte edilerek koşturulur.
      // ⚠️ KAPSAM DAMGASI: yeni biçim BUGÜN yürürlüğe girdi ⇒ dünkü kodlar sayaca
      // GİRMEZ ve sıra 1'den başlar. Tarihli → tarihsiz geçişte bu ayrım LOAD-BEARING:
      // kapsam olmasaydı `CV2209260001` kodu "2209260001" sayısı sanılır ve sıra
      // 2.209.260.002 olurdu (ölçülmüş vaka).
      const yeniFmt: NumberSeriesFormat = { ...emekliyle, formatChangedAt: bugun };
      const kod = await nextSeriesNo(e.key, async () => eskiler, bugun, yeniFmt);
      if (!matchesSeries(yeniFmt, kod)) gecersizYeni.push(`${e.key} · ${eksen} · ${kod}`);
      const beklenenBas = seriesPrefix(yeniFmt, bugun);
      const sira = Number(kod.slice(beklenenBas.length));
      // ⚠️ BEKLENEN SIRA "her zaman 1" DEĞİL ve bu ÖLÇÜLEREK öğrenildi: kapsam
      // damgası eski kodları sayaçtan eler (sıra 1'e döner), AMA üretilen dizgi
      // zaten var olan bir kodla aynıysa üreteç onun ÜSTÜNE atlar — `@unique`
      // çakışmasını önleyen davranış budur ve dönüşüme göre değişir (hane
      // değişimi dolguyu değiştirdiği için AYNI sıra bile FARKLI bir dizgidir).
      // Dönüşümden bağımsız DEĞİŞMEZ: kod var olanlardan biri olamaz ve sıra,
      // dizgi uzayındaki İLK BOŞ değerdir.
      const cizilen = (n: number): string => `${beklenenBas}${String(n).padStart(yeniFmt.digits, "0")}`;
      const varOlan = new Set(eskiler.map((x) => x.code));
      let ilkBos = 1;
      while (varOlan.has(cizilen(ilkBos))) ilkBos++;
      if (!kod.startsWith(beklenenBas) || sira !== ilkBos || varOlan.has(kod)) {
        yanlisSayac.push(
          `${e.key} · ${eksen} · ${kod} (sıra ${sira}, ilk boş ${ilkBos}` +
            `${varOlan.has(kod) ? ", ZATEN VAR" : ""})`,
        );
      }

      // (d) ESKİ ve YENİ kod AYNI ANDA tanınır (arama/sınıflandırma yüzeyi).
      if (!matchesSeries(yeniFmt, eskiler[0]!.code)) {
        bozulanEski.push(`${e.key} · ${eksen} · ${eskiler[0]!.code} (yeni biçimde tanınmıyor)`);
      }
    }
  }

  check("L1 körlük zemini: dönüşüm gerçekten ölçüldü", olculenDonusum > 20, `${olculenDonusum} dönüşüm`);
  check("L1 ⭐ (a+d) ESKİ kodlar her dönüşümden sonra TANINMAYA devam ediyor",
    bozulanEski.length === 0, bozulanEski.slice(0, 5).join(" · "));
  check("L1 ⭐ (b) YENİ kod yeni biçime GEÇERLİ",
    gecersizYeni.length === 0, gecersizYeni.slice(0, 5).join(" · "));
  check("L1 ⭐ (c) SAYAÇ doğru yerden başlıyor (tarih rakamları sıra SANILMIYOR, var olan kod ÜSTÜNE yazılmıyor)",
    yanlisSayac.length === 0, yanlisSayac.slice(0, 5).join(" · "));

  // ── L2: KAYIT EKSENİ — gerçek kayıt, gerçek kod, gerçek sayım ─────────────
  await hedefDbEngeli();
  const DAMGA = `TEST-${process.pid.toString(36).padStart(3, "0").slice(-3)}${Date.now().toString(36).slice(-6)}`.slice(0, 14);
  const yaratilan: string[] = [];
  try {
    const musteri = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
    check("L2 körlük zemini: fikstür carisi (MUS-001) bulundu — yoksa `npm run seed:fixtures`", musteri !== null);
    if (musteri) {
      const taban = resolveSeriesFormat("packingLotCode");
      const eskiKod = await nextSeriesNo(
        "packingLotCode",
        async (full) =>
          (await prisma.packingGroup.findMany({
            where: { code: { gte: full, startsWith: full } },
            select: { code: true, createdAt: true },
          })),
        bugun,
      );
      const grup = await prisma.packingGroup.create({
        data: { customerId: musteri.id, name: `${DAMGA} e3`, code: eskiKod.slice(0, 16) },
        select: { id: true, code: true },
      });
      yaratilan.push(grup.id);
      const kayitliKod = grup.code;

      // Biçim DEĞİŞİR (tarihli → TARİHSİZ: en riskli eksen) ve eski kayıt okunur.
      const yeniFmt: NumberSeriesFormat = {
        ...taban,
        dateSegment: "NONE" as NumberSeriesDateSegment,
        retiredPrefixes: [...new Set([...taban.retiredPrefixes, taban.prefix])],
        retiredFormats: [
          ...(taban.retiredFormats ?? []),
          {
            prefix: taban.prefix, dateSegment: taban.dateSegment, digits: taban.digits,
            separator: taban.separator, separator2: taban.separator2 ?? null,
          },
        ],
        formatChangedAt: new Date(),
      };
      const tazeKayit = await prisma.packingGroup.findUnique({ where: { id: grup.id }, select: { code: true } });
      check("L2 ⭐ (a) ESKİ kaydın kodu BAYT BAYT aynı (biçim değişimi geçmişe dokunmaz)",
        tazeKayit?.code === kayitliKod, `${kayitliKod} → ${tazeKayit?.code}`);
      check("L2 ⭐ (d) ESKİ kod yeni biçimde de TANINIYOR (emekli biçim)",
        matchesSeries(yeniFmt, kayitliKod), kayitliKod);

      const yeniKod = await nextSeriesNo(
        "packingLotCode",
        async (full) =>
          (await prisma.packingGroup.findMany({
            where: { code: { gte: full, startsWith: full } },
            select: { code: true, createdAt: true },
          })),
        new Date(),
        yeniFmt,
      );
      check("L2 ⭐ (b) YENİ kod geçerli ve ESKİSİNDEN FARKLI", matchesSeries(yeniFmt, yeniKod) && yeniKod !== kayitliKod,
        `${kayitliKod} → ${yeniKod}`);
      const yeniGrup = await prisma.packingGroup.create({
        data: { customerId: musteri.id, name: `${DAMGA} e3b`, code: yeniKod.slice(0, 16) },
        select: { id: true, code: true },
      });
      yaratilan.push(yeniGrup.id);
      check("L2 ⭐ (b) YENİ kod TEKİL (aynı tabloda çakışmıyor)", yeniGrup.code === yeniKod.slice(0, 16));
      const ikisiDe = await prisma.packingGroup.count({ where: { id: { in: yaratilan } } });
      check("L2 ⭐ (e) eski ve yeni kayıt AYNI ANDA aranıp bulunuyor (etki sayısı)", ikisiDe === 2, `${ikisiDe}/2`);
    }
  } finally {
    if (yaratilan.length > 0) await prisma.packingGroup.deleteMany({ where: { id: { in: yaratilan } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await prisma.$disconnect();
  process.exit(1);
});
