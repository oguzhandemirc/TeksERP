// =============================================================================
// TeksERP - WorkOrder (Parti) Service / complete
// =============================================================================
// İş emri kapatma: önizleme, completeWorkOrder (top yazgısı), yeni iş emrine top aktarımı.
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import {
  ACTIVE_ROLL_PROPERTY,
} from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  WorkOrder,
  WorkOrderStatus,
  WorkOrderType,
  RollStatus,
  RollEntrySource,
  StepStatus,
  Prisma,
  ReasonPresetKind,
} from "@prisma/client";
import { resolveReasonCode } from "../reason-preset.service";
import {
  recomputeStepStatus,
} from "../helpers/roll-step.helper";
import { freezeCloseSnapshotTx } from "../helpers/workorder-close-snapshot.helper";
import {
  claimWorkOrderStatusTx,
} from "../helpers/workorder-event.helper";
import {
  voidStalePendingBypassAssignmentsTx,
  repointPendingBypassAssignmentsTx,
} from "../helpers/kursun-bypass-guard.helper";
import { setWorkOrderCardStatusesTx } from "../helpers/traveler-card-fanout.helper";
import {
  createBatchTx,
  deleteIfEmptyAndTracelessTx,
} from "../batch.service";
import { cloneWorkOrderTx, repointRollsTx } from "../helpers/workorder-clone.helper";
import {
  applyRollDispositionsTx,
} from "../helpers/roll-disposition.helper";
import {
  readQualityGradeRequiredEnabled,
} from "../system-setting.service";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { TERIM } from "../../constants/terim";
import { CLOSE_BLOCKED_STATUSES, CLOSE_DISPOSITION_MAX_ROLLS, CLOSE_IN_FLIGHT_STATUSES, type WorkOrderServiceThis } from "./shared";

// =============================================================================
// KAPANIŞ DİSPOZİSYONU (WIP disposition) — manuel kapatmada istasyonda kalan top
// =============================================================================
// Kapatma artık "işlemde top var" diye reddetmez; kapanışı yapan kişi her top için
// KARAR verir ve karar sebebiyle audit'e yazılır (sektör pratiği: SAP TECO sonrası
// WIP dispozisyonu / Oracle-D365 job close). Fiziksel olarak DIŞARIDA olan mal
// (fason) hâlâ hard-block — ofisten verilen karar kumaşı geri getirmez.

/** Kapanışta istasyonda kalan (in-flight) topa uygulanacak dispozisyon kararı. */
export type CloseDisposition =
  // ⚠️ "ham stok" DEMEK DEĞİL: top `STOCK` statüsüne döner, hangi envanter
  // sekmesinde görüneceğini `entrySource` belirler (ham → Ham Stok, dışarıdan
  // alınan yarı mamul → Yarı Mamul). Etiketler bu yüzden "Stoğa geri" der.
  | "STOCK" // stoğa geri — mal geldiği gibi, yeni bir iş emrine sokulabilir
  | "WAREHOUSE" // bitmiş depo — satışa/sevke hazır
  | "A1_STOCK" // 2. kalite satılabilir stok
  | "SCRAP" // gerçek fire (mal vardı, çöpe gitti)
  | "CANCELLED" // hatalı kayıt geri alındı (fire DEĞİL — mal hiç yoktu)
  | "TRANSFER";

/** İstemciden gelen tek dispozisyon satırı. */
export interface CloseDispositionInput {
  rollId: string;
  action: CloseDisposition;
  /** Yalnız WAREHOUSE/A1_STOCK'ta anlamlı; opsiyonel — boş bırakılırsa kalite "—" kalır. */
  qualityGradeId?: string | null;
}

/** Uygulanan dispozisyonun audit izi (tx dışında `SystemLog`'a yazılır). */
interface AppliedDisposition {
  rollId: string;
  barcode: string | null;
  from: RollStatus;
  to: RollStatus;
  action: CloseDisposition;
}

/** Manuel kapatma payload'ı. */
export interface CompleteWorkOrderInput {
  /** Dispozisyon varsa zorunlu (min 3 karakter) — audit'e yazılır. */
  reason?: string;
  /** Sebebin KATALOG KODU — yalnız CANCELLED dispozisyonunda anlamlı (`CancelWorkOrderInput`). */
  reasonCode?: string | null;
  dispositions?: CloseDispositionInput[];
  /** TRANSFER varsa: yeni iş emri siparişe bağlı kalsın mı ("keep") yoksa stok mu. */
  transferOrderMode?: "stock" | "keep";
}

export async function getCompletePreview(id: string) {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: {
          include: { station: { select: { name: true } } },
          orderBy: { stepSequence: "asc" },
        },
      },
    });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);

    const stepIds = wo.steps.map((s) => s.id);
    const stepName = new Map(wo.steps.map((s) => [s.id, s.station?.name ?? "—"]));

    // In-flight = bu WO'nun bir adımında halen işlemde/fasonda olan toplar.
    const inFlightRolls = stepIds.length
      ? await prisma.roll.findMany({
          where: {
            currentStepId: { in: stepIds },
            status: { in: CLOSE_IN_FLIGHT_STATUSES },
          },
          select: {
            id: true,
            barcode: true,
            status: true,
            currentQty: true,
            colorId: true,
            currentStepId: true,
            entrySource: true,
            qualityGrade: true,
            color: { select: { name: true, hex: true } },
            _count: { select: { properties: { where: ACTIVE_ROLL_PROPERTY } } },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

    // Açık (iptal edilmemiş) fason sevkine bağlı toplar — statüsü IN_PRODUCTION olsa
    // bile fason izinde sayılır (getRescuePreview'ın guard'ıyla aynı).
    const openDispatchRollIds = new Set(
      inFlightRolls.length
        ? (
            await prisma.subcontractorDispatchItem.findMany({
              where: {
                rollId: { in: inFlightRolls.map((r) => r.id) },
                dispatch: { cancelledAt: null },
              },
              select: { rollId: true },
            })
          ).map((d) => d.rollId)
        : [],
    );

    const mapRoll = (r: (typeof inFlightRolls)[number]) => ({
      id: r.id,
      barcode: r.barcode,
      status: r.status,
      currentQty: Number(r.currentQty ?? 0),
      colorName: r.color?.name ?? null,
      colorHex: r.color?.hex ?? null,
      propertyCount: r._count.properties,
      // "Ham değil" — cancel-impact'teki processed tanımıyla aynı.
      processed:
        Boolean(r.colorId) ||
        r._count.properties > 0 ||
        r.entrySource === RollEntrySource.SUBCONTRACTOR_RETURN ||
        CLOSE_BLOCKED_STATUSES.includes(r.status),
      qualityGrade: r.qualityGrade,
      stepId: r.currentStepId as string,
      stationName: stepName.get(r.currentStepId as string) ?? "—",
      // Fason dönüşü mal ham stoğa DÖNEMEZ (softDelete'in fason invariant'ı).
      canReturnToStock: r.entrySource !== RollEntrySource.SUBCONTRACTOR_RETURN,
    });

    type PreviewRoll = ReturnType<typeof mapRoll>;
    const dispositionRolls: PreviewRoll[] = [];
    const blockedRolls: (PreviewRoll & { blockReason: string })[] = [];
    for (const r of inFlightRolls) {
      const mapped = mapRoll(r);
      if (r.status !== RollStatus.IN_PRODUCTION) {
        blockedRolls.push({
          ...mapped,
          blockReason: "Fasonda (fiziksel olarak dışarıda) — önce fason kabul/iade yapılmalı",
        });
      } else if (openDispatchRollIds.has(r.id)) {
        blockedRolls.push({
          ...mapped,
          blockReason: "Açık bir fason sevkine bağlı — önce fason kapatılmalı",
        });
      } else {
        dispositionRolls.push(mapped);
      }
    }

    const byStep = new Map<string, { stationName: string; count: number; meters: number }>();
    for (const r of inFlightRolls) {
      const key = r.currentStepId!;
      const e = byStep.get(key) ?? { stationName: stepName.get(key) ?? "—", count: 0, meters: 0 };
      e.count += 1;
      e.meters += Number(r.currentQty ?? 0);
      byStep.set(key, e);
    }
    const inFlightCount = inFlightRolls.length;
    const inFlightMeters = inFlightRolls.reduce((s, r) => s + Number(r.currentQty ?? 0), 0);

    const remainingSteps = wo.steps
      .filter((s) => s.status === StepStatus.PENDING || s.status === StepStatus.ACTIVE)
      .map((s) => ({ stepId: s.id, stationName: s.station?.name ?? "—", stepSequence: s.stepSequence }));

    let blockReason: string | null = null;
    if (wo.status === WorkOrderStatus.COMPLETED) {
      blockReason = `${TERIM.terbiyeIsEmri.cumleBasi.yalin} zaten tamamlanmış.`;
    } else if (wo.status === WorkOrderStatus.SUPERSEDED) {
      blockReason = `Devredilmiş ${TERIM.terbiyeIsEmri.tekilKucuk} kapatılamaz (malzemesi yeni ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} taşındı).`;
    } else if (wo.status === WorkOrderStatus.CANCELLED) {
      blockReason = `İptal edilmiş ${TERIM.terbiyeIsEmri.tekilKucuk} kapatılamaz.`;
    } else if (wo.status === WorkOrderStatus.PLANNED) {
      blockReason =
        `${TERIM.terbiyeIsEmri.cumleBasi.yalin} henüz üretime başlamadı (Planlandı). Başlamamış ${TERIM.terbiyeIsEmri.cekimKucuk.belirtme} kapatmak yerine iptal edin.`;
    } else if (blockedRolls.length > 0) {
      blockReason =
        `${blockedRolls.length} top fasonda / açık fason sevkinde — mal fiziksel olarak ` +
        "dışarıda olduğu için kapatılamaz. Önce fason kabul/iade yapılmalı.";
    } else if (dispositionRolls.length > CLOSE_DISPOSITION_MAX_ROLLS) {
      blockReason =
        `${dispositionRolls.length} top işlemde — kapanış dispozisyonu en fazla ` +
        `${CLOSE_DISPOSITION_MAX_ROLLS} top için yapılabilir. Önce topları istasyonlardan çözün.`;
    }

    return {
      success: true,
      data: {
        workOrderId: id,
        workOrderNumber: wo.workOrderNumber,
        status: wo.status,
        canComplete: blockReason === null,
        blockReason,
        /** true ise kapatma isteği her dispozisyon topu için karar taşımak ZORUNDA. */
        requiresDisposition: dispositionRolls.length > 0,
        /**
         * Devirde yeni WO'nun sipariş bağı default'u için ("keep" mi "stock" mu).
         *
         * Kaynak: `WorkOrder.type` — bağın AYNASI. Eskiden `_count.orderLinks > 0`
         * okunuyordu ve bu, siparişe özel açılmış ama bağı sonradan çözülmüş
         * (ya da henüz kurulmamış) bir WO'yu "stoka üretim" gibi devrederdi;
         * tip ise iş emrinin NİYETİDİR ve devir klonuna taşınması gereken de odur.
         */
        orderLinked: wo.type === WorkOrderType.ORDER_PRODUCTION,
        remainingSteps,
        inFlight: {
          count: inFlightCount,
          totalMeters: inFlightMeters,
          byStep: [...byStep.values()],
        },
        dispositionRolls,
        blockedRolls,
      },
    };
  }

export async function completeWorkOrder(this: WorkOrderServiceThis, 
    id: string,
    data: CompleteWorkOrderInput = {},
    userId?: string,
  ): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: { steps: { select: { id: true, stepSequence: true } } },
    });
    if (!existing) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    if (existing.status === WorkOrderStatus.COMPLETED) {
      throw AppError.badRequest(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} zaten tamamlanmış`);
    }
    if (existing.status === WorkOrderStatus.SUPERSEDED) {
      throw AppError.conflict(`Devredilmiş ${TERIM.terbiyeIsEmri.tekilKucuk} kapatılamaz (malzemesi yeni ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} taşındı)`);
    }
    if (existing.status === WorkOrderStatus.CANCELLED) {
      throw AppError.conflict(`İptal edilmiş ${TERIM.terbiyeIsEmri.tekilKucuk} kapatılamaz`);
    }
    if (existing.status === WorkOrderStatus.PLANNED) {
      throw AppError.badRequest(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} henüz üretime başlamadı — kapatmak yerine iptal edin`);
    }

    const dispositions = data.dispositions ?? [];
    const reason = (data.reason ?? "").trim();
    // Sebep KODU — yalnız CANCELLED dispozisyonunda anlamlı; tx DIŞINDA çözülür.
    const { code: cancelReasonCode } = await resolveReasonCode(ReasonPresetKind.ROLL_CANCEL, {
      reasonCode: data.reasonCode,
      reasonText: reason,
    });
    if (dispositions.length > 0 && reason.length < 3) {
      throw AppError.badRequest(
        "Kapanış dispozisyonu için işlem nedeni (en az 3 karakter) zorunludur",
      );
    }
    if (dispositions.length > CLOSE_DISPOSITION_MAX_ROLLS) {
      throw AppError.badRequest(
        `Tek kapanışta en fazla ${CLOSE_DISPOSITION_MAX_ROLLS} top için dispozisyon verilebilir`,
      );
    }
    const seenRollIds = new Set<string>();
    for (const d of dispositions) {
      if (seenRollIds.has(d.rollId)) {
        throw AppError.badRequest("Aynı top için birden fazla dispozisyon gönderildi");
      }
      seenRollIds.add(d.rollId);
      if (d.qualityGradeId && d.action !== "WAREHOUSE" && d.action !== "A1_STOCK") {
        throw AppError.badRequest(
          "Kalite yalnız depo / 2. kalite dispozisyonunda verilebilir",
        );
      }
    }

    // ── KALİTE ZORUNLU (D6) — YALNIZ SATILABİLİR DİSPOZİSYONLAR ─────────────
    // Kapanışta istasyonda kalan top depoya (`WAREHOUSE`) ya da 2. kaliteye
    // (`A1_STOCK`) çekiliyorsa artık SATILABİLİR bir maldır — kalitesi belirsiz
    // kalamaz. Diğer dört karar KAPSAM DIŞI ve bu bilinçli: `STOCK` (ham stok)
    // ve `TRANSFER` (yeni WO'ya devir) topu üretimde bırakır, `SCRAP`/`CANCELLED`
    // ise topu zaten defterden düşürür — hiçbirinde "kalite" bir karar değildir.
    // Okuma KOŞULLU: eksik kalite yoksa bayrağa hiç bakılmaz.
    const gradelessSellable = dispositions.filter(
      (d) => (d.action === "WAREHOUSE" || d.action === "A1_STOCK") && !d.qualityGradeId,
    );
    if (gradelessSellable.length > 0 && (await readQualityGradeRequiredEnabled())) {
      throw AppError.badRequest(
        `Depoya / 2. kaliteye çekilen ${gradelessSellable.length} top için kalite zorunlu`,
        { code: "GRADE_REQUIRED", rollIds: gradelessSellable.map((d) => d.rollId) },
      );
    }

    const stepIds = existing.steps.map((s) => s.id);
    const stepSeqById = new Map(existing.steps.map((s) => [s.id, s.stepSequence]));
    // Adımsız WO'da in-flight top olamaz — gelen dispozisyon sessizce yutulmasın.
    if (stepIds.length === 0 && dispositions.length > 0) {
      throw AppError.badRequest(`${TERIM.terbiyeIsEmri.cumleBasi.ilgi} adımı yok — dispozisyon verilebilecek top da yok`);
    }

    const { updated, applied, transferredWorkOrderNumber, bypassRepointed } = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // ATOMİK CLAIM ÖNCE: WO satırını IN_PROGRESS→COMPLETED koşullu kilitle.
        // Eşzamanlı son-top finalize (tambur/kursun) ya da iptal WO'yu başka duruma
        // çekmişse count===0 → 409 (çift geçiş önlenir).
        const claimed = await claimWorkOrderStatusTx(tx, id, {
          from: [WorkOrderStatus.IN_PROGRESS],
          to: WorkOrderStatus.COMPLETED,
          ctx: { trigger: "MANUAL_COMPLETE", userId, reason: reason || null },
        });
        if (!claimed) {
          const fresh = await tx.workOrder.findUnique({ where: { id }, select: { status: true } });
          throw AppError.conflict(
            `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada ${
              fresh?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "değişti"
            }, kapatılamaz. Sayfayı yenileyin.`,
          );
        }

        const appliedRows: AppliedDisposition[] = [];
        let transferredWoNumber: string | null = null;
        /** Devirde yeni WO'ya taşınan AÇIK kurşun bypass ataması adedi (audit izi). */
        let transferredBypassRepointed = 0;

        if (stepIds.length > 0) {
          // Guard'lar claim'den SONRA (cancel deseni): tripleyince tüm tx (claim dahil)
          // geri sarılır → WO IN_PROGRESS kalır, mal "kapalı WO'da takılı" limbosuna
          // düşmez.
          const inFlight = await tx.roll.findMany({
            where: {
              currentStepId: { in: stepIds },
              status: { in: CLOSE_IN_FLIGHT_STATUSES },
            },
            select: {
              id: true,
              barcode: true,
              status: true,
              currentQty: true,
              weightKg: true,
              currentStepId: true,
              entrySource: true,
              batchId: true,
            },
          });

          // GUARD 1 — FASON: mal fiziksel olarak dışarıda, karar verilemez.
          const outside = inFlight.filter((r) => CLOSE_BLOCKED_STATUSES.includes(r.status));
          if (outside.length > 0) {
            throw AppError.conflict(
              `${outside.length} top fasonda (fiziksel olarak dışarıda) — ${TERIM.terbiyeIsEmri.tekilKucuk} ` +
                "kapatılamaz. Önce fason kabul/iade yapılmalı.",
            );
          }

          // GUARD 1b — statüsü IN_PRODUCTION olsa da açık fason sevkine bağlı toplar
          // fason izindedir (rescueStuckRoll'un guard'ıyla aynı).
          if (inFlight.length > 0) {
            const openDispatchCount = await tx.subcontractorDispatchItem.count({
              where: {
                rollId: { in: inFlight.map((r) => r.id) },
                dispatch: { cancelledAt: null },
              },
            });
            if (openDispatchCount > 0) {
              throw AppError.conflict(
                `${openDispatchCount} top açık bir fason sevkine bağlı — ${TERIM.terbiyeIsEmri.tekilKucuk} ` +
                  "kapatılamaz. Önce fason kapatılmalı.",
              );
            }
          }

          // GUARD 2 — KAPSAM: tx içinde TAZE okunan in-flight küme ile gönderilen
          // dispozisyonlar birebir örtüşmeli. Eksik/fazla → istemcinin gördüğü liste
          // bayat; sessizce yarım kapatma yapmaktansa reddet.
          const byId = new Map(inFlight.map((r) => [r.id, r]));
          if (
            inFlight.length !== dispositions.length ||
            dispositions.some((d) => !byId.has(d.rollId))
          ) {
            throw AppError.badRequest(
              `İşlemde ${inFlight.length} top var, ${dispositions.length} dispozisyon ` +
                "gönderildi — liste bu sırada değişti. Sayfayı yenileyip tekrar deneyin.",
            );
          }

          // GUARD 3 — fason dönüşü mal ham stoğa DÖNEMEZ (softDelete invariant'ı).
          for (const d of dispositions) {
            const roll = byId.get(d.rollId)!;
            if (d.action === "STOCK" && roll.entrySource === RollEntrySource.SUBCONTRACTOR_RETURN) {
              throw AppError.badRequest(
                `${roll.barcode ?? "Açık kumaş"}: fason dönüşü top ham stoğa çekilemez — ` +
                  "depo / 2. kalite / fire seçin.",
              );
            }
          }

          // Kalite (opsiyonel) — verilen id'ler aktif katalogda olmalı.
          const qualityIds = Array.from(
            new Set(dispositions.map((d) => d.qualityGradeId).filter((q): q is string => !!q)),
          );
          const qualityById = new Map<string, { id: string; code: string }>();
          if (qualityIds.length > 0) {
            const rows = await tx.qualityGrade.findMany({
              where: { id: { in: qualityIds }, isActive: true },
              select: { id: true, code: true },
            });
            if (rows.length !== qualityIds.length) {
              throw AppError.badRequest("Seçilen kalite bulunamadı veya aktif değil");
            }
            for (const q of rows) qualityById.set(q.id, q);
          }

          // 1) DEVİR — üretim yeni (devam) iş emrinde sürsün.
          const transferRolls = dispositions
            .filter((d) => d.action === "TRANSFER")
            .map((d) => byId.get(d.rollId)!);
          if (transferRolls.length > 0) {
            const transferRes = await this.transferRollsToNewWorkOrderTx(tx, {
              sourceWorkOrderId: id,
              rolls: transferRolls,
              stepSeqById,
              orderMode: data.transferOrderMode ?? "stock",
              userId,
            });
            transferredWoNumber = transferRes.workOrderNumber;
            transferredBypassRepointed = transferRes.bypassRepointed;
            for (const r of transferRolls) {
              appliedRows.push({
                rollId: r.id,
                barcode: r.barcode,
                from: r.status,
                to: r.status,
                action: "TRANSFER",
              });
            }
          }

          // 2) STATÜ DİSPOZİSYONLARI — ORTAK MOTOR (`applyRollDispositionsTx`).
          //
          // Eskiden burada per-top bir döngü vardı ve aynı kararı iptal / parti
          // düşürme yolları KENDİ kopyalarıyla uyguluyordu. Üç kopya, aynı kelimeye
          // ("Hatalı kayıt") üç farklı hareket satırı yazma riski demekti.
          //
          // ⚠️ BU TAŞIMA İKİ DAVRANIŞI BİLİNÇLİ OLARAK DEĞİŞTİRİR (`CANCELLED`):
          //   • `qtyOut = 0` (storno) — eskiden `qtyIn` yazılıyordu. "Mal hiç yoktu"
          //     diyen bir karar, istasyon iş hacmine metraj yazamaz; `inventory.
          //     softDelete` bu semantiği zaten böyle tanımlamıştı.
          //   • İptal izi kolonları (`cancelledAt/ById/Reason/preCancelStatus`)
          //     artık DOLDURULUR — eskiden boştu, yani kapatmada iptal edilen topun
          //     satırında "neden" yazmıyordu ve geri alma yanlış rafa dönerdi.
          // Diğer dört aksiyonun çıktısı bayt-bayt aynıdır (`qtyOut = qtyIn`,
          // `WO_CLOSE_<AKSİYON>` öneki, barkod ve kalite yazımı).
          //
          // `stepIds` GEÇİLMEZ: kapatma, topun TÜM açık hareketlerini kapatır
          // (eski `where: { rollId, exitedAt: null }` sözleşmesi). İptal ve parti
          // düşürme kendi adımlarıyla sınırlar.
          const statusDispositions = dispositions.filter((d) => d.action !== "TRANSFER");
          if (statusDispositions.length > 0) {
            appliedRows.push(
              ...(await applyRollDispositionsTx(tx, {
                origin: "WO_CLOSE",
                reason,
                reasonCode: cancelReasonCode,
                userId,
                rolls: statusDispositions.map((d) => byId.get(d.rollId)!),
                dispositions: statusDispositions.map((d) => ({
                  rollId: d.rollId,
                  action: d.action as Exclude<CloseDisposition, "TRANSFER">,
                  qualityGradeId: d.qualityGradeId,
                })),
                qualityById,
                generateBarcodes: true,
              })),
            );
          }
        }

        // Bayat açık movement kalmışsa kapat (defansif — WIP yok ama iz temiz olsun).
        await tx.$executeRaw`
          UPDATE roll_movements m
          -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
          SET "exitedAt" = now(),
              -- qtyIn ÖNCE (istasyon iş-hacmi paritesi — yukarıdaki dispozisyon
              -- kapanışıyla aynı gerekçe): kesilmiş topta currentQty ile kapatmak
              -- üretim raporunda hayalet kayıp yaratır. qtyIn 0/null ise kalan metraj.
              "qtyOut" = COALESCE(m."qtyOut", NULLIF(m."qtyIn", 0), r."currentQty"),
              "weightOut" = COALESCE(m."weightOut", m."weightIn", r."weightKg"),
              notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_MANUAL_COMPLETE'
                           ELSE m.notes || ' | WO_MANUAL_COMPLETE' END
          FROM rolls r
          WHERE m."rollId" = r.id
            AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
            AND m."exitedAt" IS NULL
            AND m."revokedAt" IS NULL
        `;

        // Kalan PENDING/ACTIVE adımları SKIPPED — kapatılan WO adımları kuyruk/WIP
        // istatistiklerinde "içeride" sayılmasın (fason-tamamla / iptal ile aynı).
        await tx.workOrderStep.updateMany({
          where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
          data: { status: StepStatus.SKIPPED, skipReason: "MANUAL_COMPLETE" },
        });

        // Kurşun bypass: kapanış dispozisyonu WO'yu terminal duruma çeker → açık
        // kurşun dağıtımı anlamsız kalır (Tambur'da okutulacak kart artık yok).
        // `force` gerekçesi iptaldeki ile aynı: adımsız/atlanmış hallerde de temizle.
        // İSTASYON GERİ YÜKLENMEZ — kapanmış movement'ların atfı, tablet akışıyla
        // birebir aynı kalsın (dağıtılan kurşun istasyonu hacmi geriye dönük silinmez).
        await voidStalePendingBypassAssignmentsTx(tx, id, "WO_CLOSE", { force: true });

        // ACTIVE refakat kartları COMPLETED (otomatik-tamamlama yollarıyla aynı).
        await setWorkOrderCardStatusesTx(tx, id, "ACTIVE", "COMPLETED");

        // Kapanış künyesi dispozisyonlardan SONRA donar: kapanışta depoya inen top da çıktıdır.
        await freezeCloseSnapshotTx(tx, id, { closeKind: "MANUAL", ctx: { trigger: "MANUAL_COMPLETE", userId, reason: reason || null } });
        const done = await tx.workOrder.findUnique({ where: { id } });
        return {
          updated: done!,
          applied: appliedRows,
          transferredWorkOrderNumber: transferredWoNumber,
          bypassRepointed: transferredBypassRepointed,
        };
      }),
    );

    // Audit tx DIŞINDA (best-effort). WO satırı + her top için ayrı iz: kapanış
    // dispozisyonu sabit sebep kodu (`WO_CLOSE_DISPOSITION`) ile ayrıştırılabilir
    // olmalı — 6 ay sonra "bu top depoda ne arıyor" sorusunun cevabı burada.
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: { workOrderNumber: existing.workOrderNumber, status: existing.status },
      newData: {
        status: WorkOrderStatus.COMPLETED,
        manualComplete: true,
        ...(applied.length > 0 ? { dispositionCount: applied.length, reason } : {}),
        ...(transferredWorkOrderNumber ? { transferredTo: transferredWorkOrderNumber } : {}),
        // Devirde MALLA BİRLİKTE taşınan açık kurşun bypass ataması adedi. 0 ise
        // yazılmaz (gürültü); >0 ise "dağıtım kayboldu mu" sorusunun cevabı burada.
        ...(bypassRepointed > 0 ? { bypassRepointed } : {}),
      },
    });
    for (const a of applied) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: a.rollId,
        oldData: { status: a.from },
        newData: {
          event: "WO_CLOSE_DISPOSITION",
          action: a.action,
          from: a.from,
          to: a.to,
          barcode: a.barcode,
          workOrderNumber: existing.workOrderNumber,
          ...(a.action === "TRANSFER" && transferredWorkOrderNumber
            ? { transferredTo: transferredWorkOrderNumber }
            : {}),
          reason,
        },
      });
    }

    const messageParts = [`${TERIM.terbiyeIsEmri.cumleBasi.yalin} manuel kapatıldı: ${existing.workOrderNumber}`];
    if (applied.length > 0) messageParts.push(`${applied.length} top için dispozisyon uygulandı`);
    if (transferredWorkOrderNumber) {
      messageParts.push(`devredilen toplar yeni ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma}: ${transferredWorkOrderNumber}`);
    }

    return {
      success: true,
      data: updated,
      message: messageParts.join(" — "),
    };
  }

export async function transferRollsToNewWorkOrderTx(
    tx: Prisma.TransactionClient,
    params: {
      sourceWorkOrderId: string;
      rolls: Array<{
        id: string;
        currentStepId: string | null;
        currentQty: Prisma.Decimal | null;
        batchId: string | null;
      }>;
      stepSeqById: Map<string, number>;
      orderMode: "stock" | "keep";
      userId?: string;
    },
  ): Promise<{ workOrderNumber: string; bypassRepointed: number }> {
    const { sourceWorkOrderId, rolls, stepSeqById, orderMode, userId } = params;
    const rollIds = rolls.map((r) => r.id);

    const sequences = rolls.map((r) => stepSeqById.get(r.currentStepId as string));
    if (sequences.some((s) => s === undefined)) {
      throw AppError.conflict(`Devredilecek top bu ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} bir adımında değil — listeyi yenileyin`);
    }
    const reEntryStepSequence = Math.min(...(sequences as number[]));
    const movedTotalQty = rolls.reduce((s, r) => s + Number(r.currentQty ?? 0), 0);

    const src = await tx.workOrder.findUnique({
      where: { id: sourceWorkOrderId },
      select: { targetColorId: true },
    });

    const { newWo, oldToNew, newReEntryStepId } = await cloneWorkOrderTx(tx, {
      sourceWorkOrderId,
      reEntryStepSequence,
      targetColorId: src?.targetColorId ?? null,
      orderMode,
      movedTotalQty,
      userId,
    });

    // Her top KENDİ adımının klonuna taşınır (hepsi aynı adımda olmak zorunda değil).
    for (const roll of rolls) {
      const newStepId = oldToNew.get(roll.currentStepId as string);
      if (!newStepId) {
        throw AppError.conflict(`Yeni ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} hedef adım bulunamadı (rota kopyası tutarsız)`);
      }
      const claim = await tx.roll.updateMany({
        where: {
          id: roll.id,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: roll.currentStepId,
          shipmentId: null,
          sackId: null,
        },
        data: { currentStepId: newStepId },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Devredilecek top bu sırada değişti — yenileyip tekrar deneyin");
      }
    }

    // Ayak izi (movement/operation/error) yeni WO'nun adımlarına repoint — aksi hâlde
    // kaynak WO'nun adımları "hâlâ bekleyen top var" sanır.
    await repointRollsTx(tx, rollIds, oldToNew, { note: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} devri → ${newWo.workOrderNumber}`, userId: userId ?? null });

    // Kurşun bypass ataması da MALLA BİRLİKTE taşınır: mal fiziksel olarak hâlâ
    // aynı kurşun makinesinde, yalnız iş emri değişti. `stepMap` TAŞINAN topların
    // adımlarıyla SÜZÜLÜR — `oldToNew`'in tamamı verilseydi, topu devredilmemiş
    // bir adımın ataması da yeni WO'ya kaçardı (kaynakta o iş sürüyor olabilir).
    // ⚠️ Bu çağrı, kapanış akışının sonundaki force-void'den ÖNCE koşmak ZORUNDA:
    // taşınan satır artık hedef WO id'si taşır, force-void (kaynak WO id'siyle)
    // onu görmez; ters sırada atama önce iptal edilir ve taşınacak satır kalmaz.
    const movedStepIds = new Set(
      rolls.map((r) => r.currentStepId).filter((x): x is string => !!x),
    );
    const transferStepMap = new Map(
      [...oldToNew].filter(([oldStepId]) => movedStepIds.has(oldStepId)),
    );
    const bypassRepointed = await repointPendingBypassAssignmentsTx(tx, {
      sourceWorkOrderId,
      targetWorkOrderId: newWo.id,
      stepMap: transferStepMap,
    });

    // Kısmi seçim olduğu için parti TAŞINMAZ: yeni WO'da yeni parti doğar, kaynak
    // parti izsiz boşaldıysa silinir (manual-move'un kısmi taşıma yolu ile aynı).
    const sourceBatchIds = Array.from(
      new Set(rolls.map((r) => r.batchId).filter((b): b is string => !!b)),
    );
    await createBatchTx(tx, {
      workOrderId: newWo.id,
      rollIds,
      splitFromId: sourceBatchIds.length === 1 ? sourceBatchIds[0] : null,
      userId,
    });
    for (const batchId of sourceBatchIds) {
      await deleteIfEmptyAndTracelessTx(tx, batchId);
    }

    await recomputeStepStatus(tx, newReEntryStepId);

    return { workOrderNumber: newWo.workOrderNumber, bypassRepointed };
  }
