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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
import { seriesImpactCount, seriesLock } from "../src/services/helpers/series-panel.helper";
import { nextSeriesNo, resolveSeriesFormat } from "../src/services/number-series.service";
import { freeDocumentService } from "../src/services/free-document.service";
import { stockCountService } from "../src/services/stock-count.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { colorService } from "../src/routes/color.routes";
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

/** `src` altındaki tüm TS kaynağı tek metin — beyan ↔ gerçek karşılaştırması için. */
function kaynakTara(dizin: string): string {
  let out = "";
  for (const ad of readdirSync(dizin)) {
    const tam = join(dizin, ad);
    if (statSync(tam).isDirectory()) out += kaynakTara(tam);
    else if (ad.endsWith(".ts")) out += readFileSync(tam, "utf-8");
  }
  return out;
}

let stockCountFikstur = 0;
let colorFikstur = 0;
/** Manifest fikstürünün açtığı iş emirleri — teardown (manifest silindikten SONRA). */
const manifestWorkOrders: string[] = [];
const SEGMENTLER = Object.keys(DATE_SEGMENTS) as NumberSeriesDateSegment[];
const AYRACLAR = ["", "-", "_", "/", "."];

/**
 * L2 YOLU — gerçek kayıt yaratma maliyeti DÜŞÜK olan seriler. Tablo BEYANDIR:
 * burada olmayan seri L1'de ölçülür ve gerekçesi basılır ("kayıt yaratmak fikstür
 * zinciri ister"). Beyan olmadan "ölçüldü" denmez.
 */
interface L2Yolu {
  /** Kaydı GERÇEK yoldan yaratır ve kodunu döndürür; `null` = fikstür kurulamadı. */
  yarat?: (damga: string) => Promise<{ id: string; kod: string } | null>;
  /** Silme — teardown. */
  sil?: (id: string) => Promise<void>;
  /** Yaratma yolu YOKSA gerekçe: neden L1'de kaldı. */
  not: string;
}

const L2_YOLU: Record<string, L2Yolu> = {
  packingLotCode: {
    not: "PackingGroup: müşteri + ad + kod, başka zincir yok.",
    yarat: async (damga) => {
      const musteri = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
      if (!musteri) return null;
      const kod = await nextSeriesNo("packingLotCode", async (full) =>
        prisma.packingGroup
          .findMany({ where: { code: { gte: full, startsWith: full } }, select: { code: true, createdAt: true } })
          .then((rows) => rows.map((r) => ({ code: r.code, createdAt: r.createdAt }))));
      const g = await prisma.packingGroup.create({
        data: { customerId: musteri.id, name: `${damga} e3`, code: kod.slice(0, 16) },
        select: { id: true, code: true },
      });
      return { id: g.id, kod: g.code };
    },
    sil: async (id) => { await prisma.packingGroup.deleteMany({ where: { id } }); },
  },
  // ⚠️ SERVİS YOLUNDAN (1e şartı 2026-09-23): her üretecin KENDİ `loadCodes`u var ve
  // E2'de değişen tam olarak o — L1 tek başına o yolu hiç koşmaz.
  freeDocument: {
    not: "FreeDocumentService.create: yalnız başlık + gövde.",
    yarat: async (damga) => {
      const r = (await freeDocumentService.create({ title: `${damga} E3`, body: "E3" })) as {
        data?: { id?: string; documentNo?: string };
      };
      return r.data?.id && r.data.documentNo ? { id: r.data.id, kod: r.data.documentNo } : null;
    },
    sil: async (id) => { await prisma.freeDocument.deleteMany({ where: { id } }); },
  },
  stockCount: {
    not: "StockCountService.create: yalnız aktif depo (fikstür deposu kurulur).",
    // ⚠️ HER ÇAĞRI KENDİ DEPOSUNU kurar: servis "bir depoda TEK açık sayım" kuralını
    // uyguluyor (409) ve ikinci kayıt aynı depoda açılamazdı — iş kuralı doğru,
    // fikstür ona uymak zorunda.
    yarat: async (damga) => {
      stockCountFikstur += 1;
      const kod = `E3${stockCountFikstur}-${damga}`.slice(0, 32);
      const depo = await prisma.warehouse.upsert({
        where: { code: kod },
        update: {},
        create: { code: kod, name: `${damga} E3 depo ${stockCountFikstur}`, isActive: true },
        select: { id: true },
      });
      const r = await stockCountService.create({ warehouseId: depo.id });
      return r.data?.id && r.data.countNo ? { id: r.data.id, kod: r.data.countNo } : null;
    },
    sil: async (id) => {
      await prisma.stockCountLine.deleteMany({ where: { stockCountId: id } });
      await prisma.stockCount.deleteMany({ where: { id } });
    },
  },
  // ── MASTER VERİ (E2 dilim 2) ──────────────────────────────────────────────
  // ⚠️ TEMSİLCİ ÖLÇÜM ve bu BEYANLI bir karar: on master veri serisi TEK üreteçten
  // doğuyor (`BaseService.nextAutoCode`). Onunu da ayrı ayrı yaratmak AYNI kod
  // yolunu on kez ölçmek olurdu; temsilci `color` L2'de koşar, diğer dokuzu
  // "aynı üreteç yolu" gerekçesiyle L1'de kalır ve bu satırda GÖRÜNÜR.
  color: {
    not: "ColorService.create: yalnız ad.",
    // ⚠️ HER ÇAĞRI FARKLI AD: servis aynı adlı ikinci rengi 409 ile reddediyor
    // (mükerrer koruması) — iş kuralı doğru, fikstür ona uymak zorunda.
    yarat: async (damga) => {
      colorFikstur += 1;
      const r = (await colorService.create({ name: `${damga} E3 renk ${colorFikstur}` })) as {
        data?: { id?: string; code?: string };
      };
      return r.data?.id && r.data.code ? { id: r.data.id, kod: r.data.code } : null;
    },
    sil: async (id) => { await prisma.color.deleteMany({ where: { id } }); },
  },
  station: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  machine: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  cashAccount: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  bankAccount: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  returnReason: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  productRecipe: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  defectType: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  warehouse: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  routeTemplate: { not: "Aynı üreteç yolu (`BaseService.nextAutoCode`); temsilci L2 serisi: color." },
  // KENDİ üreteci olanlar — L2 fikstürleri sonraki dilimde (kart zincirleri):
  customer: { not: "Kendi üreteci var; cari kartı fikstürü (vergi no/şube/cari hesap zinciri) ayrı dilimde L2'ye alınacak." },
  subcontractor: { not: "Kendi üreteci var (`ensureSubCode`); fason firma fikstürü `fixture-subcontractor.ts`ten gelir, ayrı dilimde L2'ye alınacak." },
  subcontractorCategory: { not: "Kendi üreteci var (`ensureSubCode`); ayrı dilimde L2'ye alınacak." },
  fabricProperty: { not: "Kendi üreteci var; özellik kartı fikstürü ayrı dilimde L2'ye alınacak." },
  item: { not: "Kendi üreteci var ve elle kod süzgeci taşıyor (`ITEM_CODE_SCAN_RE`); stok kartı fikstürü ayrı dilimde L2'ye alınacak." },

  // Aşağıdakiler L1'de KALDI ve gerekçesi budur (beyansız sessizlik yok):
  packingLotName: { not: "Sevk partisi ADI kendi sırasından doğar (ownCounter): ayrı bir kayıt yolu yok, kod yolu packingLotCode ile aynı gruptan gelir." },
  returnDoc: { not: "RollReturn: sevk edilmiş top + iade zinciri ister; fikstür maliyeti yüksek (test_return_no_backfill kapsıyor)." },
  // ⚠️ ÇEKİ LİSTESİ L2'YE ALINDI (1e şartı 2026-09-23): kullanıcının şikâyet ettiği
  // seri "fikstür maliyeti" gerekçesiyle L1'de kalamaz. Ölçüldü: `createManifest`
  // yalnız VAR OLAN bir iş emri ister (anlık görüntüyü kendi hesaplar) ⇒ fikstür
  // tek satır; "top zinciri gerekir" varsayımı YANLIŞTI.
  manifest: {
    not: "WorkOrderService.createManifest: yalnız var olan bir iş emri ister (anlık görüntü hesaplanır).",
    yarat: async (damga) => {
      const wo = await prisma.workOrder.create({
        data: { workOrderNumber: `${damga}-E3-${Date.now().toString(36).slice(-4)}`.slice(0, 32) },
        select: { id: true },
      });
      manifestWorkOrders.push(wo.id);
      const r = await new WorkOrderService().createManifest(wo.id);
      const d = r.data as { id?: string; manifestNo?: string } | null;
      return d?.id && d.manifestNo ? { id: d.id, kod: d.manifestNo } : null;
    },
    sil: async (id) => { await prisma.manifest.deleteMany({ where: { id } }); },
  },
  goodsReceipt: { not: "GoodsReceipt: tedarikçi + kalem + (kumaşta) top zinciri ister." },
  purchaseOrder: { not: "PurchaseOrder: tedarikçi + kalem + birim fiyat zinciri ister." },
  warehouseTransfer: { not: "WarehouseTransfer: iki depo + taşınacak GERÇEK stok ister." },
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

  // ── L0: BEYAN ↔ GERÇEK — "sayacı hazır" diyen serinin üreteci C0 yolundan mı? ──
  // ⚠️ `scopedCounter: "hazir"` bir BEYANDIR ve beyan kendi başına bir şey ölçmez:
  // üreteç eski literal yolunda kalmışsa seri panelde AÇILIR ama kapsam damgası
  // hiç uygulanmaz — tarih segmenti değişince sayaç eski rejimin kodlarını sayar.
  // Ölçüt: o serinin anahtarıyla `nextSeriesNo` çağrısı kaynakta VAR MI?
  // Muaf: kendi sayaç mekanizması olan seri (`ownCounter`) — orada C0 zaten anlamsız.
  const kaynakMetni = kaynakTara(join(__dirname, "..", "src"));
  const beyanliHazir = NUMBER_SERIES_CATALOG.filter(
    (e) => e.scopedCounter?.durum === "hazir" && !e.ownCounter,
  );
  // ⚠️ YÜKLEM BOŞLUĞA DAYANIKLI: çağrı biçimlendirici yüzünden satıra bölünebiliyor
  // (`nextSeriesNo(\n  "manifest",`) ve düz `includes` onu GÖREMİYORDU — ölçüldü,
  // bu kontrol ilk koşumda `manifest`i yanlışlıkla "üreteçsiz" saydı.
  // ⚠️ İKİ YOL, ÇÜNKÜ İKİ ÜRETİM BİÇİMİ VAR: doğrudan çağıran seri anahtarıyla
  // aranır; ORTAK bir üreteçten (ör. `BaseService.nextAutoCode`, on master veri
  // serisi) doğan seri anahtarı DEĞİŞKEN olarak geçirir ve metinde hiç görünmez —
  // o yüzden beyan üretecin YERİNİ söyler (`scopedCounter.uretec`) ve kapı o
  // dosyanın C0 yolundan geçtiğini ölçer. Beyan yoksa anahtar aranır.
  const uretecsizBeyan = beyanliHazir.filter((e) => {
    const yol = e.scopedCounter?.uretec;
    if (yol) {
      const tam = join(__dirname, "..", "src", yol);
      if (!existsSync(tam)) return true;
      return !/nextSeriesNo\s*\(/.test(readFileSync(tam, "utf-8"));
    }
    return !new RegExp(`nextSeriesNo\\(\\s*"${e.key}"`).test(kaynakMetni);
  });
  check("L0 körlük zemini: kaynak tarandı ve beyanlı seri var",
    kaynakMetni.length > 100_000 && beyanliHazir.length > 0, `${beyanliHazir.length} beyanlı seri`);
  check("L0 ⭐ `sayacı hazır` diyen her serinin üreteci C0 yolundan (`nextSeriesNo`) geçiyor",
    uretecsizBeyan.length === 0, uretecsizBeyan.map((e) => e.key).join(", ") || `${beyanliHazir.length} seri`);

  // ── L2: KAYIT EKSENİ — gerçek kayıt, gerçek kod, gerçek sayım ─────────────
  // ⚠️ SERVİS YOLUNDAN yaratılır (1e şartı): her üretecin KENDİ `loadCodes`u var ve
  // E2'de değişen tam olarak odur; L1 o yolu hiç koşmaz.
  await hedefDbEngeli();
  const DAMGA = `TEST-${process.pid.toString(36).padStart(3, "0").slice(-3)}${Date.now().toString(36).slice(-6)}`.slice(0, 14);
  const temizlik: Array<() => Promise<void>> = [];
  try {
    for (const e of acikSeriler) {
      const yol = L2_YOLU[e.key];
      if (!yol?.yarat) {
        console.log(`   ℹ️ ${e.key}: L1'de kaldı — ${yol?.not ?? "BEYAN YOK"}`);
        check(`L2 beyanı var: ${e.key} neden L1'de kaldı`, Boolean(yol?.not), yol?.not ?? "(beyansız)");
        continue;
      }
      const taban = resolveSeriesFormat(e.key);
      const kayit = await yol.yarat(DAMGA);
      check(`L2 körlük zemini: ${e.key} kaydı SERVİS yolundan yaratıldı`, kayit !== null, kayit?.kod ?? "(yaratılamadı)");
      if (!kayit) continue;
      if (yol.sil) temizlik.push(() => yol.sil!(kayit.id));

      // Biçim tarihli → TARİHSİZ (en riskli eksen) ve eski kayıt yeniden okunur.
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
      const model = (prisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> }>)[
        NUMBER_SERIES_CATALOG.find((x) => x.key === e.key)!.countTable!.model
      ];
      const alan = NUMBER_SERIES_CATALOG.find((x) => x.key === e.key)!.countTable!.field;
      const taze = await model.findUnique({ where: { id: kayit.id }, select: { [alan]: true } });
      check(`L2 ⭐ (a) ${e.key}: eski kod BAYT BAYT aynı (biçim değişimi geçmişe dokunmaz)`,
        taze?.[alan] === kayit.kod, `${kayit.kod} → ${String(taze?.[alan])}`);
      check(`L2 ⭐ (d) ${e.key}: eski kod YENİ biçimde de tanınıyor (emekli biçim)`,
        matchesSeries(yeniFmt, kayit.kod), kayit.kod);

      const ikinci = await yol.yarat(DAMGA);
      if (ikinci && yol.sil) temizlik.push(() => yol.sil!(ikinci.id));
      check(`L2 ⭐ (b) ${e.key}: ikinci kayıt YENİ ve TEKİL bir numara aldı`,
        ikinci !== null && ikinci.kod !== kayit.kod, `${kayit.kod} → ${ikinci?.kod ?? "(yok)"}`);
      // (e) ETKİ SAYISI: iki kayıt da seri sayımına giriyor.
      const sayim = await seriesImpactCount(e.key);
      check(`L2 ⭐ (e) ${e.key}: etki sayısı ikisini de kapsıyor`,
        sayim !== null && sayim >= 2, `${sayim}`);
    }
  } finally {
    for (const t of temizlik.reverse()) await t();
    // ⚠️ FK SIRASI: manifest satırları silindikten SONRA iş emirleri.
    if (manifestWorkOrders.length > 0) {
      await prisma.manifest.deleteMany({ where: { workOrderId: { in: manifestWorkOrders } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: manifestWorkOrders } } });
    }
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
