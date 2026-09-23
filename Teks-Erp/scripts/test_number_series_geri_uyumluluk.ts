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
import type { SeriesFormatAxis } from "../src/config/client-version-policy";
import { nextSeriesNo, resolveSeriesFormat } from "../src/services/number-series.service";
import { freeDocumentService } from "../src/services/free-document.service";
import { stockCountService } from "../src/services/stock-count.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { kartelaService } from "../src/services/kartela.service";
import { colorService } from "../src/routes/color.routes";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { orderService } from "../src/routes/order.routes";
import { machineService, stationService } from "../src/routes/station.routes";
import { bankAccountService, cashBoxService } from "../src/routes/finance.routes";
import { returnReasonService } from "../src/routes/return-reason.routes";
import { productRecipeService } from "../src/routes/product-recipe.routes";
import { defectTypeService } from "../src/routes/defect-type.routes";
import { warehouseService } from "../src/services/warehouse.service";
import { routeService } from "../src/routes/route.routes";
import { customerService } from "../src/routes/customer.routes";
import { fabricPropertyService } from "../src/routes/fabric-property.routes";
import { itemService } from "../src/routes/item.routes";
import {
  SubcontractorCategoryService,
  SubcontractorManagementService,
} from "../src/services/subcontractor-management.service";
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

/** Biçimin beş ekseni — "hepsi kilitli" ölçütünün tek kaynağı. */
const TUM_EKSENLER: SeriesFormatAxis[] = ["prefix", "dateSegment", "digits", "separator", "separator2"];

let stockCountFikstur = 0;
let colorFikstur = 0;
/** Master veri fikstürlerinde ad tekilliği — servisler aynı adı 409 ile reddediyor. */
let msSayac = 0;

/**
 * ⚠️ BAĞLI FİKSTÜRLER ORTAMDAN ARANMAZ, KURULUR: `findFirst` ile "ortamda ne varsa"
 * almak temiz bir CI veritabanında düşer ya da VAKUMEN yeşil kalır (bu depoda adı
 * konmuş sınıf; `test_keyfi_arama` kapıda yakaladı). Makine/özellik/rota bir
 * istasyona, reçete bir stok kartına bağlı — ikisini de bu bekçi kendi kurar.
 */
const bagli: { stationId: string | null; itemId: string | null } = { stationId: null, itemId: null };

/** `BaseService.create` sonucundan `{ id, kod }` — master veri fikstürlerinin ortak kabuğu. */
async function msCreate(
  servis: { create: (data: Record<string, unknown>, userId?: string) => Promise<unknown> },
  data: Record<string, unknown>,
): Promise<{ id: string; kod: string } | null> {
  const r = (await servis.create(data)) as { data?: { id?: string; code?: string } };
  return r.data?.id && r.data.code ? { id: r.data.id, kod: r.data.code } : null;
}
/** Manifest fikstürünün açtığı iş emirleri — teardown (manifest silindikten SONRA). */
const manifestWorkOrders: string[] = [];
/** Okutulan aile fikstürü: iş emri · depo · fason firma · top — tek kez kurulur. */
const okutulan: {
  workOrderIds: string[];
  warehouseId: string | null;
  kartelaFirmaId: string | null;
  rollIds: string[];
  kartelaDispatchIds: string[];
  kartelaReceiptIds: string[];
  swatchIds: string[];
} = {
  workOrderIds: [], warehouseId: null, kartelaFirmaId: null,
  rollIds: [], kartelaDispatchIds: [], kartelaReceiptIds: [], swatchIds: [],
};
let okutulanSayac = 0;

/**
 * Kartela zincirinin BİR TURU: depodaki taze bir top → kartela sevki → kabul.
 * Üç seriyi birden besler (`kartelaDispatch` · `kartelaReceipt` · `swatch`),
 * çünkü üçü de AYNI zincirde doğuyor; ayrı ayrı kurmak aynı zinciri üç kez
 * kurmak olurdu. Her tur KENDİ topunu yaratır: kartela sevki topu tüketir
 * (`AT_KARTELA`), yani ikinci tur aynı topu kullanamaz.
 */
async function kartelaTuru(damga: string): Promise<{
  dispatch: { id: string; kod: string } | null;
  receipt: { id: string; kod: string } | null;
  swatch: { id: string; kod: string } | null;
}> {
  const bos = { dispatch: null, receipt: null, swatch: null };
  if (!okutulan.warehouseId || !okutulan.kartelaFirmaId || !bagli.itemId) return bos;
  okutulanSayac += 1;
  const roll = await prisma.roll.create({
    data: {
      barcode: `${damga}-E3R${okutulanSayac}`.slice(0, 32),
      itemId: bagli.itemId,
      warehouseId: okutulan.warehouseId,
      status: "WAREHOUSE",
      currentQty: 10,
      initialQty: 10,
    },
    select: { id: true },
  });
  okutulan.rollIds.push(roll.id);

  const d = (await kartelaService.dispatch({
    subcontractorId: okutulan.kartelaFirmaId,
    rollIds: [roll.id],
  })) as { data?: { id?: string; dispatchNo?: string } };
  if (!d.data?.id || !d.data.dispatchNo) return bos;
  okutulan.kartelaDispatchIds.push(d.data.id);

  const r = (await kartelaService.receive({
    subcontractorId: okutulan.kartelaFirmaId,
    dispatchId: d.data.id,
    returns: [{ rollId: roll.id, count: 2, bulkLengthCm: 30, bulkWeightKg: 1 }],
  })) as { data?: { id?: string; receiptNo?: string } };
  if (!r.data?.id || !r.data.receiptNo) {
    return { dispatch: { id: d.data.id, kod: d.data.dispatchNo }, receipt: null, swatch: null };
  }
  okutulan.kartelaReceiptIds.push(r.data.id);

  const kart = await prisma.swatch.findFirst({
    where: { parentReceiptId: r.data.id },
    select: { id: true, cardNumber: true },
    orderBy: { cardNumber: "asc" },
  });
  if (kart) okutulan.swatchIds.push(kart.id);
  return {
    dispatch: { id: d.data.id, kod: d.data.dispatchNo },
    receipt: { id: r.data.id, kod: r.data.receiptNo },
    swatch: kart ? { id: kart.id, kod: kart.cardNumber } : null,
  };
}

/** Kartela turunun sonucu — üç seri de AYNI turdan okur (ikinci tur ikinci çağrıda). */
const kartelaTurlari: Array<Awaited<ReturnType<typeof kartelaTuru>>> = [];
async function kartelaTurAl(damga: string, sira: number): Promise<Awaited<ReturnType<typeof kartelaTuru>>> {
  while (kartelaTurlari.length <= sira) kartelaTurlari.push(await kartelaTuru(damga));
  return kartelaTurlari[sira]!;
}
let kdSira = 0, krSira = 0, kwSira = 0;
/** Mal kabul/alış siparişi fikstürlerinin açtığı yardımcı kayıtlar (teardown sırası). */
const temizlikDepolari: string[] = [];
const temizlikCariler: string[] = [];
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
  // ⚠️ TEMSİLCİ ÖLÇÜM REDDEDİLDİ (1e, 2026-09-23) ve gerekçe ölçülmüş bir vakaya
  // dayanıyor: yol ortak olsa da her seri o yola KENDİ yapılandırmasını veriyor
  // (hangi model, hangi alan, `createdAt` seçiliyor mu, süzgeç var mı) — ve
  // `ensureSubCode`te kırılan tam olarak buydu. Her seri KENDİ kaydıyla ölçülür.
  station: {
    not: "StationService.create: ad + tür.",
    yarat: async (damga) => msCreate(stationService, { name: `${damga} E3 istasyon ${++msSayac}`, type: "INTERNAL" }),
    sil: async (id) => { await prisma.station.deleteMany({ where: { id } }); },
  },
  machine: {
    not: "machineService.create: ad + istasyon (fikstür istasyonu kurulur).",
    yarat: async (damga) => {
      if (!bagli.stationId) return null;
      return msCreate(machineService, { name: `${damga} E3 makine ${++msSayac}`, stationId: bagli.stationId });
    },
    sil: async (id) => { await prisma.machine.deleteMany({ where: { id } }); },
  },
  cashAccount: {
    not: "cashBoxService.create: yalnız ad.",
    yarat: async (damga) => msCreate(cashBoxService, { name: `${damga} E3 kasa ${++msSayac}` }),
    sil: async (id) => { await prisma.cashBox.deleteMany({ where: { id } }); },
  },
  bankAccount: {
    not: "bankAccountService.create: yalnız ad.",
    yarat: async (damga) => msCreate(bankAccountService, { name: `${damga} E3 banka ${++msSayac}` }),
    sil: async (id) => { await prisma.bankAccount.deleteMany({ where: { id } }); },
  },
  returnReason: {
    not: "returnReasonService.create: yalnız ad.",
    yarat: async (damga) => msCreate(returnReasonService, { name: `${damga} E3 sebep ${++msSayac}` }),
    sil: async (id) => { await prisma.returnReason.deleteMany({ where: { id } }); },
  },
  productRecipe: {
    not: "productRecipeService.create: ad + bağlı stok kartı.",
    yarat: async (damga) => {
      if (!bagli.itemId) return null;
      return msCreate(productRecipeService, { name: `${damga} E3 reçete ${++msSayac}`, itemId: bagli.itemId });
    },
    sil: async (id) => { await prisma.productRecipe.deleteMany({ where: { id } }); },
  },
  defectType: {
    not: "defectTypeService.create: yalnız ad.",
    yarat: async (damga) => msCreate(defectTypeService, { name: `${damga} E3 hata ${++msSayac}` }),
    sil: async (id) => { await prisma.defectType.deleteMany({ where: { id } }); },
  },
  warehouse: {
    not: "warehouseService.create: yalnız ad.",
    yarat: async (damga) => msCreate(warehouseService, { name: `${damga} E3 depo ${++msSayac}` }),
    sil: async (id) => { await prisma.warehouse.deleteMany({ where: { id } }); },
  },
  routeTemplate: {
    not: "routeService.create: ad + en az bir adım.",
    yarat: async (damga) => {
      if (!bagli.stationId) return null;
      return msCreate(routeService, {
        name: `${damga} E3 rota ${++msSayac}`,
        steps: [{ stationId: bagli.stationId, sequence: 1 }],
      });
    },
    sil: async (id) => {
      await prisma.routeStep.deleteMany({ where: { routeId: id } });
      await prisma.route.deleteMany({ where: { id } });
    },
  },
  customer: {
    not: "customerService.create: yalnız ad.",
    yarat: async (damga) => msCreate(customerService, { name: `${damga} E3 cari ${++msSayac}` }),
    sil: async (id) => { await prisma.customer.deleteMany({ where: { id } }); },
  },
  fabricProperty: {
    not: "fabricPropertyService.create: ad + uygulayan istasyon(lar).",
    yarat: async (damga) => {
      if (!bagli.stationId) return null;
      return msCreate(fabricPropertyService, {
        name: `${damga} E3 özellik ${++msSayac}`,
        stationIds: [bagli.stationId],
      });
    },
    sil: async (id) => { await prisma.fabricProperty.deleteMany({ where: { id } }); },
  },
  item: {
    not: "itemService.create: ad + tür (itemType).",
    yarat: async (damga) => msCreate(itemService, { name: `${damga} E3 stok ${++msSayac}`, itemType: "FABRIC" }),
    sil: async (id) => { await prisma.item.deleteMany({ where: { id } }); },
  },
  subcontractor: {
    not: "SubcontractorManagementService.create: yalnız ad.",
    yarat: async (damga) => {
      const r = await new SubcontractorManagementService().create({ name: `${damga} E3 fason ${++msSayac}` });
      const d = r.data as { id?: string; code?: string } | null;
      return d?.id && d.code ? { id: d.id, kod: d.code } : null;
    },
    sil: async (id) => { await prisma.subcontractor.deleteMany({ where: { id } }); },
  },
  subcontractorCategory: {
    not: "SubcontractorCategoryService.create: yalnız ad.",
    yarat: async (damga) => {
      const r = await new SubcontractorCategoryService().create({ name: `${damga} E3 kategori ${++msSayac}` });
      const d = r.data as { id?: string; code?: string } | null;
      return d?.id && d.code ? { id: d.id, kod: d.code } : null;
    },
    sil: async (id) => { await prisma.subcontractorCategory.deleteMany({ where: { id } }); },
  },

  // Aşağıdakiler L1'de KALDI ve gerekçesi budur (beyansız sessizlik yok):
  packingLotName: { not: "Sevk partisi ADI kendi sırasından doğar (ownCounter): ayrı bir kayıt yolu yok, kod yolu packingLotCode ile aynı gruptan gelir." },
  returnDoc: { not: "RollReturn: sevk edilmiş top + iade zinciri ister; fikstür maliyeti yüksek (test_return_no_backfill kapsıyor)." },
  // ⚠️ ÇEKİ LİSTESİ L2'YE ALINDI (1e şartı 2026-09-23): kullanıcının şikâyet ettiği
  // seri "fikstür maliyeti" gerekçesiyle L1'de kalamaz. Ölçüldü: `createManifest`
  // yalnız VAR OLAN bir iş emri ister (anlık görüntüyü kendi hesaplar) ⇒ fikstür
  // tek satır; "top zinciri gerekir" varsayımı YANLIŞTI.
  // ── ÜRETİM (E2 dilim 4) ───────────────────────────────────────────────────
  order: {
    not: "orderService.create: müşteri + en az bir kalem (miktar > 0).",
    yarat: async (damga) => {
      const musteri = await msCreate(customerService, { name: `${damga} E3 sipariş cari ${++msSayac}` });
      if (!musteri || !bagli.itemId) return null;
      temizlikCariler.push(musteri.id);
      const r = (await orderService.create({
        customerId: musteri.id,
        lines: [{ itemId: bagli.itemId, quantity: 5 }],
      })) as { data?: { id?: string; orderNumber?: string } };
      return r.data?.id && r.data.orderNumber ? { id: r.data.id, kod: r.data.orderNumber } : null;
    },
    sil: async (id) => {
      await prisma.orderLine.deleteMany({ where: { orderId: id } });
      await prisma.order.deleteMany({ where: { id } });
    },
  },
  // ── OKUTULAN AİLE (E2 dilim 5) ────────────────────────────────────────────
  // ⚠️ İş emri fikstürü ÖLÇÜLDÜ, tahmin edilmedi: `WorkOrderCreateInput` yalnız
  // `steps[].stationId` istiyor (rota şablonu verilmezse) — "sipariş + rota + top
  // zinciri gerekir" beklentim YANLIŞTI (manifest/mal kabul dersinin üçüncüsü).
  workOrder: {
    not: "WorkOrderService.create: rota şablonu yoksa yalnız bir adım (istasyon) ister.",
    yarat: async () => {
      if (!bagli.stationId) return null;
      const r = (await new WorkOrderService().create({
        type: "STOCK_PRODUCTION",
        targetItemId: bagli.itemId,
        steps: [{ stationId: bagli.stationId }],
      })) as { data?: { id?: string; workOrderNumber?: string } };
      if (r.data?.id) okutulan.workOrderIds.push(r.data.id);
      return r.data?.id && r.data.workOrderNumber ? { id: r.data.id, kod: r.data.workOrderNumber } : null;
    },
    // Silme YOK: iş emri + adımları + kartı zincirle siliniyor (toplu temizlikte).
  },
  kartelaDispatch: {
    not: "KartelaService.dispatch: kartela firması + DEPODAKİ top (zincir `kartelaTuru`da, üç seri ortak).",
    yarat: async (damga) => (await kartelaTurAl(damga, kdSira++)).dispatch,
  },
  kartelaReceipt: {
    not: "KartelaService.receive: açık kartela sevki + dönen top adedi (aynı zincir).",
    yarat: async (damga) => (await kartelaTurAl(damga, krSira++)).receipt,
  },
  swatch: {
    not: "Kartela kartı kabul anında doğar (KartelaService.receive) — ayrı bir yaratma ucu YOK; aynı zincirden okunur.",
    yarat: async (damga) => (await kartelaTurAl(damga, kwSira++)).swatch,
  },
  subcontractorDispatch: { not: "Fason sevk: iş emri + FASON adımı + o adıma bağlı top zinciri ister (ölçüldü: `dispatch` WO durumu PLANNED/IN_PROGRESS + stepId + rollIds istiyor); sıradaki dilimde." },
  subcontractorReceipt: { not: "Fason kabul: önce bir fason SEVKİ ister (aynı zincirin ikinci yarısı); sıradaki dilimde." },
  directShipment: { not: "Doğrudan sevk: açık bir fason sevki ister (fason zincirinin üstüne biner); sıradaki dilimde." },
  weavingOrder: { not: "Dokuma işi: tezgah + levent + çözgü kartı zinciri ister (E2 üretim diliminde AÇILDI; L2 fikstürü sıradaki turda — ölçülecek)." },
  warpBeam: { not: "Levent: çözgü kartı + tezgah zinciri ister (aynı tur)." },
  doffEvent: { not: "Doff: açık tezgah koşusu (MachineRun) ister (aynı tur)." },
  shipment: { not: "Sevkiyat: müşteri + çuval zinciri ister; E4 ile YENİ açıldı, L2 fikstürü sıradaki dilimde (ölçülecek, tahmin edilmeyecek)." },
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
  // ⚠️ İKİSİ DE ÖLÇÜLDÜ ve "zincir ister" gerekçem YANLIŞ ÇIKTI (manifest dersinin
  // tekrarı): mal kabul fişi yalnız DEPO istiyor (kalemler opsiyonel), alış
  // siparişi tedarikçi + tek kalem. Tahmin değil imza okundu.
  goodsReceipt: {
    not: "GoodsReceiptService.create: yalnız depo (kalemler opsiyonel).",
    yarat: async (damga) => {
      const depo = await msCreate(warehouseService, { name: `${damga} E3 mk depo ${++msSayac}` });
      if (!depo) return null;
      temizlikDepolari.push(depo.id);
      const r = await goodsReceiptService.create({ warehouseId: depo.id });
      const d = r.data as { id?: string; receiptNo?: string } | null;
      return d?.id && d.receiptNo ? { id: d.id, kod: d.receiptNo } : null;
    },
    sil: async (id) => { await prisma.goodsReceipt.deleteMany({ where: { id } }); },
  },
  purchaseOrder: {
    not: "purchaseOrderService.create: tedarikçi (cari) + tek kalem.",
    yarat: async (damga) => {
      const tedarikci = await msCreate(customerService, { name: `${damga} E3 tedarikçi ${++msSayac}` });
      if (!tedarikci || !bagli.itemId) return null;
      temizlikCariler.push(tedarikci.id);
      const r = await purchaseOrderService.create({
        supplierId: tedarikci.id,
        lines: [{ itemId: bagli.itemId, qty: 10 }],
      });
      const d = r.data as { id?: string; orderNo?: string } | null;
      return d?.id && d.orderNo ? { id: d.id, kod: d.orderNo } : null;
    },
    sil: async (id) => {
      await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      await prisma.purchaseOrder.deleteMany({ where: { id } });
    },
  },
  warehouseTransfer: { not: "WarehouseTransfer: iki depo + taşınacak GERÇEK stok ister." },
};

/** Bu koşumda üretilen aday biçimler — her eksen ayrı bir dönüşüm. */
/**
 * ⚠️ HER ADAY KENDİ EKSEN KODUNU TAŞIR (`kod`) ve bu ölçülmüş bir ihtiyaç:
 * `ISTEMCI` kilidi artık EKSEN DÜZEYİNDE — `kartelaDispatch` bugün yalnız ÖN EKTE
 * kilitli, tarih/hane/ayraç serbest. Adayları yalnız insan-okur etiketle
 * ayırsaydık "hangi aday hangi eksen" sorusu metin eşlemesiyle cevaplanırdı ve
 * bir etiket değişince süzme sessizce yanlışlanırdı.
 */
function adayBicimler(taban: NumberSeriesFormat): Array<{ eksen: string; eksenKodu: SeriesFormatAxis; fmt: NumberSeriesFormat }> {
  const out: Array<{ eksen: string; eksenKodu: SeriesFormatAxis; fmt: NumberSeriesFormat }> = [];
  out.push({ eksen: "ön ek", eksenKodu: "prefix", fmt: { ...taban, prefix: "ZZQ" } });
  for (const seg of SEGMENTLER) {
    if (seg === taban.dateSegment) continue;
    out.push({ eksen: `tarih ${seg}`, eksenKodu: "dateSegment", fmt: { ...taban, dateSegment: seg } });
  }
  out.push({ eksen: "hane +2", eksenKodu: "digits", fmt: { ...taban, digits: Math.min(8, taban.digits + 2) } });
  out.push({ eksen: "hane -1", eksenKodu: "digits", fmt: { ...taban, digits: Math.max(1, taban.digits - 1) } });
  for (const a of AYRACLAR) {
    if (a === taban.separator) continue;
    out.push({ eksen: `ayraç1 "${a}"`, eksenKodu: "separator", fmt: { ...taban, separator: a } });
  }
  for (const a of AYRACLAR) {
    if (a === (taban.separator2 ?? "")) continue;
    out.push({ eksen: `ayraç2 "${a}"`, eksenKodu: "separator2", fmt: { ...taban, separator2: a } });
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

  // ⚠️ "AÇIK" ARTIK İKİ HÂLLİ: kilitsiz seri + YALNIZ BAZI EKSENLERİ kilitli seri.
  // Kısmi kilit bir SERİ kilidi değildir (ölçüldü 2026-09-23, `test_eski_istemci_okutma`:
  // kartela sevk/kabul yalnız ÖN EKTE kırılıyor, tarih/hane/ayraç bugün serbest) —
  // eski "kilit varsa hiç ölçme" kuralı bu serilerin BUGÜN yapılabilen değişimlerini
  // kör bırakıyordu. Kilitli eksen ölçüm DIŞI kalır, serbest eksen ölçülür.
  const kilitliEksenler = (key: string): SeriesFormatAxis[] => {
    const k = seriesLock(key);
    if (k === null) return [];
    if (k.kind === "ISTEMCI") return k.lockedAxes ?? [];
    return TUM_EKSENLER; // YAPISAL / SAYAC: hiçbir eksen açık değil
  };
  const acikSeriler = NUMBER_SERIES_CATALOG.filter(
    (e) => kilitliEksenler(e.key).length < TUM_EKSENLER.length,
  );
  const kismiAcik = acikSeriler.filter((e) => kilitliEksenler(e.key).length > 0);
  check("körlük zemini: ölçülecek AÇIK seri var", acikSeriler.length > 0, `${acikSeriler.length} seri`);
  console.log(`   ℹ️ açık seriler: ${acikSeriler.map((e) => e.key).join(", ")}`);
  if (kismiAcik.length > 0) {
    console.log(
      `   ℹ️ kısmi açık (eksen kilidi): ${kismiAcik.map((e) => `${e.key}[kilitli: ${kilitliEksenler(e.key).join("+")}]`).join(", ")}`,
    );
  }
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
    const kapali = new Set(kilitliEksenler(e.key));
    for (const { eksen, eksenKodu, fmt } of adayBicimler(taban)) {
      if (kapali.has(eksenKodu)) continue; // eksen bugün kilitli — ölçülecek bir dönüşüm değil
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
  // ⚠️ BEYAN LİSTE OLABİLİR ve HEPSİ ölçülür: bir serinin iki üreteci varsa
  // (`workOrder`, `subcontractorDispatch`) yalnız birincisini açmak, ikincisi
  // eski literal hesapta kalsa bile beyanı YEŞİL gösterirdi.
  // ⚠️ `nextSeriesSeq` de C0 yoludur: aynı çekirdeği (`scopedNextSeq`) çağırır —
  // kodu çağıranın kurduğu toplu yollar (kartela kabulü) sırayı ister, kodu değil.
  const uretecsizBeyan = beyanliHazir.filter((e) => {
    const beyan = e.scopedCounter?.uretec;
    if (beyan) {
      const yollar = typeof beyan === "string" ? [beyan] : beyan;
      return yollar.some((yol) => {
        const tam = join(__dirname, "..", "src", yol);
        if (!existsSync(tam)) return true;
        return !/next(SeriesNo|SeriesSeq)\s*\(/.test(readFileSync(tam, "utf-8"));
      });
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
    // Bağlı fikstürler ÖNCE ve KENDİ servis yollarından (ortamdan aranmaz).
    const istasyon = await msCreate(stationService, { name: `${DAMGA} E3 bağlı istasyon`, type: "INTERNAL" });
    if (istasyon) {
      bagli.stationId = istasyon.id;
      temizlik.push(async () => { await prisma.station.deleteMany({ where: { id: istasyon.id } }); });
    }
    const stok = await msCreate(itemService, { name: `${DAMGA} E3 bağlı stok`, itemType: "FABRIC" });
    if (stok) {
      bagli.itemId = stok.id;
      temizlik.push(async () => { await prisma.item.deleteMany({ where: { id: stok.id } }); });
    }
    // Okutulan ailenin zinciri: DEPO (top stok kümesinde olmalı, K6) + KARTELA FİRMASI.
    const kDepo = await prisma.warehouse.create({
      data: { code: `${DAMGA}-E3KD`.slice(0, 32), name: `${DAMGA} E3 kartela depo`, isActive: true },
      select: { id: true },
    });
    okutulan.warehouseId = kDepo.id;
    temizlikDepolari.push(kDepo.id);
    const kFirma = await prisma.subcontractor.create({
      data: { code: `${DAMGA}-E3KF`.slice(0, 32), name: `${DAMGA} E3 kartela firma`, isActive: true },
      select: { id: true },
    });
    okutulan.kartelaFirmaId = kFirma.id;

    check("L2 körlük zemini: bağlı fikstürler (istasyon + stok + kartela zinciri) KURULDU",
      bagli.stationId !== null && bagli.itemId !== null &&
      okutulan.warehouseId !== null && okutulan.kartelaFirmaId !== null);

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
    // ⚠️ OKUTULAN AİLE ÖNCE, `temizlik`ten DE ÖNCE: bu kayıtlar BAĞLI
    // fikstürlere (stok kartı, istasyon) dayanıyor ve `temizlik` onları
    // siliyor. Ters sıra `rolls_itemId_fkey` ile patlar ve `finally`de
    // patlayan bir temizlik ARTIK BIRAKIR (ölçüldü 2026-09-23).
    // ⚠️ OKUTULAN AİLE — FK SIRASI YAPRAKTAN KÖKE: kart → kabul kalemi → kabul →
    // sevk kalemi → sevk → top → firma. Ters sıra FK ihlali verir ve `finally`
    // içinde patlayan bir temizlik ARTIK BIRAKIR (bir sonraki koşumu kirletir).
    if (okutulan.swatchIds.length > 0) {
      await prisma.swatch.deleteMany({ where: { id: { in: okutulan.swatchIds } } });
    }
    if (okutulan.kartelaReceiptIds.length > 0) {
      await prisma.swatch.deleteMany({ where: { parentReceiptId: { in: okutulan.kartelaReceiptIds } } });
      await prisma.kartelaReceiptItem.deleteMany({ where: { receiptId: { in: okutulan.kartelaReceiptIds } } });
      await prisma.kartelaReceipt.deleteMany({ where: { id: { in: okutulan.kartelaReceiptIds } } });
    }
    if (okutulan.kartelaDispatchIds.length > 0) {
      await prisma.kartelaDispatchItem.deleteMany({ where: { dispatchId: { in: okutulan.kartelaDispatchIds } } });
      await prisma.kartelaDispatch.deleteMany({ where: { id: { in: okutulan.kartelaDispatchIds } } });
    }
    if (okutulan.rollIds.length > 0) {
      await prisma.roll.deleteMany({ where: { id: { in: okutulan.rollIds } } });
    }
    if (okutulan.kartelaFirmaId) {
      await prisma.subcontractor.deleteMany({ where: { id: okutulan.kartelaFirmaId } });
    }
    if (okutulan.workOrderIds.length > 0) {
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: okutulan.workOrderIds } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: okutulan.workOrderIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: okutulan.workOrderIds } } });
    }
    for (const t of temizlik.reverse()) await t();
    // ⚠️ FK SIRASI: önce belgeler (yukarıdaki `temizlik`), sonra onların dayandığı
    // depo/cari kayıtları, en sonda manifest ↔ iş emri zinciri.
    if (temizlikDepolari.length > 0) {
      await prisma.warehouse.deleteMany({ where: { id: { in: temizlikDepolari } } });
    }
    if (temizlikCariler.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: temizlikCariler } } });
    }
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
