// =============================================================================
// TeksERP - Subcontractor (Fason) Service / printed-docs
// =============================================================================
// Resmi belge builder'ları (fason sevk irsaliyesi · doğrudan sevk irsaliyesi · kabul makbuzu) ve
// `registerPrintedDocBuilder` kayıtları (modül yüklenince bir kez).
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (dispatch.ts sayılır) */
import { ACTIVE_TARGET_PROPERTY } from "../helpers/property-revoke.helper";
import { Prisma, PrintedDocType } from "@prisma/client";
import { registerPrintedDocBuilder, type BuiltDocContent, type PrintedDocDb } from "../printed-document.service";
import { renderFasonCekiHtml } from "../document-render/fason-ceki.html";
import { renderFasonDirectShipHtml, renderFasonDirectShipTables } from "../document-render/fason-direct-ship.html";
import { renderFasonReceiptHtml, type FasonReceiptDoc } from "../document-render/fason-receipt.html";
import {
  resolveStepWorkInstructions,
  resolveStepDyeColor,
  type FasonWorkInstruction,
} from "../helpers/fason-work-instructions.helper";
import { assertWorkOrderBound } from "../helpers/dispatch-header.helper";
import { hasRoll } from "../helpers/dispatch-item-kind.helper";

// =============================================================================
// RESMİ BELGE — Fason Sevk İrsaliyesi snapshot builder'ı (PrintedDocument)
// =============================================================================
// Tek üretici iki yolda: freeze (sevk create tx'i) + reissue (gerekçeli revizyon).
// getCurrent belgesi olmayan eski kayıtta bunu lazy-init olarak da kullanır.
// İstenen renk + fason talimatı KASTEN belgede YOK — canlı overlay alanlarıdır
// (fasoncuya talimat; kabul/iptalde kilitlenir), getDispatchDyeOverlay döner.
/** Çeki listesi `doc` payload'ını yapısal parçalardan kurar — hem gerçek sevk
 *  belgesi (buildFasonDispatchDoc) hem erken TASLAK çeki (previewDownstreamFasonCeki)
 *  aynı şekli üretsin diye tek yer. `sequence` ve `totalWeight` burada hesaplanır. */
export function assembleFasonCekiDoc(args: {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  instruction: string | null;
  /** `width` = iş emrinin eni. Çekideki TEK "EN" değerinin kaynağı budur —
   *  topun kendi eni DEĞİL (2026-08-06 kullanıcı kararı: "bir tane en değeri
   *  koy, o da iş emrinden gelsin"). Sebep ölçüldü: sahadaki fason sevklerinin
   *  yedisinde sekizde giden topların `Roll.width`'i NULL (KK1'de en opsiyonel
   *  ve doldurulmuyor), iş emrinin eni ise HER ZAMAN dolu. Belge topun eninden
   *  beslendiği sürece EN kolonu başlığıyla basılıp değeriyle boş kalıyordu. */
  workOrder: {
    id: string;
    workOrderNumber: string;
    parameters: Record<string, unknown> | null;
    type: string;
    width: number | null;
  };
  subcontractor: { id: string; name: string; code: string | null };
  requestedColor: string | null;
  /** WO hedef üretim özellikleri (FabricProperty adları) — boyahaneye "bu özellikleri uygula" der.
   *  ⚠️ 2026-08-15'ten sonra kâğıda basılan liste `commands.works`tir; bu alan
   *  payload'da DURUR (eski donmuş belgelerin şekli değişmesin + izlenebilirlik). */
  targetProperties: string[];
  /** BOYAHANEYE GİDEN İKİ TALİMAT (2026-08-15 saha isteği).
   *  ⚠️ `color` YALNIZ `WorkOrder.targetColor.name`; topların mevcut rengine
   *  DÜŞMEZ — "BOYANACAK RENK" etiketi ham/ekru topa "EKRU'ya boya" diyemesin.
   *  ⚠️ `works` BU ADIMA süzülmüş hedeflerdir (istasyon yeteneğiyle kesişim),
   *  iş emrinin TÜM hedefleri DEĞİL — boyahane çekisinde "KURŞUNLU" yazamaz. */
  commands: { color: string | null; works: FasonWorkInstruction[] };
  /** Sevkin partisi (K10: bir sevk = bir parti). Belge DONARKEN zaten bilinir —
   *  `SubcontractorDispatch.batchId` NOT NULL ve aynı create tx'inde yazılır.
   *  Taslak çekide (previewDownstreamFasonCeki) henüz sevk yoktur → projekte edilen
   *  topların partilerinden çözülür, birden fazlaysa virgüllü liste, hiç yoksa null. */
  batchNumber: string | null;
  step: { id: string; stepSequence: number; station: { name: string; code: string } };
  rolls: Array<{
    id: string;
    barcode: string | null;
    itemCode: string;
    itemName: string;
    colorCode: string | null;
    colorName: string | null;
    dispatchedQty: number;
    dispatchedWeight: number | null;
    qualityGrade: string | null;
    width: number | null;
  }>;
  totalQty: number;
  /** F1 levent kalemleri — yalnız varsa yazılır (top-yalnız belge bayt bayt aynı kalır); kumaş grid'i basmaz. */
  beams?: Array<{ id: string; beamNo: string; warpSpecCode: string; lengthM: number }>;
}): Record<string, unknown> {
  const rolls = args.rolls.map((r, idx) => ({ sequence: idx + 1, ...r }));
  const totalWeight = Number(rolls.reduce((s, r) => s.plus(r.dispatchedWeight ?? 0), new Prisma.Decimal(0)));
  const beams = (args.beams ?? []).map((b, idx) => ({ sequence: idx + 1, ...b }));
  const beamPart = beams.length > 0
    ? { beams, beamTotals: { beamCount: beams.length, totalLengthM: Number(beams.reduce((s, b) => s.plus(b.lengthM), new Prisma.Decimal(0))) } }
    : {};
  return {
    dispatchNo: args.dispatchNo,
    dispatchedAt: args.dispatchedAt,
    driverName: args.driverName,
    plateNumber: args.plateNumber,
    notes: args.notes,
    instruction: args.instruction,
    workOrder: args.workOrder,
    subcontractor: args.subcontractor,
    requestedColor: args.requestedColor,
    targetProperties: args.targetProperties,
    commands: args.commands,
    batchNumber: args.batchNumber,
    step: args.step,
    rolls,
    totals: { rollCount: rolls.length, totalQty: args.totalQty, totalWeight },
    ...beamPart,
  };
}

async function buildFasonDispatchDoc(
  db: PrintedDocDb,
  dispatchId: string
): Promise<BuiltDocContent | null> {
  const dispatch = await db.subcontractorDispatch.findUnique({
    where: { id: dispatchId },
    include: {
      subcontractor: { select: { id: true, name: true, code: true } },
      // K10: bir sevk = bir parti. Parti no belgeye DONAR (batchId NOT NULL, aynı tx).
      batch: { select: { batchNumber: true } },
      workOrder: {
        select: {
          id: true,
          workOrderNumber: true,
          parameters: true,
          type: true,
          // Çekideki tek EN değerinin kaynağı (bkz. assembleFasonCekiDoc notu).
          width: true,
          // İstenen renk = boyamanın hedef rengi. Sevkte toplar HAM (renksiz) gider;
          // çeki listesi boyahaneye "şu renge boya" der → WO.targetColor gösterilir.
          targetColor: { select: { name: true } },
          // Üretim özellikleri de aynı mantıkla çekiye basılır ("bu apreleri uygula").
          // ⚠️ `propertyId` DE seçilir: "YAPILACAK İŞLEMLER" satırı bu listeyi
          // sevkin gittiği ADIMIN istasyon yetenekleriyle KESİŞTİRİR
          // (`resolveStepWorkInstructions`) ve kesişim id üzerinden kurulur.
          targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { propertyId: true, property: { select: { name: true } } } },
        },
      },
      step: {
        include: {
          station: { select: { name: true, code: true } },
          // "BOYANACAK RENK" satırının adım süzgeci (`resolveStepDyeColor`):
          // renk VERMEYEN kategoriye (örn. Zımpara) boya talimatı gitmesin.
          requiredCategory: { select: { appliesColor: true } },
        },
      },
      items: {
        include: {
          roll: {
            include: {
              item: { select: { code: true, name: true } },
              color: { select: { code: true, name: true } },
            },
          },
          warpBeam: { select: { id: true, beamNo: true, warpSpec: { select: { code: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!dispatch) return null;
  assertWorkOrderBound(dispatch, "Sevk belgesi"); // belge yalnız iş emri sevki için (dokuma sevki G2p)

  // F1: levent kalemi kumaş grid'ine girmez; ayrı listede donar. Kumaş toplamı top kalemlerinden
  // (top-yalnız sevkte `dispatch.totalQty` ile aynı — consistency §19; levent varsa Σ top).
  const beams = dispatch.items
    .filter((i) => i.warpBeam !== null)
    .map((i) => ({ id: i.warpBeam!.id, beamNo: i.warpBeam!.beamNo, warpSpecCode: i.warpBeam!.warpSpec.code, lengthM: Number(i.dispatchedQty) }));
  const rollItems = dispatch.items.filter(hasRoll);
  const rolls = rollItems.map((item, idx) => ({
    sequence: idx + 1,
    id: item.roll.id,
    barcode: item.roll.barcode,
    itemCode: item.roll.item?.code ?? "",
    itemName: item.roll.item?.name ?? "",
    colorCode: item.roll.color?.code ?? null,
    colorName: item.roll.color?.name ?? null,
    dispatchedQty: Number(item.dispatchedQty),
    dispatchedWeight: item.dispatchedWeight != null ? Number(item.dispatchedWeight) : null,
    qualityGrade: item.roll.qualityGrade ?? "",
    width: item.roll.width != null ? Number(item.roll.width) : null,
  }));

  // "YAPILACAK İŞLEMLER" = iş emri hedefleri ∩ BU ADIMIN istasyon yetenekleri.
  // `dispatch.step` zaten include ile geldi → `stationId` elde, ek sorgu yok
  // (yalnız yetenek satırları okunur). Fail-closed: kesişim boşsa satır basılmaz.
  const works = await resolveStepWorkInstructions(
    db,
    dispatch.step.stationId,
    dispatch.workOrder.targetProperties.map((p) => ({ propertyId: p.propertyId, name: p.property.name })),
  );

  return {
    documentNo: dispatch.dispatchNo,
    voidInfo: dispatch.cancelledAt
      ? { reason: dispatch.cancelReason, at: dispatch.cancelledAt }
      : null,
    doc: assembleFasonCekiDoc({
      dispatchNo: dispatch.dispatchNo,
      dispatchedAt: dispatch.dispatchedAt.toISOString(),
      driverName: dispatch.driverName,
      plateNumber: dispatch.plateNumber,
      notes: dispatch.notes,
      // Fason talimatı çekiye DONAR: sevkin kendi talimatı, yoksa adımın notu.
      // (overlay precedence'ı ile aynı; "Revize Et" yeni talimatla yeniden dondurur.)
      instruction: dispatch.instruction ?? dispatch.step.notes ?? null,
      workOrder: {
        id: dispatch.workOrder.id,
        workOrderNumber: dispatch.workOrder.workOrderNumber,
        parameters: (dispatch.workOrder.parameters as Record<string, unknown> | null) ?? null,
        type: dispatch.workOrder.type,
        width: dispatch.workOrder.width != null ? Number(dispatch.workOrder.width) : null,
      },
      subcontractor: {
        id: dispatch.subcontractor.id,
        name: dispatch.subcontractor.name,
        code: dispatch.subcontractor.code ?? null,
      },
      requestedColor: dispatch.workOrder.targetColor?.name ?? null,
      targetProperties: dispatch.workOrder.targetProperties.map((p) => p.property.name),
      // ⚠️ Renk BURADA fallback TAŞIMAZ (`requestedColor` ile aynı ifade gibi
      // görünüyor ama anlamı farklı ve öyle kalmalı): "BOYANACAK RENK" etiketi
      // yalnız GERÇEK hedefe basılabilir. Hedef yoksa satır hiç doğmaz.
      // ⚠️ Ayrıca ADIMA süzülür: renk vermeyen kategorideki adıma (Zımpara)
      // yapılan sevkin çekisinde boya talimatı BASILMAZ (`resolveStepDyeColor`).
      commands: {
        color: resolveStepDyeColor(dispatch.step, dispatch.workOrder.targetColor?.name ?? null),
        works,
      },
      batchNumber: dispatch.batch?.batchNumber ?? null,
      step: {
        id: dispatch.step.id,
        stepSequence: dispatch.step.stepSequence,
        station: { name: dispatch.step.station.name, code: dispatch.step.station.code },
      },
      rolls,
      totalQty: beams.length > 0
        ? Number(rollItems.reduce((s, i) => s.plus(i.dispatchedQty), new Prisma.Decimal(0)))
        : Number(dispatch.totalQty),
      ...(beams.length > 0 ? { beams } : {}),
    }),
  };
}

registerPrintedDocBuilder(PrintedDocType.SUBCONTRACTOR_DISPATCH, {
  fresh: buildFasonDispatchDoc,
  // Tek-kaynak "KUMAŞ İRSALİYESİ" HTML — mobil + Electron aynısını basar.
  renderHtml: renderFasonCekiHtml,
  // Belge şablon profili: sevkin fason firmasına atanmış profil (yoksa genel ayar).
  resolveProfileId: async (db, sourceId) => {
    const d = await db.subcontractorDispatch.findUnique({
      where: { id: sourceId },
      select: { subcontractor: { select: { documentProfileId: true } } },
    });
    return d?.subcontractor?.documentProfileId ?? null;
  },
});

// =============================================================================
// RESMİ BELGE — Fasondan Doğrudan Sevk İrsaliyesi (PrintedDocument)
// =============================================================================
// Fason sevk irsaliyesinden AYRI belge zinciri (mal MÜŞTERİYE gidiyor, fasona
// değil). sourceId = DirectShipment.id — belge YALNIZ o olayın toplarını +
// müşteriyi + doğrudan-sevk meta'sını (sebep/tarih) + varsa karşılanan sipariş
// satırlarını gösterir. Kısmi/çoklu doğrudan sevkte her olay ayrı belge.
async function buildFasonDirectShipDoc(
  db: PrintedDocDb,
  directShipmentId: string
): Promise<BuiltDocContent | null> {
  const ds = await db.directShipment.findUnique({
    where: { id: directShipmentId },
    include: {
      customer: { select: { id: true, name: true, code: true, taxNumber: true, exportCode: true } },
      branch: { select: { id: true, name: true, code: true } },
      shippedBy: { select: { fullName: true, username: true } },
      dispatch: {
        select: {
          workOrderId: true,
          dispatchNo: true,
          dispatchedAt: true,
          driverName: true,
          plateNumber: true,
          notes: true,
          // K10: bir sevk = bir parti. Bu belge MÜŞTERİYE gittiği için parti
          // varsayılan olarak BASILMAZ (opt-in — `sections.batchInfo === true`).
          batch: { select: { batchNumber: true } },
          subcontractor: { select: { id: true, name: true, code: true } },
          workOrder: { select: { id: true, workOrderNumber: true, parameters: true, type: true } },
          step: {
            select: { id: true, stepSequence: true, station: { select: { name: true, code: true } } },
          },
        },
      },
      rolls: {
        select: {
          id: true,
          barcode: true,
          currentQty: true,
          qualityGrade: true,
          width: true,
          item: { select: { code: true, name: true } },
          color: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      allocations: {
        include: {
          orderLine: {
            select: {
              quantity: true,
              item: { select: { code: true, name: true } },
              color: { select: { name: true } },
              order: { select: { orderNumber: true } },
            },
          },
        },
      },
    },
  });
  if (!ds) return null;
  assertWorkOrderBound(ds.dispatch, "Doğrudan sevkin fason sevki"); // DSK yalnız iş emri sevkinden

  // Doğrudan sevk edilen toplar = DirectShipment'a bağlı (bölünmüşse çocuk) toplar;
  // dispatchedQty = topun sevk anındaki currentQty'si (kısmi split'te sevk edilen kısım).
  const rolls = ds.rolls.map((r, idx) => ({
    sequence: idx + 1,
    id: r.id,
    barcode: r.barcode,
    itemCode: r.item?.code ?? "",
    itemName: r.item?.name ?? "",
    colorCode: r.color?.code ?? null,
    colorName: r.color?.name ?? null,
    dispatchedQty: Number(r.currentQty),
    dispatchedWeight: null, // bu aşamada top-başına ağırlık tutulmuyor (yalnız metre)
    qualityGrade: r.qualityGrade,
    width: r.width != null ? Number(r.width) : null,
  }));
  const allocations = ds.allocations.map((a) => ({
    orderNumber: a.orderLine.order.orderNumber,
    itemCode: a.orderLine.item.code,
    itemName: a.orderLine.item.name,
    colorName: a.orderLine.color?.name ?? null,
    qty: Number(a.qty),
  }));

  return {
    documentNo: ds.shipmentNo,
    // Doğrudan sevk terminaldir, iptal yolu yok → voidInfo daima null.
    voidInfo: null,
    doc: {
      directShip: true,
      shipmentNo: ds.shipmentNo,
      dispatchNo: ds.dispatch.dispatchNo,
      directShippedAt: ds.shippedAt.toISOString(),
      directShipReason: ds.reason,
      directShippedBy: ds.shippedBy?.fullName ?? ds.shippedBy?.username ?? null,
      dispatchedAt: ds.dispatch.dispatchedAt.toISOString(),
      driverName: ds.dispatch.driverName,
      plateNumber: ds.dispatch.plateNumber,
      notes: ds.dispatch.notes,
      batchNumber: ds.dispatch.batch?.batchNumber ?? null,
      // Malın gittiği MÜŞTERİ — doğrudan sevk irsaliyesinin asıl alıcısı.
      customer: {
        id: ds.customer.id,
        name: ds.customer.name,
        code: ds.customer.code ?? null,
        taxNumber: ds.customer.taxNumber ?? null,
        branchName: ds.branch?.name ?? null,
        branchCode: ds.branch?.code ?? null,
        // Şirket ihracat kodu — tek "İhracat Kodu" satırına şube ihracat kodu
        // (branchCode) boşsa yedek olarak basılır (branchCode ?? exportCode).
        exportCode: ds.customer.exportCode ?? null,
      },
      workOrder: {
        id: ds.dispatch.workOrder.id,
        workOrderNumber: ds.dispatch.workOrder.workOrderNumber,
        parameters: (ds.dispatch.workOrder.parameters as Record<string, unknown> | null) ?? null,
        type: ds.dispatch.workOrder.type,
      },
      subcontractor: {
        id: ds.dispatch.subcontractor.id,
        name: ds.dispatch.subcontractor.name,
        code: ds.dispatch.subcontractor.code ?? null,
      },
      step: {
        id: ds.dispatch.step.id,
        stepSequence: ds.dispatch.step.stepSequence,
        station: { name: ds.dispatch.step.station.name, code: ds.dispatch.step.station.code },
      },
      rolls,
      allocations,
      totals: {
        rollCount: rolls.length,
        totalQty: Number(ds.totalQty),
        totalWeight: 0,
      },
    },
  };
}

registerPrintedDocBuilder(PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP, {
  fresh: buildFasonDirectShipDoc,
  // Tek-kaynak "DOĞRUDAN SEVK İRSALİYESİ" HTML — getHtml her cihazda aynı çıktıyı verir.
  renderHtml: renderFasonDirectShipHtml,
  // Excel'in tabloları — irsaliyeyi çizen AYNI kolon çözücüsünden (PDF ↔ Excel eşit).
  renderTables: renderFasonDirectShipTables,
  // Belge şablon profili: malın gittiği MÜŞTERİNİN profili (irsaliyenin muhatabı).
  resolveProfileId: async (db, sourceId) => {
    const ds = await db.directShipment.findUnique({
      where: { id: sourceId },
      select: { customer: { select: { documentProfileId: true } } },
    });
    return ds?.customer?.documentProfileId ?? null;
  },
});

// =============================================================================
// RESMİ BELGE — Fason Kabul Makbuzu (PrintedDocument)
// =============================================================================
// Fasondan mal DÖNÜŞÜNDE kesilen kabul belgesi. sourceId = SubcontractorReceipt.id.
// Kabul edilen (yeni doğan) toplar + uygulanan renk/apre + fason firmanın verdiği
// irsaliye no (manifestNo). Kabul iptali → belge VOIDED.
async function buildFasonReceiptDoc(
  db: PrintedDocDb,
  receiptId: string,
): Promise<BuiltDocContent | null> {
  const receipt = await db.subcontractorReceipt.findUnique({
    where: { id: receiptId },
    include: {
      subcontractor: { select: { name: true, code: true } },
      workOrder: { select: { workOrderNumber: true } },
      step: { include: { station: { select: { name: true } } } },
      appliedColor: { select: { name: true } },
      appliedProperties: { include: { property: { select: { name: true } } } },
      // Kabulde doğan toplar: ÖLÇÜLEN dönen metre (fiziksel); defter `receivedQty`den ayrı büyüklük.
      bornRolls: { select: { initialQty: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          newRoll: {
            select: {
              barcode: true,
              width: true,
              item: { select: { name: true } },
              color: { select: { name: true } },
              // Fason dönüşünde doğan top partiyi kaynak sevkten kalıtır
              // (`SubcontractorDispatch.batchId`) → makbuz "hangi parti döndü"yü söyler.
              batch: { select: { batchNumber: true } },
            },
          },
        },
      },
    },
  });
  if (!receipt) return null;
  assertWorkOrderBound(receipt, "Kabul belgesi"); // belge yalnız iş emri makbuzu için (dokuma makbuzu G2p)

  const rolls = receipt.items.map((it, idx) => ({
    sequence: idx + 1,
    barcode: it.newRoll.barcode,
    itemName: it.newRoll.item?.name ?? "",
    colorName: it.newRoll.color?.name ?? null,
    width: it.newRoll.width != null ? Number(it.newRoll.width) : null,
    // Kabul DEFTERİ metresi (fasondan düşülen); eski satırda NULL = tamamı, tahmin edilmez.
    qty: it.receivedQty != null ? Number(it.receivedQty) : null,
  }));

  const doc: FasonReceiptDoc = {
    receiptNo: receipt.receiptNo,
    manifestNo: receipt.manifestNo ?? null,
    receivedAt: receipt.receivedAt.toISOString(),
    notes: receipt.notes ?? null,
    subcontractor: {
      name: receipt.subcontractor.name,
      code: receipt.subcontractor.code ?? null,
    },
    workOrder: { workOrderNumber: receipt.workOrder.workOrderNumber },
    stationName: receipt.step.station.name,
    appliedColor: receipt.appliedColor?.name ?? null,
    appliedProperties: receipt.appliedProperties.map((p) => p.property.name),
    // Distinct + sıralı: bir kabul birden fazla sevki (dolayısıyla partiyi) kapsayabilir.
    batchNumbers: [
      ...new Set(
        receipt.items.map((it) => it.newRoll.batch?.batchNumber).filter((b): b is string => !!b),
      ),
    ].sort(),
    rolls,
    totals: {
      rollCount: rolls.length,
      qty: Math.round(rolls.reduce((s, r) => s + (r.qty ?? 0), 0) * 1000) / 1000,
      // Doğan topların ölçülen metresi — çekme/fazla bu ile defter `qty` farkıdır; top doğmadıysa alan yok.
      ...(receipt.bornRolls.length
        ? { returnedQty: Math.round(receipt.bornRolls.reduce((s, r) => s + Number(r.initialQty), 0) * 1000) / 1000 }
        : {}),
    },
  };

  return {
    documentNo: receipt.receiptNo,
    voidInfo: receipt.cancelledAt
      ? { reason: receipt.cancelReason ?? null, at: receipt.cancelledAt }
      : null,
    doc: doc as unknown as Record<string, unknown>,
  };
}

registerPrintedDocBuilder(PrintedDocType.SUBCONTRACTOR_RECEIPT, {
  fresh: buildFasonReceiptDoc,
  renderHtml: renderFasonReceiptHtml,
  resolveProfileId: async (db, sourceId) => {
    const r = await db.subcontractorReceipt.findUnique({
      where: { id: sourceId },
      select: { subcontractor: { select: { documentProfileId: true } } },
    });
    return r?.subcontractor?.documentProfileId ?? null;
  },
});
