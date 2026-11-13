// =============================================================================
// Order Service / create
// =============================================================================
// Sipariş oluşturma: token replay, hazırlık (doğrulama + numara), ekleme tx'i, oluşturma sonrası.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { assertCariNotHeldTx } from "../helpers/cari-hold.helper";
import { assertCustomerRiskLimitTx, customerRiskLimitIntakeWarningTx, riskLimitIntakeWarningText } from "../helpers/risk-exposure.helper";
import prisma from "../../lib/prisma";
import { followAsCreatorTx } from "../helpers/record-follow.helper";
import { AuditService } from "../audit.service";
import { withActor } from "../base.service";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import { assertOrderReplayAlive, tokenReplay } from "../helpers/token-replay.helper";
import { resolveShipmentDestination } from "../helpers/shipment-destination.helper";
import {
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { isClientTokenP2002 } from "../../utils/p2002";
import { validate as isUuidString } from "uuid";
import { nextSeriesNo, resolveSeriesFormat } from "../number-series.service";
import { readOrderDefaultDeadlineDays } from "../system-setting.service";
import { assertManualNumberAllowed } from "../helpers/manual-number.helper";
import { runItemUsageChecksTx, type ItemUsageCheck } from "../helpers/item-usage.helper";
import { emitOrderCreatedTx } from "../notification-sources/satis";
import {
  lineTargetValuesNestedCreate,
  preparedTargetValues,
} from "../helpers/order-line-target-value.helper";
import { ORDER_HEADER_WRITABLE, ORDER_LINE_WRITABLE, computeTotalAmount, siparisSatirIzi, withExtraWarnings, type OrderServiceThis, type SiparisSatiri } from "./shared";

/** Kart kullanım uyarılarını (ör. "Tükenene kadar" A2) yanıtın `warnings`ine ekler. */
/** `create`in tx dışı yarısının çıktısı — hızlı sipariş aynı kapılardan geçip kendi tx'inde yazsın diye. */
export interface PreparedOrderCreate {
  prismaData: Record<string, unknown>;
  /** Oluşturan — insert (`createdById`) ve audit AYNI alandan okur; doğuş yolu başına bir kez verilir. */
  actorUserId: string | undefined;
  lineCheck: { checks: ItemUsageCheck[]; warnings: string[] };
  /** K3: iş kabulü kapısı kapalıyken risk limiti aşımı uyarısı (Türkçe; tutar yalnız `actor.canSeeRiskAmounts`). */
  riskWarnings: string[];
  destination: Awaited<ReturnType<typeof resolveShipmentDestination>>["destination"];
  manualOrderNumber: string | null;
  today: Date;
  fmt: ReturnType<typeof resolveSeriesFormat>;
}

/** Sipariş doğuşunun aktörü: her doğuş yolu (uç · hızlı sipariş · gelen kutusu · içe aktarma) AÇIKÇA verir. */
export interface OrderActor {
  userId: string | undefined;
  /** Risk uyarısında tutar/bakiye gösterilsin mi (bakiye görme izni `finance:read`); verilmezse ayrıntısız. */
  canSeeRiskAmounts?: boolean;
}

/** İdempotency anahtarı (Roll emsali) — route-level zod yok (BaseController ham body), burada doğrulanır. */
function parseOrderClientToken(raw: unknown): string | null {
  const token = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  if (token && !isUuidString(token)) throw AppError.badRequest("Geçersiz istemci anahtarı");
  return token;
}

const parseManualOrderNumber = (raw: unknown): string | null =>
  typeof raw === "string" && raw.trim() ? raw.trim() : null;

export async function create(this: OrderServiceThis, data: Record<string, unknown>, userId?: string, opts?: { canSeeRiskAmounts?: boolean }): Promise<ApiResponse<unknown>> {
    const clientToken = parseOrderClientToken(data.clientToken);
    // R: token HER iş kuralından (elle numara çakışması dahil) ÖNCE okunur ve iş hangi hatayla düşerse
    // düşsün yeniden okunur — sıralı tekrar da eşzamanlı kaybeden de önceki siparişi alır.
    return this.orderReplay(data).run(clientToken, async () => {
      const prepared = await this.prepareOrderCreate(data, clientToken, { userId, canSeeRiskAmounts: opts?.canSeeRiskAmounts });
      const record = await this.insertPreparedOrder(prepared);
      return this.finishOrderCreate(record, data, prepared);
    });
  }

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function finishOrderCreate(this: OrderServiceThis, 
    record: Record<string, unknown>,
    data: Record<string, unknown>,
    prepared: PreparedOrderCreate,
    opts?: { auditExtra?: Record<string, unknown> },
  ): Promise<ApiResponse<unknown>> {
    const userId = prepared.actorUserId;
    const auditExtra = opts?.auditExtra;
    const orderNumber = record.orderNumber as string;
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: record.id as string,
      newData: { ...data, orderNumber, ...(auditExtra ?? {}) },
    });
    await this.promoteCustomerAliases(
      data.customerId as string | undefined,
      Array.isArray(data.lines)
        ? (data.lines as Array<Record<string, unknown>>)
        : null,
      userId
    );
    return withExtraWarnings(
      this.withUnitWarnings({ success: true, data: record, message: "Sipariş oluşturuldu" }),
      [...prepared.lineCheck.warnings, ...prepared.riskWarnings],
    );
  }

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function prepareOrderCreate(this: OrderServiceThis, 
    data: Record<string, unknown>,
    clientToken: string | null,
    actor: OrderActor,
    /** Yalnız hızlı sipariş: satırlar okutulan toplardan doğdu — gövdeden GELMEZ. */
    opts?: { fromScannedRolls?: boolean },
  ): Promise<PreparedOrderCreate> {
    // F154: satırsız sipariş = ölü kayıt (coverage/MRP işleyemez, wo-picker düşürür).
    if (!Array.isArray(data.lines) || data.lines.length === 0) {
      throw AppError.badRequest("Sipariş en az bir kalem içermeli.");
    }
    this.validateLines(data.lines);
    await this.prepareLineVariants(data.lines);
    const lineCheck = await this.validateLineItems(data.lines, { fromScannedRolls: opts?.fromScannedRolls });
    const unitByItem = lineCheck.unitByItem;
    const riskWarnings: string[] = [];

    if (data.customerId) {
      await this.validateCustomer(data.customerId as string);
      // Cari kilidi (D4-I1, INTAKE): yeni sipariş = yeni iş kabulü; uç + hızlı sipariş + patron gelen kutusu bu boğazdan.
      await assertCariNotHeldTx(prisma, data.customerId as string, "INTAKE");
      // Risk limiti (D4-I2, finance.riskLimitBlock.intake) — kilit kapısının yanında.
      await assertCustomerRiskLimitTx(prisma, data.customerId as string, "INTAKE");
      // K3: kapı kapalıyken aşım engellemez, yanıta uyarı olur (aynı çekirdek; kapı açıksa null).
      const risk = await customerRiskLimitIntakeWarningTx(prisma, data.customerId as string);
      if (risk) riskWarnings.push(riskLimitIntakeWarningText(risk, actor.canSeeRiskAmounts === true));
    }

    if (data.branchId && data.customerId) {
      await this.validateBranch(
        data.branchId as string,
        data.customerId as string
      );
    }

    await this.validateLineColors(
      data.lines,
      data.customerId as string | null | undefined,
    );

    // F148: para birimi kataloğa karşı doğrula (create/update simetrik).
    this.assertValidCurrency(data.currency);

    // totalAmount: gönderilmediyse lines'tan otomatik hesapla. Gönderilmiş ise
    // (planlamacı override etmiş — KDV/indirim gibi) olduğu gibi bırak.
    if (
      data.totalAmount == null &&
      Array.isArray(data.lines) &&
      data.lines.length > 0
    ) {
      const computed = computeTotalAmount(
        data.lines as Array<{ quantity?: number; unitPrice?: number | null | string }>
      );
      if (computed !== null) data.totalAmount = computed;
    }

    // Termin (deadline) default: sipariş tarihinden N gün sonra. N tanımlardan
    // (`order.defaultDeadlineDays`) okunur; yoksa 7. orderDate verilmediyse
    // şema default'u (now()) baz alınır.
    if (data.deadline == null) {
      const baseDate = data.orderDate
        ? new Date(data.orderDate as string)
        : new Date();
      const days = await readOrderDefaultDeadlineDays();
      const deadline = new Date(baseDate);
      deadline.setDate(deadline.getDate() + days);
      data.deadline = deadline;
    } else {
      // F148: İş kuralı deadline >= orderDate (helper — update ile simetrik).
      this.assertDeadlineNotBeforeOrderDate(data.deadline, data.orderDate);
    }

    // Sipariş no: SIP + GGAAYY + NNNN (örn SIP1207260001) — tek tip kod kalıbı.
    const today = new Date();
    const fmt = resolveSeriesFormat("order");

    // HEADER + SATIR WHITELIST (M-3): orderNumber/status/shippedQty gibi
    // muhasebe alanları istemciden yazılamaz; bilinmeyen anahtarlar atılır.
    const prismaData: Record<string, unknown> = {
      // Sipariş oluşturulur oluşturulmaz üretime/sevke açık olsun;
      // ayrı bir "onay" adımı kullanılmıyor.
      status: OrderStatus.APPROVED,
    };
    for (const key of Object.keys(data)) {
      if (ORDER_HEADER_WRITABLE.has(key)) prismaData[key] = data[key];
    }
    // SİPARİŞ YÖNÜ DOĞUŞTA DONAR (sevkiyatın donmuş yönüyle aynı zincir): şube → cari; zincir boşsa
    // NULL ("yön belirsiz"). Kart sonradan değişse de sipariş değişmez; gövdeden yazılamaz (whitelist dışı).
    const destination = data.customerId
      ? (await resolveShipmentDestination(prisma, {
          customerId: data.customerId as string,
          branchId: (data.branchId as string | null | undefined) ?? null,
        })).destination
      : null;

    // Lines: whitelist + requiredPropertyIds → { create: [...] } formatı.
    if (Array.isArray(data.lines)) {
      prismaData.lines = (data.lines as Record<string, unknown>[]).map((rawLine) => {
        const line: Record<string, unknown> = {};
        for (const key of Object.keys(rawLine)) {
          if (ORDER_LINE_WRITABLE.has(key)) line[key] = rawLine[key];
        }
        line.unit = this.resolveLineUnit(rawLine, unitByItem);
        const ids = Array.isArray(rawLine.requiredPropertyIds)
          ? [...new Set((rawLine.requiredPropertyIds as string[]).filter(Boolean))]
          : [];
        if (ids.length > 0) {
          line.requiredProperties = {
            create: ids.map((propertyId) => ({ propertyId })),
          };
        }
        Object.assign(line, lineTargetValuesNestedCreate(preparedTargetValues(rawLine)));
        return line;
      });
    }

    if (this.config.nestedCreateFields) {
      for (const field of this.config.nestedCreateFields) {
        if (Array.isArray(prismaData[field])) {
          prismaData[field] = { create: prismaData[field] };
        }
      }
    }

    if (clientToken) prismaData.clientToken = clientToken;

    // Saha #16: kullanıcı sipariş numarasını ELLE verebilir (override) —
    // whitelist'ten BİLEREK ayrı işlenir (mass-assignment koruması korunur;
    // yalnız bu alan kontrollü kabul edilir). Boş/verilmemiş → otomatik üretim.
    const manualOrderNumber = parseManualOrderNumber(data.orderNumber);
    assertManualNumberAllowed("order", manualOrderNumber);
    if (manualOrderNumber) {
      if (manualOrderNumber.length > 40) {
        throw AppError.badRequest("Sipariş numarası en fazla 40 karakter olabilir");
      }
      const clash = await prisma.order.findUnique({
        where: { orderNumber: manualOrderNumber },
        select: { id: true },
      });
      if (clash) {
        throw AppError.conflict(`'${manualOrderNumber}' numaralı sipariş zaten var`);
      }
    }
    return { prismaData, actorUserId: actor.userId, lineCheck, riskWarnings, destination, manualOrderNumber, today, fmt };
  }

export function insertPreparedOrder(this: OrderServiceThis, p: PreparedOrderCreate): Promise<Record<string, unknown>> {
    return withBarcodeRetry(async () => {
      if (p.manualOrderNumber) {
        const stillFree = await prisma.order.findUnique({
          where: { orderNumber: p.manualOrderNumber },
          select: { id: true },
        });
        if (stillFree) {
          throw AppError.conflict(`'${p.manualOrderNumber}' numaralı sipariş zaten var`);
        }
      }
      return prisma.$transaction((tx) => this.insertPreparedOrderTx(tx, p));
    }, undefined, (err) => !isClientTokenP2002(err)) as Promise<Record<string, unknown>>;
  }

export async function insertPreparedOrderTx(this: OrderServiceThis, tx: Prisma.TransactionClient, p: PreparedOrderCreate, opts?: { notify?: boolean }): Promise<Record<string, unknown>> {
    await runItemUsageChecksTx(tx, p.lineCheck.checks);
    const orderNumber = p.manualOrderNumber ?? (await this.nextOrderNumber(tx, p));
    const created = await this.insertOrderTx(tx, p, orderNumber);
    // `siparis.olusturuldu` (S1); bulut gelen kutusu kendi türünü (`siparis.patron-siparisi`) yazar → notify:false.
    if (opts?.notify !== false) await emitOrderCreatedTx(tx, created.id as string, p.actorUserId);
    // Oluşturan otomatik takipçi (bildirim §5.3); dönüş aynen.
    await followAsCreatorTx(tx, p.actorUserId, { orderId: created.id as string });
    return created;
  }

export function nextOrderNumber(db: Pick<Prisma.TransactionClient, "order">, p: PreparedOrderCreate): Promise<string> {
    return nextSeriesNo(
      "order",
      async (fullPrefix) =>
        db.order
          .findMany({
            where: { orderNumber: { gte: fullPrefix, startsWith: fullPrefix } },
            select: { orderNumber: true, createdAt: true },
          })
          .then((rows) => rows.map((r) => ({ code: r.orderNumber, createdAt: r.createdAt }))),
      p.today,
      p.fmt,
    );
  }

export function insertOrderTx(this: OrderServiceThis, tx: Prisma.TransactionClient, p: PreparedOrderCreate, orderNumber: string): Promise<Record<string, unknown>> {
    return sequentialTx(tx).order.create({
      data: {
        ...withActor(p.prismaData, p.actorUserId, "CREATE", "order"),
        orderNumber,
        destination: p.destination,
      } as Prisma.OrderUncheckedCreateInput,
      ...(this.config.defaultInclude ? { include: this.config.defaultInclude } : {}),
    }) as Promise<Record<string, unknown>>;
  }

export function findOrderByToken(this: OrderServiceThis, db: Prisma.TransactionClient, clientToken: string): Promise<Record<string, unknown> | null> {
    return db.order.findUnique({
      where: { clientToken },
      ...(this.config.defaultInclude ? { include: this.config.defaultInclude as Prisma.OrderInclude } : {}),
    }) as Promise<Record<string, unknown> | null>;
  }

export function orderReplay(this: OrderServiceThis, data: Record<string, unknown>) {
    const manualOrderNumber = parseManualOrderNumber(data.orderNumber);
    return tokenReplay<Record<string, unknown>, ApiResponse<unknown>>({
      find: (db, clientToken) => this.findOrderByToken(db, clientToken),
      alive: (p) => assertOrderReplayAlive({ id: String(p.id), status: p.status as OrderStatus, orderNumber: (p.orderNumber as string | null) ?? null }),
      identity: (p) => [
        { ad: "customerId", mevcut: p.customerId, gelen: data.customerId },
        { ad: "branchId", mevcut: p.branchId, gelen: data.branchId },
        { ad: "satırlar", mevcut: siparisSatirIzi(Array.isArray(p.lines) ? (p.lines as SiparisSatiri[]) : []), gelen: siparisSatirIzi(Array.isArray(data.lines) ? (data.lines as SiparisSatiri[]) : []) },
        { ad: "orderNumber", mevcut: manualOrderNumber === null ? null : p.orderNumber, gelen: manualOrderNumber },
      ],
      collision: (p) => `Bu form daha önce kaydedilmiş: ${p.orderNumber}. Yeni sipariş için formu kapatıp yeniden açın.`,
      collisionEk: (p) => ({ orderNumber: p.orderNumber }),
      // Audit + alias terfisi yalnız gerçek create yolunda (ilk çağrıda yazıldı).
      respond: (p) => this.withUnitWarnings({ success: true, data: p, message: `Sipariş zaten oluşturulmuş (idempotent retry): ${p.orderNumber}` }),
    });
  }
