// =============================================================================
// TeksERP - WorkOrder (Parti) Service / quick-start
// =============================================================================
// Hızlı iş emri (quickStart): replay politikası + taze yol (create + top bağlama + ilk adım sevki).
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================

import {
  ACTIVE_ROLL_PROPERTY,
} from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { customerFromRollOwners } from "../helpers/workorder-customer-goods.helper";
import {
  WorkOrder,
  RollStatus,
} from "@prisma/client";
import { ATTACHABLE_ROLL_STATUSES } from "../workorder-batch-add.service";
import { assertWorkOrderReplayAlive, tokenReplay } from "../helpers/token-replay.helper";
import { normalizeScanCode } from "../../utils/code-format";
import { SubcontractorService } from "../subcontractor.service";
import { hata } from "../../lib/logger";
import { TERIM } from "../../constants/terim";
import type { WorkOrderService } from "../workorder.service";
import { WO_REPLAY_INCLUDE, activeOrderLineIds, inputOrderLineIds, type WorkOrderCreateInput, type WorkOrderReplayRow, type WorkOrderServiceThis } from "./shared";

/**
 * `quickStart` idempotent-replay dalları için partiyi ÇÖZ.
 *
 * Normal akışta parti `attachRolls`'un yanıtından gelir; replay'de attach hiç
 * koşmadığı için WO üzerinden okunur. Timeout sonrası tekrar denemede operatör
 * sonuç ekranını İLK KEZ görür — parti orada boş kalırsa özellik tam da en çok
 * gerektiği anda kaybolur.
 *
 * `mergedIntoId != null` olan parti TARİHÇEDİR (başka partiye katılmış), canlı
 * kimlik değildir → dışlanır. Hızlı İş Emri tek parti üretir; yine de en YENİsi
 * alınır ki elle bölünmüş/eklenmiş WO'da güncel olan dönsün.
 */
async function resolveQuickStartBatch(
  workOrderId: string,
): Promise<{ id: string; batchNumber: string } | null> {
  return prisma.batch.findFirst({
    where: { workOrderId, mergedIntoId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, batchNumber: true },
  });
}

export function quickStartReplay(data: WorkOrderCreateInput, barcodes: string[]) {
    type P = { wo: WorkOrderReplayRow; rollItemIds: string[] };
    return tokenReplay<P, Awaited<ReturnType<WorkOrderService["quickStartFresh"]>>>({
      find: async (db, clientToken) => {
        const wo = await db.workOrder.findUnique({ where: { clientToken }, include: WO_REPLAY_INCLUDE });
        if (!wo) return null;
        const rolls = await db.roll.findMany({ where: { barcode: { in: barcodes } }, select: { itemId: true }, distinct: ["itemId"] });
        return { wo, rollItemIds: rolls.map((r) => r.itemId) };
      },
      alive: (p) => assertWorkOrderReplayAlive(p.wo),
      identity: (p) => [
        { ad: "targetItemId", mevcut: p.wo.targetItemId, gelen: data.targetItemId ?? (p.rollItemIds.length === 1 ? p.rollItemIds[0] : null) },
        { ad: "orderLines", mevcut: activeOrderLineIds(p.wo), gelen: inputOrderLineIds(data) },
      ],
      collision: (p) => `Bu okutma daha önce ${p.wo.workOrderNumber} ${TERIM.terbiyeIsEmri.tekilKucuk} olarak başlatılmış — yeni ${TERIM.terbiyeIsEmri.tekilKucuk} için ekranı kapatıp yeniden açın.`,
      collisionEk: (p) => ({ workOrderNumber: p.wo.workOrderNumber }),
      respond: async (p) => ({
        success: true,
        data: {
          workOrder: p.wo,
          attached: await prisma.roll.count({ where: { barcode: { in: barcodes }, OR: [{ currentStep: { workOrderId: p.wo.id } }, { batch: { workOrderId: p.wo.id } }] } }),
          errors: [],
          dispatch: null,
          batch: await resolveQuickStartBatch(p.wo.id),
        },
        message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} zaten başlatılmış (idempotent retry): ${p.wo.workOrderNumber}`,
      }),
    });
  }

export async function quickStart(this: WorkOrderServiceThis, 
    ...args: Parameters<WorkOrderService["quickStartFresh"]>
  ): ReturnType<WorkOrderService["quickStartFresh"]> {
    const [data] = args;
    const barcodes = [...new Set(data.rollBarcodes.map(normalizeScanCode).filter(Boolean))];
    return this.quickStartReplay(data, barcodes).run(data.clientToken, () => this.quickStartFresh(...args));
  }

export async function quickStartFresh(this: WorkOrderServiceThis, 
    data: WorkOrderCreateInput & { rollBarcodes: string[]; dispatchFirstStep?: boolean; sourceNoteId?: string | null; /** S1 çok parti: belgenin bu partisinin no'su (nottaki ourBatchNo yerine). */ sourceBatchNo?: string | null },
    userId?: string,
  ): Promise<
    ApiResponse<{
      workOrder: WorkOrder;
      attached: number;
      errors: string[];
      dispatch: { id: string; dispatchNo: string } | null;
      /** Topların bağlandığı PARTİ — İş Emri No ile AYRI kavram. Çözülemezse null. */
      batch: { id: string; batchNumber: string } | null;
    }>
  > {
    const { rollBarcodes, dispatchFirstStep, sourceNoteId, sourceBatchNo, ...woInput } = data;
    // Kaynak belge iş emri açılmadan ÖNCE doğrulanır (bilinmeyen not 404; yetim WO bırakmaz). Numara nottan okunur.
    if (sourceNoteId && !(await prisma.customerDeliveryNote.findUnique({ where: { id: sourceNoteId }, select: { id: true } }))) {
      throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
    }
    // Okutulan kod DEPOLANMIŞ biçime çekilir (bkz. normalizeScanCode) — büyütme
    // TEKİLLEŞTİRMEDEN ÖNCE yapılır, yoksa "T1" ve "t1" iki ayrı kod sayılırdı.
    const barcodes = [...new Set(rollBarcodes.map(normalizeScanCode).filter(Boolean))];
    if (barcodes.length === 0) {
      throw AppError.badRequest("En az bir top barkodu okutmalısınız.");
    }

    // ── 1) Ön-doğrulama: var + STOCK + aynı ürün ────────────────────────────
    const rolls = await prisma.roll.findMany({
      where: { barcode: { in: barcodes } },
      select: {
        id: true, barcode: true, status: true, itemId: true, sackId: true, shipmentId: true,
        // Rota kapsaması muafiyeti için (bkz. create → assertRouteCoversTargets):
        // "mal zaten hedef renkte/özellikte mi". Okunmazsa muafiyet hiç doğmaz ve
        // sipariş bağlı + boyahanesiz rota yine 400 verir.
        colorId: true,
        properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true } },
        ownerCustomerId: true,
      },
    });
    const byBarcode = new Map(rolls.map((r) => [r.barcode, r]));

    const missing = barcodes.filter((b) => !byBarcode.has(b));
    if (missing.length > 0) {
      throw AppError.badRequest(`Şu barkodlar bulunamadı: ${missing.join(", ")}`);
    }

    // Envanterdeki serbest+satılabilir toplar (ham STOCK + depo WAREHOUSE/A1_STOCK) bağlanabilir — TEK küme
    // (`ATTACHABLE_ROLL_STATUSES`; belgeden iş emri planı da aynısını okur, D4-D2).
    const notAttachable = rolls.filter((r) => !ATTACHABLE_ROLL_STATUSES.includes(r.status));
    if (notAttachable.length > 0) {
      throw AppError.badRequest(
        "Yalnız envanterdeki (stok/depo) toplar bağlanabilir. Uygun olmayan: " +
          notAttachable.map((r) => `${r.barcode} (${r.status})`).join(", "),
      );
    }
    const committed = rolls.filter((r) => r.sackId != null || r.shipmentId != null);
    if (committed.length > 0) {
      throw AppError.badRequest(
        "Bir çuvalda/sevkiyatta olan top üretime bağlanamaz — önce oradan çıkarın: " +
          committed.map((r) => r.barcode).join(", "),
      );
    }

    const itemIds = [...new Set(rolls.map((r) => r.itemId))];
    if (itemIds.length > 1) {
      throw AppError.badRequest(
        `Okutulan toplar farklı ürünlere ait. Tek ${TERIM.terbiyeIsEmri.tekilKucuk} tek kumaş içindir — aynı üründeki topları okutun.`,
      );
    }
    const rollsItemId = itemIds[0];

    // type: explicit verilmemişse sipariş bağına göre türet.
    const hasOrderLink =
      (woInput.orderLineIds?.length ?? 0) > 0 ||
      (woInput.orderLineAllocations?.length ?? 0) > 0;
    const type =
      (woInput.type as WorkOrder["type"]) ??
      (hasOrderLink ? "ORDER_PRODUCTION" : "STOCK_PRODUCTION");

    // targetItemId: verilmemişse topların ürününden türet; verilmişse tutarlılık şart.
    let targetItemId = woInput.targetItemId ?? null;
    if (!targetItemId) {
      targetItemId = rollsItemId;
    } else if (targetItemId !== rollsItemId) {
      throw AppError.badRequest(
        "Okutulan topların ürünü, seçilen hedef ürün ile aynı değil.",
      );
    }

    // ── 2) WO oluştur ───────────────────────────────────────────────────────
    // Fason (müşteri malı): müşteri gövdeden ya da topların tek sahibinden (gelen belge onayı belge carisini topa yazar).
    const customerId = customerFromRollOwners(type, woInput.customerId, rolls.map((r) => r.ownerCustomerId));
    const createRes = await this.create({ ...woInput, type, targetItemId, customerId }, userId, {
      colorIds: rolls.map((r) => r.colorId),
      propertyIdSets: rolls.map((r) => r.properties.map((p) => p.propertyId)),
    });
    if (!createRes.success || !createRes.data) {
      throw AppError.badRequest(createRes.message ?? `${TERIM.terbiyeIsEmri.cumleBasi.yalin} oluşturulamadı.`);
    }
    const workOrder = createRes.data;

    // İdempotent replay: create() cached WO döndüyse toplar İLK istekte bağlanmış
    // demektir — attach/telafi/dispatch TEKRARLANMAZ. (Devam edilseydi attach 0
    // dönerdi ve zero-attach telafisi GERÇEK WO'yu hardDelete ile arşivlerdi.)
    if (createRes.idempotentReplay) {
      const attached = await prisma.roll.count({
        // Rotasız İE (K29) topu adımsız bağlar → partiden de sayılır.
        where: { barcode: { in: barcodes }, OR: [{ currentStep: { workOrderId: workOrder.id } }, { batch: { workOrderId: workOrder.id } }] },
      });
      return {
        success: true,
        data: {
          workOrder,
          attached,
          errors: [],
          dispatch: null,
          batch: await resolveQuickStartBatch(workOrder.id),
        },
        message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} zaten başlatılmış (idempotent retry): ${workOrder.workOrderNumber}`,
      };
    }

    // ── 3) Topları bağla + 4) telafi (zero-attach → WO'yu arşivle) ──────────
    let attached = 0;
    let errors: string[] = [];
    // Parti, attachRolls'ta doğar (P+GGAAYY+NNNN). Eskiden yanıta konmuyordu ve
    // mobil sonuç ekranı parti yerine İŞ EMRİ numarasını basıyordu — iki kavram
    // ayrı (bkz. kök CLAUDE.md "İş Emri No ≠ Parti"), operatör kartta/lanede
    // parti arayınca bulamıyordu.
    let batch: { id: string; batchNumber: string } | null = null;
    // Telafi (zero-attach → WO'yu arşivle) başarısız OLURSA artık sessizce
    // yutulmuyor: telafi hardDelete patlarsa kullanıcıya "oluşturulmadı" denirken
    // canlı yetim PLANNED WO + ACTIVE refakat kartı kalır — bunu loglayıp iz bırak
    // (audit best-effort sayacı felsefesi; operatör/log yetim WO'yu görebilsin).
    const logOrphanCleanupFailure = (cleanupErr: unknown): void => {
      hata("quickStart", `telafi hardDelete başarısız — yetim WO kaldı (${workOrder.id}), manuel iptal gerekebilir:`,
        cleanupErr,
      );
    };

    try {
      const attachRes = await this.attachRolls(workOrder.id, barcodes, userId, { sourceNoteId, sourceBatchNo });
      attached = attachRes.data?.attached ?? 0;
      errors = attachRes.data?.errors ?? [];
      batch = attachRes.data?.batch ?? null;
    } catch (err) {
      await this.hardDelete(workOrder.id, userId, { releaseToken: true }).catch(logOrphanCleanupFailure);
      throw err;
    }

    if (attached === 0) {
      await this.hardDelete(workOrder.id, userId, { releaseToken: true }).catch(logOrphanCleanupFailure);
      throw AppError.conflict(
        `Hiçbir top bağlanamadı; ${TERIM.terbiyeIsEmri.tekilKucuk} oluşturulmadı. ${errors.join("; ")}`.trim(),
      );
    }

    // ── 5) Opsiyonel: ilk adım fason (EXTERNAL) ise otomatik fason sevki ──────
    // Hızlı iş emrinin amacı "iş emri aç + malı fasona gönder"i tek seferde yapmak.
    // dispatch() ayrı bir tx — patlarsa WO oluşmuş (PLANNED, toplar ilk adımda) kalır,
    // operatör manuel Fason Sevk'le tamamlar (kurtarılabilir kısmi başarı).
    let dispatch: { id: string; dispatchNo: string } | null = null;
    let dispatchWarning: string | null = null;
    if (dispatchFirstStep) {
      const firstStep = await prisma.workOrderStep.findFirst({
        where: { workOrderId: workOrder.id },
        orderBy: { stepSequence: "asc" },
        select: {
          id: true,
          plannedSubcontractorId: true,
          station: { select: { type: true } },
        },
      });
      if (firstStep && firstStep.station.type === "EXTERNAL") {
        if (!firstStep.plannedSubcontractorId) {
          dispatchWarning =
            "Fason firma planlanmadığı için otomatik sevk yapılamadı — Fason Sevk ekranından gönderin.";
        } else {
          const dispatchRollIds = (
            await prisma.roll.findMany({
              where: {
                currentStepId: firstStep.id,
                status: RollStatus.IN_PRODUCTION,
              },
              select: { id: true },
            })
          ).map((r) => r.id);
          if (dispatchRollIds.length === 0) {
            dispatchWarning =
              "İlk adıma bağlı top bulunamadığı için otomatik sevk yapılamadı.";
          } else {
            try {
              // dyehouseNote verilmez → dispatch() WO.dyehouseNote'u default alır.
              const dispRes = await new SubcontractorService().dispatch(
                {
                  workOrderId: workOrder.id,
                  stepId: firstStep.id,
                  subcontractorId: firstStep.plannedSubcontractorId,
                  rollIds: dispatchRollIds,
                },
                userId,
              );
              const d = dispRes.data as
                | { id?: string; dispatchNo?: string }
                | undefined;
              if (d?.id && d?.dispatchNo) {
                dispatch = { id: d.id, dispatchNo: d.dispatchNo };
              }
            } catch (err) {
              dispatchWarning =
                `${TERIM.terbiyeIsEmri.cumleBasi.yalin} oluştu ama otomatik fason sevki yapılamadı: ` +
                (err instanceof Error ? err.message : "bilinmeyen hata") +
                " — Fason Sevk ekranından gönderebilirsiniz.";
            }
          }
        }
      }
    }

    return {
      success: true,
      data: { workOrder, attached, errors, dispatch, batch },
      message:
        `${TERIM.terbiyeIsEmri.cumleBasi.yalin} ${workOrder.workOrderNumber} başlatıldı — ${attached} top bağlandı` +
        (batch ? ` (Parti ${batch.batchNumber})` : "") +
        (errors.length ? `, ${errors.length} top bağlanamadı.` : ".") +
        (dispatch ? ` Fasona sevk edildi: ${dispatch.dispatchNo}.` : "") +
        (dispatchWarning ? ` ${dispatchWarning}` : ""),
      // `create`'in rota kapsaması uyarıları BURADAN GEÇMEK ZORUNDA — yoksa
      // tablet iş emrini açar ve "rotada renk veren adım yok" notu yolda kaybolur
      // (uyarıya çevirmenin tüm anlamı o notun görünmesiydi).
      ...(createRes.warnings?.length ? { warnings: createRes.warnings } : {}),
    };
  }
