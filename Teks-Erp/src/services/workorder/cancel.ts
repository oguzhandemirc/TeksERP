// =============================================================================
// TeksERP - WorkOrder (Parti) Service / cancel
// =============================================================================
// İş emri iptali: softDelete, cancelWorkOrderTx, ham topların iptalde iadesi.
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import { postStockMove, qtyYazilabilir } from "../helpers/warehouse-ledger.helper";
import { cancelReturnNote, findOpenProductionIssueTx } from "../helpers/production-issue-ledger.helper";
import { reverseStockMove } from "../helpers/warehouse-ledger-reverse.helper";
import { warehouseStampWhereTx } from "../helpers/warehouse.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  WarehouseEventType,
  WorkOrder,
  WorkOrderStatus,
  RollStatus,
  RollEntrySource,
  StepStatus,
  Prisma,
  ReasonPresetKind,
} from "@prisma/client";
import { resolveReasonCode } from "../reason-preset.service";
import {
  claimWorkOrderStatusTx,
} from "../helpers/workorder-event.helper";
import { isWorkOrderUntouched } from "../helpers/workorder-locks.helper";
import {
  voidStalePendingBypassAssignmentsTx,
} from "../helpers/kursun-bypass-guard.helper";
import { setWorkOrderCardStatusesTx } from "../helpers/traveler-card-fanout.helper";
import {
  applyRollDispositionsTx,
  DISPOSITION_MAX_ROLLS,
  type AppliedRollDisposition,
} from "../helpers/roll-disposition.helper";
import { TERIM } from "../../constants/terim";
import type { CancelDisposition, CancelWorkOrderInput, WorkOrderServiceThis } from "./shared";

/** İptal payload'ı — hiçbiri verilmezse davranış 2026-08-06 öncesiyle birebir aynı. */
/** `cancelWorkOrderTx` bağlamı — çağıranın tx dışında çözdüğü her şey (fason planı, sebep kodu, kararlı toplar). */
export interface CancelWorkOrderTxInput {
  id: string;
  workOrderNumber: string;
  stepIds: string[];
  trigger?: string;
  /** Olayın kaynağı (gelen belge iptali `CUSTOMER_DELIVERY_NOTE` + belge kimliği); yanıt ve zaman çizelgesi buradan okur. */
  refType?: string;
  refId?: string;
  reason: string;
  cancelReasonCode: string | null;
  userId?: string;
  fasonPlan: { scrapRollIds: string[]; residualRollIds: string[]; remainderClosed: boolean };
  decidedWithFason: Array<{ rollId: string; action: CancelDisposition }>;
}

/**
 * Hiç işlem görmemiş iş emri: statü PLANNED ve hiçbir adım başlamamış / açık sevk yok. Tabletten
 * iptal yalnız bu durumda ("yanlış açıldı"); gerisi panelden dispozisyonla.
 */
async function assertWorkOrderUntouched(id: string, status: WorkOrderStatus): Promise<void> {
  if (!(await isWorkOrderUntouched(prisma, id, status))) {
    throw AppError.conflict(
      `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} üretim başladı — tabletten iptal edilemez. Panelden iptal edin (toplar için karar ve sebep sorulur).`,
      { code: "WO_CANCEL_PANEL_ONLY" },
    );
  }
}

export async function returnRawRollsOnCancelTx(
    tx: Prisma.TransactionClient,
    args: { hamTopWhere: Prisma.RollWhereInput; stepIds: string[]; workOrderNumber: string; userId?: string },
  ): Promise<void> {
    const { hamTopWhere, stepIds, workOrderNumber, userId } = args;
    const rawRolls = await tx.roll.findMany({ where: hamTopWhere, select: { id: true, currentQty: true }, orderBy: { id: "asc" } });
    type CancelReturn = { rollId: string; status: RollStatus; warehouseId: string | null; currentQty: Prisma.Decimal; issue: NonNullable<Awaited<ReturnType<typeof findOpenProductionIssueTx>>> };
    const returns: CancelReturn[] = [];
    for (const r of rawRolls) {
      const issue = await findOpenProductionIssueTx(tx, r.id, stepIds);
      if (issue?.fromStatus) returns.push({ rollId: r.id, status: issue.fromStatus, warehouseId: issue.fromWarehouseId, currentQty: r.currentQty, issue });
    }
    const groups = new Map<string, { status: RollStatus; warehouseId: string | null; ids: string[] }>();
    for (const d of returns) {
      const key = `${d.status}|${d.warehouseId ?? ""}`;
      const g = groups.get(key) ?? { status: d.status, warehouseId: d.warehouseId, ids: [] };
      g.ids.push(d.rollId);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const claim = await tx.roll.updateMany({
        where: { AND: [hamTopWhere, { id: { in: g.ids } }] },
        data: { status: g.status, currentStepId: null, ...(g.warehouseId ? { warehouseId: g.warehouseId } : {}) },
      });
      if (claim.count !== g.ids.length) throw AppError.conflict("Toplardan biri bu sırada değişti — tekrar deneyin.");
    }
    const note = cancelReturnNote(workOrderNumber);
    for (const d of returns) {
      await reverseStockMove(tx, d.issue.id, { reasonCode: STOCK_MOVE_REASON.ROLL_DETACH, userId: userId ?? null, notes: note });
      // Üretimde metraj değiştiyse fark AYRI olgudur: ters net 0 kapanır, fark kendi satırıyla.
      const diff = new Prisma.Decimal(d.currentQty).minus(d.issue.qty);
      if (d.warehouseId !== null && qtyYazilabilir(diff.abs())) {
        const end = { warehouseId: d.warehouseId, status: d.status };
        await postStockMove(tx, {
          rollId: d.rollId,
          eventType: WarehouseEventType.ADJUST,
          qty: diff.abs(),
          ...(diff.isNegative() ? { from: end } : { to: end }),
          reasonCode: STOCK_MOVE_REASON.PRODUCTION_VARIANCE,
          workOrderStepId: d.issue.workOrderStepId,
          userId: userId ?? null,
          notes: note,
        });
      }
    }
    // ⚠️ DAMGA STATÜ FLIP'İNDEN ÖNCE: deposuz top stok kümesine "hangi depoda belli
    // değil" hâlinde düşerdi; flip'ten sonra aynı yüklem eşleşmez. Mevcut depoyu EZMEZ.
    const unmatchedIds = rawRolls.map((r) => r.id).filter((id) => !returns.some((d) => d.rollId === id));
    if (unmatchedIds.length > 0) {
      const unmatchedWhere = { AND: [hamTopWhere, { id: { in: unmatchedIds } }] } satisfies Prisma.RollWhereInput;
      await warehouseStampWhereTx(tx, unmatchedWhere);
      const claim = await tx.roll.updateMany({ where: unmatchedWhere, data: { status: RollStatus.STOCK, currentStepId: null } });
      if (claim.count !== unmatchedIds.length) throw AppError.conflict("Toplardan biri bu sırada değişti — tekrar deneyin.");
    }
  }

export async function softDelete(this: WorkOrderServiceThis, 
    id: string,
    userId?: string,
    input: CancelWorkOrderInput = {},
  ): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: true,
        orderLinks: { where: ACTIVE_ORDER_LINK, orderBy: { createdAt: "asc" }, include: { orderLine: true } },
      },
    });

    if (!existing) {
      throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    }

    if (existing.status === WorkOrderStatus.CANCELLED) {
      throw AppError.badRequest(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} zaten iptal edilmiş`);
    }
    if (existing.status === WorkOrderStatus.SUPERSEDED) {
      throw AppError.badRequest(`Devredilmiş ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edilemez (malzemesi yeni ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} taşındı)`);
    }
    if (existing.status === WorkOrderStatus.COMPLETED) {
      throw AppError.conflict(`Tamamlanmış ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edilemez`);
    }
    if (input.untouchedOnly) await assertWorkOrderUntouched(existing.id, existing.status);

    const stepIds = existing.steps.map((step) => step.id);

    // ⚠️ STOCK MOTORA VERİLMEZ. İptalde `STOCK` VARSAYILANDIR ve aşağıdaki toplu
    // yolda (blanket updateMany + hareket süpürmesi) uygulanır. İstemci listede
    // açıkça göndermiş olsa bile motora geçirilmez — aksi halde AYNI kullanıcı
    // kararı, istemcinin satırı gönderip göndermemesine göre `roll_movements`'ta
    // iki farklı not/metraj üretirdi (sessiz, kalıcı, raporlanamaz).
    const decided = (input.dispositions ?? []).filter((d) => d.action !== "STOCK");
    const reason = (input.reason ?? "").trim();
    // Sebep KODU (CANCELLED topların `cancelReasonCode`'u) — tx DIŞINDA çözülür; açık
    // kod doğrulanır, yoksa metinden türetilir (serbest metin → NULL).
    const { code: cancelReasonCode } = await resolveReasonCode(ReasonPresetKind.ROLL_CANCEL, {
      reasonCode: input.reasonCode,
      reasonText: reason,
    });

    if (decided.length > 0) {
      if (reason.length < 3) {
        throw AppError.badRequest("İptal nedeni (en az 3 karakter) zorunludur");
      }
      if (decided.length > DISPOSITION_MAX_ROLLS) {
        throw AppError.badRequest(
          `Tek iptalde en fazla ${DISPOSITION_MAX_ROLLS} top için karar verilebilir`,
        );
      }
      const seen = new Set<string>();
      for (const d of decided) {
        if (seen.has(d.rollId)) {
          throw AppError.badRequest("Aynı top için birden fazla karar gönderildi");
        }
        seen.add(d.rollId);
      }
      if (stepIds.length === 0) {
        throw AppError.badRequest(`${TERIM.terbiyeIsEmri.cumleBasi.ilgi} adımı yok — karar verilebilecek top da yok`);
      }
    }

    // ── FASON KARARI — iptal tx'inden ÖNCE (2026-08-17) ────────────────────
    // Sıra bilinçli: açık fason sevkleri MEVCUT ve test edilmiş `cancelBulk`
    // servisiyle iptal edilir (kendi tx'i, kendi hareket/iz kayıtları). Aynı işi
    // burada yeniden yazsaydık iki fason muhasebesi doğardı ve zamanla ayrışırdı.
    //
    // Sevk iptali topları geri getirdiği için, buradan sonra normal iptal yolu
    // (aşağıdaki tx) onları sıradan "işlemdeki top" gibi görür — FİRE kararı da
    // oradaki dispozisyon motoruna devredilir.
    const fasonPlan = await this.prepareFasonCancelDecision(id, stepIds, input, userId, reason);
    // FİRE seçilen fason topları normal dispozisyon listesine katılır — karar
    // motoru TEK yerde kalsın (hareket notu, sapma defteri, audit hepsi orada).
    const decidedWithFason = [
      ...decided,
      ...fasonPlan.scrapRollIds
        .filter((rid) => !decided.some((d) => d.rollId === rid))
        .map((rid) => ({ rollId: rid, action: "SCRAP" as CancelDisposition })),
    ];
    const { updated, applied } = await prisma.$transaction((tx) =>
      this.cancelWorkOrderTx(tx, { id, workOrderNumber: existing.workOrderNumber, stepIds, trigger: input.trigger, reason, cancelReasonCode, userId, fasonPlan, decidedWithFason }),
    );

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: { batchNumber: existing.workOrderNumber, status: existing.status },
      newData: {
        status: WorkOrderStatus.CANCELLED,
        ...(applied.length > 0 ? { dispositionCount: applied.length, reason } : {}),
      },
    });

    // Top başına ayrı iz — sabit olay koduyla ayrıştırılabilir olmalı: altı ay sonra
    // "bu top neden fire yazılmış" sorusunun cevabı burada. `WO_CLOSE_DISPOSITION`
    // ile aynı desen, farklı kod (kapatma ile iptal karışmasın).
    for (const a of applied) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: a.rollId,
        oldData: { status: a.from },
        newData: {
          status: a.to,
          event: "WO_CANCEL_DISPOSITION",
          action: a.action,
          reason,
          workOrderNumber: existing.workOrderNumber,
        },
      });
    }

    const scrapCount = applied.filter((a) => a.action === "SCRAP").length;
    const voidCount = applied.filter((a) => a.action === "CANCELLED").length;
    const extra = [
      scrapCount > 0 ? `${scrapCount} fire` : null,
      voidCount > 0 ? `${voidCount} hatalı kayıt` : null,
    ].filter(Boolean);

    return {
      success: true,
      data: updated,
      message:
        extra.length > 0
          ? `${TERIM.terbiyeIsEmri.cumleBasi.yalin} iptal edildi (${extra.join(", ")}), kalan ham toplar STOCK'a çekildi: ${existing.workOrderNumber}`
          : `${TERIM.terbiyeIsEmri.cumleBasi.yalin} iptal edildi, ham toplar STOCK'a çekildi: ${existing.workOrderNumber}`,
    };
  }

export async function cancelWorkOrderTx(this: WorkOrderServiceThis, tx: Prisma.TransactionClient, c: CancelWorkOrderTxInput) {
    const { id, stepIds, reason, cancelReasonCode, userId, fasonPlan, decidedWithFason } = c;
    const existing = { workOrderNumber: c.workOrderNumber };
    const input = { trigger: c.trigger };
  // ATOMİK CLAIM ÖNCE (F57): WO satırını status-koşullu updateMany ile
  // kilitle. Fason in-flight guard'ı BUNDAN SONRA çalışır — böylece guard,
  // WO satır kilidini tutarken okur ve eşzamanlı bir fason sevkinin (dispatch
  // tx başında touchWorkOrderTx ile AYNI satırı kilitler) COMMIT'li
  // AT_SUBCONTRACTOR toplarını her zaman görür. Guard önce çalışsaydı, READ
  // COMMITTED'da commit'siz dispatch topları görülmez (count=0), sonra claim
  // dispatch commit'inden sonra geçer ve mal fasondayken WO iptal olurdu.
  // Ayrıca eşzamanlı son-top finalize (tambur.finalize / kursun.finishStep)
  // WO'yu COMPLETED yaparsa bu claim count===0 görür → 409. tx-DIŞI ön-kontrol
  // (2371-2376) yalnız UX; asıl koruma burada.
  // ⚠️ KENDİ ÜRETTİĞİMİZ TAMAMLANMA (2026-08-29 / BULGU-T1-009): "kalan
  // gelmeyecek" kararı uygulandıysa `closeRemainder` fason adımını kapatır
  // ve TEK ADIMLI iş emrinde bu, iş emrini COMPLETED'a çeker. O durumda bu
  // claim kendi eylemimizi "başkası bu sırada tamamladı" sanıp 409 verir ve
  // operatörün AZ ÖNCE onayladığı iptal sessizce yapılmamış olur — üstelik
  // kalan zaten fire yazılmıştır, yani yarım iş kalır.
  // Muafiyet DAR: yalnız bu istekte kalan kapatıldıysa ve yalnız COMPLETED
  // için. CANCELLED/SUPERSEDED kapıları AYNEN duruyor.
  const claimBlocked = fasonPlan.remainderClosed
    ? [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED]
    : [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED];
  const cancelFrom = await claimWorkOrderStatusTx(tx, id, {
    from: Object.values(WorkOrderStatus).filter((st) => !(claimBlocked as WorkOrderStatus[]).includes(st)),
    to: WorkOrderStatus.CANCELLED,
    // İptal izi KOLONDA (2026-08-17): audit 6 ayda bir arşivleniyor, sebep
    // orada kalırsa "bu iş emri neden iptal edildi" sorusu sessizce
    // cevapsız kalırdı. Audit yine yazılır — ikisi farklı soruları
    // cevaplıyor ("her değişiklik" ↔ "son karar").
    data: {
      cancelledAt: new Date(),
      cancelledById: userId ?? null,
      cancelReason: reason || null,
    },
    ctx: { trigger: input.trigger ?? "WO_CANCEL", userId, reason: reason || null, refType: c.refType ?? null, refId: c.refId ?? null },
  });
  if (!cancelFrom) {
    const fresh = await tx.workOrder.findUnique({
      where: { id },
      select: { status: true },
    });
    throw AppError.conflict(
      `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada ${
        fresh?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
      }, iptal edilemez. Listeyi yenileyin.`
    );
  }

  // ── ARTIK KALAN FASON TOPLARI — TX İÇİNDE, CLAIM'Lİ (BULGU-T1-009) ────
  // Sevk iptali topları normalde geri getirir. Getirmediği durumlar var ve
  // sahada BUNLAR takılmaya sebep oluyordu:
  //   · top AT_SUBCONTRACTOR ama AÇIK sevki yok (kısmi kabul kalıntısı,
  //     elle düzeltilmiş kayıt, eski veri),
  //   · dönüş topu (SUBCONTRACTOR_RETURN) zaten içeride ama fason statüsünde.
  // Bunları AÇIKÇA içeri alıyoruz; yoksa aşağıdaki guard yine tetikler ve
  // kullanıcı kararı verdiği hâlde iptal edemez.
  //
  // Hedef IN_PRODUCTION: sevk iptalinin ürettiği son durumun aynısı — bundan
  // sonrası SIRADAN bir "işlemdeki top" olur ve karar motoru (fire /
  // varsayılan stok) TEK yerde çalışır.
  //
  // ⚠️ İKİ ŞEY LOAD-BEARING: (1) yazım bu tx'in İÇİNDE — tx düşerse çevirme
  // de geri sarılır (eskiden havuz client'ıyla dışarıda koşuyor ve kalıcı
  // kalıyordu); (2) `where`'deki statü süzgeci bir CLAIM'dir — id listesi
  // tx'ten ÖNCE okundu, arada bir top meşru olarak başka statüye geçmiş
  // olabilir ve onu körlemesine IN_PRODUCTION'a çekmek o işlemi ezerdi.
  // Bu arada FASONA ÇIKAN yeni bir top ise listede olmadığı için aşağıdaki
  // guard'a takılır ve iptal reddedilir (fail-closed, doğru yön).
  if (fasonPlan.residualRollIds.length > 0) {
    await tx.roll.updateMany({
      where: {
        id: { in: fasonPlan.residualRollIds },
        status: {
          in: [RollStatus.AT_SUBCONTRACTOR, RollStatus.RETURNED_FROM_SUBCONTRACTOR],
        },
      },
      data: { status: RollStatus.IN_PRODUCTION },
    });
  }

  // GUARD (claim'den SONRA — F57): Fasonda (boyahanede) işlem gören/görmüş
  // in-flight top varsa iptal edilemez. Fason malı asla ham stoğa dönemez —
  // sipariş kopsa bile bu mal stok için üretilmeye devam eder. Guard triplerse
  // tüm tx (claim dahil) geri sarılır → WO IN_PROGRESS kalır.
  //   - AT_SUBCONTRACTOR                     → halen boyahanede
  //   - RETURNED_FROM_SUBCONTRACTOR          → fason dönüşü (eski model)
  //   - IN_PRODUCTION + SUBCONTRACTOR_RETURN → boyanmış açık kumaş, KK2'de
  if (stepIds.length > 0) {
    const fasonInFlight = await tx.roll.count({
      where: {
        AND: [
          {
            OR: [
              { currentStepId: { in: stepIds } },
              { producedInStepId: { in: stepIds } },
            ],
          },
          {
            OR: [
              { status: RollStatus.AT_SUBCONTRACTOR },
              { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR },
              {
                status: RollStatus.IN_PRODUCTION,
                entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
              },
            ],
          },
        ],
      },
    });
    if (fasonInFlight > 0) {
      // 2026-08-17: SERT ENGEL KALDIRILDI. Eskiden burada iptal tamamen
      // reddediliyordu ve kullanıcının hiçbir çıkışı yoktu. Artık karar
      // AÇIKÇA sorulur; karar gelmemişse istemciye MAKİNE-OKUR bir kod
      // döner ve modal iki seçeneği çizer (uzun bir açıklama metni değil).
      //
      // ⚠️ Karar gelmişse fason topları bu tx'e GİRMEDEN ÖNCE (aşağıdaki
      // `applyFasonDecisionBeforeCancel`) işlenmiş olur; buraya düşmek,
      // kararın uygulanamadığı (ör. sevk iptali başarısız) anlamına gelir.
      throw AppError.conflict(
        `Fasondaki toplar için karar verilmeden ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edilemez.`,
        { code: "FASON_DECISION_REQUIRED", fasonRollCount: fasonInFlight },
      );
    }
  }

  // KARARLI TOPLAR (fire / hatalı kayıt) — varsayılan STOCK dışına çıkanlar.
  // Guard'lardan SONRA, toplu geri çekmeden ÖNCE koşar: motor topları
  // IN_PRODUCTION'dan çıkarır, böylece aşağıdaki blanket updateMany onları
  // kendiliğinden kapsam dışı bırakır — bakımı gereken bir `notIn` listesi YOK.
  const applied: AppliedRollDisposition[] = [];
  if (decidedWithFason.length > 0) {
    // Kapsam guard'ı: karar verilen her top tx içinde TAZE okunan işlemdeki
    // kümede olmalı. Kapatmadan farklı olarak BİREBİR eşleşme aranmaz (alt küme
    // yeterli) — listelenmeyen her top zaten varsayılan STOCK'a gider ve
    // gövdesiz eski çağrıyı yapısal olarak aynı bırakan şey budur.
    const inFlight = await tx.roll.findMany({
      where: { currentStepId: { in: stepIds }, status: RollStatus.IN_PRODUCTION },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        weightKg: true,
        entrySource: true,
      },
    });
    const inFlightById = new Map(inFlight.map((r) => [r.id, r]));
    const missing = decidedWithFason.filter((d) => !inFlightById.has(d.rollId));
    if (missing.length > 0) {
      throw AppError.badRequest(
        `${missing.length} top artık işlemde değil — liste bu sırada değişti. ` +
          "Sayfayı yenileyip tekrar deneyin.",
      );
    }
    applied.push(
      ...(await applyRollDispositionsTx(tx, {
        origin: "WO_CANCEL",
        reason,
        reasonCode: cancelReasonCode,
        userId,
        rolls: inFlight,
        dispositions: decidedWithFason,
        stepIds,
        // İptalde parti üyeliği KORUNUR (`inventory.softDelete` emsali): "hangi
        // partiye yanlış top yazılmıştı" izi iptalle birlikte silinmemeli.
        clearBatchId: () => false,
        // Üç aksiyonun hiçbiri satılabilir değil → barkod üretimi gereksiz.
        generateBarcodes: false,
      })),
    );
  }

  if (stepIds.length > 0) {
    // Yalnız GERÇEKTEN HAM (entrySource ≠ SUBCONTRACTOR_RETURN), halen
    // üretimdeki toplar geri döner. `producedInStepId` (üretim izi) KORUNUR.
    // Bitmiş depo malları (WAREHOUSE/TAMBUR_CONSUMED) ve fason ürünleri
    // (yukarıda bloklandı) DOKUNULMAZ.
    const hamTopWhere = {
      currentStepId: { in: stepIds },
      status: RollStatus.IN_PRODUCTION,
      entrySource: { not: RollEntrySource.SUBCONTRACTOR_RETURN },
    } satisfies Prisma.RollWhereInput;
    await this.returnRawRollsOnCancelTx(tx, { hamTopWhere, stepIds, workOrderNumber: existing.workOrderNumber, userId });
  }

  // M-12: iptal edilen WO'nun adımlarındaki TÜM açık movement'ları kapat —
  // yoksa süresiz açık kalır: dashboard WIP sayacı kalıcı şişer, açık-kart
  // partial index'i ölü adımlarla dolar, serbest STOCK top "istasyonda
  // aktif" görünür. qtyOut topun son metrajından.
  if (stepIds.length > 0) {
    await tx.$executeRaw`
      UPDATE roll_movements m
      -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
      SET "exitedAt" = now(),
          "qtyOut" = COALESCE(m."qtyOut", r."currentQty"),
          "weightOut" = COALESCE(m."weightOut", r."weightKg"),
          notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_CANCELLED'
                       ELSE m.notes || ' | WO_CANCELLED' END
      FROM rolls r
      WHERE m."rollId" = r.id
        AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
        AND m."exitedAt" IS NULL
        AND m."revokedAt" IS NULL
    `;
    // Başlamamış/yarım adımlar terminal duruma (SKIPPED) — ölü WO'nun
    // adımları kuyruk/WIP istatistiklerinde "içeride" sayılmasın.
    await tx.workOrderStep.updateMany({
      where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
      data: { status: StepStatus.SKIPPED, skipReason: "WO_CANCELLED" },
    });
  }

  // Kurşun bypass: iş emri artık YOK → açık kurşun dağıtımı da yok. `force`
  // ile TÜM açık atamalar iptal edilir (adım durumuna bakılmaz): yukarıdaki
  // blok adımları zaten SKIPPED'a çekiyor ama `stepIds` boşsa hiç çalışmıyor,
  // ve bayat kalan bir atama dağıtım ekranında "bu iş bizde bekliyor" diye
  // sonsuza dek görünür + partial unique yüzünden adım yeniden kullanılamazdı.
  // İSTASYON GERİ YÜKLENMEZ (helper sözleşmesi) — kapanmış movement'ların
  // istasyon atfı, işi fiilen yapan kurşun istasyonunda kalmalı.
  await voidStalePendingBypassAssignmentsTx(tx, id, "WO_CANCELLED", { force: true });

  // WO iptal olunca tüm ACTIVE refakat kartlarını VOIDED'a çek
  await setWorkOrderCardStatusesTx(tx, id, "ACTIVE", "VOIDED", { voidReason: "WO_CANCELLED" });

  const cancelledWO = await tx.workOrder.findUnique({ where: { id } });
  return { updated: cancelledWO!, applied };
  }
