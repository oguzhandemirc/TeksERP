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

import { seriesCounterReadsLastBorn } from "../src/services/helpers/series-counter.helper";
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
import { updateSeriesFormat } from "../src/services/helpers/series-write.helper";
import type { SeriesFormatAxis } from "../src/config/client-version-policy";
import { nextSeriesNo, refreshNumberSeriesCache, resolveSeriesFormat } from "../src/services/number-series.service";
import { freeDocumentService } from "../src/services/free-document.service";
import { stockCountService } from "../src/services/stock-count.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { kartelaService } from "../src/services/kartela.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { chequeService } from "../src/services/cheque.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { chequeDeliveryNoteService } from "../src/services/cheque-delivery-note.service";
import { reconciliationLetterService } from "../src/services/reconciliation-letter.service";
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
  externalStationId: string | null;
  fasonFirmaId: string | null;
  musteriId: string | null;
  fasonDispatchIds: string[];
  fasonReceiptIds: string[];
  directShipmentIds: string[];
} = {
  workOrderIds: [], warehouseId: null, kartelaFirmaId: null,
  rollIds: [], kartelaDispatchIds: [], kartelaReceiptIds: [], swatchIds: [],
  externalStationId: null, fasonFirmaId: null, musteriId: null,
  fasonDispatchIds: [], fasonReceiptIds: [], directShipmentIds: [],
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

/**
 * FASON zincirinin BİR TURU: EXTERNAL adımlı iş emri + serbest stok topu →
 * fason sevki → kabul; ikinci bir sevk de DOĞRUDAN SEVK edilir.
 *
 * Üç seriyi birden besler (`subcontractorDispatch` · `subcontractorReceipt` ·
 * `directShipment`) çünkü üçü de AYNI zincirde doğuyor. Ölçülen ön koşullar:
 * adımın istasyonu EXTERNAL, iş emri PLANNED/IN_PROGRESS, top `STOCK` +
 * adımsız + çuvalsız (o hâlde sevk onu kendisi adıma bağlar), doğrudan sevkte
 * müşteri ve en az 3 karakterlik sebep ZORUNLU.
 */
async function fasonTuru(damga: string): Promise<{
  dispatch: { id: string; kod: string } | null;
  receipt: { id: string; kod: string } | null;
  direct: { id: string; kod: string } | null;
}> {
  const bos = { dispatch: null, receipt: null, direct: null };
  if (!okutulan.externalStationId || !okutulan.fasonFirmaId || !bagli.itemId) return bos;
  const svc = new SubcontractorService();

  const yeniTop = async (): Promise<string> => {
    okutulanSayac += 1;
    const r = await prisma.roll.create({
      data: {
        barcode: `${damga}-E3F${okutulanSayac}`.slice(0, 32),
        itemId: bagli.itemId!,
        // K6: deposuz top stok kümesinden ÇIKAMAZ — fason sevki tam olarak bunu
        // yapıyor, o yüzden fikstür topu bir depoda doğar.
        warehouseId: okutulan.warehouseId,
        status: "STOCK",
        currentQty: 20,
        initialQty: 20,
      },
      select: { id: true },
    });
    okutulan.rollIds.push(r.id);
    return r.id;
  };
  const yeniIsEmri = async (): Promise<{ woId: string; stepId: string } | null> => {
    const r = (await new WorkOrderService().create({
      type: "STOCK_PRODUCTION",
      targetItemId: bagli.itemId,
      steps: [{ stationId: okutulan.externalStationId! }],
    })) as { data?: { id?: string } };
    if (!r.data?.id) return null;
    okutulan.workOrderIds.push(r.data.id);
    const step = await prisma.workOrderStep.findFirst({
      where: { workOrderId: r.data.id },
      select: { id: true },
    });
    return step ? { woId: r.data.id, stepId: step.id } : null;
  };

  // ① Sevk + kabul
  const a = await yeniIsEmri();
  if (!a) return bos;
  const d1 = (await svc.dispatch({
    workOrderId: a.woId, stepId: a.stepId,
    subcontractorId: okutulan.fasonFirmaId, rollIds: [await yeniTop()],
  })) as { data?: { id?: string; dispatchNo?: string } };
  if (!d1.data?.id || !d1.data.dispatchNo) return bos;
  okutulan.fasonDispatchIds.push(d1.data.id);

  const gonderilen = await prisma.subcontractorDispatchItem.findMany({
    where: { dispatchId: d1.data.id },
    select: { rollId: true },
  });
  const k1 = (await svc.receive({
    workOrderId: a.woId, stepId: a.stepId, subcontractorId: okutulan.fasonFirmaId,
    returns: gonderilen
      .map((x) => x.rollId)
      .filter((x): x is string => x !== null)
      .map((rollId) => ({ rollId })),
  })) as { data?: { id?: string; receiptNo?: string } };
  if (k1.data?.id) okutulan.fasonReceiptIds.push(k1.data.id);

  // ② İKİNCİ sevk — doğrudan sevk edilir (kabul edilen sevk tüketildi).
  const b = await yeniIsEmri();
  if (!b) {
    return {
      dispatch: { id: d1.data.id, kod: d1.data.dispatchNo },
      receipt: k1.data?.id && k1.data.receiptNo ? { id: k1.data.id, kod: k1.data.receiptNo } : null,
      direct: null,
    };
  }
  const d2 = (await svc.dispatch({
    workOrderId: b.woId, stepId: b.stepId,
    subcontractorId: okutulan.fasonFirmaId, rollIds: [await yeniTop()],
  })) as { data?: { id?: string } };
  let direct: { id: string; kod: string } | null = null;
  // ⚠️ AYRI `try`: doğrudan sevk düşerse sevk ve kabul sonuçları YİNE bildirilir —
  // üç iddiayı tek halkanın kaderine bağlamak, çalışan iki seriyi de kör bırakırdı.
  try {
   if (d2.data?.id && okutulan.musteriId) {
    okutulan.fasonDispatchIds.push(d2.data.id);
    await svc.executeDirectShip({
      dispatchId: d2.data.id,
      reason: "E3 uyumluluk matrisi fikstürü",
      customerId: okutulan.musteriId,
      orderless: true,
    });
    const ds = await prisma.directShipment.findFirst({
      where: { dispatchId: d2.data.id },
      select: { id: true, shipmentNo: true },
      orderBy: { createdAt: "desc" },
    });
    if (ds) {
      okutulan.directShipmentIds.push(ds.id);
      direct = { id: ds.id, kod: ds.shipmentNo };
    }
   }
  } catch (e) {
    console.log(`   ⚠️ doğrudan sevk kurulamadı: ${(e as Error).message}`);
  }
  return {
    dispatch: { id: d1.data.id, kod: d1.data.dispatchNo },
    receipt: k1.data?.id && k1.data.receiptNo ? { id: k1.data.id, kod: k1.data.receiptNo } : null,
    direct,
  };
}

const fasonTurlari: Array<Awaited<ReturnType<typeof fasonTuru>>> = [];
/**
 * ⚠️ ÇÖKEN FİKSTÜR BEKÇİYİ ÇÖKERTMEZ: zincirin herhangi bir halkası 4xx atarsa
 * sonuç boş döner, ilgili iddia KIRMIZI olur ve sebep basılır. Çöken bir sonda
 * sonda değildir — teardown bile koşmadan düşer ve bir sonraki koşumu kirletir.
 */
async function fasonTurAl(damga: string, sira: number): Promise<Awaited<ReturnType<typeof fasonTuru>>> {
  while (fasonTurlari.length <= sira) {
    try {
      fasonTurlari.push(await fasonTuru(damga));
    } catch (e) {
      console.log(`   ⚠️ fason zinciri kurulamadı: ${(e as Error).message}`);
      fasonTurlari.push({ dispatch: null, receipt: null, direct: null });
    }
  }
  return fasonTurlari[sira]!;
}
let fdSira = 0, frSira = 0, dsSira = 0;

/**
 * FİNANS fikstürü — ortak bağlar: cari (müşteri) + kasa. Her seri KENDİ gerçek
 * kaydını yaratır; "aynı servis, temsilci yeter" reddedildi (1e şartı): fatura
 * TÜRÜ ön eki belirliyor ve sayaç ön ekle bölünüyor, yani dört tür DÖRT AYRI
 * sayaç uzayıdır — birini ölçmek ötekini ölçmez.
 */
const finans: {
  musteriId: string | null;
  cariId: string | null;
  kasaId: string | null;
  invoiceIds: string[];
  paymentIds: string[];
  chequeIds: string[];
  cashTxnIds: string[];
  noteIds: string[];
  letterIds: string[];
} = {
  musteriId: null, cariId: null, kasaId: null,
  invoiceIds: [], paymentIds: [], chequeIds: [], cashTxnIds: [], noteIds: [], letterIds: [],
};

/** Fatura — tür PARAMETRE, kayıt her çağrıda YENİ (dört seri aynı yolu kullanır). */
async function finansFatura(tur: "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN") {
  if (!finans.musteriId) return null;
  // ⚠️ UCUN ADI `createDraft` — fatura TASLAK doğar ve belge NUMARASI taslakta
  // zaten verilir (`nextInvoiceNoTx`, onayda değil). Ölçülen yol budur.
  const r = await invoiceService.createDraft({
    type: tur as never,
    customerId: finans.musteriId,
    lines: [{ description: "E3", qty: 1, unit: "m", unitPrice: 10 }],
  });
  if (!r.data?.id) return null;
  finans.invoiceIds.push(r.data.id);
  return { id: r.data.id, kod: r.data.docNo };
}

async function finansOdeme(yon: "IN" | "OUT") {
  if (!finans.musteriId || !finans.kasaId) return null;
  const r = await paymentService.create({
    direction: yon as never, method: "CASH" as never,
    customerId: finans.musteriId, amount: 5, cashBoxId: finans.kasaId,
  });
  if (!r.data?.id) return null;
  finans.paymentIds.push(r.data.id);
  return { id: r.data.id, kod: r.data.docNo };
}

async function finansCek(kind: "RECEIVED" | "ISSUED", docType: "CHEQUE" | "PROMISSORY_NOTE") {
  if (!finans.musteriId) return null;
  const r = await chequeService.create({
    kind: kind as never, docType: docType as never,
    customerId: finans.musteriId, amount: 100,
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  if (!r.data?.id) return null;
  finans.chequeIds.push(r.data.id);
  return { id: r.data.id, kod: r.data.docNo };
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
  // Parti numarasının İKİ REJİMİ: hangisinin koşacağını `batch.shortNumberEnabled`
  // bayrağı seçer, yani L2 yaratma yolu bayrağı DEĞİŞTİRMEDEN kurulamaz — ve
  // bayrağı değiştirmek fabrikanın numara rejimini bekçi koşumu sırasında
  // oynatmak demektir. Rejim aritmetiği kendi bekçisinde sahte tx ile ölçülüyor
  // (`test_batch_number_format` §0/§0b/§0c/§1/§3, 56 iddia).
  batchDaily: { not: "İki rejimli üreteç; L2 yolu `batch.shortNumberEnabled` bayrağını oynatmayı gerektirir — rejim aritmetiği `test_batch_number_format`ta sahte tx ile ölçülüyor." },
  batchShort: { not: "İki rejimli üreteç; L2 yolu `batch.shortNumberEnabled` bayrağını oynatmayı gerektirir — sarma ve aralık `test_batch_number_format` §0/§0b/§0c'de ölçülüyor." },
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
  // ── FİNANS (E2 dilim 6) ───────────────────────────────────────────────────
  // ⚠️ DÖRT FATURA TÜRÜ DÖRT AYRI KAYIT: tür ön eki belirliyor ve sayaç ön ekle
  // bölünüyor — "aynı servis, biri yeter" burada YANLIŞ olurdu.
  invoiceSales: { not: "InvoiceService.create: cari + tek kalem.", yarat: async () => finansFatura("SALES") },
  invoicePurchase: { not: "InvoiceService.create (alış).", yarat: async () => finansFatura("PURCHASE") },
  invoiceSalesReturn: { not: "InvoiceService.create (satış iade).", yarat: async () => finansFatura("SALES_RETURN") },
  invoicePurchaseReturn: { not: "InvoiceService.create (alış iade).", yarat: async () => finansFatura("PURCHASE_RETURN") },
  paymentIn: { not: "PaymentService.create: cari + kasa + tutar (tahsilat).", yarat: async () => finansOdeme("IN") },
  paymentOut: { not: "PaymentService.create (ödeme).", yarat: async () => finansOdeme("OUT") },
  chequeReceived: { not: "ChequeService.create: cari + tutar + vade (alınan çek).", yarat: async () => finansCek("RECEIVED", "CHEQUE") },
  chequeIssued: { not: "ChequeService.create (verilen çek).", yarat: async () => finansCek("ISSUED", "CHEQUE") },
  noteReceived: { not: "ChequeService.create (alınan senet).", yarat: async () => finansCek("RECEIVED", "PROMISSORY_NOTE") },
  noteIssued: { not: "ChequeService.create (verilen senet).", yarat: async () => finansCek("ISSUED", "PROMISSORY_NOTE") },
  cashTransaction: {
    not: "CashTransactionService.create: kasa + tutar.",
    yarat: async () => {
      if (!finans.kasaId) return null;
      const r = await cashTransactionService.create({ kind: "INCOME" as never, amount: 7, cashBoxId: finans.kasaId });
      if (!r.data?.id) return null;
      finans.cashTxnIds.push(r.data.id);
      return { id: r.data.id, kod: r.data.docNo };
    },
  },
  chequeDeliveryNote: {
    not: "ChequeDeliveryNoteService.create: en az bir çek (fikstür kendi çekini açar).",
    yarat: async () => {
      const cek = await finansCek("RECEIVED", "CHEQUE");
      if (!cek) return null;
      const r = await chequeDeliveryNoteService.create({ chequeIds: [cek.id] } as never);
      if (!r.data?.id) return null;
      finans.noteIds.push(r.data.id);
      return { id: r.data.id, kod: r.data.docNo };
    },
  },
  reconciliationLetter: {
    not: "ReconciliationLetterService.create: cari hesap (müşteri kartından LAZY açılır).",
    yarat: async () => {
      // ⚠️ CARİ HESAP MÜŞTERİ KARTIYLA BİRLİKTE DOĞMAZ, ilk parasal belgede LAZY
      // açılır (`ensureCariAccountTx`) — o yüzden burada ARANIR, fikstürde
      // kurulmaz. Fatura/ödeme fikstürleri bu bekçide daha önce koştuğu için
      // hesap vardır; yoksa iddia kırmızı olur ve sebebi görünür.
      finans.cariId ??= (await prisma.cariAccount.findFirst({
        where: { customerId: finans.musteriId ?? "" }, select: { id: true },
      }))?.id ?? null;
      if (!finans.cariId) return null;
      const r = await reconciliationLetterService.create({ cariId: finans.cariId } as never);
      if (!r.data?.id) return null;
      finans.letterIds.push(r.data.id);
      return { id: r.data.id, kod: r.data.docNo };
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
  subcontractorDispatch: {
    not: "SubcontractorService.dispatch: EXTERNAL adımlı iş emri + serbest stok topu (zincir `fasonTuru`da, üç seri ortak).",
    yarat: async (damga) => (await fasonTurAl(damga, fdSira++)).dispatch,
  },
  subcontractorReceipt: {
    not: "SubcontractorService.receive: açık fason sevki + dönen top (aynı zincir).",
    yarat: async (damga) => (await fasonTurAl(damga, frSira++)).receipt,
  },
  directShipment: {
    not: "SubcontractorService.executeDirectShip: açık fason sevki + müşteri + sebep (aynı zincirin ikinci sevki).",
    yarat: async (damga) => (await fasonTurAl(damga, dsSira++)).direct,
  },
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
      // ⚠️ SARMALI SERİ BU İDDİANIN DIŞINDADIR ve muafiyet BİÇİMDEN TÜRER, ad
      // listesinden değil: sarma KÖRLEMESİNEDİR (2026-08-05 kullanıcı kararı) —
      // numara bilerek TEKRAR EDER, çünkü fabrikanın fiziksel plaka setinin
      // karşılığıdır ve "boştaki numarayı bul" alternatifi 99'u da doluyken
      // üretimi durdururdu. Orada "kod zaten var" bir İHLAL değil, TANIMDIR;
      // ölçülen yer `test_batch_number_format` §0/§0b/§0c.
      if (seriesCounterReadsLastBorn(yeniFmt)) continue;
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
    // Fason zinciri: adımın istasyonu EXTERNAL OLMALI (ölçüldü — `dispatch`
    // başka tipte 400 döner), firma ayrı (kartela firması ile karışmasın) ve
    // doğrudan sevkte müşteri ZORUNLU.
    // ⚠️ İKİ AYRI ALAN, İKİ AYRI KAPI (ölçüldü): sevk `station.type === EXTERNAL`
    // ister, DOĞRUDAN SEVK ise `station.kind === SUBCONTRACTOR` — birini kurup
    // ötekini unutmak zinciri ikinci halkada düşürür.
    const dIstasyon = await msCreate(stationService, {
      name: `${DAMGA} E3 fason istasyon`, type: "EXTERNAL", kind: "SUBCONTRACTOR",
    });
    if (dIstasyon) {
      okutulan.externalStationId = dIstasyon.id;
      temizlik.push(async () => { await prisma.station.deleteMany({ where: { id: dIstasyon.id } }); });
    }
    const fFirma = await prisma.subcontractor.create({
      data: { code: `${DAMGA}-E3FF`.slice(0, 32), name: `${DAMGA} E3 fason firma`, isActive: true },
      select: { id: true },
    });
    okutulan.fasonFirmaId = fFirma.id;
    const dMusteri = await msCreate(customerService, { name: `${DAMGA} E3 sevk cari ${++msSayac}` });
    if (dMusteri) {
      okutulan.musteriId = dMusteri.id;
      temizlikCariler.push(dMusteri.id);
    }
    // Finans zinciri: cari (cari hesabı LAZY açılır) + kasa.
    const fMusteri = await msCreate(customerService, { name: `${DAMGA} E3 finans cari ${++msSayac}` });
    if (fMusteri) {
      finans.musteriId = fMusteri.id;
      temizlikCariler.push(fMusteri.id);
    }
    const fKasa = await msCreate(cashBoxService, { name: `${DAMGA} E3 finans kasa` });
    if (fKasa) {
      finans.kasaId = fKasa.id;
      temizlik.push(async () => { await prisma.cashBox.deleteMany({ where: { id: fKasa.id } }); });
    }

    check("L2 körlük zemini: bağlı fikstürler (istasyon + stok + kartela/fason zinciri) KURULDU",
      bagli.stationId !== null && bagli.itemId !== null &&
      okutulan.warehouseId !== null && okutulan.kartelaFirmaId !== null &&
      okutulan.externalStationId !== null && okutulan.fasonFirmaId !== null &&
      okutulan.musteriId !== null);

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

      // ── (f) BİÇİM GERÇEKTEN DEĞİŞTİKTEN SONRA İKİ KAYIT ────────────────────
      // ⚠️ MATRİSİN KÖR NOKTASIYDI (K27, 2026-09-23): (a)…(e) kolları biçimi
      // yalnız BELLEKTE değiştiriyordu (`yeniFmt` ile `matchesSeries`), yani
      // serinin GERÇEK biçimi hiç değişmiyordu ve üretecin kendi yükleyicisi
      // yeni ön ekle HİÇ koşmuyordu. Ürün kodunun süzgeci (`/^STK-\d+$/`) tam
      // orada saklandı: ön ek değişince süzgeç bütün satırları eliyor, sayaç
      // 1'de kalıyor ve arıza ancak İKİNCİ kayıtta (P2002) görünüyordu.
      // ⇒ Bu kol biçimi DB'de değiştirir, İKİ kayıt yaratır ve ikisinin hem
      // TEKİL hem ARDIŞIK olduğunu ölçer. Tek kayıt bu sınıfı göremez.
      const yeniOnEk = `${taban.prefix}Z`.slice(0, 6);
      let bicimTasindi = false;
      try {
        await updateSeriesFormat(e.key, {
          prefix: yeniOnEk, dateSegment: taban.dateSegment, digits: taban.digits,
          separator: taban.separator, separator2: taban.separator2 ?? null,
        });
        bicimTasindi = true;
      } catch (err) {
        // Kapılar (çakışma · kapasite · istemci ekseni) reddedebilir — bu bir
        // ihlal DEĞİL, ölçülemez bir vakadır ve ADIYLA bildirilir.
        console.log(`   ⏭️ (f) ${e.key}: ön ek ${yeniOnEk} kapıdan geçmedi — ${(err as Error).message.slice(0, 90)}`);
      }
      // ⚠️ GERİ ALMA `finally`DE (2026-09-24): eskiden taşıma ile geri alma
      // ARASINDAKİ herhangi bir `await` düşerse geri alma HİÇ koşmuyordu ve seri
      // `<ÖNEK>Z` olarak SIZIYORDU. Ölçüldü: tam pakette `item` `STKZ` kaldı ve
      // arıza `test_item_code_autogen`de göründü (ön ek geri konunca 14/0).
      // ⇒ Bir bekçi FİKSTÜR DEĞİL AYAR yazıyorsa geri alma `finally`ye girer;
      //   yoksa arıza bir SONRAKİ bekçinin adına yazılır.
      try {
        if (bicimTasindi) {
          await refreshNumberSeriesCache();
          const tasindi = resolveSeriesFormat(e.key);
          check(`L2 (f) körlük zemini: ${e.key} biçimi GERÇEKTEN değişti`,
            tasindi.prefix === yeniOnEk, `${taban.prefix} → ${tasindi.prefix}`);
          // ⚠️ ÇÖKEN SONDA, SONDA DEĞİLDİR: K27'nin belirtisi bir İSTİSNADIR
          // ("Barkod üretimi 5 denemede başarısız"). Yakalanmazsa bekçi düşer,
          // teardown koşmaz ve arıza bir SONRAKİ koşumda ilgisiz yerde görünür.
          // İstisna burada KIRMIZI İDDİAYA çevrilir, sebebi basılır.
          const uret = async (): Promise<{ id: string; kod: string } | Error> => {
            try {
              return (await yol.yarat!(DAMGA)) ?? new Error("(kayıt yaratılamadı)");
            } catch (err) {
              return err as Error;
            }
          };
          const r1 = await uret();
          const u1 = r1 instanceof Error ? null : r1;
          if (u1 && yol.sil) temizlik.push(() => yol.sil!(u1.id));
          const r2 = await uret();
          const u2 = r2 instanceof Error ? null : r2;
          if (u2 && yol.sil) temizlik.push(() => yol.sil!(u2.id));
          check(`L2 ⭐ (f) ${e.key}: ön ek değişiminden sonra İKİ kayıt da doğdu`,
            u1 !== null && u2 !== null,
            `${u1?.kod ?? (r1 as Error).message.slice(0, 60)} · ${u2?.kod ?? (r2 as Error).message.slice(0, 60)}`);
          if (u1 && u2) {
            check(`L2 ⭐ (f) ${e.key}: iki kod TEKİL ve yeni ön eki taşıyor`,
              u1.kod !== u2.kod && u1.kod.startsWith(yeniOnEk) && u2.kod.startsWith(yeniOnEk),
              `${u1.kod} · ${u2.kod}`);
            // ARDIŞIKLIK: sayaç ikinci kayıtta İLERLEMELİ (1'de takılmamalı).
            // ⚠️ SON RAKAM ÖBEĞİ: kodda tarih de olabilir (`PRTZ-2609-0002`) ve
            // "baştan say" kurgusu orada tarihi sıra sanar — ölçüldü, ilk yazımda
            // bu kol yanlış kırmızı verdi (kod ARTMIŞTI, yüklem okuyamadı).
            const sira = (k: string): number => Number.parseInt(/(\d+)$/.exec(k)?.[1] ?? "", 10);
            check(`L2 ⭐ (f) ${e.key}: sayaç İKİNCİ kayıtta ilerledi (1'de takılmadı)`,
              sira(u2.kod) > sira(u1.kod), `${u1.kod} → ${u2.kod}`);
          }
        }
      } finally {
        if (bicimTasindi) {
          // Geri alma DOĞRUDAN yazmayla: ölçülen kod yolu bozuksa teardown da düşerdi.
          await prisma.numberSeriesLine.deleteMany({ where: { seriesKey: e.key, prefix: yeniOnEk } });
          await prisma.numberSeries.update({
            where: { key: e.key },
            data: {
              prefix: taban.prefix, dateSegment: taban.dateSegment, digits: taban.digits,
              separator: taban.separator, separator2: taban.separator2 ?? null,
              retiredPrefixes: taban.retiredPrefixes,
            },
          });
          await refreshNumberSeriesCache();
        }
      }
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
    // ── FİNANS — yapraktan köke: bordro pivotu → bordro → çek → ödeme → fatura
    // → kasa fişi → mutabakat → cari hesap. Cari hesap `onDelete: Restrict`
    // taşıdığı için EN SONDA ve yalnız bu bekçinin açtığı kayıt silinir.
    // ⚠️ CARİ DEFTERİ ÖNCE: fatura · ödeme · çek satırlarının HEPSİ cari harekete
    // yazıyor (`cari_transactions_*_fkey`) — belgeyi önce silmek FK ile düşer.
    // Cari hesap fikstürün müşterisinden ARANIR: ilk parasal belgede lazy açıldı.
    finans.cariId ??= (await prisma.cariAccount.findFirst({
      where: { customerId: finans.musteriId ?? "" }, select: { id: true },
    }))?.id ?? null;
    if (finans.cariId) {
      await prisma.cariTransaction.deleteMany({ where: { cariId: finans.cariId } });
    }
    if (finans.noteIds.length > 0) {
      await prisma.chequeDeliveryNoteItem.deleteMany({ where: { noteId: { in: finans.noteIds } } });
      await prisma.chequeDeliveryNote.deleteMany({ where: { id: { in: finans.noteIds } } });
    }
    if (finans.chequeIds.length > 0) {
      await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: finans.chequeIds } } });
      await prisma.cheque.deleteMany({ where: { id: { in: finans.chequeIds } } });
    }
    if (finans.paymentIds.length > 0) {
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: finans.paymentIds } } });
      // ⚠️ NAKİT TAHSİLAT KASA FİŞİ DOĞURUR (`cash_transactions_paymentId_fkey`):
      // ödemeyi silmeden önce onun doğurduğu fiş de silinir. Fikstürün kendi
      // listesinde olmayan bu satırı bağdan bulmak, FK'yı tek tek kovalamaktan
      // daha dürüst — hangi satırın nereden doğduğu ŞEMADA yazılı.
      await prisma.cashTransaction.deleteMany({ where: { paymentId: { in: finans.paymentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: finans.paymentIds } } });
    }
    if (finans.invoiceIds.length > 0) {
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: finans.invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: finans.invoiceIds } } });
    }
    if (finans.cashTxnIds.length > 0) {
      await prisma.cashTransaction.deleteMany({ where: { id: { in: finans.cashTxnIds } } });
    }
    if (finans.letterIds.length > 0) {
      await prisma.reconciliationLetter.deleteMany({ where: { id: { in: finans.letterIds } } });
    }
    if (finans.cariId) {
      await prisma.cariTransaction.deleteMany({ where: { cariId: finans.cariId } });
      await prisma.cariAccount.deleteMany({ where: { id: finans.cariId } });
    }

    if (okutulan.directShipmentIds.length > 0) {
      // Doğrudan sevkin KALEMİ yok: toplar doğrudan bağlanıyor (`rolls Roll[]`),
      // o yüzden önce bağ koparılır, sonra belge silinir.
      await prisma.roll.updateMany({
        where: { directShipmentId: { in: okutulan.directShipmentIds } },
        data: { directShipmentId: null },
      });
      await prisma.directShipment.deleteMany({ where: { id: { in: okutulan.directShipmentIds } } });
    }
    if (okutulan.fasonReceiptIds.length > 0) {
      await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: okutulan.fasonReceiptIds } } });
      await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: okutulan.fasonReceiptIds } } });
    }
    if (okutulan.fasonDispatchIds.length > 0) {
      await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: okutulan.fasonDispatchIds } } });
      await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: okutulan.fasonDispatchIds } } });
    }
    // ⚠️ FASON KABULÜ YENİ TOP DOĞURUR ve top iş emrine DOĞRUDAN bağlı değildir
    // (`currentStepId → WorkOrderStep`, soyağacı `parentRollId`). Çocuklar ÖNCE
    // silinir: ebeveyni silmek `RollLineage` FK'sını ihlal ederdi.
    // ⚠️ TOPUN DEFTERLERİ ÖNCE: sevk/kabul topa hareket, operasyon ve stok satırı
    // yazıyor — ölçüldü, `roll_operations_rollId_fkey` teardown'ı düşürdü. Liste
    // şemadan çıkarıldı (Roll'a `rollId` ile bağlanan her model), tek tek
    // keşfedilmedi: bir FK'yı kovalayıp ötekini beklemek aynı hatanın tekrarıdır.
    const topIdleri = [
      ...okutulan.rollIds,
      ...(await prisma.roll.findMany({
        where: {
          OR: [
            { parentRollId: { in: okutulan.rollIds } },
            ...(okutulan.workOrderIds.length > 0
              ? [{ currentStep: { workOrderId: { in: okutulan.workOrderIds } } }]
              : []),
          ],
        },
        select: { id: true },
      })).map((r) => r.id),
    ];
    if (topIdleri.length > 0) {
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.rollError.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.rollReturn.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.stockCountLine.deleteMany({ where: { rollId: { in: topIdleri } } });
      await prisma.roll.deleteMany({ where: { id: { in: topIdleri } } });
    }
    if (okutulan.workOrderIds.length > 0) {
      await prisma.batch.deleteMany({ where: { workOrderId: { in: okutulan.workOrderIds } } });
    }
    for (const id of [okutulan.kartelaFirmaId, okutulan.fasonFirmaId]) {
      if (id) await prisma.subcontractor.deleteMany({ where: { id } });
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
