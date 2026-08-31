// =============================================================================
// Return Service — Müşteri İade Girişi (RollReturn)
// =============================================================================
// QR ile sevk edilmiş top okutulur → doğrudan Hazır Depo'ya (WAREHOUSE) alınır.
// Akış:
//   1) lookupForReturn(barcode) → top + sevkiyat + ADAY siparişler (sevkiyatın
//      spec'e uyan siparişleri) + returnGradingEnabled bayrağı.
//   2) createReturn(input)      → tek transaction:
//        - RollReturn yaz (spec snapshot + neden + not + seçilen sipariş)
//        - Roll: SHIPPED→WAREHOUSE, shipmentId/sackId temizle; flag açık + override
//          verildiyse qualityGrade(+Id) güncelle (flag kapalıysa override YOK SAYILIR)
//        - SEVK MUHASEBESİNE DOKUNULMAZ (shippedQty/allocation) → sipariş kapalı kalır.
//   3) listReturns(req)         → İade Takibi raporu (filtre + toplam).
//
// GEVŞEK MODEL: top↔sipariş bağı yok; top yalnız geldiği sevkiyatı bilir. "Hangi
// siparişten" sorusu personelin sevkiyat aday siparişlerinden seçimiyle cevaplanır.
// =============================================================================

import { Prisma, RollStatus, OrderStatus, PrintedDocType, ShipmentStatus, WarehouseEventType } from "@prisma/client";
import { normalizeScanCode } from "../utils/code-format";
import { writeWarehouseMovement } from "./helpers/warehouse-ledger.helper";
import prisma from "../lib/prisma";
import {
  printedDocumentService,
  registerPrintedDocBuilder,
  type BuiltDocContent,
  type PrintedDocDb,
} from "./printed-document.service";
import { renderReturnDispatchHtml, type ReturnDispatchDoc } from "./document-render/return-dispatch.html";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { readReturnGradingEnabled } from "./system-setting.service";
import { ApiResponse } from "../types/api.types";
import type { Request } from "express";
import {
  parseQueryParams,
  isCursorRequested,
  buildWhereClause,
  applyDateRange,
} from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import { lockShipmentScopeTx } from "./helpers/shipment-locks.helper";

const D0 = () => new Prisma.Decimal(0);

// item kesin; renk/en ikisi de doluysa eşit olmalı, biri null ise gevşek eşleşir
// (shipping.service.allocate ile aynı semantik — fungible spec havuzu).
function specMatch(
  a: { itemId: string; colorId: string | null; width: Prisma.Decimal | null },
  b: { itemId: string; colorId: string | null; width: Prisma.Decimal | null }
): boolean {
  if (a.itemId !== b.itemId) return false;
  if (a.colorId != null && b.colorId != null && a.colorId !== b.colorId) return false;
  if (
    a.width != null &&
    b.width != null &&
    !new Prisma.Decimal(a.width).equals(new Prisma.Decimal(b.width))
  ) {
    return false;
  }
  return true;
}

// Rapor filtreleri — serbest metin alanlarında OR-contains + createdAt tarih penceresi.
// Arama kapsamı liste kolonlarıyla hizalı: neden/not + müşteri + sipariş no +
// ürün adı + top barkodu (iade hacmi düşük — contains kabul edilebilir).
const RETURN_SEARCH_FIELDS = ["reasonText", "note", "customer.name", "item.name"];
// Sipariş no + top barkodu üretilmiş ASCII kodlardır — katlanmaz.
const RETURN_CODE_SEARCH_FIELDS = ["order.orderNumber", "roll.barcode"];
const RETURN_DATE_FIELDS = ["createdAt"] as const;

/**
 * Satıra "irsaliyesi hangi kayda bağlı" bilgisini ekler.
 *
 * Çok kalemli iadede (`returnGroupId` dolu) belge YALNIZ grup liderinin id'sine
 * bağlıdır; istemci bir üye satırına tıklayıp kendi id'siyle belge isterse belge
 * bulunamaz (builder bilinçli `null` döner). Bu türetilmiş alan olmadan her
 * istemcinin aynı `?? id` kuralını kendi kopyalaması gerekirdi — ve kopyalamayan
 * istemcide "irsaliye yok" sessizliği doğardı.
 */
function withDocumentSourceId<T extends { id: string; returnGroupId: string | null }>(
  row: T,
): T & { documentSourceId: string } {
  return { ...row, documentSourceId: row.returnGroupId ?? row.id };
}

/**
 * Sayfadaki iade satırlarına "bu grup faturalanmış mı" bilgisini ekler
 * (H8 dikişi, 2026-08-14 — `attachBadges` deseni: SAYFA kapsamlı TEK ek sorgu).
 *
 * Panelin "Satış İade Faturası" düğmesi bu alana bakar: alan olmadan düğme
 * faturalanmış grupta da çıkar ve kullanıcı ancak backend 409'unda öğrenirdi
 * (sesli ama geç). Yalnız İPTAL EDİLMEMİŞ fatura sayılır — iptal edilen fatura
 * grubu yeniden faturalamaya açar (backend partial unique'i de aynı kuralı
 * uygular; iki katman aynı şeyi söyler).
 */
async function attachReturnInvoices<T extends { documentSourceId: string }>(
  rows: T[],
): Promise<Array<T & { invoiceDocNo: string | null }>> {
  if (rows.length === 0) return rows.map((r) => ({ ...r, invoiceDocNo: null }));
  const sourceIds = [...new Set(rows.map((r) => r.documentSourceId))];
  const invoices = await prisma.invoice.findMany({
    where: { returnGroupId: { in: sourceIds }, status: { not: "CANCELLED" } },
    select: { returnGroupId: true, docNo: true },
  });
  const byGroup = new Map(invoices.map((i) => [i.returnGroupId as string, i.docNo]));
  return rows.map((r) => ({ ...r, invoiceDocNo: byGroup.get(r.documentSourceId) ?? null }));
}

export class ReturnService {
  // =========================================================================
  // LOOKUP — QR okut → iade ekranı için top + aday siparişler
  // =========================================================================
  async lookupForReturn(barcode: string): Promise<ApiResponse<unknown>> {
    const code = normalizeScanCode(barcode);
    if (!code) throw AppError.badRequest("Barkod gerekli");

    const roll = await prisma.roll.findUnique({
      where: { barcode: code },
      select: {
        id: true,
        barcode: true,
        status: true,
        itemId: true,
        colorId: true,
        width: true,
        currentQty: true,
        qualityGrade: true,
        qualityGradeId: true,
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        qualityGradeRef: { select: { id: true, code: true, name: true, color: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            dispatchedAt: true,
            customer: { select: { id: true, code: true, name: true } },
            branch: { select: { id: true, name: true } },
            orders: {
              select: {
                order: {
                  select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    deadline: true,
                    lines: {
                      select: {
                        id: true,
                        itemId: true,
                        colorId: true,
                        width: true,
                        quantity: true,
                        shippedQty: true,
                        customerItemName: true,
                        customerColorName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound(`Top bulunamadı: ${code}`);
    if (roll.status !== RollStatus.SHIPPED) {
      throw AppError.badRequest(
        `Bu top sevk edilmemiş (durum: ${roll.status}) — iade alınamaz.`
      );
    }
    if (!roll.shipment) {
      throw AppError.badRequest("Bu topun sevkiyat bağı yok — iade alınamaz.");
    }

    const rollSpec = { itemId: roll.itemId, colorId: roll.colorId, width: roll.width };
    // Aday siparişler: sevkiyatın, İPTAL DEĞİL ve topun spec'ine uyan satırı olan siparişleri.
    const candidateOrders = roll.shipment.orders
      .map((so) => so.order)
      .filter((o) => o.status !== OrderStatus.CANCELLED && o.lines.some((l) => specMatch(l, rollSpec)))
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        deadline: o.deadline,
        matchingLines: o.lines
          .filter((l) => specMatch(l, rollSpec))
          .map((l) => ({
            lineId: l.id,
            quantity: l.quantity,
            shippedQty: l.shippedQty,
            customerItemName: l.customerItemName,
            customerColorName: l.customerColorName,
          })),
      }));

    const returnGradingEnabled = await readReturnGradingEnabled();

    return {
      success: true,
      data: {
        roll: {
          id: roll.id,
          barcode: roll.barcode,
          item: roll.item,
          color: roll.color,
          width: roll.width,
          currentQty: roll.currentQty,
          qualityGrade: roll.qualityGrade,
          qualityGradeRef: roll.qualityGradeRef,
        },
        shipment: {
          id: roll.shipment.id,
          shipmentNo: roll.shipment.shipmentNo,
          dispatchedAt: roll.shipment.dispatchedAt,
        },
        customer: roll.shipment.customer,
        branch: roll.shipment.branch,
        candidateOrders, // tek aday → frontend otomatik seçer
        returnGradingEnabled,
      },
    };
  }

  // =========================================================================
  // LOOKUP (ÇUVAL) — çuval kodu okut → sevk edilmiş toplarını topluca iade al
  // =========================================================================
  /**
   * Çuval bazlı iade girişi. `lookupForReturn`in çuval kardeşi: tek tek 20 barkod
   * okutmak yerine çuval kodu okutulur, içindeki SEVK EDİLMİŞ toplar listelenir,
   * operatör seçip tek nedenle topluca iade alır (tek belge, N defter satırı).
   *
   * Çuvalın toplarında `sackId` sevk sonrası da DURUR (sevk çuvalı bozmaz) — iade
   * alınan top ise `sackId`'sini kaybeder, yani bu sorgu zaten iade alınmışları
   * doğal olarak dışarıda bırakır; ayrı bir "iade edildi mi" süzgeci gerekmez.
   */
  async lookupSackForReturn(sackCode: string): Promise<ApiResponse<unknown>> {
    const code = normalizeScanCode(sackCode);
    if (!code) throw AppError.badRequest("Çuval kodu gerekli");

    const sack = await prisma.sack.findUnique({
      where: { sackNo: code },
      select: {
        id: true,
        sackNo: true,
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            dispatchedAt: true,
            customer: { select: { id: true, code: true, name: true } },
            branch: { select: { id: true, name: true } },
            orders: {
              select: {
                order: {
                  select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    deadline: true,
                    lines: { select: { itemId: true, colorId: true, width: true } },
                  },
                },
              },
            },
          },
        },
        rolls: {
          where: { status: RollStatus.SHIPPED },
          orderBy: { barcode: "asc" },
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            itemId: true,
            colorId: true,
            item: { select: { id: true, code: true, name: true } },
            color: { select: { id: true, code: true, name: true } },
            qualityGradeRef: { select: { id: true, code: true, name: true, color: true } },
          },
        },
      },
    });
    if (!sack) throw AppError.notFound(`Çuval bulunamadı: ${code}`);
    if (!sack.shipment) {
      throw AppError.badRequest("Bu çuval bir sevkiyata bağlı değil (depoda) — iade alınamaz.");
    }
    if (sack.shipment.status !== ShipmentStatus.DISPATCHED) {
      throw AppError.badRequest(
        "Bu çuvalın sevkiyatı henüz sevk edilmemiş — iade alınamaz. Planlı sevkiyattan çuval çıkarmak için Sevkiyat detayını kullanın."
      );
    }
    if (sack.rolls.length === 0) {
      throw AppError.badRequest("Bu çuvalda iade alınabilecek top kalmamış (hepsi iade alınmış olabilir).");
    }

    // Aday siparişler: sevkiyatın iptal EDİLMEMİŞ ve çuvaldaki TÜM topların spec'ine
    // uyan siparişleri. "En az birine uyan" listelemek yanıltıcı olurdu: sipariş
    // seçimi TÜM seçili toplara uygulanır ve backend her top için doğrular → uymayan
    // bir sipariş seçilebilir görünüp kaydetmede 400 verirdi.
    const candidateOrders = sack.shipment.orders
      .map((so) => so.order)
      .filter(
        (o) =>
          o.status !== OrderStatus.CANCELLED &&
          sack.rolls.every((r) =>
            o.lines.some((l) => specMatch(l, { itemId: r.itemId, colorId: r.colorId, width: r.width }))
          )
      )
      .map((o) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status, deadline: o.deadline }));

    return {
      success: true,
      data: {
        sack: { id: sack.id, sackNo: sack.sackNo },
        shipment: {
          id: sack.shipment.id,
          shipmentNo: sack.shipment.shipmentNo,
          dispatchedAt: sack.shipment.dispatchedAt,
        },
        customer: sack.shipment.customer,
        branch: sack.shipment.branch,
        rolls: sack.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          currentQty: r.currentQty,
          width: r.width,
          item: r.item,
          color: r.color,
          qualityGrade: r.qualityGrade,
          qualityGradeRef: r.qualityGradeRef,
        })),
        candidateOrders,
        returnGradingEnabled: await readReturnGradingEnabled(),
      },
    };
  }

  // =========================================================================
  // CREATE — iade al → top Hazır Depo'ya, defter kaydı
  // =========================================================================
  async createReturn(
    input: {
      /** Tekil iade (mobil + eski istemciler) — `rollIds` ile birlikte de verilebilir. */
      rollId?: string;
      /** ÇOKLU iade (çuval bazlı toplu kabul) — tek olay, tek belge, N defter satırı. */
      rollIds?: string[];
      orderId?: string | null;
      reasonId?: string | null;
      reasonText?: string | null;
      note?: string | null;
      qualityGradeId?: string | null;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const rollIds = [
      ...new Set([...(input.rollIds ?? []), ...(input.rollId ? [input.rollId] : [])]),
    ];
    if (rollIds.length === 0) throw AppError.badRequest("İade alınacak top seçilmeli");
    // Üst sınır: tek çuval ~30 top; 200 fazlasıyla yeter ve tx'i sınırlar.
    if (rollIds.length > 200) {
      throw AppError.badRequest("Tek seferde en fazla 200 top iade alınabilir");
    }

    const rolls = await prisma.roll.findMany({
      where: { id: { in: rollIds } },
      select: {
        id: true,
        barcode: true,
        status: true,
        itemId: true,
        colorId: true,
        width: true,
        currentQty: true,
        qualityGrade: true,
        qualityGradeId: true,
        shipmentId: true,
        sackId: true,
        // İade depo defterine "hangi depoya geri girdi" yazar (sevkte temizlenmez).
        warehouseId: true,
        shipment: {
          select: {
            id: true,
            customerId: true,
            orders: {
              select: {
                orderId: true,
                order: {
                  select: {
                    status: true,
                    lines: { select: { itemId: true, colorId: true, width: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (rolls.length !== rollIds.length) throw AppError.notFound("Top bulunamadı");

    const ref = (r: { barcode: string | null; id: string }) => r.barcode ?? r.id;
    for (const r of rolls) {
      if (r.status !== RollStatus.SHIPPED) {
        throw AppError.badRequest(
          `${ref(r)}: bu top sevk edilmemiş (durum: ${r.status}) — iade alınamaz.`
        );
      }
      if (!r.shipment || !r.shipmentId) {
        throw AppError.badRequest(`${ref(r)}: bu topun sevkiyat bağı yok — iade alınamaz.`);
      }
    }
    // TEK SEVKİYAT KURALI: bir iade belgesinin künyesi (müşteri + geldiği sevkiyat)
    // tektir. Farklı sevkiyatlardan toplar tek belgeye girseydi başlıktaki sevkiyat
    // no yalnız birini gösterir, diğerlerinin izi sessizce kaybolurdu.
    if (new Set(rolls.map((r) => r.shipmentId)).size > 1) {
      throw AppError.badRequest(
        "Seçilen toplar farklı sevkiyatlardan — tek iade belgesi tek sevkiyata aittir. Sevkiyat bazında ayrı ayrı iade alın."
      );
    }

    // Sıra korunur: liste sırası belge kalem sırasıdır (lider = ilk kalem).
    const orderedRolls = rollIds.map((id) => rolls.find((r) => r.id === id)!);
    const roll = orderedRolls[0]!;
    const customerId = roll.shipment!.customerId;

    // Sipariş atfı — verildiyse aday kriterini sağlamalı: bu sevkiyatta + iptal değil
    // + topun spec'ine (ürün+renk+en) uyan satırı olmalı (lookup'taki aday mantığının aynısı).
    // Çoklu iadede sipariş atfı TÜM toplara uygulanır → her top ayrı ayrı doğrulanır
    // (biri uymuyorsa hangisi olduğu barkodla söylenir; sessizce atlamak, o topun
    // iadesini siparişsiz bırakıp defteri yanıltırdı).
    let orderId: string | null = null;
    if (input.orderId) {
      const link = roll.shipment!.orders.find((o) => o.orderId === input.orderId);
      if (!link) {
        throw AppError.badRequest("Seçilen sipariş bu topun sevkiyatına ait değil");
      }
      if (link.order.status === OrderStatus.CANCELLED) {
        throw AppError.badRequest("İptal edilmiş sipariş seçilemez");
      }
      for (const r of orderedRolls) {
        const rollSpec = { itemId: r.itemId, colorId: r.colorId, width: r.width };
        if (!link.order.lines.some((l) => specMatch(l, rollSpec))) {
          throw AppError.badRequest(
            orderedRolls.length > 1
              ? `${ref(r)}: seçilen sipariş bu topun ürün/renk/en bilgisine uymuyor`
              : "Seçilen sipariş bu topun ürün/renk/en bilgisine uymuyor"
          );
        }
      }
      orderId = input.orderId;
    }

    // İade nedeni ZORUNLU — en az biri: katalog nedeni VEYA serbest metin açıklama.
    // (Nedensiz iade kalite geri-besleme verisini değersizleştirir.)
    const reasonText = input.reasonText?.trim() || null;
    if (!input.reasonId && !reasonText) {
      throw AppError.badRequest(
        "İade nedeni gerekli — katalogdan bir neden seçin veya açıklama yazın."
      );
    }
    // Neden seçildiyse var olmalı (pasif neden de seçilebilir — snapshot için sorun değil).
    if (input.reasonId) {
      const reason = await prisma.returnReason.findUnique({
        where: { id: input.reasonId },
        select: { id: true },
      });
      if (!reason) throw AppError.badRequest("İade nedeni bulunamadı");
    }

    // Kalite override — YALNIZ returnGradingEnabled açıkken honor edilir. Override
    // varsa topun gideceği raf = seçilen kalitenin returnTargetStatus'u (FİRE→SCRAP,
    // A1→A1_STOCK, 1.Kalite→WAREHOUSE). Bu kolon Tambur'un targetStatus'undan AYRIDIR
    // (Tambur'a dokunmaz). Override yoksa / flag kapalıysa top hep WAREHOUSE'a iner.
    const gradingEnabled = await readReturnGradingEnabled();
    let overrideQualityGradeId: string | null = null;
    let overrideQualityCode: string | null = null;
    let appliedStatus: RollStatus = RollStatus.WAREHOUSE;
    if (gradingEnabled && input.qualityGradeId) {
      const qg = await prisma.qualityGrade.findUnique({
        where: { id: input.qualityGradeId },
        select: { id: true, code: true, isActive: true, returnTargetStatus: true },
      });
      // Soft-delete giriş guard'ı (createInitialEntry/tambur/resolveQualityGradeIdStrict
      // ile parite): pasif kalite ile iade rafına atama yapılamaz.
      if (!qg || !qg.isActive) {
        throw AppError.badRequest("Kalite derecesi bulunamadı veya pasif");
      }
      overrideQualityGradeId = qg.id;
      overrideQualityCode = qg.code;
      appliedStatus = qg.returnTargetStatus ?? RollStatus.WAREHOUSE;
    }

    const note = input.note?.trim() || null;

    const created = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İFADESİ — sevkiyat kapsamlı advisory lock (F-SEV-ESZ-001).
      // `undoDispatch` (storno) AYNI kilidi alır. Aksi halde iki akış birbirini
      // yalnız TOP satırında görüyordu ve o satıra storno GEÇ dokunduğu için tek
      // yönlü koruma vardı: storno önce commit ederse aşağıdaki koşullu flip iadeyi
      // reddediyordu, ama iade önce commit ederse storno'nun iade sayımı 0 okumuş
      // olduğu için bloklamayı geçip sevkiyatı PLANNED'a çekiyordu (üretildi).
      // Yukarıda tüm topların TEK sevkiyata ait olduğu doğrulandı → tek kilit yeter.
      const lockShipmentId = orderedRolls[0]?.shipmentId ?? null;
      if (lockShipmentId) await lockShipmentScopeTx(tx, lockShipmentId);

      const createdIds: string[] = [];
      let totalQty = new Prisma.Decimal(0);
      // `tx` içinde Promise.all YASAK (pg adapter tek bağlantı) → seri döngü.
      for (const r of orderedRolls) {
        // Top iade rafına — appliedStatus (override yoksa WAREHOUSE; FİRE→SCRAP vb.).
        // KOŞULLU flip (status===SHIPPED): eşzamanlı/çift iade'de yalnız ilki başarılı
        // olur; ikincisi count=0 görür → tüm tx geri sarılır, çift RollReturn yazılmaz.
        // Çoklu iadede bu ATOMİKLİK GRUBUN TAMAMINI kapsar: bir top araya giren başka
        // bir iadeyle kapılmışsa TÜM grup geri sarılır (yarım iade belgesi doğmaz).
        const flip = await tx.roll.updateMany({
          where: { id: r.id, status: RollStatus.SHIPPED },
          data: {
            status: appliedStatus,
            shipmentId: null,
            sackId: null,
            ...(overrideQualityGradeId
              ? { qualityGradeId: overrideQualityGradeId, qualityGrade: overrideQualityCode! }
              : {}),
          },
        });
        if (flip.count === 0) {
          throw AppError.conflict(
            orderedRolls.length > 1
              ? `${ref(r)}: bu top zaten iade alınmış veya durumu değişmiş — hiçbir top iade alınmadı.`
              : "Bu top zaten iade alınmış veya durumu değişmiş."
          );
        }
        const qty = new Prisma.Decimal(r.currentQty);
        totalQty = totalQty.plus(qty);
        const rr = await tx.rollReturn.create({
          data: {
            rollId: r.id,
            fromShipmentId: r.shipmentId,
            customerId,
            orderId,
            itemId: r.itemId,
            colorId: r.colorId,
            width: r.width,
            qty,
            reasonId: input.reasonId ?? null,
            reasonText,
            note,
            qualityGradeId: overrideQualityGradeId,
            appliedStatus,
            receivedById: userId,
            // İade öncesi snapshot — iptal (geri al) topu bunlarla eski haline döndürür.
            prevSackId: r.sackId,
            prevQualityGrade: r.qualityGrade,
            prevQualityGradeId: r.qualityGradeId,
          },
          select: { id: true },
        });
        createdIds.push(rr.id);

        // DEPO DEFTERİ — mal müşteriden GERİ GELDİ ve depoya girdi. Hedef depo,
        // topun sevkten önce durduğu depodur: `Roll.warehouseId` sevkte
        // temizlenmiyor, dolayısıyla iade malı geldiği rafa döner (SCRAP'a düşse
        // bile "hangi depoya girdi" izi doğru kalır).
        await writeWarehouseMovement(tx, {
          rollId: r.id,
          eventType: WarehouseEventType.RETURN,
          qty,
          toWarehouseId: r.warehouseId ?? null,
          rollReturnId: rr.id,
          userId,
        });
      }

      // GRUP anahtarı = LİDERİN id'si. Tekil iadede alan NULL kalır → belge çözümü,
      // eski kayıtlar ve mobil akışı bugünküyle birebir aynı davranır.
      const leaderId = createdIds[0]!;
      if (createdIds.length > 1) {
        await tx.rollReturn.updateMany({
          where: { id: { in: createdIds } },
          data: { returnGroupId: leaderId },
        });
      }

      // RESMİ BELGE — iade irsaliyesini iade ANINDA dondur (sevk irsaliyesiyle aynı
      // desen: `shipping.service` dispatch tx'i). Eskiden belge yalnız biri ekranı
      // AÇTIĞINDA lazy-init ile kuruluyordu; yani hiç açılmayan iadenin resmi kaydı
      // hiç doğmuyordu (SVK2007260001'in 20.07.2026 iadesinde `printed_documents`
      // satırı yoktu) ve künye/şablon "ilk açan kişinin gününe" göre donuyordu.
      // Tx İÇİNDE: iade başarısızsa belge de geri sarılır.
      // ÇOK KALEMLİDE TEK BELGE: sourceId = lider (sektörde bir iade = bir irsaliye).
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.RETURN_DISPATCH,
        leaderId,
        userId,
      );
      return { ids: createdIds, leaderId, totalQty };
    });

    // Audit SATIR BAZLI kalır (defter satır bazlı) — grup kimliği her satıra yazılır.
    for (let i = 0; i < created.ids.length; i++) {
      const r = orderedRolls[i]!;
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "ROLL_RETURN",
        recordId: created.ids[i]!,
        newData: {
          rollId: r.id,
          barcode: r.barcode,
          fromShipmentId: r.shipmentId,
          customerId,
          orderId,
          qty: r.currentQty.toString(),
          reasonId: input.reasonId ?? null,
          qualityGradeId: overrideQualityGradeId,
          appliedStatus,
          ...(created.ids.length > 1 ? { returnGroupId: created.leaderId } : {}),
        },
      });
    }

    const shelfLabel =
      appliedStatus === RollStatus.SCRAP
        ? "hurdaya"
        : appliedStatus === RollStatus.A1_STOCK
          ? "2. kalite stoğa"
          : "Hazır Depo'ya";
    const multi = created.ids.length > 1;
    return {
      success: true,
      data: {
        id: created.leaderId,
        rollId: roll.id,
        appliedStatus,
        ...(multi
          ? { ids: created.ids, returnGroupId: created.leaderId, rollCount: created.ids.length }
          : {}),
      },
      message: multi
        ? `İade alındı — ${created.ids.length} top ${shelfLabel} eklendi (tek irsaliye)`
        : `İade alındı — top ${shelfLabel} eklendi`,
    };
  }

  // =========================================================================
  // LİSTE — İade Takibi raporu (filtre + toplam)
  // =========================================================================
  async listReturns(req: Request): Promise<Record<string, unknown>> {
    const params = parseQueryParams(req);

    // İptal durumu — Electron FilterBar `filter[cancelled]` ile, doğrudan/legacy
    // çağrılar `?cancelled=` ham param ile gönderir. RollReturn'de `cancelled`
    // kolonu YOK (yalnız `cancelledAt`); generic buildWhereClause'a `where.cancelled`
    // olarak sızarsa Prisma validation (HTTP 500) verir → filters'tan ayıklayıp
    // ayrı yorumluyoruz.
    const cancelledParam =
      (Array.isArray(params.filters.cancelled)
        ? params.filters.cancelled[0]
        : params.filters.cancelled) ??
      (req.query.cancelled as string | undefined) ??
      "active";
    delete params.filters.cancelled;

    // L (düşük bulgu): filter[] anahtarları whitelist'ten geçer — bilinmeyen
    // anahtar generic buildWhereClause üzerinden Prisma validation 500'üne
    // dönüşüyordu (base.service safeFilters davranışının yereli: sessiz düş).
    const ALLOWED_RETURN_FILTERS = new Set([
      "customerId", "orderId", "itemId", "colorId", "reasonId",
      "qualityGradeId", "rollId", "fromShipmentId", "receivedById",
    ]);
    for (const key of Object.keys(params.filters)) {
      if (!ALLOWED_RETURN_FILTERS.has(key)) delete params.filters[key];
    }

    const where = buildWhereClause(
      params.filters,
      RETURN_SEARCH_FIELDS,
      params.search,
      RETURN_CODE_SEARCH_FIELDS
    ) as Prisma.RollReturnWhereInput;
    applyDateRange(where as Record<string, unknown>, params, RETURN_DATE_FIELDS);

    // Ham query geri-uyumu (filter[] değil): customerId / orderId / itemId / reasonId
    const rawCustomerId = req.query.customerId as string | undefined;
    if (rawCustomerId) where.customerId = rawCustomerId;
    const rawOrderId = req.query.orderId as string | undefined;
    if (rawOrderId) where.orderId = rawOrderId;
    const rawItemId = req.query.itemId as string | undefined;
    if (rawItemId) where.itemId = rawItemId;
    const rawReasonId = req.query.reasonId as string | undefined;
    if (rawReasonId) where.reasonId = rawReasonId;

    // İptal filtresi: default yalnız AKTİF (iptal edilmemiş) — rapor/özet iptalleri
    // saymaz. "cancelled" → yalnız iptaller; "all" → hepsi (iptaller İptal rozetiyle).
    if (cancelledParam === "cancelled") where.cancelledAt = { not: null };
    else if (cancelledParam !== "all") where.cancelledAt = null;

    const select = {
      id: true,
      qty: true,
      width: true,
      reasonText: true,
      note: true,
      createdAt: true,
      roll: { select: { id: true, barcode: true } },
      item: { select: { id: true, code: true, name: true } },
      color: { select: { id: true, code: true, name: true } },
      customer: { select: { id: true, code: true, name: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
      reason: { select: { id: true, code: true, name: true, color: true } },
      qualityGrade: { select: { id: true, code: true, name: true, color: true } },
      appliedStatus: true,
      fromShipment: { select: { id: true, shipmentNo: true } },
      receivedBy: { select: { id: true, fullName: true } },
      cancelledAt: true,
      cancelReason: true,
      cancelledBy: { select: { id: true, fullName: true } },
      // Çok kalemli iade grubu — belge LİDERİN id'sine bağlıdır. İstemci irsaliyeyi
      // `documentSourceId` ile açar (aşağıda türetilir), satırın kendi id'siyle DEĞİL.
      returnGroupId: true,
    } as const;

    // Toplam (filtreli set) — "ne kadar iade geldi" (adet + metraj). where ile aynı.
    const summarize = async () => {
      const agg = await prisma.rollReturn.aggregate({
        where,
        _sum: { qty: true },
        _count: { _all: true },
      });
      return { count: agg._count._all, totalQty: agg._sum.qty ?? D0() };
    };

    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhere = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] }
        : where;
      const [items, summary] = await Promise.all([
        prisma.rollReturn.findMany({
          where: cursorWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select,
        }),
        wantTotal ? summarize() : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const data = await attachReturnInvoices(page.map(withDocumentSourceId));
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          // Electron useDataTable satır sayısını buradan okur; özet adet = toplam.
          ...(summary !== undefined ? { totalEstimate: summary.count } : {}),
        },
        ...(summary !== undefined ? { summary } : {}),
      };
    }

    const [items, summary] = await Promise.all([
      prisma.rollReturn.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        select,
      }),
      summarize(),
    ]);
    return { success: true, data: await attachReturnInvoices(items.map(withDocumentSourceId)), summary };
  }

  // =========================================================================
  // DETAY — tek iade kaydı (mobil geçmiş ekranı detay sheet'i)
  // =========================================================================
  async getReturnById(id: string): Promise<ApiResponse<unknown>> {
    const r = await prisma.rollReturn.findUnique({
      where: { id },
      select: {
        id: true,
        qty: true,
        width: true,
        reasonText: true,
        note: true,
        createdAt: true,
        cancelledAt: true,
        cancelReason: true,
        roll: { select: { id: true, barcode: true, status: true } },
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, code: true, name: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
        reason: { select: { id: true, code: true, name: true, color: true } },
        qualityGrade: { select: { id: true, code: true, name: true, color: true } },
        appliedStatus: true,
        fromShipment: { select: { id: true, shipmentNo: true } },
        receivedBy: { select: { id: true, fullName: true } },
        cancelledBy: { select: { id: true, fullName: true } },
        // ⚠️ `withDocumentSourceId` bu alana bakar; select'ten düşerse `undefined`
        // olur ve `?? id` sessizce satırın KENDİ id'sini döndürür → üye satırdan
        // irsaliye açılamaz (belge lidere bağlı). Bekçi: test_return_bulk_group §6.
        returnGroupId: true,
      },
    });
    if (!r) throw AppError.notFound("İade kaydı bulunamadı");
    return { success: true, data: withDocumentSourceId(r) };
  }

  // =========================================================================
  // İPTAL (geri al) — yanlış iade kabulü. Top iade öncesi haline döner (SHIPPED +
  // eski sevkiyat/çuval/kalite); RollReturn iptal işaretlenir (sebep + kim). Yalnız
  // top hâlâ iade-sonrası durumdaysa (WAREHOUSE + sevkiyatsız) yapılabilir; sonradan
  // yeniden sevk/kesim görmüşse engellenir. Sevk muhasebesi zaten dokunulmamıştı → simetrik.
  // =========================================================================
  async cancelReturn(
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();
    const trimmedReason = (reason ?? "").trim();
    if (trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi gerekli (en az 3 karakter).");
    }

    const rr = await prisma.rollReturn.findUnique({
      where: { id },
      select: {
        id: true,
        cancelledAt: true,
        createdAt: true,
        rollId: true,
        fromShipmentId: true,
        // İadede uygulanan kalite override'ı (varsa) — iptalde geri alma koşulu.
        qualityGradeId: true,
        prevSackId: true,
        prevQualityGrade: true,
        prevQualityGradeId: true,
        appliedStatus: true,
        // Çok kalemli iade belgesinin kaynağı — iptalde void mi revize mi kararı bununla.
        returnGroupId: true,
        roll: { select: { barcode: true, status: true, shipmentId: true, sackId: true } },
      },
    });
    if (!rr) throw AppError.notFound("İade kaydı bulunamadı");
    if (rr.cancelledAt) throw AppError.conflict("Bu iade zaten iptal edilmiş.");
    // İade anında topa uygulanan raf (override yoksa / legacy null → WAREHOUSE). Top hâlâ
    // tam bu raftaysa, sevkiyatsız VE çuvalsızsa iptal edilebilir; sonradan kesim /
    // yeniden sevk / yeni depo çuvalına okutma → engel. (İade topu çuvalsız bırakır —
    // sackId dolu = iade sonrası yeni çuvala girmiş; sessizce sökülmesin, çuval
    // tartısı/içeriği bayatlar.)
    const expectedStatus = rr.appliedStatus ?? RollStatus.WAREHOUSE;
    if (
      rr.roll.status !== expectedStatus ||
      rr.roll.shipmentId !== null ||
      rr.roll.sackId !== null
    ) {
      throw AppError.conflict(
        rr.roll.sackId !== null
          ? "Top iade sonrası bir depo çuvalına konmuş — önce çuvaldan çıkarın, sonra iadeyi iptal edin."
          : `Top iade sonrası işlem görmüş (durum: ${rr.roll.status}) — iade iptal edilemez.`
      );
    }
    if (!rr.fromShipmentId) {
      throw AppError.conflict("İadenin sevkiyat bağı yok — geri alınamaz.");
    }

    // RECENCY GUARD'I: iptal yalnız topun EN SON aktif iadesinde yapılabilir.
    // Sevk→iade R1→yeniden sevk→iade R2 geçmişinde R1 yanlışlıkla iptal
    // edilirse şekil-kontrolleri geçer ve top YILLAR ÖNCEKİ sevkiyata (R1.
    // fromShipmentId) SHIPPED yazılır, eski kalite etiketini giyerdi.
    const newerReturn = await prisma.rollReturn.findFirst({
      where: {
        rollId: rr.rollId,
        cancelledAt: null,
        createdAt: { gt: rr.createdAt },
      },
      select: { id: true },
    });
    if (newerReturn) {
      throw AppError.conflict(
        "Bu topun daha yeni bir iade kaydı var — önce onu iptal edin."
      );
    }

    // Eski çuval hâlâ duruyor mu? (sevkiyat iptalinde çuvallar silinmiş olabilir) →
    // yoksa çuvalsız geri yaz (FK ihlalini önle).
    let restoreSackId = rr.prevSackId;
    if (restoreSackId) {
      const sack = await prisma.sack.findUnique({
        where: { id: restoreSackId },
        select: { id: true },
      });
      if (!sack) restoreSackId = null;
    }

    await prisma.$transaction(async (tx) => {
      // KOŞULLU geri-yükleme: yalnız hâlâ iade rafında + sevkiyatsız + ÇUVALSIZ ise
      // (eşzamanlı koruması — pre-check'in atomik hali).
      const restore = await tx.roll.updateMany({
        where: { id: rr.rollId, status: expectedStatus, shipmentId: null, sackId: null },
        data: {
          status: RollStatus.SHIPPED,
          shipmentId: rr.fromShipmentId,
          sackId: restoreSackId,
          // Kalite override'ı İADEDE uygulandıysa (rr.qualityGradeId dolu) snapshot'a
          // geri dön. Koşul "override var mıydı"dır, "eski kalite dolu muydu" DEĞİL:
          // kalitesiz (null) sevk edilmiş top iade + A1 override + iptal edildiğinde
          // eski koşul override'ı geri almıyor, top SHIPPED'e A1 etiketiyle dönüyordu.
          // Snapshot null olabilir — null geri yazmak doğru davranıştır.
          ...(rr.qualityGradeId != null
            ? { qualityGrade: rr.prevQualityGrade, qualityGradeId: rr.prevQualityGradeId }
            : {}),
        },
      });
      if (restore.count === 0) {
        throw AppError.conflict("Top iade sonrası işlem görmüş — iade iptal edilemez.");
      }
      await tx.rollReturn.update({
        where: { id: rr.id },
        data: { cancelledAt: new Date(), cancelReason: trimmedReason, cancelledById: userId },
      });
      // BELGE — iki dal, çünkü belge artık ÇOK KALEMLİ olabilir (`returnGroupId`):
      //  • Gruptaki SON aktif kalem iptal edildiyse → belge VOIDED (İPTAL filigranı).
      //  • Hâlâ aktif kalem varsa → belge REVİZE (v+1): iptal edilen satır düşer,
      //    kalanlar için belge geçerli kalır. Tümünü void etmek, iadesi duran
      //    topların resmi kaydını sessizce yok ederdi.
      // Belge kaynağı GRUP LİDERİ'dir (tekil iadede lider = kaydın kendisi → eski
      // davranış birebir korunur).
      const docSourceId = rr.returnGroupId ?? rr.id;
      const remaining = await tx.rollReturn.count({
        where: {
          cancelledAt: null,
          OR: [{ returnGroupId: docSourceId }, { id: docSourceId }],
        },
      });
      if (remaining === 0) {
        await printedDocumentService.voidForSource(
          tx,
          PrintedDocType.RETURN_DISPATCH,
          docSourceId,
          trimmedReason,
        );
      } else {
        await printedDocumentService.reissueForSourceTx(
          tx,
          PrintedDocType.RETURN_DISPATCH,
          docSourceId,
          `Kalem iptali: ${trimmedReason}`,
          userId,
        );
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_RETURN",
      recordId: rr.id,
      newData: {
        kind: "CANCEL",
        reason: trimmedReason,
        rollId: rr.rollId,
        barcode: rr.roll.barcode,
        restoredToShipmentId: rr.fromShipmentId,
      },
    });

    return {
      success: true,
      data: { id: rr.id, rollId: rr.rollId },
      message: "İade iptal edildi — top sevkiyatına geri döndü",
    };
  }

  // =========================================================================
  // DÜZELT — yalnız defter alanları (neden + not). Topun statüsü / sevkiyat bağı /
  // kalitesi DEĞİŞMEZ (onu düzeltmek gerekirse iptal+yeniden iade). İptal edilmiş
  // kayıt düzeltilemez. Neden zorunluluğu burada da korunur (her ikisi de boşalamaz).
  // =========================================================================
  async editReturn(
    id: string,
    input: { reasonId?: string | null; reasonText?: string | null; note?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const rr = await prisma.rollReturn.findUnique({
      where: { id },
      select: { id: true, cancelledAt: true, reasonId: true, reasonText: true, note: true, rollId: true },
    });
    if (!rr) throw AppError.notFound("İade kaydı bulunamadı");
    if (rr.cancelledAt) throw AppError.conflict("İptal edilmiş iade düzeltilemez.");

    // undefined = dokunma; null/boş = temizle. Mevcut değerle birleştirip son hâli doğrula.
    const nextReasonId = input.reasonId !== undefined ? input.reasonId || null : rr.reasonId;
    const nextReasonText =
      input.reasonText !== undefined ? input.reasonText?.trim() || null : rr.reasonText;
    const nextNote = input.note !== undefined ? input.note?.trim() || null : rr.note;

    if (!nextReasonId && !nextReasonText) {
      throw AppError.badRequest(
        "İade nedeni gerekli — katalogdan bir neden seçin veya açıklama yazın."
      );
    }
    if (nextReasonId) {
      const reason = await prisma.returnReason.findUnique({
        where: { id: nextReasonId },
        select: { id: true },
      });
      if (!reason) throw AppError.badRequest("İade nedeni bulunamadı");
    }

    // F198: Atomik claim — eşzamanlı cancelReturn ile yarışta düzeltmeyi deterministik
    // reddet (cancelledAt guard update WHERE'inde — check-then-act değil).
    const updated = await prisma.rollReturn.updateMany({
      where: { id: rr.id, cancelledAt: null },
      data: { reasonId: nextReasonId, reasonText: nextReasonText, note: nextNote },
    });
    if (updated.count === 0) {
      throw AppError.conflict("İptal edilmiş iade düzeltilemez.");
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_RETURN",
      recordId: rr.id,
      oldData: { reasonId: rr.reasonId, reasonText: rr.reasonText, note: rr.note },
      newData: { kind: "EDIT", reasonId: nextReasonId, reasonText: nextReasonText, note: nextNote },
    });

    return {
      success: true,
      data: { id: rr.id, rollId: rr.rollId },
      message: "İade kaydı güncellendi",
    };
  }
}

export const returnService = new ReturnService();

// =============================================================================
// RESMİ BELGE — İade İrsaliyesi (PrintedDocument)
// =============================================================================
// Müşteriden dönen topun kabul belgesi. sourceId = GRUP LİDERİ RollReturn.id.
// İade iptali (cancelledAt) → belge VOIDED. Belge no yok → createdAt + kısa id'den
// okunur bir numara türetilir (IADE-GGAAYY-XXXXXX).
//
// ÇOK KALEMLİ (2026-08-05): çuval bazlı toplu kabulde her top yine ayrı `RollReturn`
// satırıdır (defter satır bazlı kalır — brüt kuralı, `prevSackId` geri-ekleme, iade
// raporları), ama BELGE tektir: sourceId = liderin id'si, kalemler `returnGroupId`
// ile toplanır. Tekil iadede (`returnGroupId` NULL) davranış AYNEN eskisi gibi.
async function buildReturnDispatchDoc(
  db: PrintedDocDb,
  returnId: string,
): Promise<BuiltDocContent | null> {
  const rr = await db.rollReturn.findUnique({
    where: { id: returnId },
    select: {
      id: true, qty: true, width: true, createdAt: true, reasonText: true, note: true,
      cancelledAt: true, cancelReason: true, returnGroupId: true,
      customer: { select: { code: true, name: true } },
      order: { select: { orderNumber: true } },
      fromShipment: { select: { shipmentNo: true } },
      reason: { select: { name: true } },
      item: { select: { name: true } },
      color: { select: { name: true } },
      qualityGrade: { select: { name: true } },
      roll: { select: { barcode: true } },
      receivedBy: { select: { fullName: true } },
    },
  });
  if (!rr) return null;
  // ÜYE id'siyle İKİNCİ BİR BELGE DOĞMASIN. Çok kalemli iadede belge YALNIZ liderin
  // id'sine bağlıdır (`returnGroupId === id`). Bir üyenin id'siyle çağrılırsa (eski
  // istemci, elle URL, lazy-init) burada `null` döneriz: aksi halde `getCurrent`
  // lazy-init ile aynı grubun İKİNCİ kopyasını farklı bir sourceId altında dondurur
  // ve tek iade olayı iki resmi belgeyle görünürdü. İstemciler `documentSourceId`
  // alanını kullanır (liste + detay yanıtlarında döner).
  if (rr.returnGroupId && rr.returnGroupId !== rr.id) return null;

  // Grup ÜYELERİ — lider dahil, İPTAL EDİLENLER HARİÇ. Bir kalem iptal edilince
  // belge `reissue` ile tazelenir ve o satır düşer (sektörde iade belgesi revize
  // edilir; tüm kalemler iptal olursa belge VOIDED'e çekilir — `cancelReturn`).
  const groupId = rr.returnGroupId ?? rr.id;
  const members = await db.rollReturn.findMany({
    where: {
      cancelledAt: null,
      OR: [{ returnGroupId: groupId }, { id: groupId }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      qty: true, width: true,
      item: { select: { name: true } },
      color: { select: { name: true } },
      qualityGrade: { select: { name: true } },
      roll: { select: { barcode: true } },
    },
  });

  const d = rr.createdAt;
  const p = (x: number) => String(x).padStart(2, "0");
  const documentNo = `IADE-${p(d.getDate())}${p(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}-${rr.id.slice(0, 6).toUpperCase()}`;

  const doc: ReturnDispatchDoc = {
    header: {
      documentNo,
      customerName: rr.customer.name,
      customerCode: rr.customer.code,
      date: rr.createdAt.toISOString(),
      fromShipmentNo: rr.fromShipment?.shipmentNo ?? null,
      orderNo: rr.order?.orderNumber ?? null,
    },
    // `line` her zaman LİDERİN kalemidir — eski snapshot şekliyle uyum (kaldırılamaz).
    line: {
      barcode: rr.roll?.barcode ?? null,
      itemName: rr.item.name,
      colorName: rr.color?.name ?? null,
      width: rr.width != null ? Number(rr.width) : null,
      qty: Number(rr.qty),
      grade: rr.qualityGrade?.name ?? "",
    },
    // `lines` YALNIZ çok kalemlide yazılır: tekil iadede alan hiç doğmaz ve
    // renderer `[line]`e düşer → çıktı bugünküyle bayt-bayt aynı kalır.
    ...(members.length > 1
      ? {
          lines: members.map((m) => ({
            barcode: m.roll?.barcode ?? null,
            itemName: m.item.name,
            colorName: m.color?.name ?? null,
            width: m.width != null ? Number(m.width) : null,
            qty: Number(m.qty),
            grade: m.qualityGrade?.name ?? "",
          })),
        }
      : {}),
    reason: rr.reason?.name ?? rr.reasonText ?? null,
    note: rr.note ?? null,
    receivedBy: rr.receivedBy?.fullName ?? null,
  };

  return {
    documentNo,
    voidInfo: rr.cancelledAt ? { reason: rr.cancelReason ?? null, at: rr.cancelledAt } : null,
    doc: doc as unknown as Record<string, unknown>,
  };
}

registerPrintedDocBuilder(PrintedDocType.RETURN_DISPATCH, {
  fresh: buildReturnDispatchDoc,
  renderHtml: renderReturnDispatchHtml,
  resolveProfileId: async (db, sourceId) => {
    const r = await db.rollReturn.findUnique({
      where: { id: sourceId },
      select: { customer: { select: { documentProfileId: true } } },
    });
    return r?.customer?.documentProfileId ?? null;
  },
});
