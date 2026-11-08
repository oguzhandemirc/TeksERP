// =============================================================================
// Shipping Service / sack-content
// =============================================================================
// Çuval içeriği: okutma, kartela, top çıkarma/taşıma, içerik dağıtımı (tekil + toplu), çuval bölme, içerik-değişti damgası.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (shipping/list.ts sayılır) */

import {
  Prisma,
  SackWeighingKind,
  SwatchEventType,
} from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { ambiguousCustomerCodeError, matchExtras, resolveRollByScanCode } from "../helpers/roll-scan-resolve.helper";
import { normalizeScanCode } from "../../utils/code-format";
import { matchesSeries, resolveSeriesFormat } from "../number-series.service";
import {
  touchWarehouseSackTx,
} from "../helpers/shipment-locks.helper";
import {
  NON_SACKABLE_STATUSES,
  SACK_ABSENT_STATUSES,
} from "../helpers/sack-invariants.helper";
import { ApiResponse } from "../../types/api.types";
import { SWATCH_IN_STOCK_WHERE, transitionSwatchesTx } from "../helpers/swatch-event.helper";
import { nextSackNo, type ShippingServiceThis } from "./shared";

export async function scanIntoSack(this: ShippingServiceThis, 
    data: { sackId: string; barcode: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, shipmentId: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Çuval bir sevkiyata atanmış — içerik değiştirilemez");

    const code = normalizeScanCode(data.barcode);
    // ÇUVAL KODU okutulduysa (CV+GGAAYY+NNNN) bu bir top DEĞİL. Çuval etiketi
    // basılabildiği için operatör kaçınılmaz olarak bunu top alanına okutur;
    // yanıltıcı "Bu barkodla top bulunamadı" yerine ne olduğunu söyleyelim.
    // (İstemci bunu zaten yakalayıp çuvalı aktif yapar; bu sunucu tarafı ağdır.)
    if (matchesSeries(resolveSeriesFormat("sack"), code)) {
      throw AppError.badRequest(
        `${code} bir ÇUVAL kodu, top barkodu değil — çuvala eklemek için TOP barkodunu okutun.`,
      );
    }
    // D4-F1: tek okutma boğazı — iç barkod (top, sonra kartela) önce; ayar açıksa aktif müşteri kodu.
    const resolved = await resolveRollByScanCode(code, {
      load: (where) => prisma.roll.findUnique({
        where,
        select: { id: true, status: true, shipmentId: true, sackId: true, barcode: true, currentQty: true, sack: { select: { shipmentId: true } } },
      }),
      otherInternalHit: async (c) => (await prisma.swatch.findUnique({ where: { barcode: normalizeScanCode(c) }, select: { id: true } })) !== null,
    });
    if (resolved.kind === "AMBIGUOUS") throw ambiguousCustomerCodeError(resolved);
    const roll = resolved.kind === "FOUND" ? resolved.roll : null;
    const extras = resolved.kind === "FOUND" ? matchExtras(resolved) : {};
    if (roll) {
      // Zaten bu çuvalda
      if (roll.sackId === data.sackId) {
        return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId, ...extras }, message: "Top zaten bu çuvalda" };
      }
      // Başka depodaki çuvaldaysa TAŞI; sevkiyattaki çuvaldaysa reddet.
      if (roll.sackId) {
        const from = roll.sack;
        if (!from || from.shipmentId != null) {
          throw AppError.conflict("Top başka bir çuvalda (sevkiyatta) — taşınamaz");
        }
        const fromSackId = roll.sackId;
        await prisma.$transaction(async (tx) => {
          await touchWarehouseSackTx(tx, data.sackId);
          const moved = await tx.roll.updateMany({
            where: { id: roll.id, sackId: fromSackId, shipmentId: null },
            data: { sackId: data.sackId },
          });
          if (moved.count !== 1) throw AppError.conflict("Top bu sırada taşınmış/çıkarılmış — tekrar deneyin");
          await this.markSackContentChangedTx(tx, [fromSackId, data.sackId]);
        });
        await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: roll.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: roll.barcode } });
        return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId, currentQty: roll.currentQty, ...extras }, message: "Top bu çuvala taşındı" };
      }
      // Serbest depo topu — çuvala ekle (atomik claim).
      if (roll.shipmentId) throw AppError.conflict("Top bir sevkiyatta");
      if (NON_SACKABLE_STATUSES.includes(roll.status)) {
        throw AppError.badRequest(
          `Bu top çuvala konulamaz — durumu: ${roll.status} (sevk edilmiş/fire/iptal/tüketilmiş/fasonda/kartelada/üretimde). Envanterdeki serbest toplar okutulabilir.`,
        );
      }
      await prisma.$transaction(async (tx) => {
        await touchWarehouseSackTx(tx, data.sackId);
        const claimed = await tx.roll.updateMany({
          where: { id: roll.id, shipmentId: null, sackId: null, status: { notIn: NON_SACKABLE_STATUSES } },
          data: { sackId: data.sackId },
        });
        if (claimed.count === 0) throw AppError.conflict("Top az önce başka bir akışa girdi — tekrar deneyin.");
        await this.markSackContentChangedTx(tx, [data.sackId]);
      });
      await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: roll.id, newData: { kind: "SACK_SCAN", sackId: data.sackId, barcode: roll.barcode } });
      return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId, currentQty: roll.currentQty, ...extras }, message: "Top çuvala eklendi" };
    }

    // Kartela
    const swatch = await prisma.swatch.findUnique({
      where: { barcode: code },
      select: { id: true, shipmentId: true, sackId: true, barcode: true, cancelledAt: true, sack: { select: { shipmentId: true } } },
    });
    if (!swatch) throw AppError.notFound(`Top/kartela bulunamadı: ${code}`);
    if (swatch.cancelledAt) throw AppError.badRequest(`İptal edilmiş kartela okutulamaz: ${swatch.barcode}`);
    if (swatch.sackId === data.sackId) {
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela zaten bu çuvalda" };
    }
    if (swatch.sackId) {
      const from = swatch.sack;
      if (!from || from.shipmentId != null) {
        throw AppError.conflict("Kartela başka bir çuvalda (sevkiyatta) — taşınamaz");
      }
      const fromSackId = swatch.sackId;
      await prisma.$transaction(async (tx) => {
        // Kilit sırası çuval → kartela: iki çuval da karteladan ÖNCE, id sırasıyla (ters yönlü
        // eşzamanlı taşıma ve çuvaldan çıkarma 40P01 üretmesin).
        for (const id of [fromSackId, data.sackId].sort()) await touchWarehouseSackTx(tx, id);
        // Taşıma iki olaydır (A'dan çıktı · B'ye girdi), tek grup: çuval başına net sayım korunur.
        const moveCtx = { trigger: "SACK_MOVE", userId, groupId: randomUUID() };
        const left = await transitionSwatchesTx(tx, SwatchEventType.UNSACKED, { scope: { ids: [swatch.id] }, sack: { id: fromSackId }, ctx: moveCtx });
        const entered = left.length === 1
          ? await transitionSwatchesTx(tx, SwatchEventType.SACKED, { scope: { ids: [swatch.id] }, sack: { id: data.sackId }, ctx: moveCtx })
          : [];
        if (entered.length !== 1) throw AppError.conflict("Kartela bu sırada taşınmış/çıkarılmış — tekrar deneyin");
        await this.markSackContentChangedTx(tx, [fromSackId, data.sackId]);
      });
      await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: swatch.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: swatch.barcode } });
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela bu çuvala taşındı" };
    }
    if (swatch.shipmentId) throw AppError.conflict("Kartela bir sevkiyatta");
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      const claimed = await transitionSwatchesTx(tx, SwatchEventType.SACKED, { scope: { ids: [swatch.id] }, sack: { id: data.sackId }, ctx: { trigger: "SACK_SCAN", userId } });
      if (claimed.length === 0) throw AppError.conflict("Kartela az önce başka bir akışa girdi — tekrar deneyin.");
      await this.markSackContentChangedTx(tx, [data.sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: swatch.id, newData: { kind: "SACK_SCAN", sackId: data.sackId, barcode: swatch.barcode } });
    return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela çuvala eklendi" };
  }

export async function addKartelaToSack(this: ShippingServiceThis, 
    data: { sackId: string; itemId: string; colorId: string | null; count: number },
    userId?: string
  ): Promise<ApiResponse<{ added: number; swatchIds: string[]; sackId: string }>> {
    if (!Number.isInteger(data.count) || data.count < 1) throw AppError.badRequest("Adet pozitif tam sayı olmalı");
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, shipmentId: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Çuval bir sevkiyata atanmış");

    const ids = await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      const candidates = await tx.swatch.findMany({
        where: { itemId: data.itemId, colorId: data.colorId, ...SWATCH_IN_STOCK_WHERE },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: data.count,
      });
      if (candidates.length < data.count) {
        throw AppError.conflict(`Yeterli kartela stoğu yok — istenen ${data.count}, mevcut ${candidates.length}. Listeyi yenileyin.`);
      }
      const claimIds = candidates.map((c) => c.id);
      const claimed = await transitionSwatchesTx(tx, SwatchEventType.SACKED, { scope: { ids: claimIds }, sack: { id: data.sackId }, ctx: { trigger: "KARTELA_SELECT_ADD", userId } });
      if (claimed.length !== data.count) throw AppError.conflict("Kartelalardan biri az önce başka bir akışa girdi — tekrar deneyin.");
      await this.markSackContentChangedTx(tx, [data.sackId]);
      return claimIds;
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: ids[0], newData: { kind: "KARTELA_SELECT_ADD", sackId: data.sackId, itemId: data.itemId, colorId: data.colorId, count: data.count } });
    return { success: true, data: { added: ids.length, swatchIds: ids, sackId: data.sackId }, message: "Kartela çuvala eklendi" };
  }

export async function removeRollFromSack(this: ShippingServiceThis, 
    data: { rollId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, sackId: true, shipmentId: true, sack: { select: { shipmentId: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.sackId) throw AppError.badRequest("Top bir çuvalda değil");
    if (roll.shipmentId != null || (roll.sack && roll.sack.shipmentId != null)) {
      throw AppError.conflict("Top sevkiyattaki çuvalda — önce sevkiyattan çıkarın");
    }
    const sackId = roll.sackId;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, sackId);
      const removed = await tx.roll.updateMany({ where: { id: data.rollId, sackId, shipmentId: null }, data: { sackId: null } });
      if (removed.count !== 1) throw AppError.conflict("Top bu sırada çıkarılmış/taşınmış — tekrar deneyin");
      await this.markSackContentChangedTx(tx, [sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: data.rollId, newData: { kind: "SACK_UNSCAN", sackId: null } });
    return { success: true, data: {}, message: "Top çuvaldan çıkarıldı (depoya döndü)" };
  }

export async function removeSwatchFromSack(this: ShippingServiceThis, 
    data: { swatchId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const swatch = await prisma.swatch.findUnique({
      where: { id: data.swatchId },
      select: { id: true, sackId: true, shipmentId: true, sack: { select: { shipmentId: true } } },
    });
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (!swatch.sackId) throw AppError.badRequest("Kartela bir çuvalda değil");
    if (swatch.shipmentId != null || (swatch.sack && swatch.sack.shipmentId != null)) {
      throw AppError.conflict("Kartela sevkiyattaki çuvalda — önce sevkiyattan çıkarın");
    }
    const sackId = swatch.sackId;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, sackId);
      const removed = await transitionSwatchesTx(tx, SwatchEventType.UNSACKED, { scope: { ids: [data.swatchId] }, sack: { id: sackId }, ctx: { trigger: "SACK_UNSCAN", userId } });
      if (removed.length !== 1) throw AppError.conflict("Kartela bu sırada çıkarılmış/taşınmış — tekrar deneyin");
      await this.markSackContentChangedTx(tx, [sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: data.swatchId, newData: { kind: "SACK_UNSCAN", sackId: null } });
    return { success: true, data: {}, message: "Kartela çuvaldan çıkarıldı" };
  }

export async function moveRollToSack(this: ShippingServiceThis, 
    data: { rollId: string; sackId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, barcode: true, sackId: true, shipmentId: true, sack: { select: { shipmentId: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.sackId || !roll.sack) throw AppError.badRequest("Top bir çuvalda değil");
    if (roll.shipmentId != null || roll.sack.shipmentId != null) {
      throw AppError.conflict("Kaynak çuval sevkiyatta — önce sevkiyattan çıkarın");
    }
    if (roll.sackId === data.sackId) {
      return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: "Top zaten bu çuvalda" };
    }
    const target = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, shipmentId: true } });
    if (!target) throw AppError.notFound("Hedef çuval bulunamadı");
    if (target.shipmentId != null) throw AppError.conflict("Hedef çuval sevkiyatta");
    const fromSackId = roll.sackId;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, fromSackId);
      await touchWarehouseSackTx(tx, data.sackId);
      const moved = await tx.roll.updateMany({ where: { id: roll.id, sackId: fromSackId, shipmentId: null }, data: { sackId: data.sackId } });
      if (moved.count !== 1) throw AppError.conflict("Top bu sırada taşınmış/çıkarılmış — tekrar deneyin");
      await this.markSackContentChangedTx(tx, [fromSackId, data.sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: roll.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: roll.barcode } });
    return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: "Top taşındı" };
  }

export async function distributeSackContents(this: ShippingServiceThis, 
    data: { sackId: string; rollIds?: string[]; swatchIds?: string[] },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, sackNo: true, shipmentId: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) {
      throw AppError.conflict("Sevkiyata atanmış çuvalın içeriği değiştirilemez — önce sevkiyattan çıkarın");
    }
    const rollSel = data.rollIds?.length ? data.rollIds : null;
    const swatchSel = data.swatchIds?.length ? data.swatchIds : null;
    // Hiç seçim verilmediyse: çuvaldaki HER ŞEYİ dağıt.
    const all = !rollSel && !swatchSel;

    let removedRolls = 0;
    let removedSwatches = 0;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      if (all || rollSel) {
        const rollWhere: Prisma.RollWhereInput = all
          ? { sackId: data.sackId, shipmentId: null }
          : { id: { in: rollSel! }, sackId: data.sackId, shipmentId: null };
        removedRolls = (await tx.roll.updateMany({ where: rollWhere, data: { sackId: null } })).count;
      }
      if (all || swatchSel) {
        removedSwatches = (await transitionSwatchesTx(tx, SwatchEventType.UNSACKED, {
          scope: all ? { sackIds: [data.sackId] } : { ids: swatchSel! },
          sack: { id: data.sackId, sackNo: sack.sackNo },
          ctx: { trigger: "SACK_DISTRIBUTE", userId },
        })).length;
      }
      await this.markSackContentChangedTx(tx, [data.sackId]);
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId,
      newData: { kind: "SACK_DISTRIBUTE", removedRolls, removedSwatches, all },
    });
    const n = removedRolls + removedSwatches;
    return { success: true, data: { removedRolls, removedSwatches }, message: n > 0 ? `${n} top/kartela depoya çıkarıldı` : "Çıkarılacak içerik yok" };
  }

export async function previewDistributeSacks(sackIds: string[]): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(sackIds)].filter(Boolean);
    if (ids.length === 0) throw AppError.badRequest("Çuval seçilmedi");
    const sacks = await prisma.sack.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, sackNo: true, shipmentId: true, weightKg: true,
        shipment: { select: { shipmentNo: true, status: true } },
        customer: { select: { id: true, name: true } },
        rolls: {
          where: { status: { notIn: SACK_ABSENT_STATUSES } },
          select: { id: true, barcode: true, currentQty: true, item: { select: { name: true } }, color: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { swatches: true } },
      },
      orderBy: { sackNo: "asc" },
    });
    const bulunanIds = new Set(sacks.map((s2) => s2.id));
    const kayip = ids.filter((i) => !bulunanIds.has(i));

    const satirlar = sacks.map((sk) => {
      const metraj = sk.rolls.reduce((a2, r) => a2 + Number(r.currentQty), 0);
      // Tek engel sınıfı: sevkiyata atanmış çuval. Aynı kural tekil dağıtmada da
      // var (`distributeSackContents`) — iki yüzey aynı hükmü versin.
      const engel = sk.shipmentId
        ? `${sk.shipment?.shipmentNo ?? "Bir"} sevkiyatına atanmış — önce sevkiyattan çıkarın`
        : null;
      return {
        sackId: sk.id,
        sackNo: sk.sackNo,
        customer: sk.customer,
        weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        rollCount: sk.rolls.length,
        swatchCount: sk._count.swatches,
        totalMeters: Math.round(metraj * 1000) / 1000,
        engel,
        // Etkilenen HER kayıt — arayüz sayı değil satır gösterir.
        rolls: sk.rolls.map((r) => ({
          id: r.id, barcode: r.barcode,
          item: r.item?.name ?? null, color: r.color?.name ?? null,
          meters: Number(r.currentQty),
        })),
      };
    });
    const uygun = satirlar.filter((r) => !r.engel);
    return {
      success: true,
      data: {
        sacks: satirlar,
        bulunamayan: kayip,
        ozet: {
          secilen: ids.length,
          dagitilacak: uygun.length,
          engelli: satirlar.length - uygun.length,
          toplamTop: uygun.reduce((a2, r) => a2 + r.rollCount, 0),
          toplamMetraj: Math.round(uygun.reduce((a2, r) => a2 + r.totalMeters, 0) * 1000) / 1000,
        },
      },
    };
  }

export async function distributeSacksBulk(this: ShippingServiceThis, 
    data: { sackIds: string[] },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(data.sackIds)].filter(Boolean);
    if (ids.length === 0) throw AppError.badRequest("Çuval seçilmedi");
    const on = (await this.previewDistributeSacks(ids)).data as {
      sacks: { sackId: string; sackNo: string; engel: string | null }[];
      bulunamayan: string[];
    };
    const dagitilan: { sackId: string; sackNo: string; removedRolls: number; removedSwatches: number }[] = [];
    const atlanan: { sackId: string; sackNo: string; sebep: string }[] = [];
    for (const sk of on.sacks) {
      if (sk.engel) {
        atlanan.push({ sackId: sk.sackId, sackNo: sk.sackNo, sebep: sk.engel });
        continue;
      }
      const r = (await this.distributeSackContents({ sackId: sk.sackId }, userId)).data as {
        removedRolls: number; removedSwatches: number;
      };
      dagitilan.push({ sackId: sk.sackId, sackNo: sk.sackNo, ...r });
    }
    for (const id of on.bulunamayan) atlanan.push({ sackId: id, sackNo: "?", sebep: "Çuval bulunamadı" });
    const topToplam = dagitilan.reduce((a2, d) => a2 + d.removedRolls + d.removedSwatches, 0);
    return {
      success: true,
      data: { dagitilan, atlanan },
      message:
        atlanan.length === 0
          ? `${dagitilan.length} çuval dağıtıldı (${topToplam} top/kartela depoya çıktı)`
          : `${dagitilan.length} çuval dağıtıldı, ${atlanan.length} çuval atlandı`,
    };
  }

export async function moveRollsToSack(this: ShippingServiceThis, 
    data: { sackId: string; rollIds: string[]; targetSackId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.rollIds?.length) throw AppError.badRequest("Taşınacak top seçilmedi");
    if (data.sackId === data.targetSackId) throw AppError.badRequest("Kaynak ve hedef çuval aynı olamaz");
    const source = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, shipmentId: true } });
    if (!source) throw AppError.notFound("Kaynak çuval bulunamadı");
    if (source.shipmentId != null) throw AppError.conflict("Kaynak çuval sevkiyatta — önce sevkiyattan çıkarın");
    const target = await prisma.sack.findUnique({ where: { id: data.targetSackId }, select: { id: true, shipmentId: true } });
    if (!target) throw AppError.notFound("Hedef çuval bulunamadı");
    if (target.shipmentId != null) throw AppError.conflict("Hedef çuval sevkiyatta");

    let moved = 0;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      await touchWarehouseSackTx(tx, data.targetSackId);
      moved = (await tx.roll.updateMany({
        where: { id: { in: data.rollIds }, sackId: data.sackId, shipmentId: null },
        data: { sackId: data.targetSackId },
      })).count;
      await this.markSackContentChangedTx(tx, [data.sackId, data.targetSackId]);
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId,
      newData: { kind: "SACK_MOVE_BULK", targetSackId: data.targetSackId, moved },
    });
    return { success: true, data: { moved }, message: moved > 0 ? `${moved} top taşındı` : "Taşınacak top yok" };
  }

export async function splitSack(this: ShippingServiceThis, 
    data: { sackId: string; rollIds: string[] },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.rollIds?.length) throw AppError.badRequest("Ayrılacak top seçilmedi");
    const source = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, shipmentId: true, customerId: true, branchId: true, warehouseId: true, _count: { select: { rolls: true } } },
    });
    if (!source) throw AppError.notFound("Çuval bulunamadı");
    if (source.shipmentId != null) {
      throw AppError.conflict("Çuval sevkiyatta — bölmek için önce sevkiyattan çıkarın");
    }
    // Pre-tx UX guard'ı (kilit altında taze sayımla tekrar doğrulanır). Seçimin
    // KESİŞİMİ sayılır — id listesi bu çuvala ait olmayan top içerebilir (istemci
    // bayat liste gönderdi); ham `selected.size` ile karşılaştırmak o durumda
    // meşru isteği yanlış mesajla reddediyordu.
    const selected = new Set(data.rollIds);
    const inSack = await prisma.roll.count({
      where: { id: { in: [...selected] }, sackId: data.sackId, shipmentId: null },
    });
    if (inSack === 0) throw AppError.badRequest("Seçili topların hiçbiri bu çuvalda değil");
    if (inSack >= source._count.rolls) {
      throw AppError.badRequest(
        "Çuvaldaki tüm toplar seçili — bölmek için en az bir top kaynak çuvalda kalmalı.",
      );
    }

    let newSackId = "";
    let newSackNo = "";
    let moved = 0;
    // sackNo HER ZAMAN otomatik üretilir (manuel kod yolu yok) → tüm P2002 retry
    // edilebilir; predicate gerekmez (openSack'ten farkı: orada manuel kod olabiliyor).
    await withBarcodeRetry(async () => {
      await prisma.$transaction(async (tx) => {
          await touchWarehouseSackTx(tx, data.sackId);
          // Kilit ALTINDA taze sayım — bayat `_count` tuzağı (removeSack ile aynı ders).
          const fresh = await tx.roll.count({ where: { sackId: data.sackId, shipmentId: null } });
          const claimable = await tx.roll.count({
            where: { id: { in: [...selected] }, sackId: data.sackId, shipmentId: null },
          });
          if (claimable === 0) throw AppError.conflict("Seçili toplar bu sırada taşınmış/çıkarılmış — yenileyin");
          if (claimable >= fresh) {
            throw AppError.badRequest("Bölme sonrası kaynak çuval boş kalır — en az bir top kalmalı.");
          }
          const created = await tx.sack.create({
            data: {
              sackNo: await nextSackNo(tx),
              customerId: source.customerId,
              branchId: source.branchId,
              // Bölme fiziksel olarak kaynağın YANINDA olur → depo MİRAS alınır
              // (kaynak eski/damgasızsa NULL kalır, lazy adoption transfer anında).
              warehouseId: source.warehouseId,
            },
            select: { id: true, sackNo: true },
          });
          newSackId = created.id;
          newSackNo = created.sackNo;
          moved = (
            await tx.roll.updateMany({
              where: { id: { in: [...selected] }, sackId: data.sackId, shipmentId: null },
              data: { sackId: created.id },
            })
          ).count;
        // ⚠️ ÇUVAL İZLERİ (ETİKET) MİRAS ALINMAZ — bilinçli, "eksik" DEĞİL.
        // İz FİZİKSEL çuvala bırakılmış bir işarettir ("bunu ayır", "kontrol et");
        // yeni çuval BAŞKA BİR NESNEDİR ve kopyalamak talimatı sessizce İKİZLERDİ
        // (operatör bir "kontrol et" bırakır, ekranda iki tane belirir — hangisinin
        // gerçek iş olduğu kaybolur). Yeni çuvala iz gerekiyorsa operatör bırakır.
        // Buraya `sackTagAssignment.createMany` EKLEME.
        //
        // İçerik değişti → iki çuvalın da bayat kg'si düşer (irsaliyeye gitmesin)
        // + etiketleri "bayat" işaretlenir (kâğıttaki top adedi/metraj değişti).
        await this.markSackContentChangedTx(tx, [data.sackId, created.id]);
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: newSackId,
      newData: { kind: "SACK_SPLIT", fromSackId: data.sackId, sackNo: newSackNo, moved },
    });
    return {
      success: true,
      data: { sackId: newSackId, sackNo: newSackNo, moved },
      message: `${moved} top yeni çuvala ayrıldı: ${newSackNo}`,
    };
  }

export async function markSackContentChangedTx(
    tx: Prisma.TransactionClient,
    sackIds: (string | null | undefined)[]
  ): Promise<void> {
    const ids = [...new Set(sackIds.filter((s): s is string => !!s))];
    if (ids.length === 0) return;
    // ÖNCEKİ DEĞERLER ÖNCE OKUNUR: sıfırlama artık sessiz silme değil `CLEARED`
    // OLAYIDIR (2026-09-11) ve defter satırı neyin kaybolduğunu söylemeli.
    const temizlenecek = await tx.sack.findMany({
      where: { id: { in: ids }, weightKg: { not: null } },
      select: { id: true, weightKg: true, weightSource: true },
    });
    await tx.sack.updateMany({
      where: { id: { in: ids }, weightKg: { not: null } },
      // `weightSource` de NULL'lanır: kg gidince kaynak bilgisi bayatlar ve
      // "kg yok ama kaynağı SCALE" gibi tutarsız bir çift kalırdı.
      data: { weightKg: null, weightSource: null, weighedById: null, weighedAt: null },
    });
    if (temizlenecek.length > 0) {
      const stamp = new Date();
      await tx.sackWeighing.createMany({
        data: temizlenecek.map((sk) => ({
          sackId: sk.id,
          kind: SackWeighingKind.CLEARED,
          // ⚠️ `weightKg` NULL: olayın SONUCU "tartı yok"tur. Kaybolan değer
          // defterde bir ÖNCEKİ satırda durur — burada tekrarlamak, aynı kg'ı
          // iki satırda gösterip toplamı yalanlardı.
          weightKg: null,
          weightSource: sk.weightSource,
          weighedAt: stamp,
          notes: `İçerik değişti — önceki tartı ${sk.weightKg?.toString() ?? "?"} kg düştü`,
        })),
      });
    }
    await tx.sack.updateMany({
      where: { id: { in: ids }, labelDirty: false },
      data: { labelDirty: true },
    });
  }
