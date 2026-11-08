// =============================================================================
// Shipping Service / create-direct
// =============================================================================
// Toptan (çuvalsız) sevk: sevk edilebilir toplar ve createShipmentFromRolls.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  ShipmentStatus,
  ShipmentDestination,
  LoadUnitKind,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { p2002Mentions } from "../../utils/p2002";
import {
  readShipmentConfirmationEnabled,
  readShipmentLooseLoadEnabled,
  readShippingWeighRequiredEnabled,
} from "../system-setting.service";
import {
  assertOrderLinkAllowed,
  orderlessWarning,
  resolveOrderRequirement,
} from "../helpers/shipment-order-requirement.helper";
import {
  NON_SACKABLE_STATUSES,
} from "../helpers/sack-invariants.helper";
import { ApiResponse } from "../../types/api.types";
import {
  quickShipExportMessage,
  type ShipmentDestinationSource,
} from "../helpers/shipment-destination.helper";
import { planLoadUnits, type LoadUnitInput, type LoadUnitPlan } from "../helpers/load-unit.helper";
import { type DeliveryToInput } from "../helpers/shipment-delivery.helper";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import type { ShippingService } from "../shipping.service";
import { SHIPPABLE_ROLL_WHERE, nextSackNo, openLoadUnitTx, shipmentReplay, type AllocationAuditTrail, type ShipmentDestinationDecision, type ShippingServiceThis } from "./shared";

export async function findShippableRolls(params: {
    itemId: string;
    colorId?: string | null;
    warehouseId?: string | null;
    limit: number;
  }): Promise<ApiResponse<unknown>> {
    const rolls = await prisma.roll.findMany({
      where: {
        ...SHIPPABLE_ROLL_WHERE,
        itemId: params.itemId,
        ...(params.colorId ? { colorId: params.colorId } : {}),
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      },
      select: {
        id: true,
        barcode: true,
        currentQty: true,
        width: true,
        statusChangedAt: true,
        warehouseId: true,
        item: { select: { name: true } },
        color: { select: { name: true } },
      },
      orderBy: [
        { statusChangedAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      take: Math.min(Math.max(params.limit, 1), 200),
    });
    return {
      success: true,
      data: rolls.map((r) => ({
        id: r.id,
        barcode: r.barcode,
        qty: Number(r.currentQty),
        width: r.width === null ? null : Number(r.width),
        itemName: r.item?.name ?? "—",
        colorName: r.color?.name ?? null,
        warehouseId: r.warehouseId,
      })),
    };
  }

export async function createShipmentFromRolls(this: ShippingServiceThis, 
    ...args: Parameters<ShippingService["createShipmentFromRollsInner"]>
  ): ReturnType<ShippingService["createShipmentFromRollsInner"]> {
    const [data] = args;
    return shipmentReplay({ customerId: data.customerId, branchId: data.branchId ?? null, rollIds: data.rollIds }).run(data.clientToken, () =>
      this.createShipmentFromRollsInner(...args),
    );
  }

export async function createShipmentFromRollsInner(this: ShippingServiceThis, 
    data: {
      rollIds: string[];
      customerId: string;
      branchId?: string | null;
      orderIds?: string[];
      /** Siparişsiz sevk NİYETİ — `createShipment` ile AYNI sözleşme (Dilim 2). */
      orderless?: boolean;
      destination?: ShipmentDestination;
      destinationChosen?: boolean;
      procedureCode?: string | null;
      plateNumber?: string | null;
      driverName?: string | null;
      carrier?: string | null;
      clientToken?: string | null;
      /** İrsaliye açıklaması (annotation) — kurulumla AYNI tx'te yazılır; boş → yazılmaz. */
      dispatchNote?: string | null;
      /** Çuvalsız sevk: dökme/araba birimleri (top kümesini TAM böler); yoksa görünmez tek çuval. */
      loadUnits?: LoadUnitInput[] | null;
    } & DeliveryToInput,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const rollIds = [...new Set(data.rollIds)];
    if (rollIds.length === 0) throw AppError.badRequest("En az bir top seçilmeli");
    if (!data.customerId) throw AppError.badRequest("Müşteri seçilmeli");
    const orderIds = [...new Set(data.orderIds ?? [])];
    const branchId = data.branchId ?? null;
    // Yük birimi kapısı (fail-closed): bayrak kapalıyken dökme/araba isteği reddedilir.
    let unitPlans: LoadUnitPlan[] | null = null;
    if (data.loadUnits != null) {
      if (!(await readShipmentLooseLoadEnabled())) {
        throw AppError.badRequest(`Çuvalsız sevk (dökme / araba) bu kurulumda kapalı (${settingRowPath("shipmentLooseLoadEnabled")}).`, {
          code: "LOOSE_LOAD_DISABLED",
        });
      }
      unitPlans = planLoadUnits(data.loadUnits, rollIds);
    }

    // ⚠️ TARTI İSTEYEN HER REJİM HIZLI SEVKİ KAPATIR ve çuval yeni doğduğu için
    // tartısı YOKTUR. İki kaynak: (a) ihracat (her zaman, bayraktan bağımsız),
    // (b) `shipping.weighRequiredEnabled` (yurtiçi dahil).
    //
    // ⚠️ ALTERNATİF REDDEDİLDİ ("hızlı sevkte kg sor"): çuval kullanıcıya
    // GÖRÜNMEZ, tek tx içinde doğar — kg alanı eklemek hızlı sevkin varlık
    // sebebini (üç ekran → bir ekran) yok ederdi. Bayrağı açan kurulum bu bedeli
    // bilerek kabul eder; sürüm notunda operatör diliyle yazılıdır.
    // Yön tx içinde çözülür: ihracat olarak kilitli cari/şubede Hızlı Sevk KAPALIDIR.
    const weighRequired = await readShippingWeighRequiredEnabled();
    const assertQuickShipAllowed = (destination: ShipmentDestination, lockSource: ShipmentDestinationSource | null): void => {
      if (destination === ShipmentDestination.EXPORT) {
        throw AppError.badRequest(quickShipExportMessage(lockSource), { code: "QUICK_SHIP_EXPORT_UNSUPPORTED", source: lockSource });
      }
      if (!weighRequired) return;
      throw AppError.badRequest(
        "Bu kurulumda sevk öncesi çuval tartısı zorunlu — Hızlı Sevk çuvalı görünmeden ürettiği için tartılamaz. " +
          "Paketleme / Çuvallar ekranından çuvalı açıp tartın, sonra sevkiyatı kurun.",
        { code: "WEIGH_REQUIRED" },
      );
    };
    if (weighRequired) assertQuickShipAllowed(ShipmentDestination.DOMESTIC, null);
    // SİPARİŞ BAĞI KAPISI — `createShipment` ile AYNI yüklem (kaçış kapısı yok).
    const orderRequirement = await resolveOrderRequirement();
    assertOrderLinkAllowed(orderRequirement, { orderIds, orderless: data.orderless });
    await this.assertOrdersBelong(orderIds, data.customerId, branchId);

    // Ön kontrol (tx DIŞINDA, UX için): uygun olmayan topu ekranda söyle —
    // 20 top seçip tek satır yüzünden hepsini kaybetmek kötü bir deneyim.
    // Gerçek guard tx içindeki atomik claim'dir.
    const rolls = await prisma.roll.findMany({
      where: { id: { in: rollIds } },
      select: { id: true, barcode: true, status: true, sackId: true, shipmentId: true, warehouseId: true },
    });
    const problems: string[] = [];
    const ref = (r: { id: string; barcode: string | null }) => r.barcode ?? r.id.slice(0, 8);
    const found = new Set(rolls.map((r) => r.id));
    for (const missing of rollIds.filter((id) => !found.has(id))) {
      problems.push(`${missing.slice(0, 8)}: top bulunamadı`);
    }
    for (const r of rolls) {
      if (r.shipmentId) problems.push(`${ref(r)}: zaten bir sevkiyatta`);
      else if (r.sackId) problems.push(`${ref(r)}: bir çuvalın içinde — Paketleme ekranından çıkarın`);
      else if (NON_SACKABLE_STATUSES.includes(r.status)) problems.push(`${ref(r)}: durumu uygun değil (${r.status})`);
    }
    if (problems.length > 0) {
      throw AppError.badRequest(
        `${problems.length} top sevk edilemez: ${problems.slice(0, 8).join(" · ")}${problems.length > 8 ? " · …" : ""}`,
      );
    }
    // Toplar TEK depodan olmalı: bir sevkiyat tek yerden çıkar ve çuvalın
    // konumu tek değer taşır. Karışık seçim sessizce tek depoya damgalanırsa
    // envanter "bu depodan çıktı" derken mal başka depodaydı.
    const warehouses = new Set(rolls.map((r) => r.warehouseId ?? "—"));
    if (warehouses.size > 1) {
      throw AppError.badRequest("Seçilen toplar farklı depolarda — tek sevkiyat tek depodan çıkar.");
    }

    // `iz` = tahsis iz defteri (çekirdekten taşınır, tx DIŞINDA flush edilir).
    let result: { id: string; shipmentNo: string; iz: AllocationAuditTrail | null; yon: ShipmentDestinationDecision };
    result = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
          // 1) Yük birimi(leri) doğar — görünmez çuval ya da dökme/araba; konumu topların deposu.
          // 2) Toplar birim başına ATOMİK claim ile bağlanır (barkod değil id ile).
          const plans: LoadUnitPlan[] = unitPlans ?? [{ kind: LoadUnitKind.SACK, label: null, rollIds }];
          const sackIds: string[] = [];
          let claimedTotal = 0;
          for (const plan of plans) {
            const unit = await openLoadUnitTx(tx, {
              sackNo: await nextSackNo(tx),
              kind: plan.kind,
              label: plan.label,
              customerId: data.customerId,
              branchId,
              warehouseId: rolls[0]?.warehouseId ?? null,
            });
            sackIds.push(unit.id);
            const claimed = await tx.roll.updateMany({
              where: { id: { in: plan.rollIds }, ...SHIPPABLE_ROLL_WHERE },
              data: { sackId: unit.id },
            });
            claimedTotal += claimed.count;
          }
          if (claimedTotal !== rollIds.length) {
            throw AppError.conflict(
              `Toplar bu sırada başka bir akışa girdi (${claimedTotal}/${rollIds.length}) — sevkiyat kurulmadı, yenileyip tekrar deneyin.`,
            );
          }
          // 3) Normal sevkiyat çekirdeği — TAHSİS/İRSALİYE/İADE zinciri birebir aynı.
          const core = await this.createShipmentCoreTx(tx, {
            sackIds,
            customerId: data.customerId,
            branchId,
            orderIds,
            requestedDestination: data.destination,
            destinationChosen: data.destinationChosen === true,
            assertDestination: assertQuickShipAllowed,
            procedureCode: data.procedureCode,
            deliveryCustomerId: data.deliveryCustomerId,
            deliveryAddress: data.deliveryAddress,
            plateNumber: data.plateNumber,
            driverName: data.driverName,
            carrier: data.carrier,
            clientToken: data.clientToken,
            confirmationEnabled: await readShipmentConfirmationEnabled(),
            userId,
          });
          // 4) İrsaliye açıklaması (annotation; belge basılırken canlı çözülür, sürüm doğurmaz).
          const note = data.dispatchNote?.trim().slice(0, 500) || null;
          if (note) await tx.shipment.update({ where: { id: core.id }, data: { dispatchNote: note } });
          return core;
        }),
      undefined,
      (err) => {
        if (p2002Mentions(err, /clientToken/i)) return false;
        return true;
      },
    );

    const dispatched = !(await readShipmentConfirmationEnabled());
    // ⚠️ TAHSİS İZİ BURADA DA YAZILIR (merge, 2026-09-01). Hızlı Sevk yalnız
    // `feature/depo-mal-kabul`ta, tahsis iz defteri (`flushAllocationAudit`)
    // yalnız `adnansahin`de vardı — iki yol İLK KEZ bu merge'de yan yana geldi
    // ve çekirdek paylaşıldığı hâlde iz yalnız çuvaldan-sevk yolunda yazılıyordu.
    // Ayrışması, "aynı çekirdek aynı defteri tutar" varsayımını sessizce bozardı:
    // hızlı sevkle giden mal tahsis geçmişinde görünmezdi.
    await this.flushAllocationAudit(result.iz, userId);
    await this.logFirstShipmentDestination(result.yon, result.id, userId);
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SHIPMENT",
      recordId: result.id,
      newData: { kind: "QUICK_FROM_ROLLS", shipmentNo: result.shipmentNo, customerId: data.customerId, rollCount: rollIds.length, dispatchNote: data.dispatchNote?.trim() || null, loadUnits: unitPlans?.map((u) => ({ kind: u.kind, label: u.label, rollCount: u.rollIds.length })) ?? null, orderIds, orderless: data.orderless === true, destination: result.yon.destination },
    });
    // Hızlı sevk de ORTAK kancayı çağırır — çuvaldan sevkle davranış ayrışmasın.
    const draftNote = dispatched ? await this.maybeAutoDraftInvoiceAfterDispatch(result.id, userId) : null;
    // SİPARİŞSİZLİK UYARISI — `createShipment` ile AYNI metin, AYNI yardımcı.
    // 2026-09-03'e kadar bu yol hiç uyarı üretmiyordu: tablet Hızlı Sevk'ten
    // çıkan her sevkiyat sessizce tahsissizdi ve kimse görmüyordu.
    const quickWarnings: string[] = [];
    const quickOrderlessNote = orderlessWarning(orderRequirement, {
      orderIds,
      orderless: data.orderless,
    });
    if (quickOrderlessNote) quickWarnings.push(quickOrderlessNote);
    if (result.yon.warning) quickWarnings.push(result.yon.warning);
    return {
      success: true,
      data: {
        id: result.id,
        shipmentNo: result.shipmentNo,
        status: dispatched ? ShipmentStatus.DISPATCHED : ShipmentStatus.PLANNED,
        dispatched,
        rollCount: rollIds.length,
      },
      message:
        (dispatched
          ? `Sevk edildi: ${result.shipmentNo} (${rollIds.length} top)`
          : `Sevkiyat kuruldu (onay bekliyor): ${result.shipmentNo}`) + (draftNote ? ` · ${draftNote}` : ""),
      ...(quickWarnings.length > 0 ? { warnings: quickWarnings } : {}),
    };
  }
