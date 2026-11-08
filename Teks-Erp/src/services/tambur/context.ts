// =============================================================================
// Tambur Service / context
// =============================================================================
// Tambur bağlamı (getTamburContext): okutulan barkodun tambur/kurşun dağıtım durumu.
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================

import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { normalizeScanCode } from "../../utils/code-format";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  RollStatus,
  RollOperationType,
  StationKind,
} from "@prisma/client";
import {
  assertWoAtStepKind,
} from "../helpers/roll-step.helper";
// ⚠️ TEK YÖNLÜ BAĞIMLILIK: tambur.service → kursun-bypass.service.
// `kursun-bypass.service` bu dosyayı (ya da onu import eden bir modülü) ASLA
// import etmez — ortak guard'lar `helpers/kursun-bypass-guard.helper.ts`'te
// yaşar. Bu kural bozulursa statik import döngüsü doğar (lazy import gerekir).
import {
  type KursunBypassTamburContext,
} from "../kursun-bypass.service";
import { processMeterNumber } from "../helpers/roll-error-meter.helper";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "../helpers/roll-error-scope.helper";
import type { TamburRollErrorSummary, TamburServiceThis } from "./shared";

export async function getTamburContext(this: TamburServiceThis, 
    cardBarcode: string,
    /**
     * `allowEmptyStep`: Tambur adımında açık top olmasa da kartı AÇ (boş bağlam).
     * Yalnız saha düzeltmesi yetkisi olan operatör için controller true geçer —
     * "Topu Buraya Al / Manuel Top Ekle" gerektiği anda ulaşılabilir olsun diye.
     * Yetkisiz operatörde false → davranış eskisi gibi (hata).
     */
    opts?: { allowEmptyStep?: boolean },
  ): Promise<
    ApiResponse<{
      workOrderId: string;
      batchNumber: string | null;
      stepId: string;
      stationName: string;
      /// Tambur planlama bilgisi — operatöre ekranda gösterilir, override edilebilir.
      plannedFoldType: string | null;
      /// Tambur adımına yazılan not (WorkOrderStep.notes) — operatöre gösterilir.
      stepNote: string | null;
      orders: Array<{
        orderId: string;
        orderNumber: string;
        customerId: string;
        customerName: string;
        lines: Array<{
          lineId: string;
          itemId: string;
          itemCode: string;
          itemName: string;
          colorCode: string | null;
          colorName: string | null;
          orderedQty: number;
          /// Sipariş satırı kesim notu + eşit-parça önerisi (Tambur talimatı).
          cutNote: string | null;
          pieceLengthM: number | null;
        }>;
      }>;
      openFabricRolls: Array<{
        rollId: string;
        /** Barkodlu top adıma alınmışsa dolu (2026-07-27); açık kumaşta null. */
        barcode: string | null;
        currentQty: number;
        initialQty: number;
        receiptNo: string | null;
        colorCode: string | null;
        colorName: string | null;
        kursunFinishedAt: string | null;
        errors: TamburRollErrorSummary[];
      }>;
      /**
       * Bu iş emrinde bekleyen KURŞUN DAĞITIM (bypass) işi. Non-null ise Tambur
       * ekranı "Kurşun adımını tamamla" önizlemesi + onayı gösterir ve
       * `POST /api/tambur/bypass-complete` ile kapatır. null = normal akış.
       *
       * Payload `kursun-bypass.service.findPendingForTambur`'un dönüşüdür ve
       * OLDUĞU GİBİ iletilir (burada yeniden şekillendirme YOK — alan eklemek
       * gerekirse tek kaynak orasıdır). Operatöre gösterilecek yer bilgisi
       * `machineName`'dir (atanan fiziksel kurşun makinesi); `stationName` tek
       * PROCESS_QC istasyonunun adıdır ve bağlam olarak taşınır — ekranda
       * "hangi makinede yapıldı" sorusunu YANITLAMAZ.
       */
      bypassPending?: KursunBypassTamburContext | null;
      /**
       * Adımda AÇIK TOP YOK ama kart yetkili operatör için yine de açıldı.
       * Ekran bunu görünce "bekleyen top yok" bandı basıp yalnız saha
       * düzeltmesini sunar (kesim/finalize aksiyonları anlamsızdır).
       */
      emptyStep?: boolean;
    }>
  > {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: normalizeScanCode(cardBarcode) },
      // Kart iş emri başına — doğrudan workOrderId.
      select: { id: true, status: true, workOrderId: true },
    });
    if (!card) throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(`Bu refakat kartı aktif değil (durum: ${card.status})`);
    }

    // ── KURŞUN BYPASS ────────────────────────────────────────────────────────
    // Kurşun Dağıtım'a verilmiş bir iş emrinde toplar HENÜZ kurşun adımında açık
    // durur (Tambur adımında hiç movement yoktur) → `assertWoAtStepKind` "bu
    // adımda açık top yok" diye 400 atardı ve operatör kartı okutamazdı. Bekleyen
    // dağıtım varsa Tambur adımını doğrudan çözer, önizleme+onay verisini
    // `bypassPending` ile ekrana iletiriz.
    //
    // Dağıtım BAŞARILI assert'te de iliştirilir: çok partili senaryoda 1. parti
    // Tambur'da işlenirken 2. parti kurşunda bekliyor olabilir (ekran hem açık
    // kumaşları hem bekleyen kurşun işini aynı anda göstermeli).
    const pendingBypass = await this.bypassService.findPendingForTambur(card.workOrderId);
    // `rollCount === 0` = "stale" atama (adımda açık top kalmamış). Onaylanacak iş
    // olmadığı için ekranda ölü bir onay butonu doğurur — Dağıtım ekranındaki
    // stale rozetiyle planlamacı iptal eder, Tambur burada YOK sayar.
    const bypassPending = pendingBypass && pendingBypass.rollCount > 0 ? pendingBypass : null;

    let stepId: string;
    let emptyStep = false;
    try {
      // ⚠️ Burada ZENGİNLEŞTİRİLMEMİŞ assert kullanılır: `bypassPending` dolu
      // olduğunda bu hata zaten YUTULUYOR ve sebep sorgusu (rota + üç iz
      // sorgusu) boşa koşardı — üstelik bypass rejiminin EN SIK yolunda.
      // Zenginleştirme yalnız gerçekten fırlatılacak dalda yapılır (aşağıda).
      ({ stepId } = await assertWoAtStepKind(card.workOrderId, StationKind.TAMBUR));
    } catch (err) {
      // Bekleyen dağıtım YOKSA **ve** saha düzeltmesi yetkisi YOKSA davranış birebir
      // eskisi gibi — hata aynen çıkar. Altyapı hatası (DB/bağlantı) hiçbir durumda
      // MASKELENMEZ: yalnız assert'in kendi iş kuralı hataları (AppError) bu yollara düşer.
      //
      // ⚠️ `allowEmptyStep` (2026-08-03): Tambur adımında AÇIK TOP YOKKEN kart hiç
      // açılamıyordu ve "Topu Buraya Al / Manuel Top Ekle" saha aksiyonları TAM DA
      // gerektikleri anda ulaşılamaz kalıyordu (aksiyonlar `activeJob`'a bağlı, o da
      // karta). Yetkili operatör (`mobile:tambur-duzelt` / `roll:manual-adjust`) için
      // kartı BOŞ olarak açıyoruz: `emptyStep: true` ile ekran "bu adımda bekleyen top
      // yok" bandını gösterip yalnız saha düzeltmesini sunar. Yetkisiz operatörde
      // davranış DEĞİŞMEZ — boş kart kafa karıştırır, hata doğru cevaptır.
      if (!(err instanceof AppError)) throw err;
      if (!bypassPending && !opts?.allowEmptyStep) {
        throw await this.enrichTamburScanError(err, card.workOrderId);
      }
      if (!bypassPending) emptyStep = true;
      // Rotanın ilk Tambur adımı (assertWoAtStepKind ile aynı seçim kuralı).
      const tamburStep = await prisma.workOrderStep.findFirst({
        where: {
          workOrderId: card.workOrderId,
          station: { kind: StationKind.TAMBUR },
        },
        select: { id: true },
        orderBy: { stepSequence: "asc" },
      });
      // Rotada Tambur adımı hiç yoksa (assert'in 404'ü) bypass da kurtaramaz:
      // kapanış Kurşun Dağıtım ekranındaki "İşi Bitir" ile yapılır.
      if (!tamburStep) throw err;
      stepId = tamburStep.id;
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: { select: { name: true } },
        workOrder: {
          select: {
            id: true,
            workOrderNumber: true,
            foldType: true,
          },
        },
      },
    });
    if (!step) throw AppError.notFound("Tambur adımı bulunamadı");

    // WO'ya bağlı OrderLine'lar
    const links = await prisma.workOrderToOrderLine.findMany({
      where: { workOrderId: card.workOrderId, ...ACTIVE_ORDER_LINK },
      select: {
        orderLine: {
          select: {
            id: true,
            itemId: true,
            quantity: true,
            width: true,
            cutNote: true,
            pieceLengthM: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            requiredProperties: {
              select: {
                property: { select: { id: true, name: true } },
              },
            },
            order: {
              select: {
                id: true,
                orderNumber: true,
                customer: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    // Order başına grupla
    const ordersMap = new Map<
      string,
      {
        orderId: string;
        orderNumber: string;
        customerId: string;
        customerName: string;
        lines: Array<{
          lineId: string;
          itemId: string;
          itemCode: string;
          itemName: string;
          colorCode: string | null;
          colorName: string | null;
          width: number | null;
          orderedQty: number;
          cutNote: string | null;
          pieceLengthM: number | null;
          requiredProperties: { id: string; name: string }[];
        }>;
      }
    >();
    for (const link of links) {
      const ol = link.orderLine;
      const order = ol.order;
      // F133: daima-0 shippedQty alanı kaldırıldı — loose modelde top→sipariş satırı
      // bağı yok, per-line karşılanma türetilemez (spec-toplam üzerinden işler).
      if (!ordersMap.has(order.id)) {
        ordersMap.set(order.id, {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customer.id,
          customerName: order.customer.name,
          lines: [],
        });
      }
      ordersMap.get(order.id)!.lines.push({
        lineId: ol.id,
        itemId: ol.itemId,
        itemCode: ol.item.code,
        itemName: ol.item.name,
        colorCode: ol.color?.code ?? null,
        colorName: ol.color?.name ?? null,
        width: ol.width !== null ? Number(ol.width) : null,
        orderedQty: Number(ol.quantity),
        cutNote: ol.cutNote ?? null,
        pieceLengthM: ol.pieceLengthM !== null ? Number(ol.pieceLengthM) : null,
        requiredProperties: ol.requiredProperties.map((rp) => ({
          id: rp.property.id,
          name: rp.property.name,
        })),
      });
    }
    const orders = Array.from(ordersMap.values());

    // Adımdaki kesilebilir Roll'lar (LIFO — Tambur movement enteredAt DESC).
    // `barcode: null` filtresi KALDIRILDI (2026-07-27): "Tambur adımındaki HER top
    // kesilebilir" (2026-07-16, bkz. cutOpenFabric) — Konumu-Düzelt ile gelen
    // barkodlu TOP bu listede görünmüyordu; adım listesi (loadTamburRolls) ile
    // sayılar çelişiyordu. Barkod payload'a eklendi (UI etiketleyebilsin).
    const openMovements = await prisma.rollMovement.findMany({
      where: {
        ...ACTIVE_MOVEMENT,
        workOrderStepId: stepId,
        exitedAt: null,
        roll: {
          status: RollStatus.IN_PRODUCTION,
        },
      },
      // LIFO: en son giren en üstte; id tie-break — toplu taşımada eşit enteredAt
      // sırayı refetch'ler arasında zıplatmasın (loadTamburRolls paritesi).
      orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
      select: {
        enteredAt: true,
        roll: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            initialQty: true,
            color: { select: { code: true, name: true } },
            parentReceipt: { select: { receiptNo: true } },
            errors: {
              // F131: kardeş sorgularla (getPendingRolls/getRollForDecision/loadTamburRolls)
              // aynı işlenmemiş-hata filtresi — NO_CUT ile idari kapatılmış (isProcessed=true)
              // hata, fason turundan sonra dönen açık kumaşta 'açık hata' olarak listelenmesin.
              where: { ...ACTIONABLE_ROLL_ERROR_WHERE, isProcessed: false },
              orderBy: { startMeter: "asc" },
              select: {
                id: true,
                startMeter: true,
                errorType: true,
              },
            },
            operations: {
              where: { ...ACTIVE_OPERATION, operationType: RollOperationType.QC2_COMPLETED },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });

    const openFabricRolls = openMovements.map((m) => ({
      rollId: m.roll.id,
      barcode: m.roll.barcode,
      currentQty: Number(m.roll.currentQty),
      initialQty: Number(m.roll.initialQty),
      receiptNo: m.roll.parentReceipt?.receiptNo ?? null,
      colorCode: m.roll.color?.code ?? null,
      colorName: m.roll.color?.name ?? null,
      kursunFinishedAt: m.roll.operations[0]?.createdAt.toISOString() ?? null,
      errors: m.roll.errors.map((e) => ({
        id: e.id,
        startMeter: processMeterNumber(e),
        errorType: e.errorType,
      })),
    }));

    return {
      success: true,
      data: {
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.workOrderNumber,
        stepId: step.id,
        stationName: step.station.name,
        plannedFoldType: step.workOrder.foldType,
        stepNote: step.notes,
        orders,
        openFabricRolls,
        bypassPending,
        emptyStep,
      },
    };
  }
