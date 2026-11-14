// =============================================================================
// TeksERP - Subcontractor (Fason) Service / receive
// =============================================================================
// Fason mal kabulü: token kimliğiyle idempotent dış kapı (`receive`) + kabulün asıl gövdesi.
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (dispatch.ts sayılır) */
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { ACTIVE_TARGET_PROPERTY } from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { tokenReplay } from "../helpers/token-replay.helper";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { resolveEntryStationId } from "../helpers/roll-entry-station.helper";
import { resolveBirthWarehouseIdTx, resolveEmanetBirthWarehouseIdTx } from "../helpers/emanet-warehouse.helper";
import { postStockMoves } from "../helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { v4 as uuidv4 } from "uuid";
import { ApiResponse } from "../../types/api.types";
import { createBatchTx } from "../batch.service";
import { Prisma, RollOperationType, RollStatus, RollForm, RollVarianceKind, StationType, StepStatus, ScanType, WarehouseEventType, TravelerCardStatus } from "@prisma/client";
import { resolveOwnerFromReceiptTx } from "../helpers/emanet-owner.helper";
import { lowestStage, stageForProductionExit, stageForStepBirth } from "../helpers/roll-stage.helper";
import { recomputeStepStatus, completeWorkOrderIfStepsDone } from "../helpers/roll-step.helper";
import { reserveRollBarcodesTx } from "../helpers/roll-barcode.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { assertTargetablePropertyIds } from "../helpers/targetable-property.helper";
// Kabulde ölçülen eni iş emrine yansıtmak için (2026-08-17, madde 12).
import { workOrderLinkService } from "../workorder-link.service";
import { recordVarianceTx } from "../helpers/roll-variance.helper";
import { recordPlanDeviationTx } from "../helpers/tambur-plan-gate.helper";
import { FASON_RECEIPT_DEVIATION_SOURCE } from "../../constants/tambur-plan-gate";
import { allocateShrink } from "../helpers/subcontractor-shrink.helper";
import { SHRINK_REASON_CODE, VARIANCE_SOURCES } from "../../constants/variance-reasons";
import { OPEN_OUTSTANDING, outstandingItemOfOpenDispatch } from "../helpers/fason-open-dispatch.helper";
import { p2002Mentions } from "../../utils/p2002";
import { uyari } from "../../lib/logger";
import { readReceiptTargetVariantsTx, receiptOperationValueId } from "../helpers/fason-receipt-variant.helper";
import { TERIM } from "../../constants/terim";
import { resolveRollLabels, rollLabel, nextSubcontractorDocNoTx } from "./shared";
import type { SubcontractorServiceThis } from "./shared";
import type { SubcontractorService } from "../subcontractor.service";
import { emitSubcontractReceivedTx } from "../notification-sources/depo";

// Refakat kartı okutma izi (TravelerCardScan) — tx İÇİNDE; audit'i çağıran eylem basar.
// Bu dosyada durur: aile içinde audit taşıyan bir modülde (test_audit_muafiyeti §7 dosya düzeyi).
export async function logTravelerScan(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  stationId: string,
  stepId: string,
  scanType: ScanType,
  userId: string | undefined,
  note: string
): Promise<void> {
  const activeCard = await tx.travelerCard.findFirst({
    // Kart iş emri başına — WO'nun aktif kartına yaz.
    where: { workOrderId, status: TravelerCardStatus.ACTIVE },
    select: { id: true },
  });
  if (!activeCard) return;

  await tx.travelerCardScan.create({
    data: {
      cardId: activeCard.id,
      stationId,
      workOrderStepId: stepId,
      scanType,
      scannedById: userId ?? null,
      notes: note,
    },
  });
}

type ReceiptReplayRow = Prisma.SubcontractorReceiptGetPayload<{
  include: { subcontractor: true; step: { include: { station: true } }; items: { include: { newRoll: true } }; bornRolls: { select: { initialQty: true } } };
}>;

/**
 * Fason kabul replay'i (R). Aynı fişin ikinci kopyası yarışı kaybettiğinde üç ayrı noktada düşebilir (tx öncesi
 * kural · tx içi claim · token P2002) ve operatör için üçü de "kabul zaten yapıldı"dır: cevap hata türüne değil
 * token KİMLİĞİNE bakar (BULGU-T1-005). Gövde kapısı: iş emri + adım + fasoncu + dönen top kümesi + elle verilen
 * metrajlar + doğan yeni topların metrajları (sırasız); iptal edilmiş kabulün token'ı 409 `RECEIPT_CANCELLED`.
 */
function receiptReplay(data: {
  workOrderId: string;
  stepId: string;
  subcontractorId: string;
  returns: Array<{ rollId: string; receivedQty?: number | null }>;
  newRolls?: Array<{ qty: number }>;
}) {
  const explicit = data.returns.filter((r) => r.receivedQty != null);
  const qtyKey = (rows: Array<{ rollId: string; qty: Prisma.Decimal.Value | null }>) =>
    rows.map((r) => `${r.rollId}:${r.qty == null ? "" : new Prisma.Decimal(r.qty).toFixed(3)}`).sort().join(",");
  return tokenReplay<ReceiptReplayRow, ApiResponse<unknown>>({
    find: (db, clientToken) =>
      db.subcontractorReceipt.findUnique({
        where: { clientToken },
        include: { subcontractor: true, step: { include: { station: true } }, items: { include: { newRoll: true } }, bornRolls: { select: { initialQty: true } } },
      }),
    alive: (p) => {
      if (!p.cancelledAt) return;
      throw AppError.conflict(
        "Bu kabul denemesi daha önce kaydedilmiş ve İPTAL edilmiş — aynı deneme tekrar gönderilemez. Kabulü ekrandan yeniden yapın.",
        { code: "RECEIPT_CANCELLED" },
      );
    },
    identity: (p) => [
      { ad: "workOrderId", mevcut: p.workOrderId, gelen: data.workOrderId },
      { ad: "stepId", mevcut: p.stepId, gelen: data.stepId },
      { ad: "subcontractorId", mevcut: p.subcontractorId, gelen: data.subcontractorId },
      { ad: "toplar", mevcut: p.items.map((i) => i.newRollId).sort().join(","), gelen: data.returns.map((r) => r.rollId).sort().join(",") },
      {
        ad: "metrajlar",
        mevcut: qtyKey(explicit.map((r) => ({ rollId: r.rollId, qty: p.items.find((i) => i.newRollId === r.rollId)?.receivedQty ?? null }))),
        gelen: qtyKey(explicit.map((r) => ({ rollId: r.rollId, qty: r.receivedQty ?? null }))),
      },
      {
        ad: "yeniToplar",
        mevcut: p.bornRolls.map((r) => new Prisma.Decimal(r.initialQty).toFixed(3)).sort().join(","),
        gelen: (data.newRolls ?? []).map((r) => new Prisma.Decimal(r.qty).toFixed(3)).sort().join(","),
      },
    ],
    collision: (p) => `Bu form daha önce başka bir kabul olarak kaydedilmiş (makbuz ${p.receiptNo}) — yeni kabul için ekranı kapatıp yeniden açın.`,
    collisionEk: (p) => ({ receiptNo: p.receiptNo }),
    respond: (p) => ({ success: true, data: p, message: `Mal kabul zaten yapılmış (idempotent retry). Makbuz: ${p.receiptNo}` }),
  });
}

export async function receive(this: SubcontractorServiceThis, 
    data: Parameters<SubcontractorService["receiveInner"]>[0],
    userId?: string,
  ): ReturnType<SubcontractorService["receiveInner"]> {
    return receiptReplay(data).run(data.clientToken ?? null, () => this.receiveInner(data, userId));
  }

export async function receiveInner(
    data: {
      workOrderId: string;
      stepId: string;
      subcontractorId: string;
      /** Doğan topların partisi — kabulün açık sevklerinden biri olmalı; yoksa en eski açık sevkin partisi (D8 R5b). */
      batchId?: string | null;
      manifestNo?: string | null; // Opsiyonel — fason her zaman irsaliye vermeyebilir
      returns: Array<{
        rollId: string;         // Orijinal fasona gönderilmiş top
        notes?: string | null;  // Bu topa dair kabul notu (opsiyonel)
        /// KISMİ KABUL (2026-08-19): bu teslimatta bu toptan gelen metraj.
        /// Verilmez ya da kalanı aşar/eşitler → TAM kabul (top tüketilir; eski
        /// APK'ların davranışı birebir korunur). Kalanın altındaysa → top
        /// AT_SUBCONTRACTOR kalır, currentQty atomik decrement ile kalana iner;
        /// kalan ikinci bir teslimatla (yeni makbuz) ya da "kalan gelmeyecek"
        /// kapamasıyla (closeRemainder) kapanır. Kısmi sevkin (satır ~530) aynası.
        receivedQty?: number | null;
      }>;
      notes?: string;
      /// İdempotency anahtarı — kısmi teslimatta replay'in TEK kimliği (aşağıda).
      clientToken?: string | null;
      /// Override — fason kategorisi appliesColor=true ise WO.targetColorId
      /// otomatik kullanılır; UI farklı renk seçtiyse buradan gönderilir.
      appliedColorId?: string | null;
      /// Tabletin kabul ekranını açarken gördüğü iş emri hedef rengi (null =
      /// hedefsiz). Kilit altında taze hedefle karşılaştırılır; farklıysa 409
      /// `TARGET_COLOR_CHANGED`. `undefined` = kontrol yok (eski APK).
      expectedTargetColorId?: string | null;
      /// Plandan FARKLI renk kabul edilirken operatörün kararı (2026-08-21):
      /// APPLY_TO_PLAN → kabul sonrası iş emri hedef rengi de bu renge çekilir
      /// (tx DIŞI, best-effort; tek bekçi reddederse yanıt `warnings`);
      /// ROLLS_ONLY → sapma KABULDE deftere düşer, Tambur aynı topa tekrar sormaz.
      /// undefined = eski davranış.
      planColorAction?: "APPLY_TO_PLAN" | "ROLLS_ONLY";
      /// Override — fason kategorisi appliesProperty=true ise WO.targetProperties
      /// otomatik kullanılır; UI farklı liste verirse buradan gönderilir (replace).
      appliedPropertyIds?: string[];
      /// Bu kabulde ÖLÇÜLEN en (cm) — doğan TÜM parçalara uygulanır ve makbuza yazılır.
      /// Renkten farkı: renk yalnız "renk veren" kategoride sorulur, en HER fason
      /// dönüşünde sorulur (topun enini ilk kez burada öğreniyoruz — ham girişte en
      /// tasarım gereği yazılmıyor). Zorunluluk ARAYÜZDE; burada opsiyonel kalması
      /// zorunludur, yoksa alanı göndermeyen eski APK'ların her kabulü 400 alır.
      appliedWidth?: number | null;
      /// Fasondan gelen açık kumaş parçaları — verilirse Receipt anında yeni
      /// "open-fabric" Roll'lar otomatik doğar ve rotadaki bir sonraki adıma
      /// bağlanır. Verilmezse mevcut akış: Kurşun/KK2 operatörü
      /// `POST /api/rolls/open-fabric` ile manuel açar.
      newRolls?: Array<{
        qty: number;
        weightKg?: number | null;
        notes?: string | null;
      }>;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.returns || data.returns.length === 0) {
      throw AppError.badRequest("En az bir dönüş kaydı girin");
    }
    for (const r of data.returns) {
      if (r.receivedQty != null && (!Number.isFinite(r.receivedQty) || r.receivedQty <= 0)) {
        throw AppError.badRequest("Gelen metraj pozitif olmalı");
      }
    }

    // IDEMPOTENCY #1 — clientToken (kısmi teslimatın TEK replay kimliği): `receive()`deki boğaz
    // (`receiptReplay`) okur; küme-eşitliği guard'ı (aşağıda) kısmi teslimatta çalışamaz.

    // IDEMPOTENCY (offline sync replay): yalnız bu çağrıdaki dönüş kümesiyle
    // BİREBİR AYNI kümeyi kabul etmiş (iptal edilmemiş) bir makbuz varsa cached
    // döndür — sevk tarafındaki sameRolls guard'ıyla (dispatch) gerçekten simetrik.
    //
    // Eski guard KESİŞİME bakıyordu (findFirst, newRollId IN incoming): kısmi
    // örtüşen payload'da ({R1,R2} gelir, R1 önceden kabul edilmiş) makbuz-1 cached
    // dönüyor, R2 SESSİZCE atlanıyordu — operatör başarı toast'ı görür, top
    // AT_SUBCONTRACTOR'da takılı kalırdı. Artık:
    //   TAM küme eşitliği → cached makbuz;
    //   KISMİ örtüşme    → cached DÖNME, akışa devam — tx içindeki atomik claim
    //                      AT_SUBCONTRACTOR olmayan topları net 409'lar;
    //   ayrık küme       → guard tetiklenmez (kısmi/partili dönüş normal kabul).
    //
    // KRİTİK: cancelledAt: null filtresi şart — iptal edilmiş receipt cached
    // dönerse silent failure olur (toast başarılı ama hiçbir şey olmaz).
    const incomingRollIds = data.returns.map((r) => r.rollId);
    const incomingSet = new Set(incomingRollIds);
    const overlappingItems = await prisma.subcontractorReceiptItem.findMany({
      where: {
        newRollId: { in: incomingRollIds },
        receipt: { stepId: data.stepId, cancelledAt: null },
      },
      select: { receiptId: true },
    });
    if (overlappingItems.length > 0) {
      const priorReceipts = await prisma.subcontractorReceipt.findMany({
        where: { id: { in: [...new Set(overlappingItems.map((i) => i.receiptId))] } },
        include: {
          subcontractor: true,
          step: { include: { station: true } },
          items: { include: { newRoll: true } },
        },
      });
      for (const prior of priorReceipts) {
        // Kalemler yalnız returns'ten yazılır (newRolls kalem üretmez, satır 1954)
        // → kalem kümesi = kabul edilen dönüş topları kümesi.
        //
        // ⚠️ KISMİ makbuz (herhangi bir kalemi isPartial) cached DÖNEMEZ: aynı
        // top kümesi ikinci teslimatta meşru olarak tekrar gelir ("100 gitti,
        // 51 geldi, 49 sonra"). Kısmi denemelerin replay kimliği clientToken'dır
        // (yukarıda); kümeye bakan bu guard yalnız tam-tüketimli makbuzlar için.
        if (prior.items.some((i) => i.isPartial)) continue;
        const priorRollIds = new Set(prior.items.map((i) => i.newRollId));
        const sameRolls =
          priorRollIds.size === incomingSet.size &&
          [...priorRollIds].every((id) => incomingSet.has(id));
        if (sameRolls) {
          return {
            success: true,
            data: prior,
            message: `Mal kabul zaten yapılmış (idempotent retry). Makbuz: ${prior.receiptNo}`,
          };
        }
      }
    }

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
      select: { id: true, isActive: true },
    });
    if (!subcontractor) throw AppError.notFound("Fason firma bulunamadı");
    // Soft-delete guard: pasife alınmış firmadan kabul yapılamaz.
    if (!subcontractor.isActive) throw AppError.badRequest("Fason firma pasif durumda");

    // İrsaliye no opsiyonel — boş geldiyse null sakla.
    const manifestNoTrimmed =
      data.manifestNo && data.manifestNo.trim().length > 0
        ? data.manifestNo.trim()
        : null;

    const wo = await prisma.workOrder.findUnique({
      where: { id: data.workOrderId },
      select: {
        id: true,
        targetItemId: true,
        targetColorId: true,
        width: true,
        targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { propertyId: true } },
      },
    });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);

    // Roll.itemId fason dönüşünde DEĞİŞMEZ. Renk ise BU ADIM "renk veren" bir
    // kategoriye (SubcontractorCategory.appliesColor=true) bağlıysa
    // WO.targetColorId'den; özellikler ise "özellik veren" kategoride
    // (SubcontractorCategory.appliesProperty=true) WO.targetProperties'tan
    // otomatik kopyalanır. Aynı adım her ikisini de yapabilir (Boyahane).
    // Planlama tarafı rotada her bayrak için bir adım garanti eder.

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: true,
        requiredCategory: {
          select: {
            id: true,
            name: true,
            appliesColor: true,
            appliesProperty: true,
          },
        },
        workOrder: {
          include: { steps: { orderBy: { stepSequence: "asc" } } },
        },
      },
    });
    if (!step) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
    // Çapraz kontrol (dispatch ile simetrik): uyuşmaz çiftte makbuz yanlış
    // WO'ya yazılır, born roll'lar yanlış WO'nun targetItem/width'ini alır ve
    // WO-tamamlama bloğu BAŞKA iş emrini COMPLETED'a çekebilirdi (parti-ayırma
    // akışında istemcinin kart-WO/parti-adım eşleştirmesi tam bu hataya açık).
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest(`Adım bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ait değil`);
    }
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest(
        "Mal kabul yalnızca EXTERNAL istasyon adımları için yapılabilir"
      );
    }
    if (step.status !== StepStatus.ACTIVE) {
      throw AppError.badRequest(
        `Adım ACTIVE değil. Önce sevk yapılmış olmalı (mevcut: ${step.status})`
      );
    }

    const appliesColor = !!step.requiredCategory?.appliesColor;
    const appliesProperty = !!step.requiredCategory?.appliesProperty;
    if (appliesColor && !wo.targetColorId && data.appliedColorId === undefined) {
      // Mesaj OPERATÖRE yazılır, geliştiriciye değil: eski hâli "appliedColorId
      // override gönderin" diyordu ve tablette duran kişiye hiçbir şey söylemiyordu
      // — üstelik yapılabilecek tek şeyi (rengi ekrandan seçmek) hiç anmıyordu.
      // Üç dal da somut: ne oldu · ne yapmalı · ekranda o yüzey yoksa neden yok.
      throw AppError.badRequest(
        `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} hedef renk tanımlı değil — kabulde uygulanan rengi seçmeniz gerekiyor. ` +
          "Ekranda renk seçimi görünmüyorsa uygulama sürümü eskidir; yöneticinize bildirin.",
      );
    }

    // appliedColorId / appliedPropertyIds resolution:
    //   - Override gönderildiyse onu kullan (null override de meşru — renk yok)
    //   - Yoksa: appliesColor=true ise WO.targetColorId'den otomatik; değilse null
    //   - Property için ayrı bayrak: appliesProperty=true ise WO.targetProperties;
    //     boş targetProperties bilinçli olabilir → sessizce boş liste
    // `let`: override yoksa nihai değer tx İÇİNDE, WO kilidi altında TAZE hedeften
    // yeniden çözülür (2026-08-21 — aşağıdaki "HEDEF RENK — kilit ALTINDA" bloğu).
    // Buradaki değer yalnız pre-tx doğrulamalar + varsayılan içindir.
    let resolvedAppliedColorId: string | null =
      data.appliedColorId !== undefined
        ? data.appliedColorId
        : appliesColor
          ? wo.targetColorId
          : null;
    // Kabulde ÖLÇÜLEN en — renkten farklı olarak kategoriye BAKMAZ (her fason
    // dönüşünde sorulur). Burada çözülür çünkü iki yerde birden kullanılıyor:
    // makbuz satırı (aşağıda) ve doğan topların width'i (newRolls bloğu).
    // `> 0` süzgeci: 0 "ölçülmedi" demektir, 0 cm'lik kumaş yok.
    const measuredWidth =
      data.appliedWidth != null && data.appliedWidth > 0
        ? new Prisma.Decimal(data.appliedWidth)
        : null;
    // Dedupe ŞART: payload'da tekrar eden property, rollProperty @@unique
    // P2002'sine çarpıp withBarcodeRetry'ı yanlış tetikliyordu (koca kabul
    // tx'i 5 kez boşuna denenip yanıltıcı "Barkod üretimi başarısız" 409'u).
    const resolvedAppliedPropertyIds = [
      ...new Set(
        data.appliedPropertyIds !== undefined
          ? data.appliedPropertyIds
          : appliesProperty
            ? wo.targetProperties.map((p) => p.propertyId)
            : [],
      ),
    ];

    // Override varlık + isActive doğrulaması (soft-delete giriş guard'ı —
    // SEC-2/SEC-3'ün fason kabuldeki kardeşi): pasif renk/özellik born
    // roll'lara sessizce işlenmesin.
    if (data.appliedColorId) {
      const colorRow = await prisma.color.findUnique({
        where: { id: data.appliedColorId },
        select: { isActive: true },
      });
      if (!colorRow || !colorRow.isActive) {
        throw AppError.badRequest("Uygulanan renk bulunamadı veya pasif");
      }
    }
    if (resolvedAppliedPropertyIds.length > 0) {
      // ⚠️ Doğrulama artık KAYNAKTAN BAĞIMSIZ (denetim F3): eski `data.appliedPropertyIds
      // !== undefined` şartı, override GELMEDİĞİNDE WO.targetProperties'ten çözülen
      // listeyi hiç doğrulamıyordu — hedef listesine sızmış bir SEÇİM özelliği
      // (KAT/GRAMAJ) fason dönüşünde doğan HER topa valueId'siz kopyalanırdı.
      const propRows = await prisma.fabricProperty.findMany({
        where: { id: { in: resolvedAppliedPropertyIds }, isActive: true },
        select: { id: true },
      });
      if (propRows.length !== resolvedAppliedPropertyIds.length) {
        throw AppError.badRequest("Uygulanan özelliklerden bazıları bulunamadı veya pasif");
      }
      // SEÇİM tipli özellik fason kabulle UYGULANAMAZ: değeri yoktur, "uygulandı"
      // demek hangi değerin uygulandığını söylemez.
      await assertTargetablePropertyIds(resolvedAppliedPropertyIds, "fason kabulde uygulanan özellik");
    }

    // Bu step'te halen AT_SUBCONTRACTOR olan roller
    const outstandingRolls = await prisma.roll.findMany({
      where: {
        currentStepId: data.stepId,
        status: RollStatus.AT_SUBCONTRACTOR,
      },
      select: {
        id: true,
        barcode: true,
        currentQty: true,
        weightKg: true,
        batchId: true, // F74: kaynak parti (firma çapraz-kontrolü için)
        ownerCustomerId: true, // F1b: emanet deposu ön kontrolü (aşağıda)
      },
    });
    const outstandingIds = new Set(outstandingRolls.map((r) => r.id));

    // Giriş doğrulaması — hatalı id'ler ÖNCE toplanır, mesaj sonra barkodla
    // kurulur. Ham UUID basmak operatöre hiçbir şey söylemiyordu; barkod
    // sorgusu yalnız hata yolunda koşar (mutlu yolda ek sorgu yok).
    const returnIds = new Set<string>();
    const duplicateIds: string[] = [];
    const notOutstandingIds: string[] = [];
    for (const r of data.returns) {
      if (returnIds.has(r.rollId)) {
        duplicateIds.push(r.rollId);
        continue;
      }
      returnIds.add(r.rollId);
      if (!outstandingIds.has(r.rollId)) {
        notOutstandingIds.push(r.rollId);
      }
    }
    if (duplicateIds.length > 0 || notOutstandingIds.length > 0) {
      const labels = await resolveRollLabels(prisma, [...duplicateIds, ...notOutstandingIds]);
      if (duplicateIds.length > 0) {
        throw AppError.badRequest(
          `Aynı top dönüş listesinde iki kez geçiyor: ` +
            `${duplicateIds.map((id) => rollLabel(labels, id)).join(", ")}`,
        );
      }
      throw AppError.badRequest(
        `Şu toplar bu adımda fasona gönderilmemiş veya zaten dönmüş: ` +
          `${notOutstandingIds.map((id) => rollLabel(labels, id)).join(", ")}`,
      );
    }

    // F74: dönen topların kaynak sevk firması, seçilen firmayla (data.subcontractorId)
    // eşleşmeli — yoksa farklı firmaya ait toplar bu makbuza karışır (firma başına
    // ayrı kabul olmalı). Kaynak dispatch: `Roll.batchId` → `SubcontractorDispatch.batchId`.
    // stepId scope ŞART: parti birden fazla fason adımından geçmişse (ör.
    // Zımpara→Boyahane), önceki adımın kabul edilmiş dispatch'i hâlâ cancelledAt=null
    // kalır; stepId olmadan batchId→firma 1'e-çok olur, Map bayat firmayı tutar ve
    // aynı firmaya doğru yapılan kabulde bile yanlış "farklı firma" hatası üretir.
    const returnedRolls = outstandingRolls.filter((r) => returnIds.has(r.id));
    const srcBatchIds = [
      ...new Set(returnedRolls.map((r) => r.batchId).filter((x): x is string => !!x)),
    ];
    // outstanding-scope ŞART (K15 retarget dönmüş sevkleri aynı adıma taşıyabilir):
    // merge sonrası survivor'da aynı adımda DÖNMÜŞ + AÇIK sevk yan yana durabilir;
    // outstanding koşulu olmadan Map last-wins belirsizliği dönmüş sevkin (bayat)
    // firmasını tutar ve doğru firmaya yapılan kabul bile yanlış reddedilirdi.
    const srcDispatches =
      srcBatchIds.length > 0
        ? await prisma.subcontractorDispatch.findMany({
            // isPartial:false — kısmi makbuz kalemi kapatmaz; kısmen dönmüş sevk
            // hâlâ AÇIKTIR (ikinci teslimatın firma çözümü buradan geçer). Tanım
            // TEK KAYNAKTAN (`OPEN_OUTSTANDING`).
            where: { batchId: { in: srcBatchIds }, stepId: data.stepId, ...OPEN_OUTSTANDING },
            select: { id: true, batchId: true, subcontractorId: true, dispatchedAt: true },
            orderBy: [{ dispatchedAt: "asc" }, { id: "asc" }],
          })
        : [];
    const firmByBatch = new Map(srcDispatches.map((d) => [d.batchId, d.subcontractorId]));
    // Doğan topların partisi (D8 R5b): kabul EDİLEN sevkin partisi; birden çok partinin açık sevki
    // varsa istemci seçer, seçmezse en eski açık sevk. Sıralamasız `find` belirlenimsizdi.
    const openBatchIds = srcDispatches.map((d) => d.batchId).filter((b): b is string => !!b);
    if (data.batchId && !openBatchIds.includes(data.batchId)) {
      throw AppError.badRequest("Seçilen parti bu kabulün açık sevklerinden biri değil — listeyi yenileyin.", {
        code: "RECEIPT_BATCH_NOT_OPEN",
      });
    }
    const receiptBatchId = data.batchId ?? openBatchIds[0] ?? null;
    for (const r of returnedRolls) {
      const firmId = r.batchId ? firmByBatch.get(r.batchId) : undefined;
      if (!firmId) {
        throw AppError.conflict(
          "Dönen topun kaynak sevki bulunamadı. Listeyi yenileyip tekrar deneyin.",
        );
      }
      if (firmId !== data.subcontractorId) {
        throw AppError.badRequest(
          "Seçilen toplardan biri farklı bir fason firmasına ait — bu makbuza dahil edilemez. Firma başına ayrı kabul yapın.",
        );
      }
    }

    // F1b: emanet deposu ayarlı ama kullanılamıyorsa claim'den ÖNCE 400 (yazmaz); tx içindeki boğaz yeniden sorar.
    // Yalnız tek sahipli kaynakta sorulur — karışık sahip tx içinde zaten 409 OWNER_MISMATCH.
    const returnedOwners = new Set(returnedRolls.map((r) => r.ownerCustomerId));
    const returnedOwner = returnedOwners.size === 1 ? [...returnedOwners][0] ?? null : null;
    if (data.newRolls && data.newRolls.length > 0 && returnedOwner) {
      await resolveEmanetBirthWarehouseIdTx(prisma, returnedOwner);
    }

    const allSteps = step.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === step.id);
    // F76: ilk NON-SKIPPED sonraki adım (SKIPPED terminal adıma bağlanmayı önle).
    const nextStep =
      currentIndex >= 0
        ? allSteps.slice(currentIndex + 1).find((s) => s.status !== StepStatus.SKIPPED) ?? null
        : null;

    // withBarcodeRetry: receiptNo (@unique) tx içinde nextPrefixedSequenceTx ile
    // üretiliyor; eşzamanlı kabullerde P2002 çakışmasında tx baştan denenir.
    // Takip teslimatında doğan yeni parti numarası — mesaj/audit için (retry'da
    // tx başında sıfırlanır, bayat değer taşımaz).
    let followUpBatchNumber: string | null = null;
    // Kilit altında okunan TAZE hedef renk — tx dışındaki "iş emri de bu renge
    // dönsün" kararı (planColorAction=APPLY_TO_PLAN) bu değere göre verilir.
    let targetColorAtReceipt: string | null = wo.targetColorId ?? null;
    // Yarış dalı çalıştı mı (aşağıdaki catch) — audit ve yan etkiler tekrarlanmasın.
    // ⚠️ PREDICATE ZORUNLU (BULGU-T1-005). `withBarcodeRetry` predicate'siz
    // çağrıldığında HER P2002'yi barkod/sıra çakışması sanıp 5 kez tekrarlar.
    // Bu tx'te `clientToken` de @unique: aynı fişin eşzamanlı ikinci kopyası
    // (çevrimdışı kuyruk replay'i) o çakışmaya düşer, beş deneme de aynı KALICI
    // çakışmaya çarpar ve operatöre "Barkod üretimi 5 denemede başarısız oldu"
    // 409'u döner — barkodla ilgisi olmayan bir mesaj. Operatör kabulü ELLE
    // yeniden girer (yeni token → hiçbir guard'a takılmaz) ve teslimat İKİ KEZ
    // düşülür. Ölçüldü: 300 m'lik topta currentQty 300 → 60 (180 olmalıydı),
    // 2 aktif makbuz, 2 doğan top, 2 çekme sapması.
    const sequenceCakismasi = (err: Prisma.PrismaClientKnownRequestError): boolean =>
      !p2002Mentions(err, /clientToken|nameFold|one_pending_per_step|one_open_per_roll_step/i);
    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
      // Fason completion yarışı (subcon #4): WO satırını kilitle — stillAtSubcontractor
      // sayımı eşzamanlı dispatch'in commit'li toplarını görsün.
      await touchWorkOrderTx(tx, data.workOrderId);
      followUpBatchNumber = null;

      // ── HEDEF RENK — kilit ALTINDA taze (2026-08-21) ──────────────────────
      // Pre-tx okunan `wo.targetColorId` bayat olabilir: planlamacı kabul
      // sürerken "Rengi Değiştir" ile rengi çevirmiş olabilir. İki koruma:
      //   (a) override yoksa uygulanacak renk TAZE hedeften çözülür;
      //   (b) tablet ekranı açarken gördüğü hedefi gönderdiyse
      //       (`expectedTargetColorId`) ve taze hedef farklıysa 409 — operatör
      //       yenilesin, eski renk sessizce yazılmasın. Tablet `appliedColorId`yi
      //       DAİMA gönderir (override yolu), bu yüzden (a) tek başına tableti
      //       korumazdı; (b) şart. Alan gönderilmediyse kontrol yok (eski APK).
      const freshWo = await tx.workOrder.findUnique({
        where: { id: data.workOrderId },
        select: { targetColorId: true, targetColor: { select: { name: true } } },
      });
      const freshTargetColorId = freshWo?.targetColorId ?? null;
      targetColorAtReceipt = freshTargetColorId;
      if (
        data.expectedTargetColorId !== undefined &&
        (data.expectedTargetColorId ?? null) !== freshTargetColorId
      ) {
        throw AppError.conflict(
          `${TERIM.terbiyeIsEmri.cumleBasi.ilgi} hedef rengi bu arada değişti — artık "${freshWo?.targetColor?.name ?? "renksiz"}". ` +
            "Ekranı yenileyip rengi kontrol ederek tekrar kaydedin.",
          {
            code: "TARGET_COLOR_CHANGED",
            expectedColorId: data.expectedTargetColorId ?? null,
            currentColorId: freshTargetColorId,
            currentColorName: freshWo?.targetColor?.name ?? null,
          },
        );
      }
      if (data.appliedColorId === undefined && appliesColor) {
        resolvedAppliedColorId = freshTargetColorId;
      }

      // ── KISMİ/TAM SINIFLANDIRMA — kilit ALTINDA TAZE metrajla ─────────────
      // Pre-tx okunan currentQty bayat olabilir (eşzamanlı kısmi kabul kalanı
      // düşürmüş olabilir); tam/kısmi kararı ancak WO kilidi altında verilir.
      // Kural kısmi sevkin aynası: receivedQty yok ya da kalanı aşıyor/eşit →
      // TAM (top tüketilir, eski davranış birebir); kalanın altında → KISMİ.
      const freshReturns = await tx.roll.findMany({
        where: {
          id: { in: data.returns.map((r) => r.rollId) },
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStepId: data.stepId,
        },
        // `colorId` — renk MİRASI için (aşağıdaki blok).
        select: { id: true, currentQty: true, colorId: true },
      });
      if (freshReturns.length !== data.returns.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle (kabul/iptal) değişmiş. Listeyi yenileyip tekrar deneyin."
        );
      }
      // ── RENK MİRASI — renk UYGULAMAYAN fason adımı rengi SİLMEZ (2026-09-01)
      // Ölçülen saha vakası: "Boya + Zımpara" rotasında mal boyahaneden RENKLİ
      // dönüyor, sonra ZIMPARA kabulünde renk NULL'a düşüyordu — çünkü renk
      // yalnız üç kaynaktan çözülüyordu: açık override · (istasyon renk
      // uyguluyorsa) WO hedefi · aksi hâlde NULL. Zımpara `appliesColor=false`
      // olduğu için üçüncü dala düşüyor ve doğan top RENKSİZ doğuyordu.
      //
      // Bu, "bitmiş toplar renksiz" şikayetinin MEKANİZMASIYDI: boyadan SONRA
      // gelen her fason adımı rengi siliyordu (canlı demoda 86 bitmiş topun
      // 40'ı renksizdi).
      //
      // Kural: zımpara/baskı gibi bir adım kumaşın RENGİNİ DEĞİŞTİRMEZ → doğan
      // top ebeveyninin rengini taşır.
      // ⚠️ YALNIZ TEK RENKLİYSE: kabulde birden çok renkte top varsa hangisinin
      // doğacağı belirsizdir; renk UYDURULMAZ, null bırakılır (fail-closed).
      // ⚠️ Açık `appliedColorId: null` override'ı EZİLMEZ — o "rengi kaldır"
      // demektir ve meşrudur (`!== undefined` kontrolü onu korur).
      if (data.appliedColorId === undefined && !appliesColor) {
        const ebeveynRenkleri = new Set(
          freshReturns.map((r) => r.colorId).filter((x): x is string => x != null),
        );
        if (ebeveynRenkleri.size === 1) {
          resolvedAppliedColorId = [...ebeveynRenkleri][0] as string;
        }
      }

      const remainingByRoll = new Map(freshReturns.map((r) => [r.id, r.currentQty]));
      /** rollId → bu makbuzun kabul ettiği metraj (defter satırı) + kısmi mi. */
      const plans = data.returns.map((ret) => {
        const remaining = remainingByRoll.get(ret.rollId)!;
        const req =
          ret.receivedQty != null ? new Prisma.Decimal(ret.receivedQty) : null;
        const partial = req !== null && req.lessThan(remaining);
        return {
          rollId: ret.rollId,
          notes: ret.notes ?? null,
          partial,
          // TAM kabulde deftere KALAN yazılır (fazla dönen metraj born toplarda
          // yaşar; kalemden düşülebilecek en fazla şey kalandır).
          receivedQty: partial ? req! : remaining,
        };
      });
      const fullIds = plans.filter((p) => !p.partial).map((p) => p.rollId);
      const partialPlans = plans.filter((p) => p.partial);

      // ── TAKİP TESLİMATI MI? — parti kararı (kendi kalemlerimiz yazılmadan ÖNCE)
      // Kaynak sevkte daha önce aktif makbuz satırı varsa bu, aynı sevkin İKİNCİ+
      // teslimatıdır → doğan toplar YENİ parti alır (K5 kalan-böl kuralının
      // dönüş aynası; farklı tarihte/kazanda çıkan mal ayrı boya lotudur).
      // İlk teslimat giden partiyi sürdürür — tek seferde tam dönüşte hiçbir
      // şey değişmez.
      //
      // ⚠️ KAPSAM SEVKTİR, PARTİ DEĞİL — ve bu ayrım load-bearing. Sorgu
      // `batchId IN srcBatchIds` ile kurulsaydı (ilk yazımı öyleydi) parti
      // BİRLEŞTİRMESİ sonrası yanlış cevap verirdi: K15 merge, aynı adımda
      // DÖNMÜŞ bir sevkle AÇIK bir sevki tek partinin altında yan yana
      // getirebiliyor (hemen yukarıdaki `srcDispatches` yorumunun anlattığı
      // durumun aynısı). O zaman dönmüş sevkin makbuz satırları sayıma girer ve
      // AÇIK sevkin İLK teslimatı "takip teslimatı" sanılır → doğan toplar
      // gereksiz yere yeni bir partiye bölünür. Ölçüldü: `test_batch_k15_merge`
      // g4 tam bunu yakaladı (born top P71 yerine P73'e doğuyordu).
      // `srcDispatches` zaten outstanding-scope'lu, yani "şu an kabul ettiğimiz"
      // sevkler — doğru kapsam odur.
      const srcDispatchIds = srcDispatches.map((d) => d.id);
      const isFollowUpDelivery =
        srcDispatchIds.length > 0 &&
        (await tx.subcontractorReceiptItem.count({
          where: {
            receipt: { cancelledAt: null },
            sourceDispatchItem: { dispatchId: { in: srcDispatchIds } },
          },
        })) > 0;

      const now = new Date();
      const receiptNo = await nextSubcontractorDocNoTx(tx, "subcontractorReceipt", now);

      const receipt = await tx.subcontractorReceipt.create({
        data: {
          receiptNo,
          clientToken: data.clientToken ?? null,
          manifestNo: manifestNoTrimmed,
          workOrderId: data.workOrderId,
          stepId: data.stepId,
          subcontractorId: data.subcontractorId,
          receivedById: userId ?? null,
          notes: data.notes ?? null,
          appliedColorId: resolvedAppliedColorId,
          appliedWidth: measuredWidth,
        },
      });
      await emitSubcontractReceivedTx(tx, receipt.id, plans.length, userId);

      // Receipt'in property listesi — yeni doğacak açık kumaş Roll'ları bunu
      // inherit edecek (Kurşun/KK2'de operatör "yeni kumaş aç" çağrısında).
      if (resolvedAppliedPropertyIds.length > 0) {
        await tx.subcontractorReceiptProperty.createMany({
          data: resolvedAppliedPropertyIds.map((propertyId) => ({
            receiptId: receipt.id,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }

      // ── Toplu hazırlık ─────────────────────────────────────────────────
      // YENİ MODEL: Roll'lar sonraki step'e taşınmaz. Terminal'e (CONSUMED)
      // çekilir — top fasona gittiyse (boyahane / zımpara / başkası) mutlaka
      // açılır, fiziksel "top" kavramı kaybolur. Yeni Roll'lar Kurşun/KK2'de
      // operatörün open-fabric çağrısıyla doğar.
      const returnRollIds = data.returns.map((r) => r.rollId);

      // 1) Açık movement'leri kapat — YALNIZ TAM kabul edilen toplar. Kısmi
      //    kabulde top fasonda kalmaya devam eder; movement son teslimata (ya da
      //    kalan-kapamaya) kadar AÇIK kalır. qtyOut = qtyIn (sevk edilen toplam):
      //    kısmi teslimatlar sonrası r.currentQty kalana inmiş olur ve onu yazmak
      //    istasyon hacmini eksik gösterirdi; normal (tek teslimat) yolda
      //    qtyIn == currentQty olduğundan davranış birebir aynı.
      if (fullIds.length > 0) {
        await tx.$executeRaw`
          UPDATE "roll_movements" rm
          SET "qtyOut"   = COALESCE(rm."qtyIn", r."currentQty"),
              "weightOut" = r."weightKg",
              -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
              "exitedAt"  = now(),
              "notes"     = ${`RETURNED_VIA_RECEIPT:${receiptNo}`}
          FROM "rolls" r
          WHERE rm."rollId" = r."id"
            AND rm."workOrderStepId" = ${data.stepId}::uuid
            AND rm."exitedAt" IS NULL
            AND rm."revokedAt" IS NULL
            AND rm."rollId" = ANY(${fullIds}::uuid[])
        `;
      }

      // 2) Orijinal Roll'lar TERMINAL'e: SUBCONTRACTOR_CONSUMED, currentStepId=null.
      //    Top fasona gittiyse mutlaka açıldı — boyahane/zımpara fark etmez,
      //    kimliği kaybeder. currentQty / colorId / RollProperty dokunulmaz —
      //    son hayatın izi audit/raporlamada kalsın.
      //
      // ATOMİK CLAIM (dispatch'teki desenin aynası): idempotency + outstanding
      // guard'ları tx DIŞINDA okunuyor; iki operatör aynı partiyi eşzamanlı
      // kabul ederse ikisi de geçer ve İKİ makbuz + İKİ SET born roll doğardı.
      // withBarcodeRetry bunu kötüleştirir: receiptNo P2002'sinde yalnız tx
      // yeniden denenir, tx-dışı guard'lar koşmaz — kaybeden retry'da temiz
      // commit ederdi. WHERE'e AT_SUBCONTRACTOR koyup count'u doğrula: kaybeden
      // burada 409 alır (AppError.conflict P2002 olmadığından retry'a girmez).
      if (fullIds.length > 0) {
        const consumed = await tx.roll.updateMany({
          where: {
            id: { in: fullIds },
            status: RollStatus.AT_SUBCONTRACTOR,
          },
          data: {
            status: RollStatus.SUBCONTRACTOR_CONSUMED,
            currentStepId: null,
          },
        });
        if (consumed.count !== fullIds.length) {
          throw AppError.conflict(
            "Toplardan biri bu sırada başka bir işlemle (kabul/iptal) değişmiş. Listeyi yenileyip tekrar deneyin."
          );
        }
      }
      // KISMİ kabul: top FASONDA KALIR, kalan metraja atomik decrement ile iner
      // (kısmi sevkteki orijinal-decrement deseninin dönüş aynası). WHERE'deki
      // currentQty koşulu load-bearing: eşzamanlı bir kabul kalanı düşürdüyse
      // decrement negatife sarkmadan 409'a düşer. tx.* üzerinde Promise.all
      // YASAK — sıralı await (kısmi top sayısı zaten küçük).
      for (const p of partialPlans) {
        const dec = await tx.roll.updateMany({
          where: {
            id: p.rollId,
            status: RollStatus.AT_SUBCONTRACTOR,
            currentQty: { gt: p.receivedQty },
          },
          data: { currentQty: { decrement: p.receivedQty } },
        });
        if (dec.count !== 1) {
          throw AppError.conflict(
            "Top bu sırada değişti — kısmi kabul yapılamadı. Listeyi yenileyin."
          );
        }
      }

      // 3) Receipt item kayıtları — orijinal Roll referansı (audit + UI'da
      //    "bu receipt hangi orijinal toplara karşılık" görünmek için).
      //    sourceDispatchItemId ile kaynak sevk kalemine bağlanır: bu bağ
      //    olmadan open-dispatch guard'ı ve fason raporu sevki sonsuza dek
      //    "açık" görür (dönen/turnaround metrikleri de bozulur). Her dönen
      //    top, bu adımdaki açık (kabul görmemiş) sevk kalemiyle eşleşir.
      // Sadece İPTAL EDİLMEMİŞ bir TAM receipt item'ı olan kalem "dolu" sayılır
      // (`none: {}` eski hali iptal edilmiş makbuzu da dolu sayıyor, top iptal →
      // yeniden kabulde kalem bağlanamıyordu); kısmi makbuz kalemi DOLDURMAZ —
      // ikinci teslimatın kalemi de AYNI sevk kalemine bağlanır. Tanım TEK
      // KAYNAKTAN; `stepId` scope'u korunur (kalem bu adımın sevkinde olmalı).
      const openDispatchItems = await tx.subcontractorDispatchItem.findMany({
        where: {
          rollId: { in: returnRollIds },
          ...outstandingItemOfOpenDispatch({ stepId: data.stepId }),
        },
        select: { id: true, rollId: true },
      });
      const dispatchItemByRoll = new Map(
        openDispatchItems.map((di) => [di.rollId, di.id] as const),
      );
      await tx.subcontractorReceiptItem.createMany({
        data: plans.map((p) => ({
          receiptId: receipt.id,
          newRollId: p.rollId,
          sourceDispatchItemId: dispatchItemByRoll.get(p.rollId) ?? null,
          notes: p.notes,
          // Defter satırı: bu makbuz bu kalemden kaç metre düştü + kısmi mi.
          receivedQty: p.receivedQty,
          isPartial: p.partial,
        })),
      });

      // D4-D3/MIG6 (K8): ayar açıkken uygulanan bayrağın çeşidindeki İE hedefi (desen) — yalnız top DOĞAN kabulde;
      // doğan topa RollProperty, dönüş işlemine `propertyValueId` (tek desen; ters yol mevcut revoke damgası).
      const receiptVariants = data.newRolls && data.newRolls.length > 0
        ? await readReceiptTargetVariantsTx(tx, { workOrderId: data.workOrderId, appliedFlagIds: resolvedAppliedPropertyIds })
        : [];
      const returnedValueId = receiptOperationValueId(receiptVariants);

      // 4) RollOperation log — orijinal Roll'a son işlem (SUBCONTRACTOR_RETURNED).
      //    Unique key (rollId, stepId, opType) — re-receive sessiz geçer.
      await tx.rollOperation.createMany({
        data: plans.map((p) => ({
          rollId: p.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
          operatorId: userId ?? null,
          ...(returnedValueId ? { propertyValueId: returnedValueId } : {}),
          metadata: {
            receiptNo,
            manifestNo: manifestNoTrimmed,
            returnNote: p.notes,
            consumedAtSubcontractor: !p.partial,
            // Kısmi teslimat izi. ⚠️ (rollId, stepId, opType) unique olduğundan
            // ikinci teslimatın satırı skipDuplicates ile atlanır — teslimat
            // teslimat defter, makbuz kalemlerindedir (receivedQty); bu log
            // "top fasondan döndü" olayının İLK iziydi ve öyle kalır.
            receivedQty: Number(p.receivedQty),
            partial: p.partial,
          } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });

      // Step COMPLETED (tüm outstanding'ler dönmediyse hala ACTIVE kalmalı)
      const stillAtSubcontractor = await tx.roll.count({
        where: {
          currentStepId: data.stepId,
          status: RollStatus.AT_SUBCONTRACTOR,
        },
      });
      if (stillAtSubcontractor === 0) {
        await tx.workOrderStep.update({
          where: { id: step.id },
          data: { status: StepStatus.COMPLETED, completedAt: new Date() },
        });
      }

      // Son step + hepsi tamamlandıysa WO COMPLETED (adım sayımı + kart geçişi
      // helper'ın içinde; terminal guard da orada).
      if (!nextStep && stillAtSubcontractor === 0) {
        await completeWorkOrderIfStepsDone(tx, data.workOrderId, { trigger: "FASON_RECEIPT" });
      }

      // 5) newRolls açık kumaş Roll'larını burada doğur. Controller seviyesinde
      //    min(1) zorunlu — fason kabul her zaman en az bir açık kumaş parçasıyla
      //    yapılır. Sonraki adım rotadaki bir sonraki adım: fason ise oraya
      //    bağlanır (kullanıcı sonra Dispatch çağırır), değilse Kurşun/KK2 gibi
      //    internal step'e. nextStep yoksa Roll'lar serbest stokta kalır.
      if (data.newRolls && data.newRolls.length > 0) {
        // Kaynak roll'lardan inherit: itemId + width. ItemId: WO.targetItemId önce
        // (rota hedefi belli) — değilse source.
        //
        // WIDTH ÖNCELİĞİ (2026-08-05'te DEĞİŞTİ — sıra load-bearing):
        //   1. data.appliedWidth — kabulü yapan personelin ÖLÇTÜĞÜ değer
        //   2. sourceRoll.width — kaynak topun eni
        //   3. wo.width — iş emri hedef eni
        // Eskiden 1. basamak yoktu ve yorum "kumaş eni boyahanede değişmez" diyordu;
        // bu YANLIŞTI: ram/fikse/sanfor tam da eni değiştiren operasyonlardır. Üstelik
        // pratikte 2. ve 3. basamak da boştu (ham girişte en yazılmıyor → kaynak top
        // ensiz), yani doğan top ensiz doğuyor ve bir daha hiç en kazanmıyordu.
        // Operatörün ölçümü en üstte: gözlem, varsayımı yener.
        const sourceRoll = await tx.roll.findFirst({
          where: { id: { in: returnRollIds } },
          select: { itemId: true, width: true },
        });
        const bornItemId = wo.targetItemId ?? sourceRoll?.itemId ?? null;
        const bornWidth = measuredWidth ?? sourceRoll?.width ?? wo.width ?? null;
        if (!bornItemId) {
          throw AppError.badRequest(
            "Yeni Roll için item belirlenemedi (WO.targetItemId ve kaynak Roll itemId yok)"
          );
        }

        // Phase 4: born roll'lar kaynak partinin (dönen orijinal topların) dal
        // kimliğini kalıtır → dönüş çıktısı tüm rota boyunca aynı lane'de izlenir.
        const sourceLotRolls = await tx.roll.findMany({
          where: { id: { in: data.returns.map((r) => r.rollId) } },
          select: { batchId: true, stage: true },
        });
        let bornBatchId =
          receiptBatchId ?? sourceLotRolls.find((r) => r.batchId)?.batchId ?? null;
        // TAKİP TESLİMATI → doğan toplar YENİ parti (K5 kalan-böl kuralının
        // dönüş aynası): aynı sevkin ikinci+ teslimatı farklı tarihte/kazanda
        // çıkmış maldır, ilk teslimatın partisiyle karışmaz. İlk teslimat giden
        // partiyi sürdürür — tek-teslimat yolunda davranış birebir aynı.
        if (isFollowUpDelivery && bornBatchId) {
          const created = await createBatchTx(tx, {
            workOrderId: data.workOrderId,
            rollIds: [],
            splitFromId: bornBatchId,
            userId,
          });
          bornBatchId = created.batch.id;
          followUpBatchNumber = created.batch.batchNumber;
        }

        // Pre-validate + explicit UUID üret → top başına create+create (N+1) yerine
        // createMany batch. createMany nested write desteklemediği ve eklenen id'leri
        // sıralı döndürmediği için id'leri burada üretip roll→movement/property eşliyoruz.
        // (Born roll'larda barcode null — açık kumaş, sequence retry gerekmez.)
        const bornRollInputs = data.newRolls.map((nr) => {
          if (!Number.isFinite(nr.qty) || nr.qty <= 0) {
            throw AppError.badRequest("Yeni Roll metrajı pozitif olmalı");
          }
          return { id: uuidv4(), nr };
        });

        // Fason bir SON adımsa (nextStep yok): dönen açık-kumaş toplar FİNAL üründür →
        // WAREHOUSE + "her kumaşa etiket" (barkod tx içinde SIRALI üretilir; sayaç satır-
        // kilidiyle serileşir, Promise.all YASAK) + form ACIK. Ara adımsa: IN_PRODUCTION +
        // barkodsuz (kesin ölçüm/etiket bir sonraki İÇ istasyonun FINISH'inde damgalanır;
        // STOCK yerine IN_PRODUCTION — currentStepId dolu, cutOpenFabric bunu zorunlu kılar).
        const bornStatus = nextStep ? RollStatus.IN_PRODUCTION : RollStatus.WAREHOUSE;
        // Top aşaması: son adımsa üretimden çıkış (adım ?? bitmiş), ara adımsa adım ?? kaynakların en düşüğü.
        const bornStage = nextStep
          ? stageForStepBirth(step.outputStage, lowestStage(sourceLotRolls.map((r) => r.stage)))
          : stageForProductionExit(step.outputStage);
        // (2026-08-10, F-CORE-VER-001) TEK rezervasyon — eskiden döngü her doğan
        // top için ayrı bir sayaç turu atıyordu; sayaç satırının kilidi ilk turdan
        // itibaren zaten tutulduğu için araya giren her tur kilidi o kadar
        // uzatıyordu. Ara adımda (nextStep var) barkod HİÇ üretilmez → sayaca
        // dokunulmaz (`count = 0` sayaç satırına hiç yazmaz).
        const reservedBorn = await reserveRollBarcodesTx(
          tx,
          "F",
          nextStep ? 0 : bornRollInputs.length,
        );
        const bornBarcodes: (string | null)[] = bornRollInputs.map((_, i) =>
          nextStep ? null : reservedBorn[i]!,
        );

        // EMANET: doğan top kaynak topların (makbuz kalemleri, yukarıda yazıldı) tek sahibini alır;
        // karışık sahip 409 OWNER_MISMATCH. Sahipsiz doğsa hizmet faturası ve sevk kapısı onu görmez (H10).
        const bornOwnerCustomerId = await resolveOwnerFromReceiptTx(tx, receipt.id);
        // DEPO — tekil ebeveyn yok (N kaynak, makbuzdan doğum), açık seçim de yok: sahipli doğum emanet deposuna
        // (F1b ayarı; boş/emanet kapalı = bugünkü), sahipsiz varsayılana — `createInitialEntry` ile aynı boğaz.
        // Çok depolu fasonda "geldiği depo" ihtiyacı doğarsa sevkin çıktığı depo `SubcontractorDispatch`ta damgalanır.
        const bornWarehouseId = await resolveBirthWarehouseIdTx(tx, null, bornOwnerCustomerId);

        await tx.roll.createMany({
          data: bornRollInputs.map(({ id, nr }, i) => ({
            id,
            itemId: bornItemId,
            colorId: resolvedAppliedColorId,
            initialQty: nr.qty,
            currentQty: nr.qty,
            weightKg: nr.weightKg ?? null,
            width: bornWidth,
            status: bornStatus,
            warehouseId: bornWarehouseId,
            // Fason dönüşü = açık kumaş (Tambur'dan geçmedi), kaliteye bakılmadı.
            form: RollForm.ACIK,
            qualityGrade: null,
            qualityGradeId: null,
            entrySource: "SUBCONTRACTOR_RETURN",
            stage: bornStage,
            parentReceiptId: receipt.id,
            ownerCustomerId: bornOwnerCustomerId,
            batchId: bornBatchId,
            // GİRİŞ İSTASYONU — makbuzun ADIMI (fason istasyonu). Top burada
            // doğdu: orijinal rulolar emekliye ayrıldı, bunlar makbuzdan doğdu.
            //
            // ⚠️ `currentStepId` DEĞİL — o bir SONRAKİ adımdır (nextStep) ve
            // topun gideceği yeri söyler, doğduğu yeri değil. Oradan çözmek
            // her fason dönüşü topuna yanlış istasyon yazardı.
            entryStationId: resolveEntryStationId({ stepStationId: step.stationId }),
            // Born açık-kumaş topu bu fason adımında "üretildi" — roll→WO bağı.
            producedInStepId: data.stepId,
            currentStepId: nextStep ? nextStep.id : null,
            createdById: userId ?? null,
            // Son adım: final barkod üretildi; ara adım: null (sonraki istasyon damgalar).
            barcode: bornBarcodes[i],
          })),
        });

        // DEPO DEFTERİ — YALNIZ mal fiilen DEPOYA girdiyse satır yazılır, yani
        // fason SON adımsa (`bornStatus === WAREHOUSE`). Ara adımda doğan top
        // IN_PRODUCTION'dır: fiziksel olarak üretim hattındadır, rafta değil.
        // ⚠️ Koşulsuz yazım depoya girmemiş malı depoda gösteriyordu (ölçüm:
        // bu kurulumda fason dönüşü girişlerinin 57/57'si böyleydi).
        if (bornStatus === RollStatus.WAREHOUSE) {
          await postStockMoves(
            tx,
            bornRollInputs.map(({ id, nr }) => ({
              rollId: id,
              eventType: WarehouseEventType.ENTRY,
              qty: nr.qty,
              // ⚠️ YALNIZ `to` UCU VAR ve bu doğru: top BU ANDA DOĞDU, öncesi yok.
              // Ebeveynin çıkışı fason SEVKİNDE yazılır (ayrı olay) — burada `from`
              // yazmak aynı malı iki kez düşmek olurdu.
              to: { warehouseId: bornWarehouseId, status: bornStatus },
              reasonCode: STOCK_MOVE_REASON.FASON_RECEIPT,
              userId: userId ?? null,
              notes: `Fason dönüşü (${receipt.receiptNo})`,
            })),
          );
          // ⚠️ POLİTİKA ARGÜMANI YOK: yeni kapı 0 metrajda/uçsuz satırda her zaman
          // FIRLATIR. Fason dönüşünde 0 metrajlı kabul kalemi veri hatasıdır (kabul
          // miktarı uçta doğrulanıyor) — sessiz atlama defteri eksiltirdi (K6).
        }

        // Receipt-seviyesi özellikler tüm born roll'larda aynı (resolvedAppliedPropertyIds)
        // → roll × property cross product tek createMany ile. skipDuplicates:
        // @@unique(rollId,propertyId) çakışması koca tx'i retry'a sokmasın
        // (receiptProperty createMany'siyle aynı savunma).
        if (resolvedAppliedPropertyIds.length > 0) {
          // D4-D3 (K8): hedef desen doğan topa — aynı tx; çeşit özelliği değersiz satır olarak da gelmişse
          // değerli satır onun yerini alır (aktif çift tekil). Okuma yukarıda (dönüş işlemiyle aynı küme).
          const variants = receiptVariants;
          const valued = new Set(variants.map((v) => v.propertyId));
          await tx.rollProperty.createMany({
            data: bornRollInputs.flatMap(({ id }) => [
              ...resolvedAppliedPropertyIds.filter((propertyId) => !valued.has(propertyId)).map((propertyId) => ({ rollId: id, propertyId })),
              ...variants.map((v) => ({ rollId: id, propertyId: v.propertyId, valueId: v.valueId })),
            ]),
            skipDuplicates: true,
          });
        }

        // ── PLAN DIŞI RENK KABULÜ → SAPMA DEFTERİ (2026-08-21) ──────────────
        // Operatör plandan farklı renk seçti ve "sadece bu toplar" dedi
        // (planColorAction=ROLLS_ONLY): sapma KABULDE onaylanmış sayılır ve doğan
        // her top için deftere düşer; Tambur kapısı aynı topa aynı soruyu BİR
        // DAHA SORMAZ ("sapma bir kez onaylanır" kuralı kabul anına uzandı).
        // APPLY_TO_PLAN tx DIŞINDA planı çeker (aşağıda). Hedefsiz iş emri kapsam
        // dışı (kapı da öyle: hedef renksizse boyalı top sapma değildir).
        if (
          data.planColorAction === "ROLLS_ONLY" &&
          appliesColor &&
          freshTargetColorId != null &&
          resolvedAppliedColorId !== freshTargetColorId
        ) {
          const applied = resolvedAppliedColorId
            ? await tx.color.findUnique({ where: { id: resolvedAppliedColorId }, select: { name: true } })
            : null;
          const rollName = resolvedAppliedColorId ? (applied?.name ?? "bilinmeyen renk") : null;
          const planName = freshWo?.targetColor?.name ?? "bilinmeyen renk";
          for (const { id, nr } of bornRollInputs) {
            await recordPlanDeviationTx(tx, {
              mismatches: [
                {
                  field: "color",
                  message: rollName
                    ? `Top ${rollName}, ${TERIM.terbiyeIsEmri.tekilKucuk} ${planName} istiyor`
                    : `Top RENKSİZ, ${TERIM.terbiyeIsEmri.tekilKucuk} ${planName} istiyor`,
                  rollValue: rollName,
                  planValue: planName,
                },
              ],
              rollId: id,
              childRollId: null,
              workOrderId: data.workOrderId,
              workOrderStepId: data.stepId,
              qtyM: nr.qty,
              source: FASON_RECEIPT_DEVIATION_SOURCE,
              confirmedById: userId,
            });
          }
        }

        // Sonraki step varsa açılış RollMovement'leri (per-roll qty/weight in) + status.
        if (nextStep) {
          await tx.rollMovement.createMany({
            data: bornRollInputs.map(({ id, nr }) => ({
              rollId: id,
              workOrderStepId: nextStep.id,
              qtyIn: nr.qty,
              weightIn: nr.weightKg ?? null,
              operatorId: userId ?? null,
              notes: `RECEIPT_OPEN_FABRIC:${receiptNo}`,
            })),
          });
          await recomputeStepStatus(tx, nextStep.id);
        }

        // ── ÇEKME / FAZLA DÖNEN → SAPMA DEFTERİ (2026-08-21) ────────────────
        // Buraya kadar iki sayı kesinleşti: fasonun hesabından DÜŞÜLEN metraj
        // (`plans[].receivedQty` — TAM kabulde kalanın kendisi) ve fiziksel
        // olarak GELEN metraj (doğan parçalar). Boyahanede kumaş çeker; aradaki
        // fark bugüne dek HİÇBİR YERE yazılmıyordu ve fason karnesi bu yüzden
        // her firmaya %0 fire basıyordu (`subcontract-scorecard` dönen metrajı
        // defterden okur, defter TAM kabulde kalanın kendisidir → fark hep 0).
        //
        // ⚠️ Kısmi kabulde de yazılır ve bu DOĞRUDUR: o teslimatta 51 m düşülüp
        // 48 m geldiyse 3 m çekmiştir; fasonda bekleyen kalan hesabın DIŞINDADIR
        // (düşülmedi). "Kalan gelmeyecek" kararının firesi ayrı bir kaynaktır
        // (SUBCONTRACTOR_REMAINDER) — çift sayım yok.
        //
        // ⚠️ Eşik 0.01 m: `fmtMeters` / istemci FARK bantlarıyla AYNI hassasiyet.
        // Yüzer-nokta gürültüsü (0.1+0.2) defteri sıfıra yakın satırlarla doldurmasın.
        const consumedTotal = plans.reduce(
          (s, p) => s.plus(p.receivedQty),
          new Prisma.Decimal(0),
        );
        const bornTotal = data.newRolls.reduce(
          (s, nr) => s.plus(new Prisma.Decimal(nr.qty)),
          new Prisma.Decimal(0),
        );
        const bornDiff = bornTotal.minus(consumedTotal);
        if (bornDiff.abs().greaterThan(new Prisma.Decimal("0.01"))) {
          const shrink = bornDiff.isNegative();
          const shares = allocateShrink(
            plans.map((p) => ({ rollId: p.rollId, receivedQty: p.receivedQty })),
            bornDiff.abs(),
          );
          const explain =
            `Fason kabul ${receiptNo}: ${consumedTotal.toFixed(1)} m düşüldü, ` +
            `${bornTotal.toFixed(1)} m döndü`;
          for (const s of shares) {
            await recordVarianceTx(tx, {
              rollId: s.rollId,
              workOrderStepId: data.stepId,
              // Eksi yön FİRE'dir: mal vardı, metre gitti (kayıt düzeltmesi
              // DEĞİL — sistemdeki sayı yanlış değildi, kumaş gerçekten çekti).
              kind: shrink ? RollVarianceKind.SCRAP : RollVarianceKind.OVERAGE,
              qty: s.qty,
              source: VARIANCE_SOURCES.SUBCONTRACTOR_RETURN,
              // Terslemenin adresi — makbuz iptalinde TAM bu satırlar kalkar.
              sourceRefId: receipt.id,
              // OVERAGE sebep İSTEMEZ (sistem tespiti); SCRAP'te sistem kodu.
              reasonCode: shrink ? SHRINK_REASON_CODE : null,
              reasonText: explain,
              userId,
            });
          }
        }
      }
      // newRolls boş senaryosu artık geçersiz (controller min(1) ile reddediyor).

      // Refakat kartı ARRIVAL
      await logTravelerScan(
        tx,
        data.workOrderId,
        step.stationId,
        step.id,
        ScanType.ARRIVAL,
        userId,
        manifestNoTrimmed
          ? `Fason kabul: ${receiptNo} (İrsaliye: ${manifestNoTrimmed})`
          : `Fason kabul: ${receiptNo}`
      );

      return sequentialTx(tx).subcontractorReceipt.findUnique({
        where: { id: receipt.id },
        include: {
          subcontractor: true,
          step: { include: { station: true } },
          items: { include: { newRoll: true } },
        },
      });
      })
    , undefined, sequenceCakismasi);

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SUBCONTRACTOR_RECEIPT",
      recordId: result!.id,
      newData: {
        receiptNo: result!.receiptNo,
        manifestNo: result!.manifestNo,
        workOrderId: data.workOrderId,
        stepId: data.stepId,
        consumedRollCount: data.returns.filter((r) => r.receivedQty == null).length,
        // Kısmi teslimat izi — hangi toptan kaç metre kabul edildi, kaç top
        // fasonda kalmaya devam etti, doğanlar hangi partiye yazıldı.
        partialReturns: data.returns
          .filter((r) => r.receivedQty != null)
          .map((r) => ({ rollId: r.rollId, receivedQty: r.receivedQty })),
        followUpBatchNumber,
        appliedColorId: resolvedAppliedColorId,
        appliedWidth: measuredWidth ? Number(measuredWidth) : null,
        appliedPropertyIds: resolvedAppliedPropertyIds,
      },
    });

    // ── Kabulde ÖLÇÜLEN en iş emrine de yansır (2026-08-17, madde 12) ────────
    // Eskiden ölçülen en yalnız DOĞAN TOPA yazılıyordu; iş emrinin eni eski
    // değerde kalıyor ve bir sonraki fason çekisi hâlâ o eski eni basıyordu.
    // Kullanıcı kararı: kabul personeli ölçtüğü eni beyan eder, kimseden onay
    // ALMAZ, doğrudan iş emrine yansır.
    //
    // Tx DIŞINDA ve best-effort: kabul tamamlandı, mal içeride. Bu bir
    // GÜNCELLEME; başarısız olursa kabulü geri almak orantısız olurdu (audit
    // yazımıyla aynı gerekçe). Terminal WO'da servis zaten reddeder → o durumda
    // en yalnız topa yazılmış olur, iz de audit'te durur.
    if (measuredWidth && Number(measuredWidth) !== (wo.width == null ? null : Number(wo.width))) {
      try {
        await workOrderLinkService.changeWidth(
          data.workOrderId,
          Number(measuredWidth),
          `Fason kabulünde ölçüldü (${result!.receiptNo})`,
          userId,
          { source: "FASON_RECEIPT" },
        );
      } catch (err) {
        uyari("fason-kabul", `${TERIM.terbiyeIsEmri.cumleBasi.yalin} eni güncellenemedi (WO ${data.workOrderId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ── Plandan farklı renk + "iş emri de bu renge dönsün" (2026-08-21) ─────
    // Tx DIŞINDA, best-effort (en ile aynı gerekçe): kabul tamamlandı, mal
    // içeride. TEK BEKÇİDEN geçer — önceki kabuller başka renkte döndüyse ve
    // boyanacak top kalmadıysa COLOR_DYED_BLOCKED → plan değişmez, `warnings`
    // ile söylenir (kabul yine geçerlidir; yol Tebdil / toplara uygula).
    const postWarnings: string[] = [];
    if (
      data.planColorAction === "APPLY_TO_PLAN" &&
      appliesColor &&
      resolvedAppliedColorId !== targetColorAtReceipt
    ) {
      try {
        const res = await workOrderLinkService.changeTargetColor(
          data.workOrderId,
          resolvedAppliedColorId,
          `Fason kabulünde uygulandı (${result!.receiptNo})`,
          userId,
          { confirmPartial: true },
        );
        postWarnings.push(...res.data.warnings);
      } catch (err) {
        postWarnings.push(
          `${TERIM.terbiyeIsEmri.cumleBasi.ilgi} rengi değiştirilemedi: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // isPartial kararı tx içinde TAZE metraja göre verildi — mesaj sayımı da
    // oradan (result.items) okur; payload'daki receivedQty kalana eşitse top
    // aslında TAM kabul edilmiştir ve "kısmi" yazmamalıdır.
    const resultPartials =
      (result?.items ?? []).filter((i: { isPartial?: boolean }) => i.isPartial).length;
    const partialMsg =
      resultPartials > 0
        ? ` · ${resultPartials} top KISMEN döndü — kalan metraj fasonda beklemede` +
          (followUpBatchNumber ? ` (yeni parti: ${followUpBatchNumber})` : "")
        : followUpBatchNumber
          ? ` · takip teslimatı — yeni parti: ${followUpBatchNumber}`
          : "";
    return {
      success: true,
      data: result,
      message: `Fason kabul tamamlandı: ${result!.receiptNo} (${data.returns.length} dönüş kaydı)${partialMsg}. Yeni Roll'lar Kurşun/KK2'de açılacak.`,
      ...(postWarnings.length > 0 ? { warnings: postWarnings } : {}),
    };
  }
