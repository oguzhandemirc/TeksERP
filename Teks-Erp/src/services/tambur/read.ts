// =============================================================================
// Tambur Service / read
// =============================================================================
// Tambur okuma yolu: bekleyen toplar, karar ekranı topu, kart barkoduyla adım özeti (getByCardBarcode/getStep) ve okutma hatası zenginleştirme.
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (tambur/finalize.ts sayılır) */

import { assertTamburStation } from "../helpers/station-open-step.helper";
import { ACTIVE_ROLL_PROPERTY } from "../helpers/property-revoke.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { normalizeScanCode } from "../../utils/code-format";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  stepCanApplyQuality,
} from "../helpers/quality-station.helper";
import {
  Roll,
  RollStatus,
  StationKind,
} from "@prisma/client";
import {
  assertWoAtStepKind,
} from "../helpers/roll-step.helper";
import { workOrderBoundOnly } from "../helpers/dispatch-header.helper";
import { uyari } from "../../lib/logger";
import { processMeterNumber } from "../helpers/roll-error-meter.helper";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "../helpers/roll-error-scope.helper";
import { readTargetValueChips, type TargetValueChip } from "../helpers/workorder-target-value.helper";
import { TERIM } from "../../constants/terim";
import { gateByCard } from "../workorder-scan-route.service";
import type { TamburRollErrorSummary, TamburServiceThis } from "./shared";

export interface TamburRollSummary {
  rollId: string;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string | null;
  /** Parent'tan miras FabricProperty özet listesi (mobil karar ekranı gösterir). */
  properties: { id: string; name: string }[];
  errorCount: number;
  errors: TamburRollErrorSummary[];
  /** Parti (Batch) kimliği — null = partisiz/doğrudan top. */
  batchId: string | null;
  /** Parti numarası (Batch.batchNumber, P+GGAAYY+NNNN) — partisiz topta null. */
  batchNumber: string | null;
  /** Partinin İPTAL EDİLMEMİŞ en güncel fason sevk numarası
   *  (SubcontractorDispatch.dispatchNo) — hiç sevk görmemiş partide null. */
  dispatchNo: string | null;
  /** WO içindeki 1-based parti sırası (Batch.createdAt'e göre, stabil — bir
   *  parti Tambur'dan çıksa bile numarası kaymaz). */
  branchOrdinal: number | null;
}

export interface TamburStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  /** DİKKAT: legacy alan adı — İŞ EMRİ numarasıdır (WorkOrder.workOrderNumber),
   *  Batch değil. Gerçek parti numarası per-roll `TamburRollSummary.batchNumber`. */
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  /** KQ-D7: istasyonda muayene açık mı — tablet "HATA GİR" çekmecesini buna göre çizer. */
  inspectionEnabled: boolean;
  rolls: TamburRollSummary[];
  /** SY-F1: iş emrinin aktif hedef değerleri ("Kuşak: ZEBRA" çipi); eski tablet alanı yok sayar. */
  targetValues: TargetValueChip[];
}

export async function getPendingRolls(stationId: string | null = null): Promise<ApiResponse<Roll[]>> {
    // İster 2.8: çok tamburlu fabrikada tablet yalnız KENDİ istasyonundaki sıradaki
    // adımı görür; parametresiz çağrı bugünkü listeyle bayt-aynı kalır.
    if (stationId) await assertTamburStation(stationId);
    const rolls = await prisma.roll.findMany({
      where: {
        status: RollStatus.IN_PRODUCTION,
        currentStep: {
          ...(stationId ? { stationId } : {}),
          station: { kind: StationKind.TAMBUR },
        },
      },
      include: {
        item: true,
        color: true,
        errors: {
          where: { ...ACTIONABLE_ROLL_ERROR_WHERE, isProcessed: false },
          orderBy: { startMeter: "asc" },
        },
      },
      // Emniyet tavanı (listOpenCards/kursun-qc paritesi): mobil Tambur panosu bu ucu
      // periyodik yokluyor; take yokken patolojik durumda tüm IN_PRODUCTION@TAMBUR
      // rulolar + nested join çekilirdi. Gerçekte bu kadar eş zamanlı Tambur topu
      // görülmez → emniyet ağı; dolarsa sessiz kalma.
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    if (rolls.length === 500) {
      uyari("tambur", "getPendingRolls: 500 tavanına ulaşıldı — liste kırpılmış olabilir.");
    }

    return { success: true, data: rolls };
  }

export async function getRollForDecision(rollId: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        item: true,
        color: true,
        errors: {
          where: { ...ACTIONABLE_ROLL_ERROR_WHERE, isProcessed: false },
          orderBy: { startMeter: "asc" },
        },
        // En güncel iade kaydı — depo topu iade gelmişse operatör notunu/nedenini
        // burada görür (kesime gitmeden önce). İade hep WAREHOUSE'a döner; not topa bağlı.
        returns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            qty: true,
            reasonText: true,
            note: true,
            createdAt: true,
            reason: { select: { code: true, name: true, color: true } },
            receivedBy: { select: { fullName: true } },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    return { success: true, data: roll };
  }

export async function buildBranchInfoMap(
    workOrderId: string,
    batchIds: (string | null)[],
  ): Promise<
    Map<string, { batchNumber: string; dispatchNo: string | null; ordinal: number }>
  > {
    const map = new Map<
      string,
      { batchNumber: string; dispatchNo: string | null; ordinal: number }
    >();
    const present = new Set(batchIds.filter((x): x is string => Boolean(x)));
    if (present.size === 0) return map;
    const [batches, dispatches] = await Promise.all([
      // Ordinal WO'nun TÜM partileri üzerinden hesaplanır (yalnız listedekiler
      // değil) — bir parti Tambur'dan düşünce kalanların numarası kaymasın.
      prisma.batch.findMany({
        where: { workOrderId },
        orderBy: { createdAt: "asc" },
        select: { id: true, batchNumber: true },
      }),
      prisma.subcontractorDispatch
        .findMany({
          where: { batchId: { in: [...present] }, cancelledAt: null },
          orderBy: { dispatchedAt: "desc" },
          select: { workOrderId: true, batchId: true, dispatchNo: true },
        })
        .then(workOrderBoundOnly), // parti kapsamlı: tip daraltması, SQL aynı
    ]);
    // dispatchedAt DESC → parti başına ilk görülen kayıt en güncel sevki.
    const latestDispatchNo = new Map<string, string>();
    for (const d of dispatches) {
      if (!latestDispatchNo.has(d.batchId)) {
        latestDispatchNo.set(d.batchId, d.dispatchNo);
      }
    }
    batches.forEach((b, i) => {
      if (present.has(b.id)) {
        map.set(b.id, {
          batchNumber: b.batchNumber,
          dispatchNo: latestDispatchNo.get(b.id) ?? null,
          ordinal: i + 1,
        });
      }
    });
    return map;
  }

export async function loadTamburRolls(this: TamburServiceThis, step: {
    id: string;
    workOrderId: string;
  }): Promise<TamburRollSummary[]> {
    // LIFO (enteredAt desc): KK2'den son çıkan açık kumaş Tambur'a ilk gelir.
    // İkincil anahtar id: toplu taşıma (finishStep createMany) aynı timestamp'i
    // yazar — tie-break'siz sıra refetch'ler arasında zıplıyordu (deterministik olsun).
    const openMovements = await prisma.rollMovement.findMany({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: step.id, exitedAt: null },
      orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
      select: {
        roll: {
          include: {
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            properties: {
              where: ACTIVE_ROLL_PROPERTY,
              // value: Tambur FINAL KARAR noktasıdır — kurşunda seçilen GRAMAJ
              // değeri kesim/kalite kararını veren operatörün gözü önünde olmalı
              // (denetim VAL-03: ad basılıyordu, değer basılmıyordu).
              select: {
                property: { select: { id: true, name: true } },
                value: { select: { code: true, name: true } },
              },
            },
            errors: {
              where: { ...ACTIONABLE_ROLL_ERROR_WHERE, isProcessed: false },
              orderBy: { startMeter: "asc" },
              select: {
                id: true, startMeter: true, errorType: true, origin: true, detectedAtStepId: true,
                detectedAtStep: { select: { station: { select: { name: true } } } },
                detectedAt: true, detectedBy: { select: { fullName: true } },
              },
            },
          },
        },
      },
    });
    const branchInfo = await this.buildBranchInfoMap(
      step.workOrderId,
      openMovements.map((m) => m.roll.batchId),
    );
    return openMovements.map((m) => {
      const bi = m.roll.batchId
        ? branchInfo.get(m.roll.batchId)
        : undefined;
      return {
        rollId: m.roll.id,
        barcode: m.roll.barcode,
        itemCode: m.roll.item.code,
        itemName: m.roll.item.name,
        colorCode: m.roll.color?.code ?? null,
        colorName: m.roll.color?.name ?? null,
        currentQty: Number(m.roll.currentQty),
        width: m.roll.width !== null ? Number(m.roll.width) : null,
        qualityGrade: m.roll.qualityGrade,
        properties: m.roll.properties.map((p) => ({
          id: p.property.id,
          name: p.property.name,
          value: p.value ?? null,
        })),
        errorCount: m.roll.errors.length,
        errors: m.roll.errors.map((e) => ({
          id: e.id,
          startMeter: processMeterNumber(e),
          errorType: e.errorType,
          detectedStationName: e.detectedAtStep?.station.name ?? null,
          detectedByName: e.detectedBy?.fullName ?? null,
          detectedAt: e.detectedAt,
          detectedAtStepId: e.detectedAtStepId,
        })),
        batchId: m.roll.batchId ?? null,
        batchNumber: bi?.batchNumber ?? null,
        dispatchNo: bi?.dispatchNo ?? null,
        branchOrdinal: bi?.ordinal ?? null,
      };
    });
  }

export async function enrichTamburScanError(this: TamburServiceThis, 
    err: unknown,
    workOrderId: string,
  ): Promise<unknown> {
    if (!(err instanceof AppError) || err.statusCode !== 400) return err;
    const reason = await this.bypassService
      .explainTamburScanBlock(workOrderId)
      .catch(() => null);
    if (!reason) return err;
    return AppError.badRequest(
      `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} "Tambur" adımında şu an açık top yok. ${reason}`,
    );
  }

export async function assertAtTamburWithReason(this: TamburServiceThis, 
    workOrderId: string,
  ): Promise<{ stepId: string; openRollCount: number }> {
    try {
      return await assertWoAtStepKind(workOrderId, StationKind.TAMBUR);
    } catch (err) {
      throw await this.enrichTamburScanError(err, workOrderId);
    }
  }

export async function getByCardBarcode(this: TamburServiceThis, 
    cardBarcode: string,
    /** K29: oturum istasyonu — yalnız okutmaya göre rota kapısı okur; null = bugünkü çözüm. */
    sessionStationId: string | null = null,
  ): Promise<ApiResponse<TamburStepSummary>> {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: normalizeScanCode(cardBarcode) },
      // Kart iş emri başına — doğrudan workOrderId.
      select: { id: true, status: true, workOrderId: true },
    });
    if (!card) {
      throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    }
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(
        `Bu refakat kartı aktif değil (durum: ${card.status})`
      );
    }

    // Multi-batch destekli doğrulama. Eğer WO'nun rulları şu an Tambur'da
    // değilse net mesaj döner ("şu an Boyahane'de" gibi).
    // K29: okutmaya göre rota — toplar bu istasyonun adımındaysa O adım (yeniden işlemde 2. tambur adımı dahil);
    // taşıma/ekleme gerekiyorsa 400 SCAN_ROUTE_AVAILABLE. SIRALI'da kapı null → bugünkü çözüm.
    const scan = await gateByCard(card.workOrderId, sessionStationId);
    const { stepId } = scan ?? (await this.assertAtTamburWithReason(card.workOrderId));
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        workOrder: { select: { workOrderNumber: true } },
      },
    });
    if (!step) {
      throw AppError.notFound(`Bu ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} Tambur adımı tanımlı değil`);
    }

    // Adıma girmiş ama henüz tamamlanmamış roller (RollMovement.exitedAt = null).
    // Sıra LIFO (enteredAt desc): KK2'den en son çıkan = yeni sepetin en üstü =
    // Tambur operatörünün ilk eline aldığı top. KK2 ilk işlediği parça sepetin
    // en altına düşer, Tambur'a son sırada gider.
    const rolls = await this.loadTamburRolls(step);

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.workOrderNumber,
        stationId: step.stationId,
        stationCode: step.station.code,
        stationName: step.station.name,
        inspectionEnabled: stepCanApplyQuality(step.station),
        rolls,
        targetValues: await readTargetValueChips(prisma, step.workOrderId),
      },
    };
  }

export async function getStep(this: TamburServiceThis, stepId: string): Promise<ApiResponse<TamburStepSummary>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        workOrder: { select: { workOrderNumber: true } },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest("Bu adım Tambur tipinde değil");
    }

    // LIFO sıralama: KK2'nin sepete son koyduğu açık kumaş Tambur'a ilk önce
    // gelir (operatör en üstten alır). `enteredAt DESC` ile son giren listenin
    // başında olur.
    const rolls = await this.loadTamburRolls(step);

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.workOrderNumber,
        stationId: step.stationId,
        stationCode: step.station.code,
        stationName: step.station.name,
        inspectionEnabled: stepCanApplyQuality(step.station),
        rolls,
        targetValues: await readTargetValueChips(prisma, step.workOrderId),
      },
    };
  }
