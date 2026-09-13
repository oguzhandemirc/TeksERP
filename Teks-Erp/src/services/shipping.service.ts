// =============================================================================
// Shipping Service — Çuval Havuzu (Sack pool) + Sevkiyat (Shipment)
// =============================================================================
// ÇUVAL DEPO MODELİ (top→sipariş bağı YOK; mühür/rezerv YOK). Akış:
//   1) Çuval aç → openSack(customerId?)  → Sack (depoda; müşteri OPSİYONEL)
//   2) Topları/kartelaları çuvala okut → scanIntoSack(sackId) → Roll/Swatch.sackId
//   3) (Opsiyonel) brüt tart + kod gir → weighSack. Çuval depoda, her an düzenlenebilir.
//   4) Çuval(lar) seç → createShipment({sackIds, customerId, branchId?, orderIds?, plate/driver?})
//      → seçili siparişlere spec-FIFO tahsis (distributeSacksToLines) yazılır. Sevk onayı
//      KAPALI (varsayılan) ise AYNI adımda dispatch → DISPATCHED (toplar SHIPPED, tahsisler
//      → shippedQty). AÇIK ise PLANNED kalır; (5) Sevk Kapısı → dispatchShipment → DISPATCHED.
//   İptal → cancelShipment (PLANNED): çuvallar depoya döner, tahsisler silinir. Kapı önü YOK.
//
// Düşüş yalnız sevkte, elle seçilen siparişlere. Rezerv/packedQty yok. Fazla/eşleşmeyen/
// siparişsiz sevk edilebilir (uyarı). Çuval İÇERİK tutar (Roll/Swatch.sackId) → irsaliyede
// ürün-bazlı döküm. Tahsis "hangi top" değil "ne kadar metraj" (SackAllocation defteri).
// =============================================================================

import {
  Prisma,
  InvoiceStatus,
  RollStatus,
  SackWeightSource,
  ShipmentStatus,
  ShipmentDestination,
  PrintedDocType,
  PrintedDocStatus,
  LabelKind,
  OrderStatus,
  WarehouseEventType,
  ShipmentEventType,
  SackWeighingKind,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { writeWarehouseMovements } from "./helpers/warehouse-ledger.helper";
import { assertRollsHaveWarehouse } from "./helpers/warehouse-stock.helper";
import { writeShipmentEvent } from "./helpers/shipment-event.helper";
import { weightWarning } from "./helpers/measurement-threshold.helper";
import { AppError } from "../utils/app-error";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { AuditService } from "./audit.service";
import {
  printedDocumentService,
  registerPrintedDocBuilder,
  type BuiltDocContent,
  type PrintedDocDb,
} from "./printed-document.service";
import {
  renderShipmentDispatchHtml,
  type ShipmentDispatchDoc,
} from "./document-render/shipment-dispatch.html";
import { renderQualityCertificateHtml, type QualityCertificateDoc } from "./document-render/quality-certificate.html";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { p2002Mentions } from "../utils/p2002";
import {
  readShipmentConfirmationEnabled,
  readShipmentManualSackCountEnabled,
  readShipmentUndoSameDayOnly,
  readShippingManualWeightRestrictedEnabled,
  readShippingWeighRequiredEnabled,
  readSimulatedWeightEnabled,
} from "./system-setting.service";
// Dilim 2 — sevkiyat davranış bayraklarının TEK karar noktaları. Kapılar burada
// DEĞİL helper'da yaşıyor ki üç yazma yolu (çuvaldan sevk · hızlı sevk · siparişe
// bağla) aynı yüklemi paylaşsın; kopyalanan bir guard zamanla ayrışır ve fark en
// kötü yerde (sessiz kaçış kapısı) ortaya çıkar.
import {
  assertOrderLinkAllowed,
  orderlessWarning,
  resolveOrderRequirement,
} from "./helpers/shipment-order-requirement.helper";
import {
  assertManualWeightAllowed,
  assertSacksWeighed,
} from "./helpers/shipping-weigh-gate.helper";
// "Müşterideki ad" zinciri (2026-09-04) — etiketle AYNI cascade, tek kaynak.
import { loadShipmentCustomerNames } from "./helpers/shipment-customer-name.helper";
import { loadCustomerNamePolicy } from "./helpers/quality-role.helper";
import { batchLoadAliases, batchLoadAliasesMulti, resolveName } from "./helpers/customer-name.helper";
import { specMatch } from "./helpers/allocation.helper";
import {
  resolveOrderCoverage,
  assertCoverageAllowed,
} from "./helpers/shipment-coverage.helper";
import {
  readShippingAllocWidthToleranceCm,
  readShippingAllowOverAllocation,
  readShippingDocItemNameMode,
  readShippingDocCekiNameMode,
  readShippingDocProductColorSplit,
} from "./system-setting.service";
import { resolveDocNameMode, type DocNameMode } from "./document-render/shipment-name-mode";
import {
  assertInvoiceTraceAllowed,
  invoiceTraceWarning,
  resolveInvoiceMode,
} from "./helpers/shipping-invoice-mode.helper";
import { factoryDayStart } from "../constants/time";
import { resolveTargetWarehouseId } from "./helpers/warehouse.helper";
import { dailyCodePrefix, isDailyCode, nextDailySeq, normalizeScanCode } from "../utils/code-format";
import {
  touchWarehouseSackTx,
  touchShipmentPlannedTx,
  lockShipmentScopeTx,
} from "./helpers/shipment-locks.helper";
import {
  NON_SACKABLE_STATUSES,
  SACK_ABSENT_STATUSES,
  sackBlockMessage,
} from "./helpers/sack-invariants.helper";
import {
  clearSackTagsOnDispatchTx,
  restoreSackTagsOnUndoDispatchTx,
} from "./sack-tag.service";
import {
  D0,
  distributeSacksToLines,
  type PoolSack,
  type SackAllocLine,
} from "./helpers/allocation.helper";
import { recomputeOrderStatusForOrdersTx, touchOrderLinesTx } from "./helpers/order-status.helper";
import { ACTIVE_LINE } from "./helpers/order-line-scope.helper";
import { ACTIVE_TAG_SELECT, ACTIVE_TAG_WHERE, toTagBadges } from "./helpers/sack-tag.helper";
import { buildHideCancelledWhere } from "./helpers/hidden-status.helper";
import { collectBoundKeys } from "./helpers/label-context-fit";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import type { Request } from "express";
import { uyari } from "../lib/logger";
import { PackingGroupService } from "./packing-group.service";
import {
  parseQueryParams,
  isCursorRequested,
  buildWhereClause,
  applyDateRange,
  buildTextSearch,
  resolveSortBy,
} from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";

// Re-export saf primitifler (geriye uyum — eskiden bu dosyada tanımlıydı).
export {
  specMatch,
  allocate,
  computeLoadedByLine,
  type RollSpec,
  type LineForAlloc,
} from "./helpers/allocation.helper";

// Sevkiyat liste filtreleri (Electron FilterBar + arama).
// `orders.some.order.orderNumber`: muhasebeci müşteriden gelen soruyu SİPARİŞ NO ile
// arar (sevk no'yu bilmez). ShipmentOrder to-many pivot → `.some.` zorunlu;
// buildTextSearch nokta-notasyonunu ve some'ı destekler (query-parser.ts:159).
// Metin (katlanır) ↔ kod (katlanmaz) ayrımı: plaka/şoför/nakliyeci SERBEST
// METİNDİR (operatör "34 abc 123" ya da "Mehmet Şahin" yazar), sevk no ve
// sipariş no ise üretilmiş ASCII koddur.
const SHIPMENT_SEARCH_FIELDS = ["plateNumber", "driverName", "carrier", "customer.name"];
const SHIPMENT_CODE_SEARCH_FIELDS = ["shipmentNo", "orders.some.order.orderNumber"];
// destination = Shipment skaler alanı (DOMESTIC|EXPORT) → buildWhereClause halleder.
// itemId/colorId/hasReturns/invoiced BİLİNÇLİ dışarıda: relation alt-sorgusu (some) ya da
// türetilmiş null-testi olarak elle kurulur.
const SHIPMENT_FILTER_FIELDS = ["status", "customerId", "branchId", "destination"] as const;
const SHIPMENT_DATE_FIELDS = ["createdAt", "dispatchedAt"] as const;

/** Muhasebe dönem bandı — filtreli kümenin tamamı (`?withSummary=true` ile istenir). */
export interface ShipmentListSummary {
  shipmentCount: number;
  totalMeters: number;
  totalKg: number;
}

/**
 * HIZLI SEVK uygunluk yüklemi — **TEK KAYNAK**.
 *
 * İki yer okur ve ayrışmaları YASAK: `findShippableRolls` (FIFO ÖNERİSİ) ve
 * `createShipmentFromRolls`'un tx içindeki atomik CLAIM'i. Kopyalansaydı arıza
 * sessiz ve kullanıcıyı suçlayan cinsten olurdu: sistem topu KENDİSİ önerir,
 * kullanıcı "Sevk Et"e basar, aynı sistem "bu top uygun değil" der.
 *
 * Öneri tarafı ek olarak depo/kumaş/renk ile daralır; uygunluk tanımı aynıdır.
 */
const SHIPPABLE_ROLL_WHERE = {
  sackId: null,
  shipmentId: null,
  status: { notIn: NON_SACKABLE_STATUSES },
} as const;

// `NON_SACKABLE_STATUSES` + `SACK_ABSENT_STATUSES` artık `helpers/sack-invariants.helper`
// içinde TEK kaynak (üstte import edilir). Buradaki dosya-yerel kopya kaldırıldı: aynı
// küme `label.service`'te de (SHIPPED hariç varyantıyla) yaşıyordu ve yeni guard'lar
// kartela/tambur/fason servislerinden erişecek — üçüncü bir kopya kaçınılmaz olarak
// ayrışırdı. Sayım/belge yüzeyleri `SACK_ABSENT_STATUSES` (SHIPPED SAYILIR), çuvala
// giriş/sevk guard'ları `NON_SACKABLE_STATUSES` (SHIPPED de bloklu) kullanır.

// ---------------------------------------------------------------------------
// Sequence helpers — SVK + GGAAYY + NNNN (sevkiyat), CV + GGAAYY + NNNN (çuval)
// ---------------------------------------------------------------------------
// Günlük sıralı numara — collation-güvenli (gte+startsWith; U+FFFF sentinel glibc'de
// ignorable olduğundan yasak). Sayısal max+1 → gün içi monotonik.
//
// ⚠️ `tx` ZORUNLU ve İLK parametre (emsaller: `subcontractor.service.nextDirectShipmentNo`,
// `nextPrefixedSequenceTx`, `kartela.service.nextKartelaDocSequence`/`nextSwatchSequence`).
// Üç çağrı yerinin ÜÇÜ DE bir `prisma.$transaction` callback'inin içinde; eskiden global
// `prisma` client'ından okunuyordu ve bunun iki sonucu vardı:
//   1) HAVUZ: interaktif tx bir pg bağlantısını TUTARKEN ikinci bir bağlantı ödünç
//      alınıyordu (`lib/prisma.ts` max:30). Yoğunlukta kendi kendini bekleme riski.
//   2) GÖRÜNÜRLÜK: aynı tx'in KENDİ commit edilmemiş satırını göremiyordu → aynı tx'te
//      iki çuval açan bir yol yazılsaydı ikisi AYNI numarayı alır, `sackNo @unique`
//      P2002 verir, `withBarcodeRetry` deterministik olarak aynı çakışmayı 5 kez
//      tekrarlar ve 409 ile biterdi. Bugün öyle bir yol YOK (sack.create yalnız
//      `openSack` + `splitSack`, ikisi de tek çuval) — yani bu değişiklik bir davranışı
//      bozmuyor, kilitli bir kapıyı açıyor.
// İZOLASYON NOTU: tüm tx'ler READ COMMITTED (repoda `isolationLevel` kullanılmıyor) →
// BAŞKA tx'lerin commit'lerini görme davranışı global client ile BİREBİR AYNI kalır;
// okuma düz SELECT (kilit almaz), deadlock profili değişmez.
//
// ⚠️ ÇAĞRIYI TX CALLBACK'İNİN DIŞINA TAŞIMA: `withBarcodeRetry` her denemede `fn`'i
// baştan çağırır ve o sırada YENİ bir tx açılır; numara okuması içeride kaldığı sürece
// her denemede TAZE olur. Dışarı hoist edilirse retry aynı numarayı sonsuza tekrarlar.
//
// `export` ETME: modül-private kalmalı — export edilirse başka servisler tx'siz
// çağırabilir ve "tx içinde global client" sorunu başka dosyada yeniden doğar.
async function nextShipmentNo(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = dailyCodePrefix("SVK");
  const todays = await tx.shipment.findMany({
    where: { shipmentNo: { gte: prefix, startsWith: prefix } },
    select: { shipmentNo: true },
  });
  const seq = nextDailySeq(todays.map((s) => s.shipmentNo), prefix);
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

async function nextSackNo(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = dailyCodePrefix("CV");
  const todays = await tx.sack.findMany({
    where: { sackNo: { gte: prefix, startsWith: prefix } },
    select: { sackNo: true },
  });
  const seq = nextDailySeq(todays.map((s) => s.sackNo), prefix);
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** Tahsis yazımının audit izi — tx dışına taşınır (best-effort). */
interface AllocationAuditTrail {
  shipmentId: string;
  yazilan: { orderLineId: string; qty: number }[];
  atlanan: { orderLineId: string; need: number }[];
  /**
   * SEVK ANINDA hiçbir sipariş satırına bağlanamayan metraj (BULGU-T3-009).
   *
   * ⚠️ Neden kaydediliyor: sevk anında tahsis yeniden hesaplanınca, talebi aşan
   * mal artık siparişe YAZILMIYOR (doğrusu bu — eskiden 200 m'lik kaleme 500 m
   * yazılıyordu ve fazlalık hiçbir ekranda görünmüyordu). Ama "yazılmıyor" ile
   * "yok" aynı şey değildir: mal fiziksel olarak müşteriye gitti. Bu alan
   * olmasaydı bir sessizliğin yerine BAŞKA bir sessizlik koymuş olurduk.
   * `undefined` = sevk anı dışında hesaplanan iz (kuruluş/onarım yolu).
   */
  tahsissizMetraj?: number;
}

/**
 * Onarım önizlemesinin satır tablosu — motorun istediği `SackAllocLine` biçimi
 * ile ekranın istediği okunur bağlam (sipariş no / ürün / renk / en) TEK
 * geçişte kurulur; ikisi ayrı yerlerde kurulsaydı satır eşleşmesi elle
 * yapılırdı ve sessizce kayabilirdi.
 */
function onarimSatirlariniKur(
  orders: {
    order: {
      orderNumber: string; branchId: string | null; createdAt: Date; deadline: Date | null;
      lines: {
        id: string; itemId: string; colorId: string | null; width: Prisma.Decimal | null;
        quantity: Prisma.Decimal; shippedQty: Prisma.Decimal; createdAt: Date;
        item: { name: string }; color: { name: string } | null;
      }[];
    };
  }[],
): {
  bilgi: Map<string, { orderNumber: string; itemName: string; colorName: string | null; width: number | null; acikOnce: number }>;
  lines: SackAllocLine[];
} {
  const bilgi = new Map<string, { orderNumber: string; itemName: string; colorName: string | null; width: number | null; acikOnce: number }>();
  const lines = orders.flatMap((so) =>
    so.order.lines.map((l) => {
      const acik = Number(l.quantity) - Number(l.shippedQty);
      bilgi.set(l.id, {
        orderNumber: so.order.orderNumber,
        itemName: l.item.name,
        colorName: l.color?.name ?? null,
        width: l.width == null ? null : Number(l.width),
        acikOnce: Math.round(acik * 1000) / 1000,
      });
      return {
        id: l.id, itemId: l.itemId, colorId: l.colorId, width: l.width,
        branchId: so.order.branchId,
        need: new Prisma.Decimal(Math.max(acik, 0)),
        deadline: so.order.deadline,
        orderDate: so.order.createdAt,
        lineCreatedAt: l.createdAt,
      };
    }),
  );
  return { bilgi, lines };
}

/**
 * Dağıtım sonucunu ekranın tablosuna çevirir. Aynı sipariş satırına BİRDEN ÇOK
 * çuvaldan gelen metraj TEK satırda toplanır — kullanıcı çuval kırılımını değil
 * "hangi siparişe kaç metre" sorusunu soruyor. En çok yazılan satır üstte.
 */
function onarimKalemleriniKur(
  dagitim: { orderLineId: string; qty: Prisma.Decimal }[],
  bilgi: Map<string, { orderNumber: string; itemName: string; colorName: string | null; width: number | null; acikOnce: number }>,
) {
  const satirToplam = new Map<string, number>();
  for (const d of dagitim) {
    satirToplam.set(d.orderLineId, (satirToplam.get(d.orderLineId) ?? 0) + Number(d.qty));
  }
  return [...satirToplam.entries()]
    .map(([lineId, yazilacak]) => {
      const b = bilgi.get(lineId)!;
      const y = Math.round(yazilacak * 1000) / 1000;
      return {
        orderLineId: lineId,
        orderNumber: b.orderNumber,
        itemName: b.itemName,
        colorName: b.colorName,
        width: b.width,
        acikOnce: b.acikOnce,
        yazilacak: y,
        acikSonra: Math.round((b.acikOnce - y) * 1000) / 1000,
      };
    })
    .sort((a2, b2) => b2.yazilacak - a2.yazilacak);
}

export class ShippingService {
  // =========================================================================
  // ÇUVAL DEPO HAVUZU — çuval aç / okut / tart (sevkiyattan bağımsız)
  // =========================================================================

  /** A4 replay: token'la daha önce açılmış çuvalı openSack yanıt şekliyle döner. */
  private async readOpenSackReplay(
    clientToken: string,
    gelen: { customerId?: string | null; branchId?: string | null },
  ): Promise<ApiResponse<unknown> | null> {
    const s = await prisma.sack.findUnique({
      where: { clientToken },
      select: {
        id: true, sackNo: true, weightKg: true, customerId: true, branchId: true,
        customer: { select: { name: true } },
        branch: { select: { name: true, code: true } },
      },
    });
    if (!s) return null;
    // ⚠️ AYNI TOKEN, FARKLI GÖVDE (BULGU-T4-003). Eskiden token'la bulunan çuval
    // KOŞULSUZ dönüyordu: A müşterisi için açılan çuval belirsiz düşer, operatör
    // B müşterisini seçip tekrar dener, sunucu A'nın çuvalını "Çuval açıldı"
    // diyerek döndürür ve toplar YANLIŞ MÜŞTERİNİN çuvalına okutulurdu.
    // ⚠️ Müşterisiz çuval MEŞRUDUR (genel stok, depo havuzu modeli) — `null` ile
    // `null` aynı sayılır; kapı yalnız GERÇEK farkta kapanır.
    assertReplayPayloadMatches(
      [
        { ad: "customerId", mevcut: s.customerId, gelen: gelen.customerId },
        { ad: "branchId", mevcut: s.branchId, gelen: gelen.branchId },
      ],
      "Bu istemci anahtarı FARKLI bir müşteri/şube için açılmış bir çuvala ait. " +
        "Ekranı yenileyip çuvalı tekrar açın.",
      { sackNo: s.sackNo },
    );
    return {
      success: true,
      data: {
        id: s.id, sackNo: s.sackNo, weightKg: s.weightKg, customerId: s.customerId, branchId: s.branchId,
        customerName: s.customer?.name ?? null, branchName: s.branch?.name ?? null, branchCode: s.branch?.code ?? null,
      },
      message: "Çuval açıldı",
    };
  }

  /**
   * Yeni çuval aç (depoda). shipmentId NULL, seq NULL. Müşteri OPSİYONEL — bilinen sipariş
   * için atanabilir, yoksa boş (genel stok); müşteri/şube sevk kurulurken de atanır. Çuval
   * sistem kodu (sackNo) otomatik üretilir. Mühür yok — depoda her an düzenlenebilir.
   */
  async openSack(
    data: { customerId?: string | null; branchId?: string | null; weightKg?: number | null; sackNo?: string | null; clientToken?: string | null },
    userId?: string,
    /** F221 deseni — verilmezse elle-tartı kısıtı ATLANIR (dahili çağrı). */
    opts?: { permissions?: string[] }
  ): Promise<ApiResponse<unknown>> {
    // ── ARKA KAPI DA KAPALI (Dilim 2) ─────────────────────────────────────────
    // Açılışta verilen `weightKg` doğrudan `weightSource = MANUAL` yazar (bugün
    // hiçbir istemci göndermiyor, yol geri uyum için duruyor). Yalnız `weighSack`e
    // guard konsaydı bayrak FAIL-OPEN olurdu — ve daha kötüsü, o yolla yazılan kg
    // raporda "elle girildi" sayılır ama hiçbir kapıdan geçmemiş olurdu.
    if (data.weightKg != null) {
      assertManualWeightAllowed({
        restricted: await readShippingManualWeightRestrictedEnabled(),
        permissions: opts?.permissions,
      });
    }
    // İdempotent replay (A4): aynı token'la tekrar gelen istek (timeout-retry /
    // çift dokunuş) yeni BOŞ çuval açmaz — ilk denemede açılan çuvalı döner.
    if (data.clientToken) {
      const cached = await this.readOpenSackReplay(data.clientToken, { customerId: data.customerId, branchId: data.branchId });
      if (cached) return cached;
    }
    if (data.weightKg != null && !(data.weightKg > 0)) {
      throw AppError.badRequest("Geçerli bir kg girilmeli");
    }
    let customerId: string | null = null;
    let customerName: string | null = null;
    if (data.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, isActive: true, name: true },
      });
      if (!customer || !customer.isActive) throw AppError.badRequest("Geçerli bir müşteri seçilmeli");
      customerId = customer.id;
      customerName = customer.name;
    }
    let branchId: string | null = null;
    let branchName: string | null = null;
    let branchCode: string | null = null;
    if (data.branchId) {
      if (!customerId) throw AppError.badRequest("Şube seçmek için önce müşteri seçilmeli");
      const branch = await prisma.customerBranch.findUnique({
        where: { id: data.branchId },
        select: { id: true, customerId: true, isActive: true, name: true, code: true },
      });
      if (!branch || !branch.isActive || branch.customerId !== customerId) {
        throw AppError.badRequest("Şube bu müşteriye ait değil");
      }
      branchId = branch.id;
      branchName = branch.name;
      branchCode = branch.code ?? null;
    }

    const manualSackNo = data.sackNo?.trim() || null;
    let sack: { id: string; sackNo: string; weightKg: Prisma.Decimal | null; customerId: string | null; branchId: string | null };
    try {
      sack = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const sackNo = manualSackNo ?? (await nextSackNo(tx));
        // Çuval doğduğu yerde damgalanır (createInitialEntry'nin top için yaptığının
        // çuval karşılığı). Tek depolu fabrikada varsayılan depo yazılır ve hiçbir
        // yüzey okumaz — sıfır görünür fark; çok depoluda "bu depoda hangi çuvallar"
        // ve çuval-bütün transferin guard'ı buradan beslenir.
        const sackWarehouseId = await resolveTargetWarehouseId(tx, null);
        return tx.sack.create({
          data: {
            sackNo,
            clientToken: data.clientToken ?? null,
            customerId,
            branchId,
            warehouseId: sackWarehouseId,
            shipmentId: null,
            seq: null,
            weightKg: data.weightKg != null ? new Prisma.Decimal(data.weightKg) : null,
            // Açılışta kg verilirse kaynağı MANUAL sayılır: bu yol bir kantar okuması
            // DEĞİL (operatörün formda yazdığı değer) ve simüle guard'ından geçmez.
            // Kaynağı boş bırakmak "tartılmış ama kaynağı bilinmiyor" satırı üretirdi.
            // NOT: bugün hiçbir istemci burada weightKg göndermiyor (mobil/Electron
            // tartıyı ayrı `weighSack` ucundan yazıyor) — yol geri uyum için duruyor.
            ...(data.weightKg != null
              ? { weightSource: SackWeightSource.MANUAL, weighedById: userId ?? null, weighedAt: new Date() }
              : {}),
          },
          select: { id: true, sackNo: true, weightKg: true, customerId: true, branchId: true },
        });
      }),
      undefined,
      (err) => {
        // clientToken P2002'si retry EDİLMEZ (retry hep aynı token'ı yazar) —
        // propagate edilir, aşağıdaki catch replay yanıtına çevirir (WO create emsali).
        if (p2002Mentions(err, /clientToken/i)) return false;
        // F61 emsali: manuel sackNo P2002'si retry EDİLMEZ (retry hep aynı sabit
        // değeri yazar; 5 tur sonra yanıltıcı "Barkod üretimi 5 denemede başarısız"
        // dönerdi) — doğrudan anlamlı 409. Otomatik modda sackNo sequence yarışı
        // taze nextSackNo ile retry edilir (mevcut davranış).
        if (manualSackNo && p2002Mentions(err, /sackNo/i)) {
          throw AppError.conflict(`Bu çuval kodu zaten kullanılıyor: ${manualSackNo}`);
        }
        return true;
      },
    );
    } catch (err) {
      // Yarış replay'i: pre-check ile create arası aynı token'lı ikinci istek kazandıysa.
      if (data.clientToken && p2002Mentions(err, /clientToken/i)) {
        const cached = await this.readOpenSackReplay(data.clientToken, { customerId: data.customerId, branchId: data.branchId });
        if (cached) return cached;
      }
      throw err;
    }
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: { sackNo: sack.sackNo, customerId, branchId },
    });
    return {
      success: true,
      data: { ...sack, customerName, branchName, branchCode },
      message: "Çuval açıldı",
    };
  }

  /**
   * Depodaki çuvalın MÜŞTERİSİNİ (ve şubesini) değiştir — yalnız `shipmentId=null`
   * (sevkiyata girmemiş) çuvalda. Top→müşteri bağı olmadığından içerik varken de
   * güvenli; müşteri `null`'a (müşterisiz genel stok) çekilebilir. Şube verilirse yeni
   * müşteriye ait olmalı; müşteri boşsa/değişince şube temizlenir. `openSack`'in
   * müşteri/şube doğrulamasıyla aynı kural. Atomik claim: eşzamanlı sevkiyat kurulumu
   * araya girerse (çuval PLANNED'e kaçarsa) 409.
   */
  async reassignSackCustomer(
    sackId: string,
    data: { customerId?: string | null; branchId?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { id: true, sackNo: true, shipmentId: true, customerId: true, branchId: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) {
      throw AppError.conflict("Çuval bir sevkiyata atanmış — müşteri değiştirilemez (önce sevkiyattan çıkarın)");
    }

    // Müşteri opsiyonel (null = müşterisiz genel stok). Ad'ı da al → yanıtta dön
    // (istemci editör rozetini fetch'siz günceller).
    let customerId: string | null = null;
    let customerName: string | null = null;
    if (data.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, isActive: true, name: true },
      });
      if (!customer || !customer.isActive) throw AppError.badRequest("Geçerli bir müşteri seçilmeli");
      customerId = customer.id;
      customerName = customer.name;
    }
    // Şube opsiyonel — müşteri gerektirir + o müşteriye ait olmalı.
    let branchId: string | null = null;
    let branchName: string | null = null;
    let branchCode: string | null = null;
    if (data.branchId) {
      if (!customerId) throw AppError.badRequest("Şube seçmek için önce müşteri seçilmeli");
      const branch = await prisma.customerBranch.findUnique({
        where: { id: data.branchId },
        select: { id: true, customerId: true, isActive: true, name: true, code: true },
      });
      if (!branch || !branch.isActive || branch.customerId !== customerId) {
        throw AppError.badRequest("Şube bu müşteriye ait değil");
      }
      branchId = branch.id;
      branchName = branch.name;
      branchCode = branch.code ?? null;
    }

    // ⚠️ TEK TRANSACTION (D1, 2026-07-30): müşteri claim'i ile etiket bayatlaması
    // ESKİDEN AYRI çalışıyordu — claim commit oluyor, ardından sarılmamış bayatlama
    // çağrısı geliyordu. Bayatlama patlarsa (DB timeout, bağlantı düşmesi) sonuç:
    // müşteri DEĞİŞMİŞ ama `labelDirty` işaretsiz + audit HİÇ yazılmamış + istemci
    // 500 görüp "değişmedi" sanıyor → yeni müşterinin şablonuyla basılması gereken
    // etiketler ESKİ şablonla sevke gidiyor ve hatanın izi de yok. Emsal: `splitSack`
    // her şeyi tek tx'te yapıyor. Audit tx DIŞINDA kalır ve bu DOĞRU: tx geri sararsa
    // hiçbir şey değişmemiştir, audit de olmamalıdır.
    const labelsStale = await prisma.$transaction(async (tx) => {
      // Atomik claim — hâlâ depoda (shipmentId=null) olmalı.
      const claimed = await tx.sack.updateMany({
        where: { id: sackId, shipmentId: null },
        data: { customerId, branchId },
      });
      if (claimed.count !== 1) throw AppError.conflict("Çuval az önce bir sevkiyata girdi — yenileyin.");

      // Müşteri değişince İÇİNDEKİ topların etiketi bayatlar MI? Tetikleyici "müşteri
      // değişti" DEĞİL: etikete müşteri adı basılmıyor, tek fark MÜŞTERİYE ÖZEL ŞABLON
      // (CustomerTemplateRoute). Eski ve yeni müşteri aynı şablona çözülüyorsa (ikisi
      // de rotasız → bağlam varsayılanı) fiziksel etiket geçerli kalır, dokunmayız.
      return sack.customerId === customerId
        ? 0
        : await this.markSackLabelsStaleOnCustomerChange(tx, sackId, sack.customerId, customerId);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: sackId,
      oldData: { customerId: sack.customerId, branchId: sack.branchId },
      newData: { customerId, branchId, labelsStale },
    });
    return {
      success: true,
      data: { id: sackId, customerId, customerName, branchId, branchName, branchCode, labelsStale },
      message: labelsStale > 0
        ? `Çuval müşterisi güncellendi — ${labelsStale} topun etiketi yeni müşterinin şablonuyla yeniden basılmalı`
        : "Çuval müşterisi güncellendi",
    };
  }

  /**
   * Müşteri değişiminde ÇUVALIN ve İÇİNDEKİ TOPLARIN etiketini "bayat" işaretler —
   * YALNIZ etkin şablon değişiyorsa. Döner: işaretlenen top adedi (çuvalın kendi
   * bayrağı `Sack.labelDirty` ayrıca yazılır).
   *
   * Etkin şablon = `CustomerTemplateRoute(müşteri, kind)` ?? bağlam varsayılanı.
   * Top kind'ı renginden türer (renksiz → ROLL_RAW, renkli → ROLL_FINISHED,
   * `label-routing.resolver` ile aynı kural); ÇUVAL için kind = SACK.
   * Eski ve yeni müşterinin rotası aynı şablona çıkıyorsa (çoğu kurulumda ikisi de
   * rotasız) HİÇBİR ŞEY yapılmaz — gereksiz "yeniden bas" uyarısı operatörü körleştirir.
   *
   * SACK dalı 2026-07-30'da eklendi: çuval etiketinin müşteri rotası o tarihte
   * canlandırıldı (öncesinde `buildSackRenderInput` `customerId` geçirmiyordu →
   * rota ölüydü, dolayısıyla çuval etiketi müşteri değişiminden ETKİLENMİYORDU).
   */
  private async markSackLabelsStaleOnCustomerChange(
    /** ⚠️ tx ZORUNLU: müşteri claim'i ile AYNI transaction'da koşmalı (D1) — ayrı
     *  koşarsa claim commit olur ama bayatlama/audit kaybolabilir. */
    tx: Prisma.TransactionClient,
    sackId: string,
    oldCustomerId: string | null,
    newCustomerId: string | null,
  ): Promise<number> {
    const rolls = await tx.roll.findMany({
      where: { sackId },
      select: { id: true, colorId: true },
    });

    // ÇUVAL kind'ı her zaman sorgulanır (çuvalın kendi etiketi topların varlığından
    // BAĞIMSIZ — boş çuvalın da basılı etiketi olabilir), top kind'ları içerikten.
    const rollKinds = [
      ...new Set(rolls.map((r) => (r.colorId == null ? LabelKind.ROLL_RAW : LabelKind.ROLL_FINISHED))),
    ];
    const kinds = [...new Set([...rollKinds, LabelKind.SACK])];
    const routesFor = async (cid: string | null): Promise<Map<LabelKind, string>> => {
      if (!cid) return new Map();
      const rows = await tx.customerTemplateRoute.findMany({
        where: { customerId: cid, kind: { in: kinds } },
        select: { kind: true, templateId: true },
      });
      return new Map(rows.map((r) => [r.kind, r.templateId]));
    };
    // SIRALI await (tx client'ta Promise.all YASAK — pg adapter tek connection).
    const oldRoutes = await routesFor(oldCustomerId);
    const newRoutes = await routesFor(newCustomerId);

    // Şablonu DEĞİŞEN kind'lar (yok → bağlam varsayılanı; iki taraf da yok = değişmedi).
    const changed = new Set(kinds.filter((k) => (oldRoutes.get(k) ?? null) !== (newRoutes.get(k) ?? null)));
    if (changed.size === 0) return 0;

    // ÇUVALIN KENDİ etiketi — top sayısından bağımsız.
    if (changed.has(LabelKind.SACK)) {
      await tx.sack.updateMany({ where: { id: sackId, labelDirty: false }, data: { labelDirty: true } });
    }

    const affected = rolls
      .filter((r) => changed.has(r.colorId == null ? LabelKind.ROLL_RAW : LabelKind.ROLL_FINISHED))
      .map((r) => r.id);
    if (affected.length === 0) return 0;
    // Yalnız henüz işaretsizleri güncelle (count gerçek değişimi yansıtsın).
    return (
      await tx.roll.updateMany({
        where: { id: { in: affected }, labelDirty: false },
        data: { labelDirty: true },
      })
    ).count;
  }

  /**
   * Barkod okut → top ya da kartelayı depodaki çuvala ekle (depodaki serbest mal). Başka
   * depodaki çuvaldaki bir top bu çuvala okutulursa TAŞINIR (sevkiyattaki çuval reddedilir).
   */
  async scanIntoSack(
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
    if (isDailyCode(code, "CV")) {
      throw AppError.badRequest(
        `${code} bir ÇUVAL kodu, top barkodu değil — çuvala eklemek için TOP barkodunu okutun.`,
      );
    }
    const roll = await prisma.roll.findUnique({
      where: { barcode: code },
      select: { id: true, status: true, shipmentId: true, sackId: true, barcode: true, currentQty: true, sack: { select: { shipmentId: true } } },
    });
    if (roll) {
      // Zaten bu çuvalda
      if (roll.sackId === data.sackId) {
        return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId }, message: "Top zaten bu çuvalda" };
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
        return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId, currentQty: roll.currentQty }, message: "Top bu çuvala taşındı" };
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
      return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId, currentQty: roll.currentQty }, message: "Top çuvala eklendi" };
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
        await touchWarehouseSackTx(tx, data.sackId);
        const moved = await tx.swatch.updateMany({ where: { id: swatch.id, sackId: fromSackId, shipmentId: null }, data: { sackId: data.sackId } });
        if (moved.count !== 1) throw AppError.conflict("Kartela bu sırada taşınmış/çıkarılmış — tekrar deneyin");
        await this.markSackContentChangedTx(tx, [fromSackId, data.sackId]);
      });
      await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: swatch.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: swatch.barcode } });
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela bu çuvala taşındı" };
    }
    if (swatch.shipmentId) throw AppError.conflict("Kartela bir sevkiyatta");
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      const claimed = await tx.swatch.updateMany({ where: { id: swatch.id, shipmentId: null, sackId: null, cancelledAt: null }, data: { sackId: data.sackId } });
      if (claimed.count === 0) throw AppError.conflict("Kartela az önce başka bir akışa girdi — tekrar deneyin.");
      await this.markSackContentChangedTx(tx, [data.sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: swatch.id, newData: { kind: "SACK_SCAN", sackId: data.sackId, barcode: swatch.barcode } });
    return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela çuvala eklendi" };
  }

  /**
   * Sevkiyata SEÇEREK kartela ekle (barkodsuz) — açık havuz çuvalına N adet FIFO claim.
   */
  async addKartelaToSack(
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
        where: { itemId: data.itemId, colorId: data.colorId, shipmentId: null, sackId: null, cancelledAt: null },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: data.count,
      });
      if (candidates.length < data.count) {
        throw AppError.conflict(`Yeterli kartela stoğu yok — istenen ${data.count}, mevcut ${candidates.length}. Listeyi yenileyin.`);
      }
      const claimIds = candidates.map((c) => c.id);
      const claimed = await tx.swatch.updateMany({ where: { id: { in: claimIds }, shipmentId: null, sackId: null, cancelledAt: null }, data: { sackId: data.sackId } });
      if (claimed.count !== data.count) throw AppError.conflict("Kartelalardan biri az önce başka bir akışa girdi — tekrar deneyin.");
      await this.markSackContentChangedTx(tx, [data.sackId]);
      return claimIds;
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: ids[0], newData: { kind: "KARTELA_SELECT_ADD", sackId: data.sackId, itemId: data.itemId, colorId: data.colorId, count: data.count } });
    return { success: true, data: { added: ids.length, swatchIds: ids, sackId: data.sackId }, message: "Kartela çuvala eklendi" };
  }

  /** Topu açık çuvaldan çıkar → serbest depoya döner (sackId null). */
  async removeRollFromSack(
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

  /** Kartelayı açık çuvaldan çıkar. */
  async removeSwatchFromSack(
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
      const removed = await tx.swatch.updateMany({ where: { id: data.swatchId, sackId, shipmentId: null }, data: { sackId: null } });
      if (removed.count !== 1) throw AppError.conflict("Kartela bu sırada çıkarılmış/taşınmış — tekrar deneyin");
      await this.markSackContentChangedTx(tx, [sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: data.swatchId, newData: { kind: "SACK_UNSCAN", sackId: null } });
    return { success: true, data: {}, message: "Kartela çuvaldan çıkarıldı" };
  }

  /** Topu bir depodaki çuvaldan diğerine taşı. */
  async moveRollToSack(
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

  /**
   * "Çuvalı dağıt" — çuvalın SEÇİLİ (rollIds/swatchIds) veya TÜM (ikisi de boşsa)
   * top/kartelalarını serbest depoya çıkar (sackId=null). Çuval boş kalır ama SİLİNMEZ
   * (silmek isteyen `removeSack(withContents)` kullanır). Yalnız depodaki çuval — sevkiyata
   * atanmış çuval reddedilir (touchWarehouseSackTx). İçerik değiştiği için tartı sıfırlanır.
   */
  async distributeSackContents(
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
        const swatchWhere: Prisma.SwatchWhereInput = all
          ? { sackId: data.sackId, shipmentId: null }
          : { id: { in: swatchSel! }, sackId: data.sackId, shipmentId: null };
        removedSwatches = (await tx.swatch.updateMany({ where: swatchWhere, data: { sackId: null } })).count;
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

  /**
   * DEFTER ONARIMI — SİPARİŞE YAZILAMAMIŞ SEVKİYATLAR (2026-09-06).
   *
   * PROBLEM (ölçüldü, fabrika yedeği 2026-09-05): sevk edilmiş 89 sevkiyatın
   * 42'sinde çuval içeriği sipariş defterine tam yazılmamış — 11.384,7 m. Bunların
   * 42'sinde de sipariş SEÇİLİYDİ; sorun seçim değil YAZILAMAMA.
   * `scripts/tahsis_teshis.ts` sebepleri sınıflandırdı ve en büyük küme
   * "bugün YAZILABİLİRDİ" (15.905 m / 407 top) — yani spec de kapasite de bugün
   * uygun; sevk anında değildi (kapasite doluydu ya da sipariş sonradan büyüdü).
   *
   * BU LİSTE O KÜMEYİ BULUR. Yazma YOK.
   *
   * ⚠️ Onarımın kendisi `setShipmentOrders` ile yapılır — defteri sıfırdan kurar,
   * sipariş toplamlarını yeniden hesaplar ve irsaliyeyi v+1 olarak dondurur.
   * Bu yüzden onarım AYRI BİR YETKİ ister (`shipping:repair-allocation`).
   */
  async listRepairableShipments(): Promise<ApiResponse<unknown>> {
    const sevkiyatlar = await prisma.shipment.findMany({
      where: { status: ShipmentStatus.DISPATCHED, orders: { some: {} } },
      select: {
        id: true, shipmentNo: true, dispatchedAt: true,
        customer: { select: { id: true, name: true } },
        sacks: {
          select: {
            branchId: true,
            rolls: { where: { status: { notIn: SACK_ABSENT_STATUSES } }, select: { itemId: true, colorId: true, width: true, currentQty: true } },
            allocations: { select: { qty: true } },
          },
        },
        orders: {
          select: {
            order: {
              select: {
                id: true, orderNumber: true, branchId: true,
                lines: { select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true } },
              },
            },
          },
        },
      },
      orderBy: { dispatchedAt: "desc" },
    });

    const enTolerans = await readShippingAllocWidthToleranceCm();
    const satirlar: unknown[] = [];
    for (const sh of sevkiyatlar) {
      const icerik = sh.sacks.reduce((a2, sk) => a2 + sk.rolls.reduce((b2, r) => b2 + Number(r.currentQty), 0), 0);
      const yazilan = sh.sacks.reduce((a2, sk) => a2 + sk.allocations.reduce((b2, x) => b2 + Number(x.qty), 0), 0);
      const bosluk = Math.round((icerik - yazilan) * 1000) / 1000;
      if (bosluk <= 0.001) continue;

      const kalemler = sh.orders.flatMap((so) =>
        so.order.lines.map((l) => ({
          itemId: l.itemId, colorId: l.colorId, width: l.width,
          branchId: so.order.branchId,
          kalan: Number(l.quantity) - Number(l.shippedQty),
        })),
      );
      // "Bugün yazılabilir mi" — motorun kendi yüklemleri: spec + şube + kapasite.
      let onarilabilir = 0;
      for (const sk of sh.sacks) {
        for (const r of sk.rolls) {
          const uygun = kalemler.some(
            (l) =>
              specMatch(r, l, enTolerans) &&
              (sk.branchId ?? null) === (l.branchId ?? null) &&
              l.kalan > 0.001,
          );
          if (uygun) onarilabilir += Number(r.currentQty);
        }
      }
      satirlar.push({
        shipmentId: sh.id,
        shipmentNo: sh.shipmentNo,
        dispatchedAt: sh.dispatchedAt,
        customer: sh.customer,
        orderNumbers: sh.orders.map((so) => so.order.orderNumber),
        // ⚠️ `orderNumbers` KALDIRILMADI: sahadaki panel onu okuyor. Yeni alan
        // numarayı TIKLANABİLİR yapmak için id taşır — numara ile sipariş aramak
        // ikinci bir okuma yolu (ve mükerrer numarada yanlış siparişi açardı).
        orders: sh.orders.map((so) => ({ id: so.order.id, orderNumber: so.order.orderNumber })),
        icerikMetraj: Math.round(icerik * 1000) / 1000,
        yazilanMetraj: Math.round(yazilan * 1000) / 1000,
        bosluk,
        /** Bugün yeniden denense yazılabilecek metraj — onarımın beklenen kazancı. */
        onarilabilirMetraj: Math.round(Math.min(onarilabilir, bosluk) * 1000) / 1000,
      });
    }
    return { success: true, data: satirlar };
  }

  /**
   * ONARIM ÖNİZLEMESİ — HANGİ SATIRA KAÇ METRE (2026-09-07 saha isteği).
   *
   * ⚠️ NEDEN AYRI UÇ: liste "bu sevkiyatta 1374 m yazılabilir" diyordu ve onay
   * ekranı da aynı toplamı tekrar ediyordu. Kullanıcının sözü: *"neler olacağını
   * tam anlayamıyorum, daha çok yazı istemiyorum, anlayabilmek istiyorum."*
   * Anlamak için gereken tek şey TOPLAM DEĞİL DAĞILIM: hangi siparişin hangi
   * ürün-renk-en satırına kaç metre gidecek, o satır sonra ne kadar açık kalacak.
   *
   * ⚠️ ÖLÇÜM MOTORUN KENDİSİYLE YAPILIR (`distributeSacksToLines`) — onarımın
   * çağıracağı fonksiyonun aynısı. Ayrı bir "tahmin" yazılsaydı önizleme ile
   * sonuç sessizce ayrışırdı ve önizleme YALAN söylerdi; bu depoda o sınıfın adı
   * "ayrışan yüzey"dir. Yazma YOK.
   */
  async previewRepairAllocation(shipmentId: string): Promise<ApiResponse<unknown>> {
    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true,
        customer: { select: { id: true, name: true } },
        sacks: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true, branchId: true,
            rolls: {
              where: { status: { notIn: SACK_ABSENT_STATUSES } },
              select: { itemId: true, colorId: true, width: true, currentQty: true },
            },
            allocations: { select: { qty: true } },
          },
        },
        orders: {
          select: {
            order: {
              select: {
                id: true, orderNumber: true, branchId: true, createdAt: true, deadline: true,
                lines: {
                  select: {
                    id: true, itemId: true, colorId: true, width: true,
                    quantity: true, shippedQty: true, createdAt: true,
                    item: { select: { name: true } },
                    color: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");

    const enTolerans = await readShippingAllocWidthToleranceCm();
    const fazlaSevk = await readShippingAllowOverAllocation();

    const { bilgi, lines } = onarimSatirlariniKur(sh.orders);

    const dagitim = distributeSacksToLines(
      sh.sacks.map((sk) => ({
        sackId: sk.id,
        branchId: sk.branchId,
        rolls: sk.rolls.map((r) => ({ itemId: r.itemId, colorId: r.colorId, width: r.width, currentQty: r.currentQty })),
      })),
      lines,
      enTolerans,
      fazlaSevk,
    );

    const kalemler = onarimKalemleriniKur(dagitim, bilgi);

    const icerik = sh.sacks.reduce((a2, sk) => a2 + sk.rolls.reduce((c, r) => c + Number(r.currentQty), 0), 0);
    const yazili = sh.sacks.reduce((a2, sk) => a2 + sk.allocations.reduce((c, x) => c + Number(x.qty), 0), 0);
    const toplamYazilacak = kalemler.reduce((a2, k) => a2 + k.yazilacak, 0);

    return {
      success: true,
      data: {
        shipmentId: sh.id,
        shipmentNo: sh.shipmentNo,
        customer: sh.customer,
        icerikMetraj: Math.round(icerik * 1000) / 1000,
        yazilanMetraj: Math.round(yazili * 1000) / 1000,
        yazilacakMetraj: Math.round(toplamYazilacak * 1000) / 1000,
        enToleransCm: enTolerans,
        fazlaSevkYazilir: fazlaSevk,
        kalemler,
      },
    };
  }

  /**
   * TEK SEVKİYATIN DEFTERİNİ ONAR — mevcut `setShipmentOrders` motoruyla.
   *
   * ⚠️ Sipariş kümesi DEĞİŞTİRİLMEZ: sevkiyatın bugünkü siparişleri aynen geri
   * verilir. Yaptığı tek şey tahsisi BUGÜNÜN verisiyle yeniden kurmaktır.
   * Yeni bir sipariş eklemek ayrı bir karardır ve bu uçtan yapılmaz.
   */
  async repairShipmentAllocation(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, shipmentNo: true, status: true, orders: { select: { orderId: true } } },
    });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
    if (sh.status !== ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Yalnız sevk EDİLMİŞ sevkiyatın defteri onarılır");
    }
    if (sh.orders.length === 0) {
      throw AppError.conflict("Sevkiyata bağlı sipariş yok — onarılacak defter yok");
    }
    const oncesi = await this.olcTahsis(shipmentId);
    await this.setShipmentOrders(shipmentId, sh.orders.map((o) => o.orderId), userId);
    const sonrasi = await this.olcTahsis(shipmentId);
    const kazanc = Math.round((sonrasi - oncesi) * 1000) / 1000;
    await AuditService.log({
      userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId,
      newData: { kind: "ALLOCATION_REPAIR", shipmentNo: sh.shipmentNo, oncesi, sonrasi, kazanc },
    });
    return {
      success: true,
      data: { shipmentNo: sh.shipmentNo, oncesi, sonrasi, kazanc },
      message: kazanc > 0.001
        ? `${sh.shipmentNo}: ${Math.round(kazanc)} m sipariş defterine yazıldı`
        : `${sh.shipmentNo}: yazılabilecek yeni metraj bulunamadı (defter değişmedi)`,
    };
  }

  /** Sevkiyatın toplam tahsis metrajı — onarım öncesi/sonrası ölçümü için. */
  private async olcTahsis(shipmentId: string): Promise<number> {
    const rows = await prisma.sackAllocation.aggregate({
      where: { sack: { shipmentId } },
      _sum: { qty: true },
    });
    return Math.round(Number(rows._sum.qty ?? 0) * 1000) / 1000;
  }

  /**
   * TOPLU DAĞITMA — ÖNİZLEME (2026-09-06).
   *
   * Kök CLAUDE.md: "Yıkıcı işlemde backend preview ucu döner, arayüz etkilenen HER
   * kaydı listeler ve per-record seçim sunar; soyut sayı yetmez." Toplu dağıtma
   * tam bu sınıfa girer: kullanıcı listeden N çuval seçiyor ve içindeki topların
   * hepsi depoya düşüyor.
   *
   * ⚠️ SİLME DEĞİL DAĞITMA: çuval kaydı korunur, yalnız içerik boşalır. Adı
   * "silme" olan bir düğmenin arkasında bu durur — önizleme metni bunu söyler.
   *
   * Yazma YOK; her çuval için engel varsa GEREKÇESİYLE döner (sevkiyata atanmış
   * çuval dağıtılamaz — sevk defterini bozardı).
   */
  async previewDistributeSacks(sackIds: string[]): Promise<ApiResponse<unknown>> {
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

  /**
   * TOPLU DAĞITMA — UYGULA (2026-09-06).
   *
   * Her çuval için tekil `distributeSackContents` yolunu kullanır: kural, kilit ve
   * audit satırı TEK KAYNAKTAN gelir. Toplu yol kendi SQL'ini yazsaydı
   * `touchWarehouseSackTx` / `markSackContentChangedTx` çiftini ikinci kez
   * uygulamak gerekirdi ve biri unutulunca tartı sessizce bayat kalırdı.
   *
   * ⚠️ HEPSİ-YA-HİÇBİRİ DEĞİL: engelli çuval atlanır, sebebi RAPORLANIR. Tek bir
   * sevkiyattaki çuval yüzünden 20 çuvallık işi düşürmek sahada işe yaramaz;
   * sessizce atlamak ise "yeşil ≠ yapıldı" olurdu.
   */
  async distributeSacksBulk(
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

  /**
   * Kaynak çuvalın (`sackId`) SEÇİLİ toplarını başka bir depo çuvalına TOPLU taşı.
   * Kaynak ve hedef depoda olmalı (sevkiyattaki reddedilir). Atomik updateMany +
   * her iki çuvalın tartısı sıfırlanır (içerik değişti).
   */
  async moveRollsToSack(
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

  /**
   * ÇUVAL BÖL — seçili topları YENİ bir çuvala ayır (tek atomik işlem).
   *
   * Neden tek uç: istemcide `openSack` + `moveRollsToSack` diye iki çağrı yapmak,
   * arada hata olursa ORTADA BOŞ ÇUVAL bırakır ve iki çuvalın tartı sıfırlaması
   * yarım kalır. Tek tx: yeni çuval aç → topları claim et → iki çuvalın kg'sini
   * sıfırla. Hiç top taşınamazsa (yarış) yeni çuval da yaratılmaz.
   *
   * Yeni çuval kaynağın müşteri/şubesini devralır (bölme, müşteri değiştirmez).
   * Kaynak çuvalda en az bir top KALMALI — hepsini seçmek "bölme" değil, bu durumda
   * yapılacak şey yok (400) çünkü sonuç sadece boş bir çuval + kopya olurdu.
   */
  async splitSack(
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

  /**
   * Çuval brüt tartısını güncelle (depodaki çuval — sevkiyata atanmamış).
   *
   * `source` = tartının KAYNAĞI. Verilmezse `MANUAL` varsayılır (eski istemci geri
   * uyumu). SİMÜLE kantar koruması buna bağlıdır — bkz. aşağıdaki guard.
   * `stamp` = oturumun makine/istasyon bağlamı (`getStampContext`); sunucunun cihazı
   * kendi çözüp istemci beyanını çapraz kontrol etmesi için.
   */
  async weighSack(
    data: {
      sackId: string;
      weightKg?: number | null;
      source?: "SCALE" | "MANUAL" | "SIMULATED";
    },
    userId?: string,
    stamp?: { machineId?: string | null; stationId?: string | null },
    /** F221 deseni — verilmezse elle-tartı kısıtı ATLANIR (dahili çağrı). */
    opts?: { permissions?: string[] }
  ): Promise<ApiResponse<unknown>> {
    const hasWeight = data.weightKg !== undefined && data.weightKg !== null;
    if (!hasWeight) throw AppError.badRequest("Tartı girilmeli");
    if (!(data.weightKg! > 0)) throw AppError.badRequest("Geçerli bir kg girilmeli");

    // ── SİMÜLE KANTAR KORUMASI ────────────────────────────────────────────────
    // Çuval kg'si sevk irsaliyesine VE çeki listesine basılır (müşteri/gümrük
    // belgesi) → uydurulmuş bir sayı buraya girmemeli. `PeripheralDevice.simulate`
    // açık bir kantar 10–100 kg arası RASTGELE değer üretiyor ve tek-dokunuş tartı
    // onu DOĞRUDAN kaydediyordu; tek koruma bir toast'tı.
    //
    // İKİ SİNYAL (derinlemesine savunma):
    //  (a) İSTEMCİ BEYANI (`source`) — Electron'da TEK sinyal olmak zorunda:
    //      `useMachineScale` kantarı yerel tercihlerden çözebiliyor (DB kaydı OLMAYAN
    //      "local-scale") → backend o cihazı GÖREMEZ.
    //  (b) SUNUCU ÇÖZÜMÜ — mobil oturumda cihaz makine/istasyondan çözülür; cihazın
    //      `simulate`'i açıksa beyan ne olursa olsun reddedilir (istemci yalanına kapalı).
    //
    // `MANUAL` MUAF: operatör kg'yi elle yazmıştır, kantarın simüle olması onu
    // ilgilendirmez — kantarsız/arızalı durumun kaçış yolu bu ve kapatılmamalı.
    //
    // İstemci yalanı (SIMULATED'ı MANUAL diye göndermek) bilinçli kabul: tehdit modeli
    // kötü niyet değil OPERATÖR KAFA KARIŞIKLIĞI (LAN-only kurulum) ve kalan yüzey
    // `weighedById` + audit ile izlenebilir. `DEVICE_PAIRING_REQUIRED`'ın kabul ettiği
    // güven seviyesiyle aynı.
    const declaredSource = data.source ?? "MANUAL";
    // ── ELLE TARTI KISITI (`shipping.manualWeightRestrictedEnabled`) ──────────
    // ⚠️ SIRA LOAD-BEARING: manual-restrict SİMÜLE korumasından ÖNCE koşar,
    // çünkü MANUAL beyanı simüle dalına HİÇ GİRMEZ (orada bilinçli olarak muaf).
    // Sonraya konsaydı kapı MANUAL yolunda hiç çalışmazdı.
    // ⚠️ `declaredSource`e bakar, `data.source`a DEĞİL: `source` opsiyoneldir ve
    // gönderilmezse MANUAL sayılır — ham alana bakan bir guard eski istemciyi
    // (undefined) sessizce geçirir ve bayrak fail-open olur.
    if (declaredSource === "MANUAL") {
      assertManualWeightAllowed({
        restricted: await readShippingManualWeightRestrictedEnabled(),
        permissions: opts?.permissions,
      });
    }
    // ⚠️ `simulated` blok DIŞINDA: kolona ÇÖZÜLMÜŞ kaynak yazılacak, beyan edilen
    // değil. Aksi halde bayrak AÇIKKEN (demo/eğitim) sunucu çapraz kontrolü cihazı
    // simüle bulup isteği GEÇİRDİĞİNDE kolona "SCALE" yazılırdı — yani kolonun tek
    // varlık sebebi (simüle 47.3 ≠ gerçek 47.3) kaybolurdu.
    let simulated = declaredSource === "SIMULATED";
    if (declaredSource !== "MANUAL") {
      if (!simulated && (stamp?.machineId || stamp?.stationId)) {
        const scale = await prisma.peripheralDevice.findFirst({
          where: {
            kind: "SCALE",
            isActive: true,
            deletedAt: null,
            ...(stamp.machineId
              ? { machineId: stamp.machineId }
              : { stationId: stamp.stationId!, machineId: null }),
          },
          orderBy: { createdAt: "asc" },
          select: { simulate: true },
        });
        if (scale?.simulate) simulated = true;
      }
      if (simulated && !(await readSimulatedWeightEnabled())) {
        throw AppError.badRequest(
          'Simüle kantarla tartı kaydedilemez — Tanımlar → Cihaz Kaydı\'ndan bu kantarın ' +
            '"simülasyon" bayrağını kapatın, ya da ⋮ → "Elle kg gir" ile girin.'
        );
      }
    }

    const sack = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, shipmentId: true } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuvalın tartısı değiştirilemez");

    // Atomik claim: yukarıdaki tx-dışı guard yalnız UX (404 + okunaklı mesaj) —
    // findUnique ile update arasında çuval bir sevkiyata claim edilebilirdi
    // (check-then-act; tartı DISPATCH sırasında yazılırdı). Otorite kilitte:
    // touchWarehouseSackTx WHERE shipmentId IS NULL, atanmışsa 409.
    // ÇÖZÜLMÜŞ kaynak — beyan edilen DEĞİL. Sunucu cihazı simüle bulduysa (ve bayrak
    // açık olduğu için istek geçtiyse) kolona SIMULATED yazılır; aksi halde kolon
    // "SCALE" der ve simüle 47.3 ile gerçek 47.3 yine ayırt edilemezdi.
    const resolvedSource: SackWeightSource = simulated
      ? SackWeightSource.SIMULATED
      : (declaredSource as SackWeightSource);

    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      // ÖLÇÜM DEFTERİ (2026-09-11): yeniden tartı eskiden `weightKg`in ÜSTÜNE
      // yazıyordu ve irsaliyeye giden BRÜT kg'ın önceki değeri hiçbir kalıcı
      // kolonda kalmıyordu. Önceki değeri okuyup olay tipini ondan çözüyoruz.
      const onceki = await tx.sack.findUnique({
        where: { id: data.sackId },
        select: { weightKg: true },
      });
      const stamp = new Date();
      await tx.sack.update({
        where: { id: data.sackId },
        data: {
          weightKg: new Prisma.Decimal(data.weightKg!),
          weightSource: resolvedSource,
          weighedBy: userId ? { connect: { id: userId } } : { disconnect: true },
          weighedAt: stamp,
        },
      });
      await tx.sackWeighing.create({
        data: {
          sackId: data.sackId,
          kind: onceki?.weightKg == null ? SackWeighingKind.WEIGHED : SackWeighingKind.REWEIGHED,
          weightKg: new Prisma.Decimal(data.weightKg!),
          weightSource: resolvedSource,
          weighedById: userId ?? null,
          weighedAt: stamp,
        },
      });
    });
    // Kaynak hem KOLONA (sorgulanabilir, kalıcı) hem AUDİT'e (kim/ne zaman bağlamıyla)
    // yazılır. Kolon iç izdir: belgeye/etikete BASILMAZ (bkz. schema.prisma doc).
    return this.finishWeigh(data, resolvedSource, userId);
  }

  /**
   * Tartının kuyruğu: audit + gerçekçilik eşiği uyarısı.
   * ⚠️ AYRI METOT, bilinçli: `weighSack` tam 80 satır sınırındaydı ve lint tavanı
   * yeni kodda ZORUNLU. Tavanı yükseltmek bir karardır; doğru çözüm eklenen yeri
   * sınıra çekmek — o yüzden kuyruk buraya taşındı, davranış birebir aynı.
   * Eşik UYARIR, BLOKLAMAZ (gerekçe `helpers/measurement-threshold.helper.ts`).
   */
  private async finishWeigh(
    data: { sackId: string; weightKg?: number | null },
    resolvedSource: SackWeightSource,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const thresholdWarning = weightWarning(data.weightKg!);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId, newData: { kind: "WEIGH", weightKg: data.weightKg, source: resolvedSource, ...(thresholdWarning ? { thresholdWarning } : {}) } });
    return { success: true, data: {}, message: "Çuval tartısı güncellendi", ...(thresholdWarning ? { warnings: [thresholdWarning] } : {}) };
  }

  /**
   * Depodaki çuvalı sil. Sevkiyata atanmış çuval silinemez (önce sevkiyattan çıkar). Boş
   * çuval doğrudan; dolu çuval `withContents=true` ile içerik depoya döner. Depodaki çuvalın
   * tahsisi yoktur (tahsis yalnız sevkte yazılır) → temizlik gerekmez.
   */
  async removeSack(sackId: string, userId?: string, withContents = false): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { id: true, sackNo: true, shipmentId: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuval silinemez — önce sevkiyattan çıkarın");

    const hasContents = sack._count.rolls > 0 || sack._count.swatches > 0;
    if (hasContents && !withContents) {
      throw AppError.conflict("Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya depoya çıkar");
    }

    const rolls = hasContents ? await prisma.roll.findMany({ where: { sackId }, select: { id: true, barcode: true } }) : [];
    await prisma.$transaction(async (tx) => {
      // Atomik claim: tx-dışı shipmentId guard'ı yalnız UX — "atama-önce-silme-sonra"
      // yarışında PLANNED (onay kapalıysa DISPATCHED) sevkiyattan çuval sessizce
      // silinir, toplar "sevkiyatta ama çuvalsız" limboya düşerdi. Otorite kilitte
      // (dosyadaki diğer tüm depo-çuval mutasyonlarıyla aynı desen).
      await touchWarehouseSackTx(tx, sackId);
      // İçerik sayımı kilit ALTINDA taze — tx-dışı _count bayat olabilir (araya
      // giren okutma dolu çuvalı "boş" diye sildirtmesin). updateMany'ler koşulsuz
      // (boş çuvalda no-op); tx-dışı sayımlar yalnız audit/mesaj için kalır.
      const freshRolls = await tx.roll.count({ where: { sackId } });
      const freshSwatches = await tx.swatch.count({ where: { sackId } });
      if (!withContents && freshRolls + freshSwatches > 0) {
        throw AppError.conflict("Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya depoya çıkar");
      }
      await tx.roll.updateMany({ where: { sackId }, data: { sackId: null } });
      await tx.swatch.updateMany({ where: { sackId }, data: { sackId: null } });
      await tx.sack.delete({ where: { id: sackId } });
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SACK",
      recordId: sackId,
      oldData: { sackNo: sack.sackNo, ...(hasContents ? { kind: "SACK_REMOVE_WITH_CONTENTS", returnedRolls: rolls.map((r) => r.barcode ?? r.id), rollCount: sack._count.rolls, swatchCount: sack._count.swatches } : {}) },
    });
    const n = sack._count.rolls + sack._count.swatches;
    return { success: true, data: { returnedToWarehouse: n }, message: n > 0 ? `Çuval silindi — ${n} top/kartela depoya döndü` : "Çuval silindi" };
  }

  /**
   * ÇUVAL İÇERİĞİ DEĞİŞTİ — bayatlayan İKİ izi birden düşür (2026-08-21).
   *
   * Eski adı `resetSackWeightsTx`'ti ve yalnız tartıyı sıfırlıyordu; ad artık
   * YALAN SÖYLEMESİN diye değiştirildi — çünkü içerik değişimi kg'den fazlasını
   * bayatlatır:
   *   1. **Brüt tartı** — tartıdan sonra içerik değişirse eski kg yanlıştır
   *      (yeniden tartı istenir).
   *   2. **Çuvalın ÜSTÜNDEKİ etiket** — çuval etiketi bir TOPLAM belgesidir:
   *      `rollCount` / `lengthMeters` / `weightKg` basılır
   *      (`config/label-fields.ts` → `SACK_FIELDS`). İçerik değişince basılı
   *      kâğıttaki "12 top / 1.240 m" sayıları gerçeği anlatmaz → `labelDirty`.
   *
   * ⚠️ İKİ AYRI `updateMany` — birleştirilemez: tartı sıfırlama `weightKg: { not: null }`
   * ile SINIRLI (hiç tartılmamış çuvala boşuna yazma), etiket bayatlığı ise
   * tartıdan BAĞIMSIZDIR (tartısız çuvalın da basılı etiketi olur; top adedi/metraj
   * yine kâğıtta yazar). Tek ifadeye indirmenin bedeli ÖLÇÜLDÜ: koşul
   * birleştirildiğinde bayrak HİÇ yazılmaz — birinci ifade kg'yi zaten NULL'ladığı
   * için aynı WHERE ikinci kez eşleşmez (sessiz kayıp).
   *
   * `labelDirty: false` koşulu gereksiz yazmayı eler (`markSackLabelsStaleOnCustomerChange`
   * ve `Roll.labelDirty` emsali); baskıda temizlenir (`label.service.recordSackPrintEvent`).
   *
   * NOT: `Sack.notes` (çuval yorumu) bu fonksiyonun kapsamı DIŞINDADIR — not ne
   * ölçüm ne içeriktir (annotation); `setSackNotes` kendi kuralını uygular.
   */
  private async markSackContentChangedTx(
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

  // =========================================================================
  // HAVUZ GÖRÜNÜMÜ — müşteri-gruplu board
  // =========================================================================

  /**
   * Çuval depo board'u — müşteri bazlı özet (çuval sayısı, kg, metraj). Yalnız depodaki
   * (shipmentId NULL) çuvallar. Müşterisiz çuvallar "atanmamış" (customer=null) grubunda.
   */
  async listPool(params: { customerId?: string; search?: string }): Promise<ApiResponse<unknown>> {
    const where: Prisma.SackWhereInput = { shipmentId: null };
    if (params.customerId) where.customerId = params.customerId;
    const search = params.search?.trim();
    if (search) {
      where.OR = buildTextSearch<Prisma.SackWhereInput>(search, {
        text: ["customer.name"],
        code: ["customer.code", "sackNo"],
      });
    }
    const sacks = await prisma.sack.findMany({
      where,
      take: 2000,
      select: {
        id: true,
        customerId: true,
        weightKg: true,
        customer: { select: { id: true, code: true, name: true } },
      },
    });
    if (sacks.length === 0) return { success: true, data: [] };

    // Roll metrajı çuval bazında (havuz kapsamı) — sackId → toplam.
    const rollAgg = await prisma.roll.groupBy({
      by: ["sackId"],
      where: { sackId: { in: sacks.map((s) => s.id) }, status: { notIn: NON_SACKABLE_STATUSES } },
      _sum: { currentQty: true },
      _count: { _all: true },
    });
    const rollBySack = new Map(rollAgg.map((g) => [g.sackId, g]));

    const UNASSIGNED = "__none__";
    const byCustomer = new Map<string, {
      customer: { id: string; code: string; name: string } | null;
      sackCount: number;
      totalKg: Prisma.Decimal;
      totalMeters: Prisma.Decimal;
      rollCount: number;
    }>();
    for (const s of sacks) {
      const key = s.customerId ?? UNASSIGNED;
      let e = byCustomer.get(key);
      if (!e) {
        e = { customer: s.customer, sackCount: 0, totalKg: D0(), totalMeters: D0(), rollCount: 0 };
        byCustomer.set(key, e);
      }
      e.sackCount += 1;
      if (s.weightKg) e.totalKg = e.totalKg.plus(s.weightKg);
      const ra = rollBySack.get(s.id);
      if (ra) {
        e.totalMeters = e.totalMeters.plus(ra._sum.currentQty ?? 0);
        e.rollCount += ra._count._all;
      }
    }
    const data = [...byCustomer.values()].map((e) => ({
      customer: e.customer,
      sackCount: e.sackCount,
      totalKg: Number(e.totalKg),
      totalMeters: Number(e.totalMeters),
      rollCount: e.rollCount,
    }));
    data.sort((a, b) => b.sackCount - a.sackCount || (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "", "tr"));
    return { success: true, data };
  }

  /**
   * Bir müşterinin depo çuvalları (sevkiyata atanmamış) — içerikleriyle. Paketleme
   * workspace'inin canlı kaynağı (çuval aç/okut/tart).
   */
  async listCustomerPoolSacks(customerId: string): Promise<ApiResponse<unknown>> {
    // `defaultDestination`: tablet paketleme ekranı sevk hedefi seçicisini buradan BAŞLATIR
    // (varsayılan, kilit değil — operatör değiştirir; sevkiyat kendi değerini saklar).
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, code: true, name: true, defaultDestination: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    // GÜVENLİK TAVANI (2026-07-30) — sorgu eskiden LİMİTSİZDİ. Kardeşi `listPool`
    // `take: 2000` taşıyor; sınırsız sorgu bir tavan kadar bile korumasızdır (perf
    // kuralı #5). Ölçüm: bugün en kalabalık müşterinin 3 havuz çuvalı var (toplam
    // 369 çuval) → tavan bugün ISIRMIYOR, büyümeye karşı emniyet supabı.
    //
    // ⚠️ YÖN KRİTİK: `orderBy asc` + düz `take` EN YENİ çuvalları keserdi. Mobil
    // Paketleme ekranı AKTİF ÇUVALI listenin SONUNDAN seçiyor (`ensureActiveSack`
    // → `list[list.length - 1]`), yani tavan ısırsaydı yeni açılan çuval görünmez
    // olur ve operatör farkında olmadan ESKİ bir çuvala okuturdu. Bu yüzden `desc`
    // çekip sayfayı `reverse()` ile asc'e döndürüyoruz: kesilen uç ESKİ olanlar.
    const POOL_SACK_CAP = 2000;
    const sacksDesc = await prisma.sack.findMany({
      where: { customerId, shipmentId: null },
      orderBy: { createdAt: "desc" },
      take: POOL_SACK_CAP,
      select: {
        // weighedAt: kartta "✓ 14:22" (tartıldı izi) — tek-dokunuş tartıdan sonra
        // operatör hangi çuvalın tartıldığını modal açmadan görmeli.
        id: true, sackNo: true, weightKg: true, weighedAt: true, branchId: true, notes: true,
        // Paketleme grubu (çalışma yaftası) — istemci listeyi bu alana göre
        // bloklar. NULL = "Gruplanmamış" (bugünkü ve varsayılan hâl).
        packingGroupId: true,
        branch: { select: { id: true, code: true, name: true } },
        // İZLER (çuval etiketi) — tablette SALT-OKUNUR çip. Tek kaynak
        // `ACTIVE_TAG_SELECT`: rozet/filtre/belge ayrışmasın. Havuz çuvalı tanımı
        // gereği sevk EDİLMEMİŞTİR (`shipmentId: null`), yani `clearedAt` yüklemi
        // burada bugün ısırmaz — yine de ORTAK select'ten geçer, çünkü ayrı yazılan
        // ikinci bir yüklem tam da bu depoda adı konmuş "ayrışan yüzey" sınıfıdır.
        tags: ACTIVE_TAG_SELECT,
        // `status`: hayalet topu (çuvalda kayıtlı ama fiziksel olarak binada olmayan)
        // istemci işaretleyebilsin. Top ARRAY'İ filtrelenmez — filtrelenirse operatör
        // onu göremez ve çıkaramaz; sayaçlar aşağıda ayrıca dışlar.
        rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, status: true, width: true, currentQty: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true, hex: true } } } },
        swatches: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
      },
    });
    // Sözleşme KORUNUR: istemciler `createdAt asc` bekliyor (mobil aktif çuvalı sondan
    // seçiyor). `desc + take` ile en yeniler alındı, burada asc'e döndürülüyor.
    const sacks = sacksDesc.reverse();
    const data = sacks.map((sk) => {
      // SAYAÇLAR hayaleti DIŞLAR → çuval etiketi (label.service, aynı küme), liste ve
      // irsaliye aynı adedi/metrajı basar. Görünüm ise hepsini gösterir (üstteki not).
      const present = sk.rolls.filter((r) => !SACK_ABSENT_STATUSES.includes(r.status));
      const totalQty = present.reduce((s, r) => s.plus(r.currentQty), D0());
      return {
        id: sk.id, sackNo: sk.sackNo, weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        packingGroupId: sk.packingGroupId,
        weighedAt: sk.weighedAt, notes: sk.notes,
        // ⚠️ Yanına ayrı hesaplanmış bir etiket SAYACI EKLENMEZ: Sevk Kapısı ile
        // `/pool` zaten iki farklı rakam üretiyor, üçüncüsü olmasın. Çip listesi
        // rozetin KENDİSİDİR; sayı isteyen `tags.length` okur.
        tags: toTagBadges(sk.tags),
        branch: sk.branch,
        rollCount: present.length, swatchCount: sk.swatches.length, totalQty: Number(totalQty),
        rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, status: r.status, width: r.width != null ? Number(r.width) : null, currentQty: Number(r.currentQty), item: r.item, color: r.color })),
        swatches: sk.swatches.map((s) => ({ id: s.id, barcode: s.barcode, item: s.item, color: s.color })),
      };
    });
    // `truncated`: tavan ısırdıysa SESSİZ KALMA. Bu ekranda kesilen çuval yalnız
    // görünmez olmuyor — sevkiyata GİRMİYOR, KPI'lardan düşüyor ve aramada bile
    // bulunamıyor (arama bellekteki dizide çalışıyor). İstemci bunu bir uyarı
    // şeridine çevirmeli. Alan EKLEMELİ olduğu için eski istemcileri kırmaz.
    const truncated = sacksDesc.length === POOL_SACK_CAP;
    if (truncated) {
      uyari("listCustomerPoolSacks", `müşteri ${customerId}: havuz çuvalı ${POOL_SACK_CAP} tavanına ulaştı — en eskiler kesildi.`,
      );
    }
    // Gruplar AYNI yanıtta: istemci ikinci bir tur atmasın (liste ile grup
    // başlıkları ayrı anlarda gelirse ekran bir kare boyunca "gruplanmamış"
    // gösterirdi). Bayrak kapalıyken servis boş dizi döner.
    const groups = (await PackingGroupService.list(customerId)).data ?? [];
    return { success: true, data: { customer, sacks: data, groups, truncated, limit: POOL_SACK_CAP } };
  }

  // =========================================================================
  // SEVKİYAT — depodan çuval seçerek kur + yaşam döngüsü
  // =========================================================================

  /** Sevkiyat kurulumundan ÖNCE seçilen çuvalları doğrula (pre-tx erken 4xx). Hedef
   *  müşteri/şube dialog'da seçilir; çuvalların null-olmayan müşteri/şubesi hedefle
   *  uyuşmalı, müşterisiz/şubesiz çuvallar serbest (sevkte atanır). */
  private async loadSacksForShipment(
    sackIds: string[],
    target: { customerId: string; branchId: string | null }
  ) {
    const sacks = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: { id: true, sackNo: true, customerId: true, branchId: true, shipmentId: true, weightKg: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (sacks.length !== sackIds.length) throw AppError.notFound("Bazı çuvallar bulunamadı");
    for (const s of sacks) {
      if (s.shipmentId != null) throw AppError.conflict("Çuvallardan biri zaten bir sevkiyatta");
      if (s._count.rolls === 0 && s._count.swatches === 0) throw AppError.badRequest("Boş çuval sevk edilemez");
      if (s.customerId != null && s.customerId !== target.customerId) {
        throw AppError.badRequest("Seçilen çuvallardan biri başka müşteriye ait — tek sevkiyat = tek müşteri.");
      }
      if (s.branchId != null && s.branchId !== target.branchId) {
        throw AppError.badRequest("Seçilen çuvallardan biri başka şubeye ait — tek sevkiyat = tek şube.");
      }
    }

    // HAYALET GUARD'I (2026-07-30) — defterin DONMUŞ belgeye girmeden düzeltilebileceği
    // SON nokta. Bu fonksiyon eskiden yalnız çuval düzeyine bakıyordu (`_count`),
    // içindeki topların STATÜSÜNE hiç bakmıyordu: çuvalda kayıtlı ama fiziksel olarak
    // binada olmayan top (kartelaya/tambura/fasona gitmiş) sevkiyata bağlanıyor, sevkte
    // `SHIPPED`'e eziliyor ve şişmiş metraj irsaliyede donuyordu.
    // Uyarıp geçmek YETMEZ: yanlış metraj hukuken bağlayıcı belgeye girer → 400.
    const ghosts = await prisma.roll.findMany({
      where: { sackId: { in: sackIds }, status: { in: NON_SACKABLE_STATUSES } },
      select: { barcode: true, status: true, sack: { select: { sackNo: true } } },
      take: 10,
    });
    if (ghosts.length > 0) {
      throw AppError.badRequest(
        "Sevkiyat kurulamaz — çuvalda kayıtlı ama fiziksel olarak binada olmayan top var: " +
          ghosts
            .map((g) => `${g.sack?.sackNo ?? "?"} / ${g.barcode ?? "(barkodsuz)"} → ${g.status}`)
            .join(", ") +
          '. "Paketleme / Çuvallar" ekranından bu topları çuvaldan çıkarın.'
      );
    }

    return { sacks, customerId: target.customerId, branchId: target.branchId };
  }

  /**
   * Seçili siparişler hedef müşteri/şubeye ait mi — VE hâlâ canlı mı.
   *
   * ⚠️ `status` seçimi 2026-08-29'da eklendi (BULGU-T3-003): bu yüklem sipariş
   * DURUMUNU hiç okumuyordu. Sevkiyatçı "Sevkiyat Kur" diyaloğunu açık bırakıp
   * dakikalar sonra onayladığında (liste açıldığı anda sipariş canlıydı) arada
   * iptal edilmiş bir siparişe tahsis yazılabiliyordu: sipariş "İPTAL · Sevk
   * 640 m" görünür, aynı kumaşın gerçekten açık siparişi mal alamaz ve fabrika
   * onu yeniden üretir.
   *
   * Bu ÖN kontroldür (okunaklı 400, kullanıcı listeyi yenilesin). Yarışın
   * kendisini kapatan şey `writeShipmentAllocationsTx`teki KİLİT ALTINDA taze
   * doğrulamadır — ikisi ayrı işler görür, biri diğerinin yerine geçmez.
   */
  private async assertOrdersBelong(orderIds: string[], customerId: string, branchId: string | null): Promise<void> {
    if (orderIds.length === 0) return;
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, customerId: true, branchId: true, status: true, orderNumber: true },
    });
    if (orders.length !== orderIds.length) throw AppError.notFound("Bazı siparişler bulunamadı");
    for (const o of orders) {
      if (o.customerId !== customerId) throw AppError.badRequest("Seçili siparişlerden biri sevkiyatın müşterisine ait değil");
      if (branchId != null && o.branchId != null && o.branchId !== branchId) {
        throw AppError.badRequest("Seçili siparişlerden biri sevkiyatın şubesine ait değil");
      }
      if (o.status === OrderStatus.CANCELLED) {
        throw AppError.badRequest(
          `${o.orderNumber} siparişi İPTAL edilmiş — sevkiyata eklenemez. Listeyi yenileyip malın gerçekten ait olduğu siparişi seçin.`,
        );
      }
    }
  }

  /**
   * Tartı kapısı — bayrağı OKUR ve tek yüklemi (`assertSacksWeighed`) çağırır.
   *
   * Eski adı `assertExportWeighed` idi ve yalnız ihracatı biliyordu; `weighRequired`
   * bayrağı geldiğinde ad da yalan söylemeye başlardı. İhracat dalı hâlâ bayraktan
   * BAĞIMSIZ: bayrak yalnız genişletir.
   *
   * ⚠️ `setDestination` BİLİNÇLİ KAPISIZ — sevkiyat sonradan EXPORT yapılabiliyor
   * ve orada tartı sorulmuyor. Bugün zararsız (çıkış `dispatchShipment`te yakalanır);
   * "unutulmuş kapı" sanıp dördüncü bir kontrol EKLEME.
   */
  private async assertWeighed(
    sacks: { sackNo?: string | null; weightKg: Prisma.Decimal | null }[],
    destination: ShipmentDestination
  ): Promise<void> {
    assertSacksWeighed(sacks, destination, await readShippingWeighRequiredEnabled());
  }

  /** ShipmentOrder denorm'unu kullanıcının seçtiği sipariş kümesine ayarla. */
  private async setShipmentOrdersTx(tx: Prisma.TransactionClient, shipmentId: string, orderIds: string[]): Promise<void> {
    const ids = [...new Set(orderIds)];
    await tx.shipmentOrder.deleteMany({ where: { shipmentId } });
    if (ids.length > 0) {
      await tx.shipmentOrder.createMany({ data: ids.map((orderId) => ({ shipmentId, orderId, isActive: true })), skipDuplicates: true });
    }
  }

  /**
   * Sevkiyatın çuvallarını seçili siparişlerin AÇIK satırlarına spec + şube FIFO ile dağıt
   * (distributeSacksToLines). Şube = sevkiyatın atanan şubesi (çuvalın depolanan null'ı değil)
   * → şubesiz depo çuvalı da doğru dağıtılır. need = quantity − shippedQty. DB-pure hesap.
   */
  private async computeSackAllocations(
    db: Prisma.TransactionClient,
    params: { sackIds: string[]; orderIds: string[]; branchId: string | null }
  ): Promise<{ allocations: { sackId: string; orderLineId: string; qty: Prisma.Decimal }[]; lineNeeds: Map<string, Prisma.Decimal> }> {
    const sacks = await db.sack.findMany({
      where: { id: { in: params.sackIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, rolls: { select: { itemId: true, colorId: true, width: true, currentQty: true } } },
    });
    const poolSacks: PoolSack[] = sacks.map((s) => ({
      sackId: s.id,
      branchId: params.branchId,
      rolls: s.rolls.map((r) => ({ itemId: r.itemId, colorId: r.colorId, width: r.width, currentQty: r.currentQty })),
    }));
    const lines = params.orderIds.length
      ? await db.orderLine.findMany({
          // İptal edilmiş kaleme tahsis yapılmaz (2026-08-27) — tek kaynak.
          where: { orderId: { in: params.orderIds }, ...ACTIVE_LINE },
          select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, createdAt: true, order: { select: { deadline: true, orderDate: true } } },
        })
      : [];
    // ── HENÜZ SEVK EDİLMEMİŞ AMA ZATEN AYRILMIŞ METRAJ (BULGU-T1-010) ────────
    // `shippedQty` yalnız DISPATCH'te terfi eder (defter kuralı, doğru). Ama
    // kapasite hesabı ondan İBARET olamaz: sevk onayı AÇIKKEN pazartesi kurulan
    // PLANNED sevkiyat 500 m'yi ayırır, salı kurulan ikinci sevkiyat `shippedQty`
    // hâlâ 0 olduğu için AYNI 500 m'yi bir daha ayırır ve ikisi sevk edilince
    // 500 m'lik kalem 1000 m sevk edilmiş olur. Sipariş COMPLETED, "Açık 0",
    // hiçbir uyarı yok, 500 m fazla mal müşteriye çıkmış. Bu bir YARIŞ DEĞİL —
    // ardışık iki meşru işlemin sonucu, yani kilitle çözülmez.
    // ⚠️ Bu düşüm hiçbir RAKAMI değiştirmez (`shippedQty`, İstenen|Sevk|Açık
    // aynı kalır) — yalnız "bu kaleme daha ne kadar tahsis edilebilir"i
    // düzeltir. Fazla mal yine sevk edilebilir; tahsissiz kalır (mevcut
    // davranış), yani "fazla/eşleşmeyen sevk serbest" kuralı korunur.
    // Sevkiyatın KENDİ tahsisleri çağıran tarafından zaten silinmiştir
    // (`writeShipmentAllocationsTx` sil-yaz), o yüzden burada özel dışlama YOK.
    const planlanmis = new Map<string, Prisma.Decimal>();
    if (lines.length > 0) {
      const rows = await db.sackAllocation.groupBy({
        by: ["orderLineId"],
        where: {
          orderLineId: { in: lines.map((l) => l.id) },
          sack: { shipment: { status: ShipmentStatus.PLANNED } },
        },
        _sum: { qty: true },
      });
      for (const r of rows) planlanmis.set(r.orderLineId, new Prisma.Decimal(r._sum.qty ?? 0));
    }

    const allocLines: SackAllocLine[] = [];
    const lineNeeds = new Map<string, Prisma.Decimal>();
    for (const l of lines) {
      const need = new Prisma.Decimal(l.quantity)
        .minus(l.shippedQty)
        .minus(planlanmis.get(l.id) ?? 0);
      lineNeeds.set(l.id, need);
      if (need.greaterThan(0)) {
        allocLines.push({
          id: l.id, itemId: l.itemId, colorId: l.colorId, width: l.width, branchId: params.branchId,
          need, deadline: l.order.deadline, orderDate: l.order.orderDate, lineCreatedAt: l.createdAt,
        });
      }
    }
    // EN TOLERANSI (`shipping.allocWidthToleranceCm`, 2026-09-06) — 0 = tam eşitlik
    // ve bu VARSAYILAN, yani bayrak açılmadıkça tahsis bugünküyle bayt-bayt aynı.
    // Kumaş ve renk toleranstan ETKİLENMEZ (`specMatch` yalnız eni gevşetir).
    const enTolerans = await readShippingAllocWidthToleranceCm();
    // FAZLA SEVK (`shipping.allowOverAllocation`) — kapalı = bugünkü davranış.
    const fazlaSevk = await readShippingAllowOverAllocation();
    const allocations = distributeSacksToLines(poolSacks, allocLines, enTolerans, fazlaSevk);
    return { allocations, lineNeeds };
  }

  /**
   * Sevkiyatın tahsislerini sil-yaz (tüm çuvalları × seçili siparişleri).
   *
   * ⚠️ SIRA LOAD-BEARING (2026-08-29 / BULGU-T1-010 + T3-003): kalem kilidi
   * kapasite okumasından ÖNCE alınır. Eskiden `computeSackAllocations`
   * `shippedQty`yi KİLİTSİZ okuyor, kilit ise ancak `performDispatchTx`in
   * sonunda alınıyordu — yani iki paketleme istasyonu aynı kalem için aynı anda
   * sevkiyat kurduğunda İKİSİ DE `shippedQty=0` görüyor, ikisi de "need=500"
   * hesaplıyor ve 500 m'lik kalem 1000 m sevk edilmiş oluyordu. Sipariş
   * COMPLETED, "Açık 0", hiçbir uyarı yok; fazla mal müşteriye çıkmış.
   * Kilit önce alınınca ikinci istek birincinin commit'ini bekler ve kalan
   * kapasiteyi TAZE okur. Fason `directShip` ile birebir aynı protokol.
   */
  private async writeShipmentAllocationsTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    orderIds: string[],
    branchId: string | null
  ): Promise<AllocationAuditTrail | null> {
    await tx.sackAllocation.deleteMany({ where: { sack: { shipmentId } } });
    if (orderIds.length === 0) return null;
    const sackRows = await tx.sack.findMany({ where: { shipmentId }, select: { id: true } });
    const sackIds = sackRows.map((s) => s.id);
    if (sackIds.length === 0) return null;

    // ① Etkilenen siparişlerin TAM satır kümesini kilitle (alt-küme kilidi
    //    deadlock riski taşır — `touchOrderLinesTx` id'leri sıralı alır).
    const lockRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await touchOrderLinesTx(tx, lockRows.map((l) => l.id));

    // ② Kilit ALTINDA taze doğrulama: sipariş bu arada iptal edilmiş olabilir.
    //    `ACTIVE_LINE` yalnız KALEM iptalini süzer; başlık iptali kalemlere
    //    `cancelledAt` DAMGALAMAZ (order.service `Order.status`ı yazar, o kadar)
    //    → bu boşluk buradan kapanıyor. `ACTIVE_LINE`ın kendisine sipariş
    //    durumunu EKLEMEDİK bilinçli olarak: o yüklem "açık talep"in tek
    //    kaynağıdır ve karşılanma/denge/rapor yüzeylerinin hepsini birden
    //    değiştirmek bu düzeltmenin kapsamı değil.
    const liveOrders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, status: true },
    });
    const cancelled = liveOrders.filter((o) => o.status === OrderStatus.CANCELLED);
    if (cancelled.length > 0) {
      throw AppError.conflict(
        `${cancelled.map((o) => o.orderNumber).join(", ")} bu sırada İPTAL edildi — sevkiyat kurulmadı. ` +
          "Listeyi yenileyip malın gerçekten ait olduğu siparişi seçin.",
        { code: "ORDER_CANCELLED_DURING_SHIPMENT" },
      );
    }

    const { allocations, lineNeeds } = await this.computeSackAllocations(tx, { sackIds, orderIds, branchId });
    if (allocations.length > 0) {
      await tx.sackAllocation.createMany({ data: allocations.map((a) => ({ sackId: a.sackId, orderLineId: a.orderLineId, qty: a.qty })) });
    }

    // ── SEVK DEFTERİNİN İZİ (2026-08-29 / BULGU-T2-003) ─────────────────────
    // `SackAllocation` MALİ ETKİSİ OLAN tek defterdir (sipariş karşılanması
    // ondan türer) ve değişim geçmişi HİÇ YOKTU. "Sipariş 'Açık 1000 m'
    // görünüyor ama operatör sevk ettim diyor" sorusunda destek `system_logs`'a
    // bakınca yalnız `SHIPMENT CREATE {orderIds}` buluyordu: tahsisin HİÇ
    // yazılmadığı mı, yazılıp SİLİNDİĞİ mi, hangi metrajla yazıldığı mı ayırt
    // edilemiyordu. Bu denetimde birebir yaşandı ve mekanizma kaynak kodu
    // okunarak tahmin edildi.
    //
    // ⚠️ ATLANAN kalemler de yazılıyor ve asıl değer orada: "şu satıra neden
    // yazılmadı" sorusunu tek satırda cevaplar (kalan kapasite 0 mıydı, spec
    // tutmadı mı). Yazılanı görmek yarım cevaptır.
    // Kayıt tx DIŞINDA değil İÇİNDE değil — `AuditService.log` best-effort ve
    // tx'e girmez (CLAUDE.md: audit yazımı isteği düşürmez).
    return {
      shipmentId,
      yazilan: allocations.map((a) => ({ orderLineId: a.orderLineId, qty: Number(a.qty) })),
      atlanan: [...lineNeeds.entries()]
        .filter(([lineId]) => !allocations.some((a) => a.orderLineId === lineId))
        .map(([orderLineId, need]) => ({ orderLineId, need: Number(need) })),
    };
  }

  /**
   * Tahsis izini yaz — tx BİTTİKTEN SONRA (audit best-effort'tür ve tx'e girmez).
   *
   * ⚠️ Ara değer bir ÖRNEK ALANINDA saklanmıyor, dönüş değeriyle taşınıyor:
   * route servisi tek örnek olarak paylaşır ve iki eşzamanlı sevkiyat kurulumu
   * birbirinin bekleyen kaydını EZERDİ (ilk yazımda tam bu tuzağa düşülmüştü).
   */
  private async flushAllocationAudit(
    iz: {
      shipmentId: string;
      yazilan: { orderLineId: string; qty: number }[];
      atlanan: { orderLineId: string; need: number }[];
      tahsissizMetraj?: number;
    } | null,
    userId?: string,
  ): Promise<void> {
    if (!iz) return;
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK_ALLOCATION",
      recordId: iz.shipmentId,
      newData: {
        kind: "ALLOCATIONS_REWRITTEN",
        yazilan: iz.yazilan,
        atlanan: iz.atlanan,
        ...(iz.tahsissizMetraj !== undefined ? { tahsissizMetraj: iz.tahsissizMetraj } : {}),
      },
    });
  }

  /**
   * Depodan seçilen çuvallarla yeni sevkiyat kur (PLANNED). Müşteri/şube dialog'da seçilir
   * (müşterisiz çuvala backfill). Seçili siparişlere (opsiyonel) spec-FIFO tahsis yazılır;
   * shippedQty yalnız DISPATCH'te terfi eder. Fazla/eşleşmeyen/siparişsiz sevk edilebilir.
   */
  /** A4 replay: token'la daha önce kurulmuş sevkiyatı createShipment yanıt şekliyle döner. */
  private async readCreateShipmentReplay(clientToken: string): Promise<ApiResponse<unknown> | null> {
    const sh = await prisma.shipment.findUnique({
      where: { clientToken },
      select: { id: true, shipmentNo: true, status: true },
    });
    if (!sh) return null;
    // ⚠️ 4. DURUM — "yazıldı ama SONRADAN İPTAL EDİLDİ" (BULGU-T3-010).
    // Tablet "Hemen Sevk Et" der, sunucu kurar ve çıkarır ama yanıt ağda
    // kaybolur; mobil sözleşmesi gereği token YAPIŞIR. Bu arada masaüstünden
    // storno + kapatma yapılır (sevkiyat CANCELLED, çuvallar havuza döner,
    // irsaliye VOIDED). Tablet yeniden bağlanıp aynı token'la gönderdiğinde
    // eskiden `success:true` + "Sevkiyat kuruldu" dönüyordu: operatör yeşili
    // görüp evrak beklemeye geçiyor, oysa MAL ÇIKMAMIŞTIR ve o sevkiyat artık
    // hiçbir ekranda yok. KK1/sipariş/fason ile aynı aile
    // (`token-replay.helper`, ENTRY_CANCELLED / ORDER_CANCELLED / RECEIPT_CANCELLED).
    // ⚠️ 409 = KESİN hata → mobil kuyruk token'ı BIRAKIR (entryAttempt sözleşmesi)
    // ve operatör sevkiyatı yeniden kurar. 5xx dönseydi token yapışır, aynı ölü
    // sevkiyat sonsuza dek yeniden sorulurdu.
    if (sh.status === ShipmentStatus.CANCELLED) {
      throw AppError.conflict(
        `Bu sevkiyat (${sh.shipmentNo}) kurulmuş ama İPTAL EDİLMİŞ — mal çıkmadı. ` +
          "Sevkiyatı yeniden kurun.",
        { code: "SHIPMENT_CANCELLED", shipmentNo: sh.shipmentNo },
      );
    }
    const dispatched = sh.status === ShipmentStatus.DISPATCHED;
    return {
      success: true,
      data: { id: sh.id, shipmentNo: sh.shipmentNo, status: sh.status, dispatched },
      message: dispatched ? `Sevk edildi: ${sh.shipmentNo}` : `Sevkiyat kuruldu: ${sh.shipmentNo}`,
    };
  }

  async createShipment(
    data: { sackIds: string[]; customerId: string; branchId?: string | null; orderIds?: string[]; orderless?: boolean; destination?: ShipmentDestination; procedureCode?: string | null; plateNumber?: string | null; driverName?: string | null; carrier?: string | null; clientToken?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    // İdempotent replay (A4): timeout-retry aynı token'la gelir — çuvallar ilk
    // (başarılı ama yanıtı kaybolmuş) denemede claim'lendiği için token'sız retry
    // kör 409 alıyordu; artık kurulmuş sevkiyatın kendisi döner.
    if (data.clientToken) {
      const cached = await this.readCreateShipmentReplay(data.clientToken);
      if (cached) return cached;
    }
    const sackIds = [...new Set(data.sackIds)];
    if (sackIds.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    if (!data.customerId) throw AppError.badRequest("Müşteri seçilmeli");
    const orderIds = [...new Set(data.orderIds ?? [])];
    const branchId = data.branchId ?? null;
    const { sacks } = await this.loadSacksForShipment(sackIds, { customerId: data.customerId, branchId });
    const destination = data.destination ?? ShipmentDestination.DOMESTIC;
    await this.assertWeighed(sacks, destination);
    // SİPARİŞ BAĞI KAPISI — tx'ten ÖNCE (girdi guard'ı). `block` rejiminde
    // sipariş yoksa ve niyet beyan edilmediyse 400; diğer rejimlerde no-op.
    const orderRequirement = await resolveOrderRequirement();
    assertOrderLinkAllowed(orderRequirement, { orderIds, orderless: data.orderless });
    await this.assertOrdersBelong(orderIds, data.customerId, branchId);
    // Sevk onayı KAPALI (varsayılan) → aynı adımda dispatch; AÇIK → PLANNED kalır (Sevk Kapısı).
    const confirmationEnabled = await readShipmentConfirmationEnabled();

    let result: { id: string; shipmentNo: string };
    let tahsisIzi: AllocationAuditTrail | null = null;
    /** Kapsama kapısının `warn` metni — tx içinde üretilir, yanıtta taşınır. */
    let kapsamaNotu: string | null = null;
    try {
      result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const core = await this.createShipmentCoreTx(tx, {
          sackIds,
          customerId: data.customerId,
          branchId,
          orderIds,
          destination,
          procedureCode: data.procedureCode,
          plateNumber: data.plateNumber,
          driverName: data.driverName,
          carrier: data.carrier,
          clientToken: data.clientToken,
          confirmationEnabled,
          orderless: data.orderless,
          userId,
        });
        // Tahsis izi çekirdekten TAŞINIR (tx dışında `flushAllocationAudit`e
        // gider). Çekirdek onu döndürmeseydi audit sessizce boş kalırdı.
        tahsisIzi = core.iz;
        kapsamaNotu = core.kapsamaUyarisi;
        return { id: core.id, shipmentNo: core.shipmentNo };
      }),
      undefined,
      (err) => {
        // clientToken P2002'si retry EDİLMEZ (retry hep aynı token'ı yazar) —
        // propagate edilir, catch replay'e çevirir; shipmentNo yarışı retry edilir.
        if (p2002Mentions(err, /clientToken/i)) return false;
        return true;
      },
    );
    } catch (err) {
      if (data.clientToken && p2002Mentions(err, /clientToken/i)) {
        const cached = await this.readCreateShipmentReplay(data.clientToken);
        if (cached) return cached;
      }
      throw err;
    }
    await this.flushAllocationAudit(tahsisIzi, userId);
    const dispatched = !confirmationEnabled;
    // ── TAHSİSSİZ SEVK GÖRÜNÜR OLSUN (BULGU-T3-002) ─────────────────────────
    // Sipariş seçilmeden kurulan sevkiyat hiçbir sipariş satırına yazılmaz:
    // karşılanma tablosu, "açık talep" süzgeci, Ürün Dengesi, Sevk & Termin
    // karnesi ve muhasebe fatura satırları o malı HİÇ görmez. Fabrika
    // karşılanmış talebi yeniden üretir. Tablet ekranı `orderIds` GÖNDERMİYOR
    // (sabit undefined) — yani oradan çıkan her sevkiyat sessizce böyleydi.
    // ⚠️ 400 DEĞİL, UYARI: deploy sırası backend ÖNCE; sert red sahadaki tüm
    // tabletleri aynı anda sevk yapamaz hâle getirirdi. Siparişsiz sevk zaten
    // MEŞRU bir iştir (numune, fazla mal) — eksik olan şey niyetin BEYAN
    // edilmesiydi. `orderless: true` gönderen istemci uyarı almaz.
    // ⚠️ METİN ARTIK ORTAK YARDIMCIDA (`orderlessWarning`): Hızlı Sevk de aynı
    // uyarıyı üretir. Buraya elle bir metin YAZMA — 2026-09-03'e kadar iki yol
    // ayrışıktı ve Hızlı Sevk hiç uyarı basmıyordu.
    const warnings: string[] = [];
    const orderlessNote = orderlessWarning(orderRequirement, {
      orderIds,
      orderless: data.orderless,
    });
    if (orderlessNote) warnings.push(orderlessNote);
    // Kapsama uyarısı (`shipping.orderCoverage=warn`). Bugün bu bilgi YALNIZ
    // önizlemede vardı; tablet Paketleme `orderIds: undefined` gönderdiği için
    // sahadaki asıl yol onu hiç görmüyordu.
    if (kapsamaNotu) warnings.push(kapsamaNotu);
    await AuditService.log({ userId, action: "CREATE", tableName: "SHIPMENT", recordId: result.id, newData: { shipmentNo: result.shipmentNo, customerId: data.customerId, branchId, sackIds, orderIds, orderless: data.orderless === true, destination, dispatched } });
    // Otomatik fatura taslağı — YALNIZ gerçekten sevk edildiyse. PLANNED bir
    // sevkiyat "mal çıktı" demez; onay açıkken taslak `dispatchShipment`'te doğar.
    const draftNote = dispatched ? await this.maybeAutoDraftInvoiceAfterDispatch(result.id, userId) : null;
    return {
      success: true,
      data: { id: result.id, shipmentNo: result.shipmentNo, status: dispatched ? ShipmentStatus.DISPATCHED : ShipmentStatus.PLANNED, dispatched },
      message:
        (dispatched ? `Sevk edildi: ${result.shipmentNo}` : `Sevkiyat kuruldu (onay bekliyor): ${result.shipmentNo}`) +
        (draftNote ? ` · ${draftNote}` : ""),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * SEVKİYAT KURULUMUNUN ÇEKİRDEĞİ — tx İÇİNDE koşar.
   *
   * `createShipment` (çuvaldan) ve `createShipmentFromRolls` (Hızlı Sevk) AYNI
   * çekirdeği çağırır. Kopyalansaydı iki yol zamanla ayrışırdı ve fark en kötü
   * yerde ortaya çıkardı: tahsis (`SackAllocation`), donmuş irsaliye ve iade
   * zinciri bu blokta kuruluyor — biri güncellenip diğeri unutulsa "hızlı sevk
   * ettiğim mal siparişe işlenmemiş" gibi sessiz bir fark doğardı.
   */
  private async createShipmentCoreTx(
    tx: Prisma.TransactionClient,
    p: {
      sackIds: string[];
      customerId: string;
      branchId: string | null;
      orderIds: string[];
      destination: ShipmentDestination;
      procedureCode?: string | null;
      plateNumber?: string | null;
      driverName?: string | null;
      carrier?: string | null;
      clientToken?: string | null;
      confirmationEnabled: boolean;
      /** Kullanıcının "siparişsiz / fazla mal" beyanı — kapsama kapısının kaçışı. */
      orderless?: boolean;
      userId?: string;
    },
  ): Promise<{
    id: string;
    shipmentNo: string;
    iz: AllocationAuditTrail | null;
    /** `shipping.orderCoverage` `warn` iken üretilen metin; yoksa null. */
    kapsamaUyarisi: string | null;
  }> {
    const shipmentNo = await nextShipmentNo(tx);
    const created = await tx.shipment.create({
      // ⚠️ Künye (Faz A2) `dispatchedById`den FARKLI bilgidir: sevkiyat
      // PLANNED doğar, sevk SONRA yapılır → planlayan ≠ sevk eden. Bu yüzden
      // burada createdById eklemek çoğaltma DEĞİL, ikinci bir gerçektir.
      data: {
        shipmentNo,
        clientToken: p.clientToken ?? null,
        customerId: p.customerId,
        branchId: p.branchId,
        status: ShipmentStatus.PLANNED,
        destination: p.destination,
        procedureCode: p.procedureCode?.trim() || null,
        createdById: p.userId ?? null,
        updatedById: p.userId ?? null,
      },
      select: { id: true, shipmentNo: true },
    });
    // DOĞUŞ OLAYI — defter sevkiyatın TÜM hayatını taşısın; ilk satır yoksa
    // "bu sevkiyat ne zaman kuruldu" yalnız `createdAt`ten okunur ve defter
    // yarım başlar.
    await writeShipmentEvent(tx, {
      shipmentId: created.id,
      type: ShipmentEventType.PLANNED,
      fromStatus: null,
      toStatus: ShipmentStatus.PLANNED,
      userId: p.userId ?? null,
    });
    // Atomik claim + seq ata (+ müşterisiz çuvala müşteri/şube backfill).
    for (let i = 0; i < p.sackIds.length; i++) {
      const claimed = await tx.sack.updateMany({
        where: { id: p.sackIds[i], shipmentId: null },
        data: { shipmentId: created.id, seq: i + 1, customerId: p.customerId, branchId: p.branchId },
      });
      if (claimed.count !== 1) throw AppError.conflict("Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin.");
    }
    // İçerik shipmentId açıkça (composite FK deferred → commit'te doğrulanır).
    await tx.roll.updateMany({ where: { sackId: { in: p.sackIds } }, data: { shipmentId: created.id } });
    await tx.swatch.updateMany({ where: { sackId: { in: p.sackIds } }, data: { shipmentId: created.id } });
    // Sipariş kümesi (kullanıcı seçimi) + spec-FIFO tahsis.
    await this.setShipmentOrdersTx(tx, created.id, p.orderIds);
    let iz: AllocationAuditTrail | null = await this.writeShipmentAllocationsTx(
      tx,
      created.id,
      p.orderIds,
      p.branchId,
    );
    // Onay kapalı → aynı tx'te sevk et (DISPATCHED).
    if (!p.confirmationEnabled) {
      const dp = await this.performDispatchTx(
        tx,
        created.id,
        { plateNumber: p.plateNumber, driverName: p.driverName, carrier: p.carrier },
        p.userId,
      );
      // Anında sevkte tahsis İKİ KEZ yazılır (kuruluşta + sevk anında);
      // ikincisi birincisini siler ve GEÇERLİ olan odur → iz de o olmalı.
      if (dp.iz) iz = dp.iz;
    }

    // KAPSAMA KAPISI (`shipping.orderCoverage`, 2026-09-06) — İKİNCİ EKSEN.
    // Burada, tahsis YAZILDIKTAN sonra çalışır: "sipariş seçildi mi" değil
    // "mal deftere yazıldı mı" sorusunu ölçer. Varsayılan `off` → hiçbir şey olmaz.
    // ⚠️ tx İÇİNDE: `block` rejiminde atılan hata sevkiyatı geri alır; yarım
    // kurulmuş bir sevkiyat bırakmak, kapının kendisinden daha kötü olurdu.
    const kapsamaRejimi = await resolveOrderCoverage();
    let kapsamaUyarisi: string | null = null;
    if (kapsamaRejimi !== "off" && p.orderIds.length > 0) {
      const mal = await tx.roll.aggregate({ where: { shipmentId: created.id }, _sum: { currentQty: true } });
      const cikan = Number(mal._sum.currentQty ?? 0);
      const yazilan = (iz?.yazilan ?? []).reduce((a2, y) => a2 + y.qty, 0);
      kapsamaUyarisi = assertCoverageAllowed(kapsamaRejimi, cikan - yazilan, {
        orderIds: p.orderIds,
        orderless: p.orderless,
      });
    }
    return { ...created, iz, kapsamaUyarisi };
  }

  /**
   * HIZLI SEVK — topları doğrudan sevk et (çuval kullanıcıya GÖRÜNMEZ).
   *
   * Persona denetiminin KRİTİK bulgusu: alım-satım firmasının en sık işi
   * "depodan 20 top seç → müşteriye gönder"di ve sistem bunu üç ekran +
   * top başına tekil barkod okutma olarak dayatıyordu. Çuval bu modelde
   * irsaliyenin, tahsisin ve iade zincirinin taşıyıcısı olduğu için
   * KALDIRILAMAZ — ama operatörden GİZLENEBİLİR: burada tek transaction
   * içinde otomatik açılır, doldurulur ve sevk edilir.
   *
   * ⚠️ TEK TRANSACTION: istemcide openSack + scan×N + createShipment
   * zincirlemek de mümkündü ama yarıda kopan akış yarı dolu bir çuval
   * bırakırdı (kod tabanının kendi emsali: `splitSack` yorumu). Tek tx
   * ya hepsini yapar ya hiçbirini.
   *
   * ⚠️ BARKOD İSTEMEZ: girdi `rollIds`'tir. Etiket basmayan, stoğunu ekrandan
   * yöneten kullanıcı birinci sınıf müşteridir; `scanIntoSack`'in barkod
   * anahtarlı yolu (fiziksel okutma) AYNEN durur.
   */
  /**
   * HIZLI SEVK — FIFO ÖNERİSİ ("3 top patos sattım, hangileri umurumda değil").
   *
   * Alım-satım firmasının en sık cümlesi bu: mal aynı spec'ten, hangi fiziksel
   * topun gittiği operatörün umurunda değil. Bugüne kadar sistem onu tek tek
   * top seçmeye (ya da okutmaya) zorluyordu.
   *
   * ⚠️ UYGUNLUK `SHIPPABLE_ROLL_WHERE`'DEN GELİR — burada elle yeniden yazma.
   * Öneri ile sevk claim'i ayrışırsa sistem kendi önerdiği topu reddeder.
   *
   * ⚠️ SIRA ÇIPASI `statusChangedAt` ("bu rafta ne zamandır duruyor") —
   * `createdAt` DEĞİL: depoya sonradan giren eski bir top, doğuş tarihine göre
   * sıralanırsa hep en öne geçer ve FIFO gerçekte rafta bekleyen malı değil
   * en eski KAYDI önerir. Damgası olmayan toplar (2026-08-09 trigger'ından
   * önceki fabrika kayıtları; ticaret kurulumunda mümkün değil, trigger
   * INSERT'te de damgalar) **SONA** düşer: yaşı bilinmeyen topu "en eski" diye
   * öne almak, olmayan bir bilgiyi iddia etmek olurdu. `id` son eşitlik
   * bozucudur — öneri iki çağrıda aynı sırayı vermek zorunda (bekçide kilitli).
   *
   * Öneri BAĞLAYICI DEĞİL: kullanıcı listeden tek tek çıkarabilir.
   */
  async findShippableRolls(params: {
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

  async createShipmentFromRolls(
    data: {
      rollIds: string[];
      customerId: string;
      branchId?: string | null;
      orderIds?: string[];
      /** Siparişsiz sevk NİYETİ — `createShipment` ile AYNI sözleşme (Dilim 2). */
      orderless?: boolean;
      destination?: ShipmentDestination;
      procedureCode?: string | null;
      plateNumber?: string | null;
      driverName?: string | null;
      carrier?: string | null;
      clientToken?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    if (data.clientToken) {
      const cached = await this.readCreateShipmentReplay(data.clientToken);
      if (cached) return cached;
    }
    const rollIds = [...new Set(data.rollIds)];
    if (rollIds.length === 0) throw AppError.badRequest("En az bir top seçilmeli");
    if (!data.customerId) throw AppError.badRequest("Müşteri seçilmeli");
    const orderIds = [...new Set(data.orderIds ?? [])];
    const branchId = data.branchId ?? null;
    const destination = data.destination ?? ShipmentDestination.DOMESTIC;

    // ⚠️ TARTI İSTEYEN HER REJİM HIZLI SEVKİ KAPATIR ve çuval yeni doğduğu için
    // tartısı YOKTUR. İki kaynak: (a) ihracat (her zaman, bayraktan bağımsız),
    // (b) `shipping.weighRequiredEnabled` (yurtiçi dahil).
    //
    // ⚠️ ALTERNATİF REDDEDİLDİ ("hızlı sevkte kg sor"): çuval kullanıcıya
    // GÖRÜNMEZ, tek tx içinde doğar — kg alanı eklemek hızlı sevkin varlık
    // sebebini (üç ekran → bir ekran) yok ederdi. Bayrağı açan kurulum bu bedeli
    // bilerek kabul eder; sürüm notunda operatör diliyle yazılıdır.
    const weighRequired = await readShippingWeighRequiredEnabled();
    if (destination === ShipmentDestination.EXPORT || weighRequired) {
      throw AppError.badRequest(
        destination === ShipmentDestination.EXPORT
          ? "İhracat sevkiyatı çuval tartısı ister — Paketleme / Çuvallar ekranından çuvalı açıp tartın, sonra sevkiyatı kurun."
          : "Bu kurulumda sevk öncesi çuval tartısı zorunlu — Hızlı Sevk çuvalı görünmeden ürettiği için tartılamaz. " +
              "Paketleme / Çuvallar ekranından çuvalı açıp tartın, sonra sevkiyatı kurun.",
        { code: destination === ShipmentDestination.EXPORT ? "EXPORT_WEIGH_REQUIRED" : "WEIGH_REQUIRED" },
      );
    }
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
    let result: { id: string; shipmentNo: string; iz: AllocationAuditTrail | null };
    try {
      result = await withBarcodeRetry(
        () =>
          prisma.$transaction(async (tx) => {
            // 1) Çuval doğar (operatöre görünmez) — konumu topların deposu.
            const sackNo = await nextSackNo(tx);
            const sack = await tx.sack.create({
              data: {
                sackNo,
                customerId: data.customerId,
                branchId,
                warehouseId: rolls[0]?.warehouseId ?? null,
              },
              select: { id: true },
            });
            // 2) Toplar ATOMİK claim ile bağlanır (barkod değil id ile).
            const claimed = await tx.roll.updateMany({
              where: { id: { in: rollIds }, ...SHIPPABLE_ROLL_WHERE },
              data: { sackId: sack.id },
            });
            if (claimed.count !== rollIds.length) {
              throw AppError.conflict(
                `Toplar bu sırada başka bir akışa girdi (${claimed.count}/${rollIds.length}) — sevkiyat kurulmadı, yenileyip tekrar deneyin.`,
              );
            }
            // 3) Normal sevkiyat çekirdeği — TAHSİS/İRSALİYE/İADE zinciri birebir aynı.
            return this.createShipmentCoreTx(tx, {
              sackIds: [sack.id],
              customerId: data.customerId,
              branchId,
              orderIds,
              destination,
              procedureCode: data.procedureCode,
              plateNumber: data.plateNumber,
              driverName: data.driverName,
              carrier: data.carrier,
              clientToken: data.clientToken,
              confirmationEnabled: await readShipmentConfirmationEnabled(),
              userId,
            });
          }),
        undefined,
        (err) => {
          if (p2002Mentions(err, /clientToken/i)) return false;
          return true;
        },
      );
    } catch (err) {
      if (data.clientToken && p2002Mentions(err, /clientToken/i)) {
        const cached = await this.readCreateShipmentReplay(data.clientToken);
        if (cached) return cached;
      }
      throw err;
    }

    const dispatched = !(await readShipmentConfirmationEnabled());
    // ⚠️ TAHSİS İZİ BURADA DA YAZILIR (merge, 2026-09-01). Hızlı Sevk yalnız
    // `feature/depo-mal-kabul`ta, tahsis iz defteri (`flushAllocationAudit`)
    // yalnız `adnansahin`de vardı — iki yol İLK KEZ bu merge'de yan yana geldi
    // ve çekirdek paylaşıldığı hâlde iz yalnız çuvaldan-sevk yolunda yazılıyordu.
    // Ayrışması, "aynı çekirdek aynı defteri tutar" varsayımını sessizce bozardı:
    // hızlı sevkle giden mal tahsis geçmişinde görünmezdi.
    await this.flushAllocationAudit(result.iz, userId);
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SHIPMENT",
      recordId: result.id,
      newData: { kind: "QUICK_FROM_ROLLS", shipmentNo: result.shipmentNo, customerId: data.customerId, rollCount: rollIds.length, orderIds, orderless: data.orderless === true },
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

  /**
   * Sevkiyat kurulum ÖNİZLEMESİ (salt-okunur): çuval içerik dökümü + seçili siparişlere
   * hesaplanan tahsis + fazla/eşleşmeyen/mükerrer UYARILARI. DB'ye hiçbir şey yazmaz.
   */
  async previewCreateShipment(
    data: { sackIds: string[]; customerId?: string | null; branchId?: string | null; orderIds?: string[] }
  ): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(data.sackIds)];
    if (sackIds.length === 0) {
      return { success: true, data: { sacks: [], lines: [], warnings: [], totals: { totalMeters: 0, sackCount: 0, surplusMeters: 0 } } };
    }
    const branchId = data.branchId ?? null;
    const orderIds = [...new Set(data.orderIds ?? [])];

    const sacks = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: { id: true, sackNo: true, weightKg: true, rolls: { select: { currentQty: true } } },
    });
    let totalMeters = D0();
    const sackRows = sacks.map((s) => {
      let m = D0();
      for (const r of s.rolls) m = m.plus(r.currentQty);
      totalMeters = totalMeters.plus(m);
      return { id: s.id, sackNo: s.sackNo, weightKg: s.weightKg != null ? Number(s.weightKg) : null, rollCount: s.rolls.length, totalMeters: Number(m) };
    });

    const warnings: string[] = [];
    let lines: { lineId: string; orderNumber: string; item: string; color: string | null; width: number | null; need: number; allocated: number }[] = [];
    let surplusMeters = Number(totalMeters);

    if (orderIds.length > 0) {
      const { allocations, lineNeeds } = await this.computeSackAllocations(prisma, { sackIds, orderIds, branchId });
      const allocByLine = new Map<string, Prisma.Decimal>();
      for (const a of allocations) allocByLine.set(a.orderLineId, (allocByLine.get(a.orderLineId) ?? D0()).plus(a.qty));
      const allocatedTotal = [...allocByLine.values()].reduce((acc, q) => acc.plus(q), D0());
      surplusMeters = Number(totalMeters.minus(allocatedTotal));

      const lineRows = await prisma.orderLine.findMany({
        where: { id: { in: [...lineNeeds.keys()] } },
        select: { id: true, width: true, item: { select: { name: true } }, color: { select: { name: true } }, order: { select: { orderNumber: true } } },
      });
      // Önizleme iç operasyon ekranıdır: her zaman bizdeki ad basılır. Satırdaki
      // müşteri override'ı yalnız adın girildiği siparişte dolu olduğundan burada
      // kullanmak aynı kumaşı iki farklı adla gösteriyordu.
      lines = lineRows.map((l) => ({
        lineId: l.id, orderNumber: l.order.orderNumber,
        item: l.item.name, color: l.color?.name ?? null,
        width: l.width != null ? Number(l.width) : null,
        need: Number(lineNeeds.get(l.id) ?? 0), allocated: Number(allocByLine.get(l.id) ?? 0),
      }));

      if (surplusMeters > 0.001) {
        warnings.push(`Seçili siparişlere yazılamayan ~${Math.round(surplusMeters)} m mal var (fazla/eşleşmeyen) — yine de sevk edilecek.`);
      }
      const pendingOther = await prisma.sackAllocation.groupBy({
        by: ["orderLineId"],
        where: { orderLineId: { in: [...lineNeeds.keys()] }, sack: { shipment: { status: ShipmentStatus.PLANNED } } },
        _sum: { qty: true },
      });
      for (const g of pendingOther) {
        const q = Number(g._sum.qty ?? 0);
        if (q > 0.001) {
          const ln = lines.find((x) => x.lineId === g.orderLineId);
          warnings.push(`${ln?.orderNumber ?? "Sipariş"} · ${ln?.item ?? ""}: bu satırda başka açık sevkiyatta ~${Math.round(q)} m bekliyor (mükerrer sevk olabilir).`);
        }
      }
    } else {
      // ⚠️ REJİME BAĞLI TEK UYARI BU. `off` yalnız BUNU susturur; yukarıdaki iki
      // uyarı (tahsis fazlası · başka açık sevkiyatta bekleyen mükerrer tahsis)
      // farklı soruların cevabıdır ve her rejimde AYAKTA kalır — diziyi topluca
      // susturmak, kırmızı tonlu mükerrer sevk uyarısını da öldürürdü.
      const mode = await resolveOrderRequirement();
      if (mode === "block") {
        warnings.push(
          "Bu kurulumda sevkiyat siparişe bağlanmalı — sipariş seçin ya da " +
            '"Siparişsiz devam et" ile niyeti beyan edin.',
        );
      } else if (mode === "warn") {
        warnings.push("Sipariş seçilmedi — mal hiçbir siparişten düşülmeden sevk edilecek.");
      }
    }

    return {
      success: true,
      data: {
        sacks: sackRows,
        lines,
        warnings,
        totals: { totalMeters: Number(totalMeters), sackCount: sacks.length, surplusMeters: Math.max(0, surplusMeters) },
      },
    };
  }

  /**
   * SEVKİYATI SİPARİŞE BAĞLA — sevk EDİLDİKTEN sonra da (BULGU-T3-002).
   *
   * Neden gerekli: tahsissiz çıkmış bir sevkiyatı düzeltmenin HİÇBİR yolu yoktu.
   * `setShipmentOrdersTx` yalnız `createShipment`tan çağrılıyordu, `add-sacks` /
   * `remove-sack` PLANNED istiyordu; tek çıkış storno + yeniden kurmaktı ve
   * sevkiyat faturalanmışsa storno da reddediliyordu. Yani mal çıkmış, sipariş
   * "Açık" kalmış ve kayıt kalıcı olarak yanlıştı.
   *
   * ⚠️ SIRA LOAD-BEARING: tahsisler silinir → ESKİ ∪ YENİ siparişlerin defteri
   * yeniden hesaplanır (yoksa `shippedQty` hâlâ silinen tahsisleri sayar ve yeni
   * kapasite EKSİK çıkar) → yeni tahsisler yazılır → defter tekrar hesaplanır.
   *
   * İrsaliye yeniden dondurulur (v+1): belge artık farklı bir sipariş kümesini
   * anlatıyor, eski sürüm tarihsel kayıt olarak durur.
   */
  async setShipmentOrders(shipmentId: string, orderIdsIn: string[], userId?: string): Promise<ApiResponse<unknown>> {
    const orderIds = [...new Set(orderIdsIn)];
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, shipmentNo: true, status: true, customerId: true, branchId: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.CANCELLED) {
      throw AppError.conflict("İptal edilmiş sevkiyat siparişe bağlanamaz");
    }
    // ⚠️ KAÇIŞ KAPISI — boş dizi "sipariş bağını KALDIR" demektir ve `block`
    // rejiminde kurulum kapısını atlatmanın en kısa yoludur (kur → bağı kaldır).
    // Beyan yolu burada YOKTUR (uç yalnız `orderIds` alır): niyetini beyan etmek
    // isteyen kullanıcı sevkiyatı zaten `orderless: true` ile kurar.
    assertOrderLinkAllowed(await resolveOrderRequirement(), { orderIds });
    const branchId = shipment.branchId ?? null;
    await this.assertOrdersBelong(orderIds, shipment.customerId, branchId);

    const dispatched = shipment.status === ShipmentStatus.DISPATCHED;
    let izSet: AllocationAuditTrail | null = null;
    await prisma.$transaction(async (tx) => {
      const eski = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      const etkilenen = [...new Set([...eski.map((o) => o.orderId), ...orderIds])];

      // ① Bu sevkiyatın tahsislerini kaldır ve defteri ONSUZ yeniden hesapla.
      await tx.sackAllocation.deleteMany({ where: { sack: { shipmentId } } });
      if (etkilenen.length > 0) {
        const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: etkilenen } }, select: { id: true } });
        await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
        await recomputeOrderStatusForOrdersTx(tx, etkilenen);
      }

      // ② Yeni kümeyi yaz + tahsisleri hesapla (iptal kontrolü orada, kilit altında).
      await this.setShipmentOrdersTx(tx, shipmentId, orderIds);
      izSet = await this.writeShipmentAllocationsTx(tx, shipmentId, orderIds, branchId);

      // ③ Sevk EDİLMİŞ sevkiyatta bağ satırları pasif doğar — `performDispatchTx`
      //    sevk anında hepsini pasifleştiriyor; buradan aktif satır bırakmak
      //    sevkiyatı "hâlâ planlanıyor" gibi gösterirdi.
      if (dispatched) {
        await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });
      }

      // ④ Defteri yeni tahsislerle tekrar hesapla.
      if (etkilenen.length > 0) {
        await recomputeOrderStatusForOrdersTx(tx, etkilenen);
      }

      // ⑤ İrsaliye yeni sipariş kümesiyle yeniden donar (v+1). Yalnız sevk
      //    edilmişte anlamlı — PLANNED sevkiyatın belgesi henüz donmamıştır.
      if (dispatched) {
        await printedDocumentService.freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, shipmentId, userId);
      }
    });

    await this.flushAllocationAudit(izSet, userId);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "SET_ORDERS", orderIds, dispatched },
    });
    return {
      success: true,
      data: { shipmentId, orderIds },
      message:
        orderIds.length === 0
          ? "Sevkiyatın sipariş bağı kaldırıldı"
          : `Sevkiyat ${orderIds.length} siparişe bağlandı — sipariş defteri güncellendi`,
    };
  }

  /** PLANNED sevkiyata depodan çuval(lar) ekle (tahsisler yeniden hesaplanır). */
  async addSacksToShipment(shipmentId: string, sackIdsIn: string[], userId?: string): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(sackIdsIn)];
    if (sackIds.length === 0) throw AppError.badRequest("Çuval seçilmeli");
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, customerId: true, branchId: true, destination: true } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyata çuval eklenebilir");
    const branchId = shipment.branchId ?? null;
    const { sacks } = await this.loadSacksForShipment(sackIds, { customerId: shipment.customerId, branchId });
    await this.assertWeighed(sacks, shipment.destination);

    let izAdd: AllocationAuditTrail | null = null;
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      const maxSeqRow = await tx.sack.findFirst({ where: { shipmentId }, orderBy: { seq: "desc" }, select: { seq: true } });
      let seq = (maxSeqRow?.seq ?? 0) + 1;
      for (const sackId of sackIds) {
        const claimed = await tx.sack.updateMany({ where: { id: sackId, shipmentId: null }, data: { shipmentId, seq, customerId: shipment.customerId, branchId } });
        if (claimed.count !== 1) throw AppError.conflict("Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin.");
        seq += 1;
      }
      await tx.roll.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId } });
      await tx.swatch.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId } });
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      izAdd = await this.writeShipmentAllocationsTx(tx, shipmentId, orderRows.map((o) => o.orderId), branchId);
    });
    await this.flushAllocationAudit(izAdd, userId);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "ADD_SACKS", sackIds } });
    return { success: true, data: {}, message: "Çuval(lar) sevkiyata eklendi" };
  }

  /** PLANNED sevkiyattan çuval çıkar → depoya döner (tahsisler yeniden hesaplanır). */
  async removeSackFromShipment(shipmentId: string, sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({ where: { id: sackId }, select: { id: true, shipmentId: true, shipment: { select: { status: true, branchId: true } } } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId !== shipmentId) throw AppError.badRequest("Çuval bu sevkiyatta değil");
    if (sack.shipment && sack.shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyattan çuval çıkarılabilir");
    const branchId = sack.shipment?.branchId ?? null;
    let izRemove: AllocationAuditTrail | null = null;
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      const claimed = await tx.sack.updateMany({ where: { id: sackId, shipmentId }, data: { shipmentId: null, seq: null } });
      if (claimed.count !== 1) throw AppError.conflict("Çuval bu sırada çıkarıldı — yenileyin");
      await tx.roll.updateMany({ where: { sackId }, data: { shipmentId: null } });
      await tx.swatch.updateMany({ where: { sackId }, data: { shipmentId: null } });
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      izRemove = await this.writeShipmentAllocationsTx(tx, shipmentId, orderRows.map((o) => o.orderId), branchId);
    });
    await this.flushAllocationAudit(izRemove, userId);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "REMOVE_SACK", sackId } });
    return { success: true, data: {}, message: "Çuval sevkiyattan çıkarıldı (depoya döndü)" };
  }

  /** Yurtiçi/yurtdışı kapsamını değiştir (PLANNED). */
  async setDestination(shipmentId: string, destination: ShipmentDestination, userId?: string): Promise<ApiResponse<unknown>> {
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      await tx.shipment.update({ where: { id: shipmentId }, data: { destination } });
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DESTINATION", destination } });
    return { success: true, data: { shipmentId, destination }, message: destination === ShipmentDestination.EXPORT ? "Yurtdışı sevk olarak işaretlendi" : "Yurtiçi sevk olarak işaretlendi" };
  }

  /** Prosedür/ihracat kodu güncelle (PLANNED). */
  async setProcedureCode(shipmentId: string, procedureCode: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const code = procedureCode?.trim() || null;
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      await tx.shipment.update({ where: { id: shipmentId }, data: { procedureCode: code } });
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "PROCEDURE_CODE", procedureCode: code } });
    return { success: true, data: { shipmentId, procedureCode: code }, message: "Prosedür kodu güncellendi" };
  }

  /** İrsaliye açıklaması (annotation) — sevkiyat DURUMU fark etmez, her an düzenlenir
   *  (SÜRÜM DOĞURMAZ; belge basılırken canlı çözülür). Boş → temizlenir. */
  async setDispatchNote(shipmentId: string, note: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const value = note?.trim().slice(0, 500) || null;
    const updated = await prisma.shipment.updateMany({ where: { id: shipmentId }, data: { dispatchNote: value } });
    if (updated.count === 0) throw AppError.notFound("Sevkiyat bulunamadı");
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DISPATCH_NOTE", dispatchNote: value } });
    return { success: true, data: { shipmentId, dispatchNote: value }, message: "İrsaliye açıklaması güncellendi" };
  }

  /**
   * ARACA YÜKLENEN GERÇEK ÇUVAL ADEDİ — operatörün beyanı.
   *
   * Neden var: sahada 10 çuval gönderilse bile hepsi tek bir çuval kaydının
   * içine yazılıyor. Sistemin saydığı `sacks.length` fiziksel gerçeği vermiyor;
   * irsaliyede "1 çuval" yazan bir araç 10 çuvalla yola çıkıyor.
   *
   * `dispatchNote` ile AYNI KATMAN (annotation): donmuş belge çekirdeğine
   * girmez, her an düzenlenebilir, sürüm doğurmaz, baskıda canlı çözülür.
   * `null` = beyan yok → belgede yalnız sistemin saydığı rakam çıkar.
   *
   * ⚠️ Bayrak KAPALIYKEN yazma REDDEDİLİR (yalnız UI'da gizlemek yetmez: alan
   * doğrudan uçtan da doldurulabilirdi ve kapalı bir özelliğin verisi sessizce
   * belgeye sızardı).
   */
  async setManualSackCount(shipmentId: string, count: number | null, userId?: string): Promise<ApiResponse<unknown>> {
    if (!(await readShipmentManualSackCountEnabled())) {
      throw AppError.badRequest("Elle çuval adedi girişi kapalı (Ayarlar → Sevkiyat)");
    }
    const value = count == null ? null : Math.trunc(count);
    if (value != null && (value < 1 || value > 9999)) {
      throw AppError.badRequest("Çuval adedi 1 ile 9999 arasında olmalı");
    }
    const updated = await prisma.shipment.updateMany({ where: { id: shipmentId }, data: { manualSackCount: value } });
    if (updated.count === 0) throw AppError.notFound("Sevkiyat bulunamadı");
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "MANUAL_SACK_COUNT", manualSackCount: value } });
    return { success: true, data: { shipmentId, manualSackCount: value }, message: "Çuval adedi güncellendi" };
  }

  /**
   * FATURA İŞARETİ — "bu sevkin faturası kesildi mi" (muhasebe ekranı).
   *
   * ERP fatura KESMEZ: burada saklanan yalnız dış muhasebe programındaki belgenin
   * numarası + tarihi. `invoiceNo: null` → işaret kaldırılır (yanlış no girilmiş olabilir),
   * tarih de birlikte temizlenir — "numarasız ama faturalı" ara durum YOK.
   *
   * Yalnız SEVK EDİLMİŞ sevkiyat faturalanır: planlı sevkiyatın malı daha çıkmadı,
   * ona kesilen fatura sahte olurdu. Kontrol `updateMany WHERE {id, status}` ile ATOMİK
   * yapılır (check-then-act yasağı) → 0 satır = ya kayıt yok ya statü uygun değil.
   */
  async setShipmentInvoice(
    shipmentId: string,
    invoiceNo: string | null,
    invoicedAt: Date | null,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const value = invoiceNo?.trim().slice(0, 64) || null;
    const stamp = value ? (invoicedAt ?? new Date()) : null;
    // ── FATURA İZİ REJİMİ (`shipping.invoiceMode`) ────────────────────────────
    // `clearing` = izi KALDIRMA → her modda serbest (yanlış iz düzeltilebilmeli).
    const invoiceMode = await resolveInvoiceMode();
    assertInvoiceTraceAllowed(invoiceMode, { clearing: value === null });
    // `ikisi` uyarısı için iç fatura NESTED RELATION'dan okunur — `prisma.invoice.`
    // erişimcisi bu servise GİRMEZ (rejim bekçisi sevkiyat router'ını "kapısız
    // ticaret" ilan ederdi).
    const internalDocNo =
      invoiceMode === "ikisi" && value !== null
        ? (
            await prisma.shipment.findUnique({
              where: { id: shipmentId },
              select: {
                invoices: {
                  where: { status: { not: InvoiceStatus.CANCELLED } },
                  select: { docNo: true },
                  take: 1,
                },
              },
            })
          )?.invoices[0]?.docNo ?? null
        : null;
    // ⚠️ TEK TX: defter satırı damgayla BİRLİKTE commit olmalı. İşaret kalkıp
    // defterde iz kalmazsa "fatura işaretini kim kaldırdı" cevapsız kalır —
    // üstelik bu işaret aynı zamanda storno kapısıdır (faturalanmış sevkiyat
    // geri alınamaz), yani onu kaldırmak bir YETKİ kararıdır.
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.shipment.updateMany({
        where: { id: shipmentId, status: ShipmentStatus.DISPATCHED },
        data: { invoiceNo: value, invoicedAt: stamp, invoicedById: value ? (userId ?? null) : null },
      });
      if (u.count > 0) {
        await writeShipmentEvent(tx, {
          shipmentId,
          type: value ? ShipmentEventType.INVOICED : ShipmentEventType.INVOICE_CLEARED,
          fromStatus: ShipmentStatus.DISPATCHED,
          toStatus: ShipmentStatus.DISPATCHED,
          reason: value ? `Fatura no: ${value}` : "Fatura işareti kaldırıldı",
          userId,
        });
      }
      return u;
    });
    if (updated.count === 0) {
      // Ayrımı kullanıcıya söyle: "bulunamadı" ile "henüz sevk edilmedi" farklı hatalar.
      const exists = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
      if (!exists) throw AppError.notFound("Sevkiyat bulunamadı");
      throw AppError.badRequest("Yalnız sevk edilmiş (DISPATCHED) sevkiyat faturalandırılabilir");
    }
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "INVOICE_MARK", invoiceNo: value, invoicedAt: stamp },
    });
    const traceNote = invoiceTraceWarning(invoiceMode, {
      clearing: value === null,
      internalDocNo,
    });
    return {
      success: true,
      data: { shipmentId, invoiceNo: value, invoicedAt: stamp },
      message: value ? "Fatura bilgisi kaydedildi" : "Fatura işareti kaldırıldı",
      ...(traceNote ? { warnings: [traceNote] } : {}),
    };
  }

  /** Fasondan doğrudan sevk fatura işareti — çuval sevkiyatıyla AYNI sözleşme.
   *  DirectShipment'ta statü yok (kayıt doğduğu an sevk edilmiştir) → statü guard'ı yok. */
  async setDirectShipmentInvoice(
    directShipmentId: string,
    invoiceNo: string | null,
    invoicedAt: Date | null,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const value = invoiceNo?.trim().slice(0, 64) || null;
    const stamp = value ? (invoicedAt ?? new Date()) : null;
    // ⚠️ DOĞRUDAN SEVK DE KAPSAMDA. Kapsam dışı bırakmak, `ic` modunda elle izin
    // kapatıldığı ama iç fatura satır kurucusunun yalnız `Shipment` tanıdığı bir
    // dünyada fasona doğrudan sevkin faturalanacak HİÇBİR yolunu bırakmazdı —
    // ama simetriyi bozmak da "aynı ekran, iki farklı kural" demekti. Karar:
    // kapsamda; `ic` modunu açan kurulum doğrudan sevki de ERP'den faturalar.
    const invoiceMode = await resolveInvoiceMode();
    assertInvoiceTraceAllowed(invoiceMode, { clearing: value === null });
    const internalDocNo =
      invoiceMode === "ikisi" && value !== null
        ? (
            await prisma.directShipment.findUnique({
              where: { id: directShipmentId },
              select: {
                invoices: {
                  where: { status: { not: InvoiceStatus.CANCELLED } },
                  select: { docNo: true },
                  take: 1,
                },
              },
            })
          )?.invoices[0]?.docNo ?? null
        : null;
    const updated = await prisma.directShipment.updateMany({
      where: { id: directShipmentId },
      data: { invoiceNo: value, invoicedAt: stamp, invoicedById: value ? (userId ?? null) : null },
    });
    if (updated.count === 0) throw AppError.notFound("Fasondan sevk kaydı bulunamadı");
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "DIRECT_SHIPMENT",
      recordId: directShipmentId,
      newData: { kind: "INVOICE_MARK", invoiceNo: value, invoicedAt: stamp },
    });
    const traceNote = invoiceTraceWarning(invoiceMode, {
      clearing: value === null,
      internalDocNo,
    });
    return {
      success: true,
      data: { directShipmentId, invoiceNo: value, invoicedAt: stamp },
      message: value ? "Fatura bilgisi kaydedildi" : "Fatura işareti kaldırıldı",
      ...(traceNote ? { warnings: [traceNote] } : {}),
    };
  }

  /** İrsaliye açıklamasını oku — irsaliye modalı notu ağır getDetail'siz alsın. */
  async getDispatchNote(shipmentId: string): Promise<ApiResponse<{ dispatchNote: string | null }>> {
    const s = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { dispatchNote: true } });
    if (!s) throw AppError.notFound("Sevkiyat bulunamadı");
    return { success: true, data: { dispatchNote: s.dispatchNote } };
  }

  /**
   * Çuval yorumu (annotation) — çuvalın DURUMU fark etmez, her an düzenlenir.
   * `touchWarehouseSackTx` BİLİNÇLİ OLARAK YOK: o guard ölçüm/içerik invariant'ını korur
   * (sevkiyata atanmış çuvalın kg'si/içeriği değişmesin), yorum ise ne ölçüm ne içerik —
   * sevk edilmiş çuvala da "müşteri şikayet etti" yazılabilmeli (dispatchNote ile aynı
   * gerekçe). Guard'ı "eksik" sanıp eklemeyin. Boş/whitespace → temizlenir (NULL).
   *
   * ETİKET BAYATLIĞI KOŞULLUDUR (2026-08-21) — bkz. `sackNoteAppearsOnLabel`.
   */
  async setSackNotes(sackId: string, notes: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const value = notes?.trim().slice(0, 500) || null;
    // Not GERÇEKTEN değişti mi + hangi müşterinin şablonuna bakılacak: yazmadan önce oku.
    const before = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { notes: true, customerId: true },
    });
    if (!before) throw AppError.notFound("Çuval bulunamadı");
    const updated = await prisma.sack.updateMany({ where: { id: sackId }, data: { notes: value } });
    if (updated.count === 0) throw AppError.notFound("Çuval bulunamadı");

    // KOŞULLU BAYAT: `sackNote` şablona sürüklenmişse basılı etiket artık yalan.
    // Koşulsuz yazsaydık, notu HİÇ basmayan kurulumlarda (varsayılan) her not
    // düzenlemesi sahte "yeniden bas" uyarısı üretir, rozet enflasyonu da gerçek
    // uyarıyı öldürürdü. Değer değişmediyse (aynı metin yeniden kaydedildi) hiç sorma.
    let labelDirty = false;
    if (value !== before.notes) {
      labelDirty = await this.sackNoteAppearsOnLabel(before.customerId);
      if (labelDirty) {
        await prisma.sack.updateMany({ where: { id: sackId, labelDirty: false }, data: { labelDirty: true } });
      }
    }

    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: sackId, newData: { kind: "SACK_NOTES", notes: value, labelDirty } });
    return { success: true, data: { sackId, notes: value, labelDirty }, message: value ? "Çuval notu kaydedildi" : "Çuval notu temizlendi" };
  }

  /**
   * Bu çuvalın ETKİN etiket şablonu `sackNote` alanını basıyor mu?
   *
   * Çuval notu, katalogda OPT-IN bir alandır (`config/label-fields.ts` → SACK_FIELDS:
   * "şablona SÜRÜKLENMEZSE basılmaz") — yani çoğu kurulumda not kâğıda hiç çıkmaz.
   * Bu yüzden not düzenlemesi etiketi ancak alan şablonda VARSA bayatlatır.
   *
   * Şablon zinciri `markSackLabelsStaleOnCustomerChange` ile AYNI:
   * `CustomerTemplateRoute(müşteri, SACK)` ?? bağlam varsayılanı
   * (`LabelContextDefault`). Cihaz (peripheral) rotası BİLEREK dışarıda — not
   * düzenlenirken hangi yazıcıya basılacağı bilinmez; tahmin etmek yanlış şablona
   * bakıp sessizce yanlış cevap vermek olurdu.
   *
   * FAIL-OPEN'IN TERSİ: şablon çözülemezse (atama yok / pasif / silinmiş) `false`
   * döner — basılacak bir düzen yoksa bayatlayacak kâğıt da yoktur. Bu, çuval
   * etiketi BASKISININ fail-closed davranışıyla (şablon yoksa 400) çelişmez:
   * orada soru "basayım mı", burada "basılmışı yalanladım mı".
   *
   * Koşullu (`showIf`) eleman SAYILMAZ — `collectBoundKeys` sözleşmesi: o küme
   * "her baskıda çıkan alanlar"dır (zaten SACK payload'unda `qualityGrade` yok,
   * koşul fail-closed ile basılmaz).
   */
  private async sackNoteAppearsOnLabel(customerId: string | null): Promise<boolean> {
    const select = {
      name: true,
      rawCode: true,
      isActive: true,
      deletedAt: true,
      variants: { select: { elements: true } },
    } as const;
    type Tpl = { name: string; rawCode: Prisma.JsonValue | null; isActive: boolean; deletedAt: Date | null; variants: { elements: Prisma.JsonValue }[] };
    const usable = (t: Tpl | null | undefined): Tpl | null =>
      t && t.isActive && t.deletedAt == null ? t : null;

    let tpl: Tpl | null = null;
    if (customerId) {
      const route = await prisma.customerTemplateRoute.findUnique({
        where: { customerId_kind: { customerId, kind: LabelKind.SACK } },
        select: { template: { select } },
      });
      tpl = usable(route?.template);
    }
    if (!tpl) {
      const def = await prisma.labelContextDefault.findUnique({
        where: { kind: LabelKind.SACK },
        select: { template: { select } },
      });
      tpl = usable(def?.template);
    }
    if (!tpl) return false;

    if (collectBoundKeys({ name: tpl.name, variants: tpl.variants }).has("sackNote")) return true;
    // Uzman raw-code override: kanvas hiç çizilmez, `{{sackNote}}` yer tutucusu
    // doldurulur (`label-rawcode`). Dil bilinmediği için TÜM diller taranır.
    const raw = tpl.rawCode;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const v of Object.values(raw)) {
        if (typeof v === "string" && v.includes("sackNote")) return true;
      }
    }
    return false;
  }

  /** Çuval yorumunu oku — yorum sheet'i içerik listesi çekmeden notu alsın. */
  async getSackNotes(sackId: string): Promise<ApiResponse<{ notes: string | null }>> {
    const s = await prisma.sack.findUnique({ where: { id: sackId }, select: { notes: true } });
    if (!s) throw AppError.notFound("Çuval bulunamadı");
    return { success: true, data: { notes: s.notes } };
  }

  /**
   * Sevk tx'i — createShipment auto-dispatch + dispatchShipment ortak çekirdeği. PLANNED →
   * DISPATCHED: toplar SHIPPED, tahsisler → shippedQty (recompute), irsaliye dondurulur.
   * Döner: sevk edilen top adedi. Çağıran ön-koşulları (dolu, EXPORT tartı) garanti eder.
   */
  private async performDispatchTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
    // ⚠️ Dönüş artık {flipped, iz}: tahsis yeniden hesabının audit izi tx DIŞINDA
    // yazılmalı (proje kuralı) → çağırana taşınır. Örnek alan desen:
    // `createShipment`/`setShipmentOrders` (aynı iz `flushAllocationAudit`e gider).
  ): Promise<{ flipped: number; iz: AllocationAuditTrail | null }> {
    const claim = await tx.shipment.updateMany({
      where: { id: shipmentId, status: ShipmentStatus.PLANNED },
      data: {
        status: ShipmentStatus.DISPATCHED,
        dispatchedAt: new Date(),
        dispatchedById: userId ?? null,
        ...(data.plateNumber !== undefined ? { plateNumber: data.plateNumber } : {}),
        ...(data.driverName !== undefined ? { driverName: data.driverName } : {}),
        ...(data.carrier !== undefined ? { carrier: data.carrier } : {}),
      },
    });
    if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
    await writeShipmentEvent(tx, {
      shipmentId,
      type: ShipmentEventType.DISPATCHED,
      fromStatus: ShipmentStatus.PLANNED,
      toStatus: ShipmentStatus.DISPATCHED,
      userId,
    });

    // HAYALET GUARD'I — tx İÇİ, sevkiyat satır kilidi ALINDIKTAN sonra, flip'ten ÖNCE.
    // Aşağıdaki flip `status: { not: SHIPPED }` ile ÇUVALDAKİ HER TOPU SHIPPED'e çeker;
    // `AT_KARTELA`/`TAMBUR_CONSUMED` de ezilir ve hatanın tek kanıtı (statü) yok olur,
    // ardından `freezeForSource` şişmiş metrajı DONDURUR.
    // ⚠️ NEDEN filtre DEĞİL de assertion: flip'in WHERE'ine `notIn` koymak hayaleti
    // DISPATCHED çuvalda `AT_KARTELA` olarak bırakır; `removeRollFromSack` sevkiyattaki
    // çuvalı reddettiği için o top bir daha ÇIKARILAMAZ → onarılamaz çıkmaz. Assertion
    // ise tx'i geri sarar: ne statü ezilir, ne belge donar, ne veri kirlenir.
    // Ön guard `loadSacksForShipment`'te; bu, kilit altındaki taze son savunmadır.
    const ghosts = await tx.roll.findMany({
      where: { shipmentId, status: { in: SACK_ABSENT_STATUSES } },
      select: { barcode: true, status: true, sack: { select: { sackNo: true } } },
      take: 10,
    });
    if (ghosts.length > 0) {
      throw AppError.badRequest(
        "Sevk edilemez — çuvalda kayıtlı ama fiziksel olarak binada olmayan top var: " +
          ghosts
            .map((g) => `${g.sack?.sackNo ?? "?"} / ${g.barcode ?? "(barkodsuz)"} → ${g.status}`)
            .join(", ") +
          '. "Paketleme / Çuvallar" ekranından bu topları çuvaldan çıkarıp tekrar deneyin.'
      );
    }

    // K6 — DEPOSUZ TOP STOK KÜMESİNDEN ÇIKAMAZ. Defter çıkış satırının bir depo
    // ucu olmak zorunda; yoksa mal çıkar ama defter çıkışı görmez (ölçüldü: iki
    // top sevk edildi, TEK `SHIPMENT` satırı yazıldı — eski kapı uçsuz satırı
    // sessizce atlıyordu). Kapı BURADA, kilidin altında ve taze veriyle:
    // defterdeki `assertEndShape` son ağdır, oraya ulaşmak "kapı atlandı" demek.
    const warehouseless = await tx.roll.findMany({
      where: { shipmentId, warehouseId: null },
      select: { id: true, barcode: true, warehouseId: true },
    });
    assertRollsHaveWarehouse(warehouseless, "Sevk edilemez");

    await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });

    // ÇUVAL İZLERİ (ETİKET) TEMİZLENİR — sevk ANINDA, SOFT damgayla (2026-09-04).
    // İz depodaki işi anlatır ("kontrol et", "eksik"); mal çıktıktan sonra artık
    // hiçbir şey söylemiyor. BURASI üç sevk yolunun (onaylı · onaysız doğrudan
    // sevk · createShipmentFromRolls) ORTAK boğazı — tek satır üçünü de kapatır.
    // Damga `undoDispatch` storno dalında `clearedShipmentId` adresiyle geri alınır.
    await clearSackTagsOnDispatchTx(tx, shipmentId);

    // SEVK ÖNCESİ STATÜ SNAPSHOT'I (2026-08-05) — tek `updateMany` ile hepsini
    // SHIPPED yapmak, geri alma (storno) için gereken "bu top hangi raftan geldi"
    // bilgisini yok ediyordu. Çuvalda `WAREHOUSE` ve `A1_STOCK` (2. kalite) toplar
    // BİRLİKTE bulunabilir; geri almada hepsini WAREHOUSE'a döndürmek 2. kaliteyi
    // sessizce 1. kalite rafına yazardı. Statüye göre gruplayıp her grubu kendi
    // snapshot'ıyla yazıyoruz (pratikte 1-2 grup; `tx` içinde Promise.all YASAK).
    const preStatusGroups = await tx.roll.groupBy({
      by: ["status"],
      where: { shipmentId, status: { not: RollStatus.SHIPPED } },
    });
    let flipped = 0;
    for (const g of preStatusGroups) {
      const res = await tx.roll.updateMany({
        where: { shipmentId, status: g.status },
        data: { status: RollStatus.SHIPPED, preShipStatus: g.status },
      });
      flipped += res.count;
    }
    // DEPO DEFTERİ — mal depodan ÇIKTI. `Roll.warehouseId` BİLEREK temizlenmez
    // ("en son hangi depodaydı" izi + sevk stornosunun geri dönüş adresi), o yüzden
    // çıkışı yalnız bu defter kaydeder. Tek `createMany` (perf kuralı 9).
    if (flipped > 0) {
      const shippedRows = await tx.roll.findMany({
        where: { shipmentId, status: RollStatus.SHIPPED },
        select: { id: true, currentQty: true, warehouseId: true },
      });
      await writeWarehouseMovements(
        tx,
        shippedRows.map((r) => ({
          rollId: r.id,
          eventType: WarehouseEventType.SHIPMENT,
          qty: r.currentQty,
          fromWarehouseId: r.warehouseId,
          shipmentId,
          userId: userId ?? null,
        })),
        // Sevk brüt ve defterden türer: 0 metraj veri hatası, uçsuz top atlanır.
        { onUnwritable: "throw" },
      );
    }
    // Tahsisler artık DISPATCHED sevkiyatta → shippedQty defterden yeniden hesaplanır.
    const sevkiyat = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: { branchId: true },
    });
    const dispatchBranchId = sevkiyat?.branchId ?? null;
    const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
    // Lost-update kilidi: recompute defteri KİLİTSİZ okuyup shippedQty yazar — READ
    // COMMITTED altında aynı siparişe eşzamanlı iki terminal olay (iki dispatch, ya da
    // dispatch ∥ fason directShip) birbirinin commit'ini görmeden eksik toplam yazardı
    // (order-status.helper doc'u). Protokol: etkilenen siparişlerin TAM satır kümesi
    // recompute'tan ÖNCE tek sıralı touchOrderLinesTx partisiyle kilitlenir
    // (subcontractor directShip ile aynı; alt-küme kilidi deadlock riski taşır).
    const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
    const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await touchOrderLinesTx(tx, lineRows.map((l) => l.id));

    // ⚠️ TAHSİS SEVK ANINDA YENİDEN HESAPLANIR (BULGU-T3-009). Eskiden sevkiyat
    // kurulurken hesaplanan rakam sevk anına kadar DONUYORDU ve arada gerçek
    // değişebiliyordu:
    //   T0 sevkiyat DISPATCHED (500 m, siparişin 500 m'lik kalemine tahsisli)
    //   T1 storno → sevkiyat PLANNED'a döner, tahsis satırları BİLİNÇLİ korunur
    //   T2 satış aynı kalemi 200 m'ye düşürür
    //   T3 "Sevk Et" → bayat 500 m `shippedQty`ye terfi eder
    // Sonuç: 200 m'lik kaleme 500 m sevk yazılır; "Açık" −300 m çıkar, arayüz
    // onu 0'a kelepçelediği için fazla sevk HİÇBİR EKRANDA görünmez.
    //
    // ⚠️ ÇIKIŞI ENGELLEMEZ — ölçüldü: `allocation.helper` içinde TEK BİR `throw`
    // yok; talebi aşan mal basitçe TAHSİSSİZ kalır (`continue`/`break`). Yani
    // mal her hâlükârda çıkar, değişen tek şey deftere yazılan rakamdır ve o
    // rakam artık sevk anının gerçeğidir. Sahada yapılabilen hiçbir şey
    // yapılamaz hâle gelmiyor.
    const tazeTahsisIzi = await this.writeShipmentAllocationsTx(tx, shipmentId, orderIds, dispatchBranchId);
    if (tazeTahsisIzi) {
      // Çıkan mal ↔ siparişe yazılan: fark TAHSİSSİZ metrajdır. Sessiz kalmasın.
      const mal = await tx.roll.aggregate({ where: { shipmentId }, _sum: { currentQty: true } });
      const cikan = Number(mal._sum.currentQty ?? 0);
      const yazilanToplam = tazeTahsisIzi.yazilan.reduce((a, y) => a + y.qty, 0);
      const fark = Math.round((cikan - yazilanToplam) * 1000) / 1000;
      tazeTahsisIzi.tahsissizMetraj = fark > 0 ? fark : 0;
    }
    await recomputeOrderStatusForOrdersTx(tx, orderIds);
    // Resmi belge — sevk irsaliyesi v1 burada donar.
    await printedDocumentService.freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, shipmentId, userId);
    return { flipped, iz: tazeTahsisIzi };
  }

  /**
   * Sevk (fiziksel çıkış) — PLANNED → DISPATCHED. Yalnız sevk onayı AÇIKKEN gerekir
   * (kapalıyken createShipment zaten doğrudan dispatch eder). Toplar SHIPPED, tahsisler
   * → shippedQty terfi eder, irsaliye dondurulur. Kapı önü adımı YOK.
   */
  async dispatchShipment(
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, destination: true, sacks: { select: { sackNo: true, weightKg: true } } },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.DISPATCHED) throw AppError.conflict("Sevkiyat zaten sevk edilmiş");
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyat sevk edilebilir");
    if (shipment.sacks.length === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez");
    await this.assertWeighed(shipment.sacks, shipment.destination);

    const dispatchSonuc = await prisma.$transaction((tx) => this.performDispatchTx(tx, shipmentId, data, userId));
    const shippedRolls = dispatchSonuc.flipped;
    // Tahsis yeniden hesabının izi — tx DIŞINDA (proje kuralı).
    await this.flushAllocationAudit(dispatchSonuc.iz, userId);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DISPATCH", rollCount: shippedRolls, plateNumber: data.plateNumber ?? null, driverName: data.driverName ?? null } });
    const draftNote = await this.maybeAutoDraftInvoiceAfterDispatch(shipmentId, userId);
    return {
      success: true,
      data: { shipmentId, rollCount: shippedRolls },
      message: "Sevk edildi — stok bina dışı, karşılanma kesinleşti" + (draftNote ? ` · ${draftNote}` : ""),
    };
  }

  // =========================================================================
  // SEVK SONRASI KANCA — OTOMATİK SATIŞ FATURASI TASLAĞI (dinamik yükleme)
  // =========================================================================
  /**
   * Üç dispatch yolunun ORTAK kancası — gövde `helpers/shipment-auto-draft.helper.ts`te
   * yaşar ve BİLİNÇLİ olarak DİNAMİK yüklenir:
   *  ① `shipping.routes` bir FABRİKA router'ıdır ve rejim kapısı TAŞIYAMAZ
   *    (fabrikada sevkiyat `finance.enabled`a bağlanamaz). `invoice.service`i
   *    buradan STATİK import etmek, `test_finance_regime_gate`in türetilmiş
   *    kapsamında shipping + return router'larını "ticarete dokunuyor" yapar —
   *    ve bekçi HAKLI olur: statik kenar, modül yüklenince gerçekten kurulur.
   *    Dinamik yüklemede fabrika süreci, bayraklar kapalıyken o modülü HİÇ
   *    yüklemez. Davranışı koruyan şey bu satır değil, helper'ın kendi çift
   *    bayrak kapısıdır (financeEnabled → autoDraftFromShipment); bekçisi
   *    `test_auto_draft_shipment` (§4 modül şalteri dahil).
   *  ② invoice ↔ shipping statik çift yönü modül-init döngüsü riskiydi
   *    (eski yorum "ters yönde import eklemeden önce yeniden ölç" diyordu);
   *    dinamik yükleme bu sınıfı kökten kapatır.
   *
   * ⚠️ SEVK ASLA TASLAK YÜZÜNDEN DÜŞMEZ: helper kendi hatalarını yutar
   * (409 sessiz, gerisi warn + mesajda çıkış yolu); buradaki catch yalnız
   * MODÜL YÜKLEME hatasını (bozuk build) karşılar — o da sevki düşürmez.
   */
  private async maybeAutoDraftInvoiceAfterDispatch(
    shipmentId: string,
    userId?: string,
  ): Promise<string | null> {
    try {
      const { autoDraftInvoiceAfterDispatch } = await import("./helpers/shipment-auto-draft.helper");
      return await autoDraftInvoiceAfterDispatch(shipmentId, userId);
    } catch (err) {
      uyari("auto-draft", `Kanca modülü yüklenemedi (sevk ${shipmentId} etkilenmedi):`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  // =========================================================================
  // İPTAL (yıkıcı) — önizleme + uygula
  // =========================================================================

  /** İptal önizleme — depoya dönecek çuvallar + tahsisi kalkacak siparişler. */
  async getCancelPreview(shipmentId: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        _count: { select: { sacks: true, rolls: true, swatches: true } },
        sacks: { select: { allocations: { select: { qty: true, orderLine: { select: { order: { select: { orderNumber: true } } } } } } } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    const canCancel = shipment.status !== ShipmentStatus.DISPATCHED && shipment.status !== ShipmentStatus.CANCELLED;
    const byOrder = new Map<string, Prisma.Decimal>();
    for (const sk of shipment.sacks) {
      for (const a of sk.allocations) {
        const ord = a.orderLine.order.orderNumber;
        byOrder.set(ord, (byOrder.get(ord) ?? D0()).plus(a.qty));
      }
    }
    return {
      success: true,
      data: {
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        customerName: shipment.customer.name,
        branchName: shipment.branch?.name ?? null,
        canCancel,
        reason: canCancel ? null : "Sevk edilmiş veya iptal edilmiş sevkiyat iptal edilemez.",
        sackCount: shipment._count.sacks,
        rollCount: shipment._count.rolls,
        swatchCount: shipment._count.swatches,
        affectedOrders: [...byOrder.entries()].map(([orderNumber, qty]) => ({ orderNumber, qty: qty.toString() })),
      },
    };
  }

  /**
   * PLANNED sevkiyatı İPTAL eden tx gövdesi — TEK KAYNAK (2026-08-22). İki çağıran:
   * `cancelShipment` (kullanıcı "İptal Et") ve `undoDispatch` `releaseSacks` ile
   * (storno + kapanış AYNI tx'te). Claim `expectedStatus` üzerinden atomik; çuvallar
   * ve içerik havuza döner (shipmentId null), tahsisler silinir, sipariş defteri
   * yeniden hesaplanır. İkinci bir kopya yazma — iki yol ayrıştığında "İptal Et"
   * çuvalı serbest bırakırken storno kapanışı çuvalı üstünde unutur.
   */
  private async cancelPlannedShipmentTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    expectedStatus: ShipmentStatus,
    opts?: { userId?: string; reason?: string | null; reasonCode?: string | null },
  ): Promise<void> {
    const claim = await tx.shipment.updateMany({
      where: { id: shipmentId, status: expectedStatus },
      // İPTAL KÜNYESİ (2026-09-11): 37 modelin konvansiyonu; iptal edilebilen tek
      // belge olmasına rağmen burada YOKTU ve iptal yalnız `status`tan okunuyordu.
      data: {
        status: ShipmentStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: opts?.userId ?? null,
        cancelReason: opts?.reason?.slice(0, 300) ?? null,
        cancelReasonCode: opts?.reasonCode?.slice(0, 64) ?? null,
      },
    });
    if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
    await writeShipmentEvent(tx, {
      shipmentId,
      type: ShipmentEventType.CANCELLED,
      fromStatus: expectedStatus,
      toStatus: ShipmentStatus.CANCELLED,
      reason: opts?.reason ?? null,
      reasonCode: opts?.reasonCode ?? null,
      userId: opts?.userId ?? null,
    });
    // Tahsisleri sil (çuval.shipmentId null'lanmadan ÖNCE — yoksa where eşleşmez) + sipariş defteri.
    const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
    // Lost-update kilidi (performDispatchTx ile simetrik): defter mutasyonu
    // (deleteMany) + recompute, etkilenen siparişlerin TAM satır kümesi kilitliyken
    // koşar — eşzamanlı dispatch/iptal shippedQty'yi eksik yazamaz.
    const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
    const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
    await tx.sackAllocation.deleteMany({ where: { sack: { shipmentId } } });
    await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });
    // Çuvallar depoya döner; içerik shipmentId null.
    await tx.roll.updateMany({ where: { shipmentId }, data: { shipmentId: null } });
    await tx.swatch.updateMany({ where: { shipmentId }, data: { shipmentId: null } });
    await tx.sack.updateMany({ where: { shipmentId }, data: { shipmentId: null, seq: null } });
    await recomputeOrderStatusForOrdersTx(tx, orderIds);
  }

  /**
   * Sevkiyatı iptal et (soft → CANCELLED). PLANNED iptal edilebilir: çuvallar depoya
   * döner, tahsisler silinir (sipariş bağı kalkar). DISPATCHED iptal edilemez.
   */
  async cancelShipment(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, _count: { select: { sacks: true } } } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.CANCELLED) return { success: true, data: { shipmentId }, message: "Sevkiyat zaten iptal edilmiş" };
    if (shipment.status === ShipmentStatus.DISPATCHED) throw AppError.conflict("Sevk edilmiş sevkiyat iptal edilemez");

    await prisma.$transaction(async (tx) => {
      await this.cancelPlannedShipmentTx(tx, shipmentId, shipment.status, { userId });
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "CANCEL", freedSacks: shipment._count.sacks } });
    return { success: true, data: { shipmentId, freedSacks: shipment._count.sacks }, message: "Sevkiyat iptal edildi — çuvallar depoya döndü" };
  }

  // =========================================================================
  // SEVKİ GERİ AL (STORNO) — "mal hiç çıkmadı", İADE DEĞİL
  // =========================================================================
  //
  // İADE ile karıştırma — sektörde iki AYRI belge ve iki ayrı gerçek:
  //   • İade (RMA)   : mal müşteriye ULAŞTI, geri geldi. Çıkış belgesi DÜZELTİLMEZ
  //                    (brüt kuralı), ayrı iade irsaliyesi kesilir, iade defterine yazılır.
  //   • Storno (bu)  : mal HİÇ ÇIKMADI — kayıt erken/hatalı (araç kapıda, yanlış
  //                    sevkiyat onaylandı). Çıkış belgesi İPTAL edilir, stok geri döner,
  //                    iade defterine GİRMEZ (yoksa "müşteri iade etti" yalanı doğar ve
  //                    iade nedeni zorunlu olduğu için kalite verisi de kirlenir).
  // SAP karşılığı VL09 (reverse goods issue). Aynı ayrımın projedeki emsali:
  // `InventoryService.softDelete` (qtyOut=0, storno) ↔ WO-kapanış dispozisyonu (qtyOut=qtyIn).

  /**
   * Storno engel sebebi — TEK KAYNAK. Önizleme ve mutasyon AYNI yüklemi çağırır
   * (kopyalanan ikinci bir kural, ekranda "yapılabilir" derken uçta 409 verirdi).
   * `null` = geri alınabilir.
   */
  private resolveUndoBlockReason(input: {
    status: ShipmentStatus;
    invoiceNo: string | null;
    dispatchedAt: Date | null;
    activeReturnCount: number;
    sameDayOnly: boolean;
  }): string | null {
    if (input.status === ShipmentStatus.CANCELLED) return "İptal edilmiş sevkiyat geri alınamaz.";
    if (input.status !== ShipmentStatus.DISPATCHED) {
      return "Yalnız sevk edilmiş sevkiyat geri alınabilir — bu sevkiyat henüz çıkmamış.";
    }
    // Fatura: dış muhasebe programında belge kesilmiş demektir; çıkışı geri sarmak
    // faturayı dayanaksız bırakır. Doğru yol iade + iade faturasıdır.
    if (input.invoiceNo) {
      return `Bu sevkiyat faturalanmış (${input.invoiceNo}) — geri alınamaz. Fatura işaretini kaldırın ya da iade akışını kullanın.`;
    }
    // İade: iki motor aynı topa dokunur. İade "mal çıktı ve döndü" der, storno
    // "hiç çıkmadı" — ikisi aynı sevkiyatta birleşince hangi rakamın doğru olduğu
    // hiçbir yüzeyde söylenemez hale gelir.
    if (input.activeReturnCount > 0) {
      return `Bu sevkiyattan ${input.activeReturnCount} iade alınmış — geri alınamaz. Mal çıkıp döndüyse kalanı da iade olarak alın.`;
    }
    if (input.sameDayOnly) {
      const dayStart = factoryDayStart();
      if (!input.dispatchedAt || input.dispatchedAt < dayStart) {
        return "Sevk geri alma aynı günle sınırlı (Genel Ayarlar → Sevkiyat & İade). Bu sevkiyat bugün sevk edilmemiş.";
      }
    }
    return null;
  }

  /** Storno önizleme (yıkıcı işlem kuralı: etkilenen her kayıt somut listelenir). */
  async getUndoDispatchPreview(shipmentId: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true, dispatchedAt: true, invoiceNo: true,
        plateNumber: true, driverName: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        _count: { select: { sacks: true, rolls: true, swatches: true } },
        sacks: { select: { id: true, sackNo: true, _count: { select: { rolls: true } } } },
        orders: { select: { order: { select: { orderNumber: true } } } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    const [activeReturnCount, sameDayOnly, confirmationEnabled] = await Promise.all([
      prisma.rollReturn.count({ where: { fromShipmentId: shipmentId, cancelledAt: null } }),
      readShipmentUndoSameDayOnly(),
      // İstemci "sevkiyatı da kapat" seçeneğinin VARSAYILANINI bundan kurar:
      // sevk onayı KAPALI rejimde geri alınan sevkiyatın PLANNED beklemesinin
      // karşılığı yok (çıkış onayı ekranı bayrak kapalıyken görünmez) → varsayılan
      // kapat; AÇIK rejimde PLANNED doğal durum → varsayılan beklet.
      readShipmentConfirmationEnabled(),
    ]);
    const blockReason = this.resolveUndoBlockReason({
      status: shipment.status,
      invoiceNo: shipment.invoiceNo,
      dispatchedAt: shipment.dispatchedAt,
      activeReturnCount,
      sameDayOnly,
    });

    // Topların döneceği raflar — 2. kalite topu WAREHOUSE'a yazmadığımız burada da görünür.
    const shelves = await prisma.roll.groupBy({
      by: ["preShipStatus"],
      where: { shipmentId, status: RollStatus.SHIPPED },
      _count: { _all: true },
    });

    return {
      success: true,
      data: {
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        dispatchedAt: shipment.dispatchedAt,
        customerName: shipment.customer.name,
        branchName: shipment.branch?.name ?? null,
        plateNumber: shipment.plateNumber,
        driverName: shipment.driverName,
        canUndo: blockReason === null,
        blockReason,
        sackCount: shipment._count.sacks,
        rollCount: shipment._count.rolls,
        swatchCount: shipment._count.swatches,
        sacks: shipment.sacks.map((s) => ({ id: s.id, sackNo: s.sackNo, rollCount: s._count.rolls })),
        affectedOrders: [...new Set(shipment.orders.map((o) => o.order.orderNumber))],
        // Sevk irsaliyesi İPTAL (VOIDED) olacak — kullanıcı bunu onaydan ÖNCE bilmeli.
        voidsDispatchNote: true,
        confirmationEnabled,
        returnTargets: shelves.map((g) => ({
          status: g.preShipStatus ?? RollStatus.WAREHOUSE,
          rollCount: g._count._all,
        })),
      },
    };
  }

  /**
   * Sevki geri al: DISPATCHED → PLANNED. Toplar sevk ÖNCESİ rafına döner, sipariş
   * karşılanması geri hesaplanır, sevk irsaliyesi VOIDED'e çekilir (silinmez —
   * donmuş belge kuralı; İPTAL filigranıyla basılabilir kalır).
   *
   * Plaka/şoför/nakliyeci BİLİNÇLİ olarak KORUNUR: aynı araca yeniden yüklenecek
   * olması olağan; yeniden sevkte zaten üzerine yazılır.
   *
   * `opts.releaseSacks` (2026-08-22) — storno + KAPANIŞ aynı tx'te: geri alınan
   * sevkiyat PLANNED'da BEKLEMEZ, `cancelPlannedShipmentTx` ile CANCELLED'a çekilir
   * (çuvallar + toplar havuza döner, tahsis silinir, sipariş bağı kalkar). Neden:
   * sevk onayı KAPALI rejimde sevkiyat "oluştur + çık" tek adımdır; geri alınanın
   * çuvalları üstünde kilitli PLANNED beklemesinin o rejimde karşılığı yoktur ve
   * çıkış onayı ekranı (Sevk Kapısı) bayrak kapalıyken görünmez (saha vakası
   * SVK2008260008: "bu sipariş yok" diye geri alındı, çuval bir gün kilitli kaldı).
   * Yeniden çıkış = Paketleme'den YENİ sevkiyat (yeni sevk no); eski irsaliye zaten
   * VOIDED. Karar İSTEMCİDE (önizlemedeki `confirmationEnabled` varsayılanı kurar) —
   * açık rejimde de "kapat" seçilebilir. Storno yetkisi (`shipping:undo-dispatch`)
   * kapanışı da kapsar: aynı kararın parçası, ayrıca `shipping:write` aranmaz.
   */
  async undoDispatch(
    shipmentId: string,
    reason: string,
    userId?: string,
    opts: { releaseSacks?: boolean } = {},
  ): Promise<ApiResponse<unknown>> {
    const trimmed = reason?.trim() ?? "";
    if (trimmed.length < 3) throw AppError.badRequest("Geri alma gerekçesi zorunlu (en az 3 karakter)");
    const sameDayOnly = await readShipmentUndoSameDayOnly();
    const releaseSacks = opts.releaseSacks === true;

    const result = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İFADESİ — sevkiyat kapsamlı advisory lock (F-SEV-ESZ-001).
      // Aşağıdaki `rollReturn.count` HENÜZ OLMAYAN satırları sorar (phantom) ve
      // satır kilidi phantom'u kapatmaz: iade tx'i bu sayım ile commit arasında
      // araya girip yasak duruma yol açıyordu (üretildi — helper'daki nota bak).
      // `createReturn` AYNI kilidi alır, böylece iki akış aynı sevkiyat için serileşir.
      // Kilit BURADA, sayımdan ÖNCE olmak zorunda; sonrasına alınırsa hiçbir şey kazanılmaz.
      await lockShipmentScopeTx(tx, shipmentId);
      // Engel kontrolü TX İÇİNDE ve TAZE — önizleme ile onay arasında fatura
      // işaretlenmiş ya da iade alınmış olabilir.
      const sh = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, status: true, invoiceNo: true, dispatchedAt: true },
      });
      if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
      const activeReturnCount = await tx.rollReturn.count({
        where: { fromShipmentId: shipmentId, cancelledAt: null },
      });
      const block = this.resolveUndoBlockReason({
        status: sh.status,
        invoiceNo: sh.invoiceNo,
        dispatchedAt: sh.dispatchedAt,
        activeReturnCount,
        sameDayOnly,
      });
      if (block) throw AppError.conflict(block);

      // ⚠️ `dispatchedAt`/`dispatchedById` NULL'LANMAZ (2026-09-11, defter
      // doktrini): "sevk edildi" olmuş bir gerçektir, geri alma onu silmez.
      // Anlamları "EN SON ne zaman sevk edildi"dir; güncel gerçeği `status`
      // taşır ve muhasebe listesi `status=DISPATCHED` ile süzdüğü için
      // etkilenmez. Tam geçmiş `ShipmentEvent`te.
      const claim = await tx.shipment.updateMany({
        where: { id: shipmentId, status: ShipmentStatus.DISPATCHED },
        data: { status: ShipmentStatus.PLANNED },
      });
      if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      await writeShipmentEvent(tx, {
        shipmentId,
        type: ShipmentEventType.UNDISPATCHED,
        fromStatus: ShipmentStatus.DISPATCHED,
        toStatus: ShipmentStatus.PLANNED,
        // Gerekçe zaten ZORUNLU (en az 3 karakter) — deftere de yazılır ki
        // "kim, ne zaman, NEDEN geri aldı" tek satırda cevaplansın.
        reason: trimmed,
        userId,
      });

      // `isActive` şemada "sevkiyat PLANNED mı" denormudur (dispatch/cancel false yapar).
      await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: true } });

      // ÇUVAL İZLERİ GERİ GELİR — sevkte SOFT temizlenmişti (2026-09-04). Storno
      // "mal HİÇ ÇIKMADI" der; çuval havuza dönerken "kontrol et" izi de dönmeli.
      // Adres `clearedShipmentId` (RollVariance `sourceRefId` dersi) — sevkten
      // SONRA bırakılmış meşru izler zaten etkin, bu sorgu onlara dokunmaz.
      // ⚠️ `releaseSacks` (kapanış) dalından ÖNCE: o dal çuvalın `shipmentId`sini
      // boşaltır, sonraya kalsaydı kapsam kümesi değil, adres yine doğru olurdu —
      // ama sıra okunurluk için burada sabitlendi.
      await restoreSackTagsOnUndoDispatchTx(tx, shipmentId);

      // Toplar sevk ÖNCESİ rafına — `preShipStatus` yoksa (bu karardan önce sevk
      // edilmiş sevkiyat) WAREHOUSE. Statü bazında gruplu yazım; `tx` içinde
      // Promise.all YASAK olduğu için seri döngü.
      const groups = await tx.roll.groupBy({
        by: ["preShipStatus"],
        where: { shipmentId, status: RollStatus.SHIPPED },
      });
      let restored = 0;
      for (const g of groups) {
        const res = await tx.roll.updateMany({
          where: { shipmentId, status: RollStatus.SHIPPED, preShipStatus: g.preShipStatus },
          data: { status: g.preShipStatus ?? RollStatus.WAREHOUSE, preShipStatus: null },
        });
        restored += res.count;
      }

      // DEPO DEFTERİ — mal depoya GERİ DÖNDÜ (storno). Geri dönüş adresi topun
      // kendi `warehouseId`'sinde duruyor (sevkte temizlenmiyor) → ayrı snapshot
      // gerekmez. SHIPMENT satırı SİLİNMEZ: defter append-only, çıkış gerçekten
      // olmuştu; iki satır birlikte "çıktı ve geri geldi" der.
      if (restored > 0) {
        const backRows = await tx.roll.findMany({
          where: { shipmentId, status: { not: RollStatus.SHIPPED } },
          select: { id: true, currentQty: true, warehouseId: true },
        });
        await writeWarehouseMovements(
          tx,
          backRows.map((r) => ({
            rollId: r.id,
            eventType: WarehouseEventType.SHIPMENT_REVERSAL,
            qty: r.currentQty,
            toWarehouseId: r.warehouseId,
            shipmentId,
            userId: userId ?? null,
          })), { onUnwritable: "throw" });
      }

      // Tahsisler SİLİNMEZ — `shippedQty` defterden türetilir ve yalnız DISPATCHED
      // sevkiyattaki tahsisleri sayar; sevkiyat PLANNED olunca karşılanma kendiliğinden
      // düşer. Kilit protokolü performDispatchTx ile simetrik (lost-update).
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
      const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
      await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
      await recomputeOrderStatusForOrdersTx(tx, orderIds);

      // Resmi belge İPTAL — silinmez. Yeniden sevkte `freezeForSource` v2 üretir.
      const voidedDocs = await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.SHIPMENT_DISPATCH,
        shipmentId,
        `Sevk geri alındı: ${trimmed}`,
      );
      // KAPANIŞ (opsiyonel) — storno ile AYNI tx: yukarıdaki PLANNED claim'i
      // başarılıysa sevkiyat şimdi PLANNED'dır, `cancelPlannedShipmentTx` onu
      // CANCELLED'a çeker ve çuval/top/kartela shipmentId'sini boşaltır. Toplar
      // ÇUVALDA KALIR (sackId'ye dokunulmaz) — depoya dönen şey çuvaldır.
      let freedSacks = 0;
      if (releaseSacks) {
        freedSacks = await tx.sack.count({ where: { shipmentId } });
        await this.cancelPlannedShipmentTx(tx, shipmentId, ShipmentStatus.PLANNED);
      }
      return { restored, voidedDocs, orderIds, freedSacks };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: {
        kind: "UNDO_DISPATCH",
        reason: trimmed,
        restoredRolls: result.restored,
        voidedDocs: result.voidedDocs,
        affectedOrders: result.orderIds.length,
        released: releaseSacks,
        freedSacks: result.freedSacks,
      },
    });
    return {
      success: true,
      data: {
        shipmentId,
        restoredRolls: result.restored,
        voidedDocs: result.voidedDocs,
        released: releaseSacks,
        freedSacks: result.freedSacks,
      },
      message: releaseSacks
        ? `Sevk geri alındı ve sevkiyat kapatıldı — ${result.restored} top, ${result.freedSacks} çuval depoya döndü; irsaliye iptal edildi`
        : `Sevk geri alındı — ${result.restored} top depoya döndü, irsaliye iptal edildi`,
    };
  }

  // =========================================================================
  // LİSTE / DETAY
  // =========================================================================

  async listShipments(
    req: Request,
  ): Promise<
    | (ApiResponse<unknown> & { summary?: ShipmentListSummary })
    | (CursorPaginatedResponse<unknown> & { summary?: ShipmentListSummary })
  > {
    const params = parseQueryParams(req);
    const safeFilters: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(params.filters)) {
      if ((SHIPMENT_FILTER_FIELDS as readonly string[]).includes(k)) safeFilters[k] = v;
    }
    const where = buildWhereClause(
      safeFilters,
      SHIPMENT_SEARCH_FIELDS,
      params.search,
      SHIPMENT_CODE_SEARCH_FIELDS
    ) as Prisma.ShipmentWhereInput;
    applyDateRange(where as Record<string, unknown>, params, SHIPMENT_DATE_FIELDS);

    const rawStatus = req.query.status as string | undefined;
    if (rawStatus && Object.values(ShipmentStatus).includes(rawStatus as ShipmentStatus)) {
      where.status = rawStatus as ShipmentStatus;
    }

    // İptal edilmiş sevkiyatları gizle (panel varsayılanı). SHIPMENT_FILTER_FIELDS
    // allowlist'i bayrağı zaten `safeFilters`'a almaz — ham params.filters'tan
    // okunur. `rawStatus` (üstteki tekil ?status=) de açık niyet sayılır: varsa
    // dışlama uygulanmaz, yoksa çelişip listeyi boşaltırdı.
    if (!rawStatus) {
      const hideCancelled = buildHideCancelledWhere(params.filters, [
        ShipmentStatus.CANCELLED,
      ]);
      if (hideCancelled) where.status = hideCancelled.status as Prisma.EnumShipmentStatusFilter;
    }
    const rawCustomerId = req.query.customerId as string | undefined;
    if (rawCustomerId) where.customerId = rawCustomerId;

    // --- İÇERİK FİLTRESİ (ürün + renk = TEK TOP eşleşmesi) --------------------
    // itemId/colorId relation alt-sorgusudur (skaler DEĞİL) → SHIPMENT_FILTER_FIELDS'e
    // KOYULMAZ (buildWhereClause skaler bekler). csv → temiz ID listesi. İkisi de
    // seçiliyse AYNI topun HEM üründe HEM renkte olması gerekir (tek `some` bloğu,
    // iki koşul AND — "mavi patos" = aynı topun itemId∈seçili VE colorId∈seçili).
    const csvIds = (v: string | string[] | undefined): string[] => {
      if (v == null) return [];
      const arr = Array.isArray(v) ? v : String(v).split(",");
      return arr.map((s) => s.trim()).filter(Boolean);
    };
    const itemIds = csvIds(params.filters.itemId);
    const colorIds = csvIds(params.filters.colorId);
    const rollMatch: Prisma.RollWhereInput = {};
    if (itemIds.length) rollMatch.itemId = { in: itemIds };
    if (colorIds.length) rollMatch.colorId = { in: colorIds };
    const hasContentFilter = itemIds.length > 0 || colorIds.length > 0;
    // Roll.itemId + Roll.colorId indexli → some alt-sorgusu performanslı.
    if (hasContentFilter) where.rolls = { some: rollMatch };

    // --- İADE FİLTRESİ ("iade içerenler") — basit; iptalsiz iade taşıyan sevkler.
    const hasReturnsFilter = params.filters.hasReturns === "true";
    if (hasReturnsFilter) where.returns = { some: { cancelledAt: null } };

    // --- FATURA FİLTRESİ (muhasebe) — türetilmiş null-testi, skaler eşitlik DEĞİL →
    // FILTER_FIELDS whitelist'ine konmaz (hasReturns ile aynı gerekçe).
    const invoicedRaw = params.filters.invoiced;
    const invoicedFilter =
      invoicedRaw === "true" ? true : invoicedRaw === "false" ? false : null;
    if (invoicedFilter !== null) {
      where.invoicedAt = invoicedFilter ? { not: null } : null;
    }

    // destination (DOMESTIC|EXPORT) buildWhereClause tarafından where'e YAZILDI;
    // DirectShipment'ta destination YOK → aktifse doğrudan sevkler union'dan düşer.
    const hasDestinationFilter = safeFilters.destination != null;

    // --- SIRALAMA (whitelist) — createdAt|shipmentNo|dispatchedAt.
    // dispatchedAt PLANNED'da NULL'dur; keyset'i bozmadan sıralamak için nulls-last
    // + `dynamicCursorWhere(..., sortNullable=true)` (cursor.ts:214 null kuyruk fazı)
    // kullanılır. Muhasebe ekranı bunu ister: liste "Sevk Tarihi" basıp createdAt'e
    // göre dizilince pazartesi kurulup cuma sevk edilen sevkiyat yanlış yere düşüyordu.
    // ⚠️ DirectShipment'ta bu alanın adı `shippedAt` (NON-NULL) — direct dalındaki
    // orderBy/cursor AYRI kurulur, Shipment'ınki paylaşılamaz.
    const SORTABLE = ["createdAt", "shipmentNo", "dispatchedAt"] as const;
    type ShipSortField = (typeof SORTABLE)[number];
    const sortField = resolveSortBy(params.sortBy, SORTABLE, "createdAt") as ShipSortField;
    const sortDir: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
    // Direct tablosundaki karşılık — union'ın iki tarafında alan adı farklı.
    const directSortField = sortField === "dispatchedAt" ? "shippedAt" : sortField;
    const sortNullable = sortField === "dispatchedAt";
    const shipOrderBy: Prisma.ShipmentOrderByWithRelationInput[] =
      sortField === "shipmentNo"
        ? [{ shipmentNo: sortDir }, { id: sortDir }]
        : sortField === "dispatchedAt"
          ? [{ dispatchedAt: { sort: sortDir, nulls: "last" } }, { id: sortDir }]
          : [{ createdAt: sortDir }, { id: sortDir }];
    const directOrderBy: Prisma.DirectShipmentOrderByWithRelationInput[] =
      sortField === "shipmentNo"
        ? [{ shipmentNo: sortDir }, { id: sortDir }]
        : sortField === "dispatchedAt"
          ? [{ shippedAt: sortDir }, { id: sortDir }]
          : [{ createdAt: sortDir }, { id: sortDir }];

    const select = {
      id: true,
      shipmentNo: true,
      status: true,
      plateNumber: true,
      driverName: true,
      carrier: true,
      dispatchedAt: true,
      createdAt: true,
      invoiceNo: true,
      invoicedAt: true,
      // Muhasebe ekranı ikisini de basıyor: sevk notu (eskiden yalnız irsaliyede
      // vardı) ve operatörün beyan ettiği gerçek çuval adedi.
      dispatchNote: true,
      manualSackCount: true,
      // ── İÇ FATURA BAĞI (2026-08-15) ────────────────────────────────────────
      // ⚠️ `invoiceNo` DIŞ muhasebe programındaki belgenin izidir ("ERP fatura
      // KESMEZ", `schema.prisma`), iç fatura bağı ise `Invoice.shipmentId`dir.
      // Panelin "Faturala (iç)" düğmesi yükleminin `invoiceNo`ya bakması İKİ
      // YÖNLÜ yanlıştı: (a) iç TASLAK varken düğme çıkıyor, kullanıcı formu
      // dolduruyor ve `assertSourceFree` 409 veriyordu (emek çöpe); (b) dış
      // numarası işaretlenmiş sevkiyatta düğme HİÇ çıkmıyor, iç fatura
      // kesilemiyordu. Yüklem artık bu alana bağlanabilir.
      // ⚠️ İPTAL EDİLMİŞ FATURA DIŞARIDA: `assertSourceFree` ile AYNI süzgeç
      // (`status <> CANCELLED`) — ayrışsalardı panel "faturası var" der, uç
      // yeni faturayı kabul ederdi (ya da tersi).
      // ⚠️ Perf: to-many `select` Prisma'da sayfadaki id'ler üzerinde TEK ek
      // sorgudur (`_count` ile aynı sınıf); snapshot/JSON kolonu ÇEKİLMEZ
      // (perf kuralı 13).
      invoices: {
        where: { status: { not: InvoiceStatus.CANCELLED } },
        select: { id: true, docNo: true, status: true },
      },
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      _count: { select: { sacks: true, rolls: true, orders: true, returns: { where: { cancelledAt: null } } } },
    } as const;

    // --- BİRLEŞİK LİSTE: fasondan DOĞRUDAN sevkler (DirectShipment) çuval
    // Shipment'larıyla AYNI listede görünür (nadir ama kayıt altında olmalı).
    // Aynı createdAt-keyed keyset cursor İKİ tabloya da uygulanır; iki desc-sıralı
    // akış merge edilip üstten `limit` alınır → union üzerinde doğru keyset sayfalama
    // (her akıştan limit+1 çekmek top-`limit`'i ve hasMore'u garantiler).
    const directSelect = {
      id: true,
      shipmentNo: true,
      shippedAt: true,
      createdAt: true,
      rollCount: true,
      totalQty: true,
      reason: true,
      invoiceNo: true,
      invoicedAt: true,
      // Doğrudan sevkin de iç faturası olabilir (`Invoice.directShipmentId` +
      // kendi partial unique'i) — iki dal AYNI şekli döndürmeli, yoksa panel
      // satırın hangi tür olduğuna göre farklı alan ezberlemek zorunda kalır.
      invoices: {
        where: { status: { not: InvoiceStatus.CANCELLED } },
        select: { id: true, docNo: true, status: true },
      },
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      _count: { select: { allocations: true } },
    } as const;
    type ShipRow = Prisma.ShipmentGetPayload<{ select: typeof select }>;
    type DirectRow = Prisma.DirectShipmentGetPayload<{ select: typeof directSelect }>;
    // totalMeters/totalKg: SHIPMENT satırlarında `attachTotals` doldurur (toplama
    // gerektirir); DIRECT'te metraj zaten denormalize (`DirectShipment.totalQty`) → sorgu yok.
    const mapShip = (s: ShipRow) => ({
      kind: "SHIPMENT" as const,
      ...s,
      totalMeters: 0,
      totalKg: 0,
    });
    const mapDirect = (d: DirectRow) => ({
      kind: "DIRECT" as const,
      id: d.id,
      shipmentNo: d.shipmentNo,
      status: ShipmentStatus.DISPATCHED, // doğrudan sevk daima çıkmış say
      plateNumber: null,
      driverName: null,
      carrier: null,
      dispatchedAt: d.shippedAt,
      createdAt: d.createdAt,
      reason: d.reason,
      invoiceNo: d.invoiceNo,
      invoicedAt: d.invoicedAt,
      invoices: d.invoices,
      customer: d.customer,
      branch: d.branch,
      // Doğrudan sevkte ÇUVAL YOK (roll bazlı akış) → ikisi de null. Union'ın
      // iki tarafı aynı alan kümesini taşımalı, yoksa liste satırı tipi ayrışır.
      dispatchNote: null,
      manualSackCount: null,
      totalMeters: Number(d.totalQty),
      totalKg: 0, // doğrudan sevkte çuval/tartı yok
      _count: { sacks: 0, rolls: d.rollCount, orders: d._count.allocations, returns: 0 },
    });
    type UnifiedRow = ReturnType<typeof mapShip> | ReturnType<typeof mapDirect>;
    // Union sıralama karşılaştırıcısı — sortField + sortDir'e göre (orderBy ile birebir).
    // Birincil anahtar sortField (createdAt→getTime, shipmentNo→string compare); tie-break
    // DAİMA id, aynı yönde (dynamicCursorWhere tie-break'iyle simetrik).
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: UnifiedRow, b: UnifiedRow): number => {
      // NULL kuyruğu: dispatchedAt sıralamasında null'lar YÖNDEN BAĞIMSIZ olarak sonda
      // durur (Prisma `nulls: "last"` ile birebir) → `dir` ile çarpılmaz.
      if (sortField === "dispatchedAt") {
        const av = a.dispatchedAt;
        const bv = b.dispatchedAt;
        if (av === null && bv !== null) return 1;
        if (bv === null && av !== null) return -1;
        if (av !== null && bv !== null) {
          const d = av.getTime() - bv.getTime();
          if (d !== 0) return dir * d;
        }
        const idcN = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        return dir * idcN;
      }
      const primary =
        sortField === "shipmentNo"
          ? a.shipmentNo < b.shipmentNo
            ? -1
            : a.shipmentNo > b.shipmentNo
              ? 1
              : 0
          : a.createdAt.getTime() - b.createdAt.getTime();
      if (primary !== 0) return dir * primary;
      const idc = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return dir * idc;
    };

    // DirectShipment'ın status'u yok → daima DISPATCHED. Status filtresi DISPATCHED
    // istemiyorsa doğrudan sevkleri union'dan DÜŞ.
    const statusRaw = safeFilters.status;
    const statuses =
      statusRaw == null
        ? null
        : Array.isArray(statusRaw)
          ? statusRaw
          : String(statusRaw).split(",").map((s) => s.trim());
    // DirectShipment'ta status/destination/returns YOK → bu filtreler aktifse doğrudan
    // sevkler union'dan düşer. (İçerik filtresi DÜŞÜRMEZ — DirectShipment.rolls'a uygulanır.)
    const includeDirect =
      (!statuses || statuses.includes(ShipmentStatus.DISPATCHED)) &&
      (!rawStatus || rawStatus === ShipmentStatus.DISPATCHED) &&
      !hasReturnsFilter &&
      !hasDestinationFilter;

    // DirectShipment where — Shipment ile AYNI filtreleri alanlarına eşle.
    const directBaseWhere: Prisma.DirectShipmentWhereInput = {};
    {
      const cust =
        (typeof safeFilters.customerId === "string" ? safeFilters.customerId : undefined) ??
        rawCustomerId;
      if (cust) directBaseWhere.customerId = cust;
      if (typeof safeFilters.branchId === "string") directBaseWhere.branchId = safeFilters.branchId;
      if (params.search)
        directBaseWhere.OR = buildTextSearch<Prisma.DirectShipmentWhereInput>(
          params.search,
          {
            text: ["reason", "customer.name"],
            // Sipariş no ile arama — Shipment tarafındaki `orders.some.order.orderNumber`
            // karşılığı; doğrudan sevkte sipariş bağı allocation üzerinden kurulur.
            code: ["shipmentNo", "allocations.some.orderLine.order.orderNumber"],
          }
        );
      if (invoicedFilter !== null) {
        directBaseWhere.invoicedAt = invoicedFilter ? { not: null } : null;
      }
      if (params.dateField && (params.dateFrom || params.dateTo)) {
        const range: { gte?: Date; lte?: Date } = {};
        if (params.dateFrom) range.gte = params.dateFrom;
        if (params.dateTo) range.lte = params.dateTo;
        // Shipment.dispatchedAt ≙ DirectShipment.shippedAt.
        if (params.dateField === "createdAt") directBaseWhere.createdAt = range;
        else if (params.dateField === "dispatchedAt") directBaseWhere.shippedAt = range;
      }
      // İçerik filtresi doğrudan sevklere de (DirectShipment.rolls Roll[] — aynı rollMatch).
      if (hasContentFilter) directBaseWhere.rolls = { some: rollMatch };
    }

    // --- EŞLEŞME ROZETİ verisi — SADECE hasContentFilter iken. dataRows'a bağımlı →
    // merge/slice SONRASI ayrı Promise.all (mevcut Promise.all'a EKLENMEZ). tx dışı,
    // salt-okuma (prisma.* global) → Promise.all serbest. hasContentFilter yoksa alan
    // HİÇ eklenmez (matchRollCount undefined kalır).
    const attachBadges = async (
      rows: UnifiedRow[],
    ): Promise<Array<UnifiedRow & { matchRollCount?: number }>> => {
      if (!hasContentFilter) return rows;
      const shipIds = rows.filter((r) => r.kind === "SHIPMENT").map((r) => r.id);
      const directIds = rows.filter((r) => r.kind === "DIRECT").map((r) => r.id);
      const [shipGroups, directGroups] = await Promise.all([
        shipIds.length
          ? prisma.roll.groupBy({
              by: ["shipmentId"],
              where: { shipmentId: { in: shipIds }, ...rollMatch },
              _count: { _all: true },
            })
          : Promise.resolve([] as Array<{ shipmentId: string | null; _count: { _all: number } }>),
        directIds.length
          ? prisma.roll.groupBy({
              by: ["directShipmentId"],
              where: { directShipmentId: { in: directIds }, ...rollMatch },
              _count: { _all: true },
            })
          : Promise.resolve(
              [] as Array<{ directShipmentId: string | null; _count: { _all: number } }>,
            ),
      ]);
      const shipMap = new Map<string | null, number>(
        shipGroups.map((g): [string | null, number] => [g.shipmentId, g._count._all]),
      );
      const directMap = new Map<string | null, number>(
        directGroups.map((g): [string | null, number] => [g.directShipmentId, g._count._all]),
      );
      return rows.map((r) => ({
        ...r,
        matchRollCount: r.kind === "SHIPMENT" ? (shipMap.get(r.id) ?? 0) : (directMap.get(r.id) ?? 0),
      }));
    };

    // --- BRÜT TOPLAMLAR (metraj / kg / top adedi) -----------------------------
    // ⚠️ SEVK RAKAMI BRÜT'TÜR (kök CLAUDE.md 2026-08-02, saha vakası SVK2007260001).
    // İade `Roll.shipmentId`'yi NULL'lar (`return.service.ts:324-325`) → CANLI sayım
    // NET verir ve liste, donmuş irsaliyeden FARKLI bir sayı söyler. Bu yüzden iptal
    // edilmemiş iadeler metraja ve top adedine GERİ EKLENİR; dört yüzey (PDF, liste,
    // fiş, muhasebe Excel'i) aynı rakamı basar. İade bilgisi kaybolmaz — `_count.returns`
    // ayrı alan olarak duruyor ve listede rozet olarak gösteriliyor.
    //
    // Donmuş `PrintedDocument.snapshot` OKUNMAZ: perf kuralı 13 (liste sorgusunda
    // snapshot JSON çekilmez) — `accounting-export.service.ts:255` de aynı sebeple
    // geri-ekleme yolunu seçti. Kg geri-ekleme İSTEMEZ: iade `Sack.weightKg`'a
    // dokunmaz (tartı sevk anında donmuş brüt değerdir).
    //
    // `attachBadges` ile aynı yerleşim: merge/slice SONRASI, yalnız sayfadaki ≤limit
    // id üzerinde; tx dışı salt-okuma (`prisma.*` global) → `Promise.all` serbest.
    // DIRECT satırlar sorguya girmez — `DirectShipment.totalQty`/`rollCount` denormalize.
    const attachTotals = async <T extends UnifiedRow>(rows: T[]): Promise<T[]> => {
      const shipIds = rows.filter((r) => r.kind === "SHIPMENT").map((r) => r.id);
      if (shipIds.length === 0) return rows;
      // ⚠️ TEK ANLIK GÖRÜNTÜ ŞART (2026-08-09 denetimi, F-SEV-ESZ-002).
      // Brüt metraj `canlı toplam + iade geri-eklemesi` ile üretiliyor; iki sayım
      // FARKLI anlık görüntülerden gelirse aradaki pencerede commit eden bir iade
      // ya ÇİFT sayılır (top hâlâ sevkiyatta görünürken iade satırı da eklenir)
      // ya da KAYBOLUR (shipmentId nullanmış, iade henüz görünmüyor). İkisi de
      // geçicidir ve tam da bu yüzden teşhis edilemez: muhasebeci ekranda 501 m
      // görür, Excel'de 452 m okur ve hangisinin doğru olduğunu bilemez.
      //
      // `Promise.all` bunu SAĞLAMAZ — havuzdan AYRI bağlantılar, ayrı görüntüler.
      // Batch `$transaction` tek bağlantıda çalıştırır AMA tek başına yetmez:
      // PostgreSQL varsayılanı READ COMMITTED ve orada her İFADE kendi anlık
      // görüntüsünü alır, transaction içinde bile. Bu yüzden izolasyon
      // RepeatableRead'e yükseltilir — tx'in İLK ifadesinde alınan görüntü
      // üçünde de geçerli olur.
      //
      // ⚠️ Bu, "tx.* ile Promise.all YASAK" kuralının ihlali DEĞİLDİR: o kural
      // interaktif tx client'ını paylaşmaya ilişkindir; burada BATCH API var
      // (dizi formu), Prisma'nın kendisi sırayla çalıştırır.
      // ⚠️ P2034 riski YOK: üçü de SALT OKUMA; RepeatableRead serileştirme
      // hatasını yalnız YAZAN transaction'larda üretir.
      const [rollGroups, sackGroups, returnGroups] = await prisma.$transaction(
        [
          prisma.roll.groupBy({
            by: ["shipmentId"],
            where: { shipmentId: { in: shipIds } },
            _sum: { currentQty: true },
          }),
          prisma.sack.groupBy({
            by: ["shipmentId"],
            where: { shipmentId: { in: shipIds } },
            _sum: { weightKg: true },
          }),
          prisma.rollReturn.groupBy({
            by: ["fromShipmentId"],
            where: { fromShipmentId: { in: shipIds }, cancelledAt: null },
            _sum: { qty: true },
          }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      const liveMeters = new Map(rollGroups.map((g) => [g.shipmentId, g._sum.currentQty ?? D0()]));
      const kg = new Map(sackGroups.map((g) => [g.shipmentId, g._sum.weightKg ?? D0()]));
      const returnedMeters = new Map(returnGroups.map((g) => [g.fromShipmentId, g._sum.qty ?? D0()]));
      return rows.map((r) => {
        if (r.kind !== "SHIPMENT") return r;
        const gross = (liveMeters.get(r.id) ?? D0()).plus(returnedMeters.get(r.id) ?? D0());
        return {
          ...r,
          totalMeters: Number(gross),
          totalKg: Number(kg.get(r.id) ?? D0()),
          // Brüt top adedi: canlı (iade sonrası eksilmiş) + iade edilmiş adet.
          // İade sayısı zaten `_count.returns` ile geldi (aynı `cancelledAt: null`
          // süzgeci) → ayrı sorgu gerekmez.
          _count: { ...r._count, rolls: r._count.rolls + r._count.returns },
        };
      });
    };

    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";
      // Muhasebe ekranının dönem bandı — filtreli KÜMENİN TAMAMI (sayfa değil).
      // Bayrak olmadan ek sorgu koşmaz → operasyon ekranı bedel ödemez.
      const wantSummary = req.query.withSummary === "true";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cw = cursor ? dynamicCursorWhere(cursor, sortField, sortDir, sortNullable) : null;
      // Direct tarafı AYRI cursor ister: union'ın iki tablosunda sıralama kolonunun adı
      // farklı (dispatchedAt ↔ shippedAt). Aynı `cw` nesnesini paylaşmak DirectShipment'ta
      // var olmayan bir alana filtre yazmak olurdu.
      const directCw = cursor
        ? directSortField === sortField
          ? cw
          : dynamicCursorWhere(cursor, directSortField, sortDir) // shippedAt NON-NULL → sortNullable YOK
        : null;
      const shipWhere = cw ? { AND: [where, cw] } : where;
      const directWhere = directCw ? { AND: [directBaseWhere, directCw] } : directBaseWhere;
      const [shipItems, directItems, shipTotal, directTotal] = await Promise.all([
        prisma.shipment.findMany({ where: shipWhere, orderBy: shipOrderBy, take: limit + 1, select }),
        includeDirect
          ? prisma.directShipment.findMany({ where: directWhere, orderBy: directOrderBy, take: limit + 1, select: directSelect })
          : Promise.resolve([] as DirectRow[]),
        wantTotal ? prisma.shipment.count({ where }) : Promise.resolve(undefined),
        wantTotal && includeDirect ? prisma.directShipment.count({ where: directBaseWhere }) : Promise.resolve(0),
      ]);
      const merged: UnifiedRow[] = [...shipItems.map(mapShip), ...directItems.map(mapDirect)].sort(cmp);
      const hasMore = merged.length > limit;
      const dataRows = hasMore ? merged.slice(0, limit) : merged;
      const last = dataRows[dataRows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, sortField) : null;
      const totalEstimate = shipTotal !== undefined ? shipTotal + (directTotal ?? 0) : undefined;
      const data = await attachTotals(await attachBadges(dataRows));
      const summary = wantSummary
        ? await this.buildShipmentListSummary(where, includeDirect ? directBaseWhere : null)
        : undefined;
      return {
        success: true,
        data,
        ...(summary ? { summary } : {}),
        pagination: { nextCursor, hasMore, limit, ...(totalEstimate !== undefined ? { totalEstimate } : {}) },
      };
    }

    const [shipments, directs] = await Promise.all([
      prisma.shipment.findMany({ where, orderBy: shipOrderBy, take: 200, select }),
      includeDirect
        ? prisma.directShipment.findMany({ where: directBaseWhere, orderBy: directOrderBy, take: 200, select: directSelect })
        : Promise.resolve([] as DirectRow[]),
    ]);
    const merged: UnifiedRow[] = [...shipments.map(mapShip), ...directs.map(mapDirect)].sort(cmp).slice(0, 200);
    const data = await attachTotals(await attachBadges(merged));
    return { success: true, data };
  }

  /**
   * Muhasebe dönem bandı — filtrelenmiş KÜMENİN TAMAMI için sevk adedi + brüt
   * metraj + kg. Sayfa toplamı DEĞİL: muhasebeci "bu ay kaç metre sevk ettik"
   * sorusunu Excel indirmeden yanıtlayabilsin diye.
   *
   * Metraj `attachTotals` ile AYNI brüt sözleşmesini taşır (canlı + iptal edilmemiş
   * iade geri-eklemesi) — yoksa banttaki toplam ile satırların toplamı tutmazdı.
   */
  private async buildShipmentListSummary(
    where: Prisma.ShipmentWhereInput,
    directWhere: Prisma.DirectShipmentWhereInput | null,
  ): Promise<ShipmentListSummary> {
    const [shipCount, rollAgg, sackAgg, returnAgg, directAgg] = await Promise.all([
      prisma.shipment.count({ where }),
      prisma.roll.aggregate({ where: { shipment: where }, _sum: { currentQty: true } }),
      prisma.sack.aggregate({ where: { shipment: where }, _sum: { weightKg: true } }),
      prisma.rollReturn.aggregate({
        where: { cancelledAt: null, fromShipment: where },
        _sum: { qty: true },
      }),
      directWhere
        ? prisma.directShipment.aggregate({ where: directWhere, _sum: { totalQty: true }, _count: { _all: true } })
        : Promise.resolve(null),
    ]);
    const meters = (rollAgg._sum.currentQty ?? D0())
      .plus(returnAgg._sum.qty ?? D0())
      .plus(directAgg?._sum.totalQty ?? D0());
    return {
      shipmentCount: shipCount + (directAgg?._count._all ?? 0),
      totalMeters: Number(meters),
      totalKg: Number(sackAgg._sum.weightKg ?? D0()),
    };
  }

  /** Fasondan doğrudan sevk (DirectShipment) detayı — birleşik Sevkiyatlar
   *  listesinden açılınca gösterilir. Toplar + karşılanan sipariş satırları +
   *  fason/İE bağlamı; irsaliye SUBCONTRACTOR_DIRECT_SHIP (sourceId=DirectShipment.id). */
  async getDirectShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const ds = await prisma.directShipment.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shippedBy: { select: { fullName: true, username: true } },
        dispatch: {
          select: {
            id: true,
            dispatchNo: true,
            subcontractor: { select: { id: true, name: true, code: true } },
            workOrder: { select: { id: true, workOrderNumber: true } },
            step: { select: { stepSequence: true, station: { select: { name: true, code: true } } } },
          },
        },
        rolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        allocations: {
          select: {
            qty: true,
            orderLine: {
              select: {
                item: { select: { code: true, name: true } },
                color: { select: { name: true } },
                order: { select: { orderNumber: true } },
              },
            },
          },
        },
      },
    });
    if (!ds) throw AppError.notFound("Fasondan sevk kaydı bulunamadı");

    return {
      success: true,
      data: {
        id: ds.id,
        kind: "DIRECT" as const,
        shipmentNo: ds.shipmentNo,
        reason: ds.reason,
        totalQty: Number(ds.totalQty),
        rollCount: ds.rollCount,
        shippedAt: ds.shippedAt.toISOString(),
        createdAt: ds.createdAt.toISOString(),
        customer: ds.customer,
        branch: ds.branch,
        shippedBy: ds.shippedBy?.fullName ?? ds.shippedBy?.username ?? null,
        dispatch: {
          id: ds.dispatch.id,
          dispatchNo: ds.dispatch.dispatchNo,
          subcontractor: ds.dispatch.subcontractor,
          workOrder: ds.dispatch.workOrder,
          stationName: ds.dispatch.step.station.name,
          stepSequence: ds.dispatch.step.stepSequence,
        },
        rolls: ds.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          itemName: r.item?.name ?? "",
          colorName: r.color?.name ?? null,
          currentQty: Number(r.currentQty),
          width: r.width != null ? Number(r.width) : null,
          qualityGrade: r.qualityGrade,
        })),
        allocations: ds.allocations.map((a) => ({
          orderNumber: a.orderLine.order.orderNumber,
          itemName: a.orderLine.item.name,
          colorName: a.orderLine.color?.name ?? null,
          qty: Number(a.qty),
        })),
      },
    };
  }

  /** Sevkiyat detayı — çuvallar + toplar + sipariş bazlı bu-sevkiyat tahsis dökümü. */
  async getShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: {
        id: true, shipmentNo: true, status: true, destination: true, procedureCode: true,
        plateNumber: true, driverName: true, carrier: true, dispatchedAt: true, createdAt: true,
        dispatchNote: true,
        manualSackCount: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        orders: {
          select: {
            order: {
              select: {
                id: true, orderNumber: true, status: true, deadline: true, orderDate: true,
                lines: {
                  select: {
                    id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true,
                    customerItemName: true, customerColorName: true, createdAt: true,
                    item: { select: { id: true, code: true, name: true } },
                    color: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
          },
        },
        rolls: { select: { id: true, barcode: true, itemId: true, colorId: true, width: true, currentQty: true, qualityGrade: true, sackId: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
        swatches: { select: { id: true, barcode: true, length: true, width: true, sackId: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true, sackNo: true, seq: true, weightKg: true,
            // ADLİ/DETAY görünüm — hayalet BURADA FİLTRELENMEZ, aksine `status` ile
            // görünür kılınır: "ne oldu?" sorusunun cevabı bu ekranda okunur ve
            // operatörün topu çuvaldan çıkarma yolu buradan geçer. Filtrelemek sorunu
            // gizler. Sayım/belge yüzeyleri ayrıca dışlar (bkz. collectShipmentDocContent).
            // orderBy AÇIK: iade satırları listenin SONUNA eklenecek (aşağıda) ve
            // "önce elindeki mal" sırası ancak canlı taraf da deterministikse
            // anlamlı olur. Eskiden orderBy yoktu → sıra DB'nin keyfiydi.
            rolls: {
              orderBy: { createdAt: "asc" },
              select: { id: true, barcode: true, status: true, width: true, currentQty: true, qualityGrade: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } },
            },
            swatches: { select: { id: true, barcode: true, length: true, width: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
            allocations: { select: { orderLineId: true, qty: true } },
          },
        },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    // Bu sevkiyatın satır bazlı tahsisi (çuval tahsislerinin toplamı).
    const thisShipmentByLine = new Map<string, Prisma.Decimal>();
    for (const sk of shipment.sacks) {
      for (const a of sk.allocations) {
        thisShipmentByLine.set(a.orderLineId, (thisShipmentByLine.get(a.orderLineId) ?? D0()).plus(a.qty));
      }
    }

    // MÜŞTERİDEKİ AD — EKRAN İLE KÂĞIT AYNI YÜKLEMİ KULLANIR (2026-09-06).
    // Bu projeksiyon eskiden YALNIZ `OrderLine` override'ını taşıyordu; belge ise
    // `override > CustomerItemAlias/CustomerColorAlias (master) > bizim ad`
    // kademesini çözüyordu. Sonuç ölçüldü: sevk edilmiş 1.778 topun 424'ünde (%24)
    // kumaş için master alias VARDI ama override YOKTU → irsaliyede müşteri adı
    // basılıyor, elemanın ekranında hiç görünmüyordu (renk için 152 top / %9).
    // Aynı soruyu iki yüzeyin iki farklı yüklemle cevaplaması kök CLAUDE.md'nin
    // "türetilmiş alan / ayrışan yüzey" sınıfıdır; tek kaynak `customer-name.helper`.
    // Maliyet: müşteri başına 2 sorgu (`batchLoadAliases`), satır başına DEĞİL.
    const siparisKalemleri = shipment.orders.flatMap((so) => so.order.lines);
    const { itemAliasByItemId, colorAliasByColorId } = await batchLoadAliases(
      prisma,
      shipment.customer.id,
      siparisKalemleri.map((l) => l.itemId),
      siparisKalemleri.map((l) => l.colorId).filter((c): c is string => !!c),
    );

    const orders = shipment.orders.map((so) => ({
      id: so.order.id,
      orderNumber: so.order.orderNumber,
      status: so.order.status,
      deadline: so.order.deadline,
      lines: so.order.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        // ⚠️ Yalnız GERÇEKTEN bir müşteri karşılığı varsa dolu döner: `resolveName`
        // DEFAULT'a düşerse (bizim adımız) alan null kalır — arayüz "(Müşteride: X)"
        // etiketini bizim adımızla basıp kullanıcıya sahte bir karşılık göstermesin.
        const musteriKumas = resolveName(l.customerItemName, itemAliasByItemId.get(l.itemId), "");
        const musteriRenk = resolveName(
          l.customerColorName,
          l.colorId ? colorAliasByColorId.get(l.colorId) : null,
          "",
        );
        return {
          lineId: l.id,
          item: l.item,
          color: l.color,
          width: l.width,
          customerItemName: musteriKumas.source === "DEFAULT" ? null : musteriKumas.name,
          customerColorName: musteriRenk.source === "DEFAULT" ? null : musteriRenk.name,
          requested,
          shipped,
          openQty: requested.minus(shipped),
          thisShipment: thisShipmentByLine.get(l.id) ?? D0(),
        };
      }),
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // İADELER — SACKS'TEN ÖNCE OKUNUR (2026-08-03)
    //
    // NEDEN: iade `RollReturn` satırı yazıp topun `sackId`/`shipmentId` FK'larını
    // NULL'lar (return.service.ts:322-325). Bu yüzden canlı `sacks[].rolls` ve
    // `shipment.rolls` iadeden SONRA eksilir — sevk EDİLMİŞ bir sevkiyatın
    // "hangi çuvalda ne gitti" cevabı geriye dönük değişirdi (saha vakası
    // SVK0308260001: 4 top iade alındı, detay ekranı "0 top · 0 m" dedi).
    //
    // Kök CLAUDE.md 2026-08-02 kuralı: "sevk rakamı BRÜT'tür; iade onu geriye
    // dönük değiştiremez." O gün fiş/irsaliye/liste/muhasebe brüte çekildi; ÇUVAL
    // İÇERİĞİ yüzeyi atlanmıştı. Burası o boşluğun kapatılması.
    //
    // Kaynak SNAPSHOT DEĞİL `RollReturn`: satır iade anını zaten donmuş taşıyor
    // (qty/width/prevQualityGrade/prevSackId) ve `attachTotals` (:2147) ile
    // `accounting-export.service.ts:257` aynı kaynağı seçti — üçüncü bir kaynak
    // üçüncü bir rakam demekti. Ek sorgu YOK: bu findMany zaten koşuyordu,
    // yalnız yukarı taşındı ve select'i genişledi.
    const returnRows = await prisma.rollReturn.findMany({
      where: { fromShipmentId: id, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, qty: true, width: true, createdAt: true, reasonText: true,
        prevSackId: true,
        // rollId: satır kimliği (`id` RollReturn'ün kendi id'si — canlı topla
        // aynı uzayda DEĞİL; dedup ve React key için gerçek top id'si lazım).
        rollId: true,
        // prevQualityGrade: iade anındaki kalite. Canlı `roll.qualityGrade`
        // okunamaz — iade topu WAREHOUSE'a çekerken kaliteyi değiştirebilir.
        prevQualityGrade: true,
        // Çok kalemli iade belgesinin kaynağı — irsaliye GRUP LİDERİNE bağlıdır;
        // üye id'siyle sorulursa belge bulunamaz (builder bilinçli null döner).
        returnGroupId: true,
        roll: { select: { barcode: true } },
        // ⚠️ `id` ŞART: Electron facet süzgeci (useShipmentDetailFilter) kumaş/renk
        // eşleşmesini ID ile yapar. id olmadan iade satırları "Kumaş" filtresi
        // seçilir seçilmez tablodan DÜŞER — üst sayaç brüt kalırken tablo nete
        // dönerdi, yani düzeltmeye çalıştığımız hastalığın aynısı.
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        reason: { select: { name: true, color: true } },
      },
    });

    // YARIŞ KORUMASI: `shipment.findUnique` ile bu findMany AYRI sorgulardır (tx
    // yok). İkisi arasında bir iade commit olursa aynı top HEM canlı `sk.rolls`
    // içinde HEM iade satırı olarak gelir → çuval ve sevkiyat sayaçları şişer.
    // Canlı id kümesiyle dedup, o pencereyi kapatır.
    const liveRollIds = new Set<string>(shipment.rolls.map((r) => r.id));
    for (const sk of shipment.sacks) for (const r of sk.rolls) liveRollIds.add(r.id);
    const freshReturnRows = returnRows.filter((rr) => !liveRollIds.has(rr.rollId));

    /** Çuval içinde basılacak iade satırı — canlı top satırıyla AYNI şekil + `returned`. */
    const toReturnedRow = (rr: (typeof freshReturnRows)[number]) => ({
      id: rr.rollId,
      barcode: rr.roll.barcode,
      item: rr.item,
      color: rr.color,
      width: rr.width,
      currentQty: rr.qty,
      qualityGrade: rr.prevQualityGrade,
      // `sackId` TAŞINIR: üst `rolls` dizisinde "çuvalsız" ayrımı bu alandan
      // yapılıyor; yazılmazsa `undefined == null` ile iade satırı hem çuvalın
      // içinde hem "çuvalsız" kümesinde görünürdü.
      sackId: rr.prevSackId,
      // Tek ayrım noktası. `status` alanına ikinci anlam YÜKLENMEZ — o alan
      // hayalet-top (SACK_ABSENT) sözleşmesine ait, karıştırmak sonraki
      // geliştirici için sessiz tuzak olur.
      returned: {
        returnId: rr.id,
        returnedAt: rr.createdAt,
        reasonName: rr.reason?.name ?? rr.reasonText ?? null,
        reasonColor: rr.reason?.color ?? null,
      },
    });

    const returnsBySack = new Map<string, ReturnType<typeof toReturnedRow>[]>();
    for (const rr of freshReturnRows) {
      if (!rr.prevSackId) continue; // legacy (kolon 2026-06'da eklendi) → çuvala düşmez
      const arr = returnsBySack.get(rr.prevSackId);
      if (arr) arr.push(toReturnedRow(rr));
      else returnsBySack.set(rr.prevSackId, [toReturnedRow(rr)]);
    }

    const totalKg = shipment.sacks.reduce((s, sk) => s.plus(sk.weightKg ?? 0), D0());

    const sacks = shipment.sacks.map((sk) => {
      // Çuvalın BRÜT içeriği = hâlâ içindeki toplar + bu çuvaldan iade alınanlar.
      // İade satırları SONA eklenir: operatörün elindeki mal önce okunur, iade
      // edilen mal artık orada değildir.
      const sackReturned = returnsBySack.get(sk.id) ?? [];
      const grossRolls = [...sk.rolls, ...sackReturned];

      const summaryMap = new Map<string, { itemCode: string; itemName: string; colorCode: string | null; colorName: string | null; width: Prisma.Decimal | null; totalQty: Prisma.Decimal; rollCount: number }>();
      for (const r of grossRolls) {
        const key = `${r.item.code}|${r.color?.code ?? ""}|${r.width == null ? "" : new Prisma.Decimal(r.width).toString()}`;
        let e = summaryMap.get(key);
        if (!e) {
          e = { itemCode: r.item.code, itemName: r.item.name, colorCode: r.color?.code ?? null, colorName: r.color?.name ?? null, width: r.width, totalQty: D0(), rollCount: 0 };
          summaryMap.set(key, e);
        }
        e.totalQty = e.totalQty.plus(r.currentQty);
        e.rollCount += 1;
      }
      return {
        id: sk.id, sackNo: sk.sackNo, seq: sk.seq, weightKg: sk.weightKg,
        rolls: grossRolls,
        swatches: sk.swatches,
        productSummary: [...summaryMap.values()],
        rollCount: grossRolls.length,
        // Ayrı sayaç: satır basmayan yüzeyler (mobil çuval kartı) rozeti bundan
        // kurar — orada `rolls` dizisi hiç render edilmiyor, yalnız bu iki sayı
        // okunuyor. Olmasaydı mobilde işaretsiz şişmiş rakam doğardı.
        returnedCount: sackReturned.length,
        returnedQty: sackReturned.reduce((s, r) => s.plus(r.currentQty), D0()),
        swatchCount: sk.swatches.length,
      };
    });

    // prevSackId = iade anındaki çuval (top artık o çuvalda değil ama iz burada); UI
    // sackNo/seq'i sevkiyatın YÜKLÜ sacks[]'ından çözer (çuval sevkiyatta kalır).
    // Bu dizi ekrandaki "BU SEVKİYATTAN İADE EDİLENLER" kartını besler ve AYNEN
    // KALIR — sektör standardındaki ayrı "iade defteri"nin karşılığıdır; çuval
    // içindeki rozetli satır onun yerine geçmez, konumunu söyler.
    const returnedRolls = returnRows.map((rr) => ({ id: rr.id, documentSourceId: rr.returnGroupId ?? rr.id, barcode: rr.roll.barcode, item: rr.item, color: rr.color, width: rr.width, qty: rr.qty, returnedAt: rr.createdAt, reasonName: rr.reason?.name ?? rr.reasonText ?? null, reasonColor: rr.reason?.color ?? null, prevSackId: rr.prevSackId }));
    const returnedMeters = returnRows.reduce((s, r) => s.plus(r.qty), D0());

    // ⚠️ TEK KAYNAK: brüt top dizisi BİR KEZ kurulur, hem payload'daki `rolls`
    // hem `summary` ONDAN türetilir. İkisini ayrı ayrı toplamak (canlı + iade)
    // klasik çift-sayım tuzağıdır — mobilin bugün yaptığı hatanın (istemcide
    // `rollCount + returnedCount`) backend ikizi olurdu.
    const grossShipmentRolls = [
      ...shipment.rolls.map((r) => ({ id: r.id, barcode: r.barcode, item: r.item, color: r.color, width: r.width, currentQty: r.currentQty, qualityGrade: r.qualityGrade, sackId: r.sackId })),
      ...freshReturnRows.map(toReturnedRow),
    ];
    const totalMeters = grossShipmentRolls.reduce((s, r) => s.plus(r.currentQty), D0());

    // DEFTER BOŞLUĞU (2026-09-06) — "çıkan mal ↔ siparişe yazılan" farkı.
    // Bugüne kadar bu sayı YALNIZ audit izinde vardı (`tahsissizMetraj`), yani
    // hiçbir ekranda görünmüyordu. Ölçüldü: sevk edilmiş 89 sevkiyatın 42'sinde
    // fark var (11.384,7 m) ve sipariş "Açık" kaldığı için aynı mal yeniden
    // üretime verilebiliyordu. Sayı, siparişi OLAN sevkiyatlarda anlamlıdır.
    const defterYazilan = shipment.sacks.reduce(
      (a2, sk) => a2 + sk.allocations.reduce((b2, x) => b2 + Number(x.qty), 0),
      0,
    );
    const defterCikan = shipment.sacks.reduce(
      (a2, sk) => a2 + sk.rolls.reduce((b2, r) => b2 + Number(r.currentQty), 0),
      0,
    );
    const defterBoslugu =
      shipment.orders.length === 0 ? null : Math.max(0, Math.round((defterCikan - defterYazilan) * 1000) / 1000);

    return {
      success: true,
      data: {
        id: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        /** Siparişe yazılamayan metraj; `null` = sevkiyatın siparişi yok (soru anlamsız). */
        defterBoslugu,
        destination: shipment.destination,
        procedureCode: shipment.procedureCode,
        dispatchNote: shipment.dispatchNote,
        manualSackCount: shipment.manualSackCount,
        plateNumber: shipment.plateNumber,
        driverName: shipment.driverName,
        carrier: shipment.carrier,
        dispatchedAt: shipment.dispatchedAt,
        customer: shipment.customer,
        branch: shipment.branch,
        orders,
        rolls: grossShipmentRolls,
        swatches: shipment.swatches,
        sacks,
        returnedRolls,
        // rollCount/totalMeters artık BRÜT — `attachTotals` (liste) ile birebir
        // aynı anlam. Eskiden liste "4 top / 212 m" derken detay "0 top / 0 m"
        // diyordu; alan adları aynı kaldı, anlamları BİRLEŞTİ. Net isteyen
        // `rollCount − returnedCount` yapar (ikisi de yanıtta).
        // `totalKg` DEĞİŞMEZ: iade `Sack.weightKg`'a dokunmuyor → zaten brüt;
        // geri-ekleme yapmak çift sayardı.
        summary: { rollCount: grossShipmentRolls.length, swatchCount: shipment.swatches.length, totalMeters, sackCount: shipment.sacks.length, totalKg, returnedCount: returnedRolls.length, returnedMeters },
      },
    };
  }

  // =========================================================================
  // SEVK KAPISI — PLANNED board (yalnız sevk-onayı AÇIKKEN dolar)
  // =========================================================================

  /** Sevk Kapısı board LİSTESİ — onay bekleyen PLANNED sevkiyatlar; hafif + cursor. */
  async listSackStoreBoard(params: { status?: string; search?: string; destination?: string; cursor?: string; limit?: number }): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 30), 100);
    const where: Prisma.ShipmentWhereInput = { status: ShipmentStatus.PLANNED };
    if (params.destination === "DOMESTIC" || params.destination === "EXPORT") {
      where.destination = params.destination as ShipmentDestination;
    }
    const search = params.search?.trim();
    if (search) {
      where.OR = buildTextSearch<Prisma.ShipmentWhereInput>(search, {
        text: ["customer.name"],
        code: ["shipmentNo", "sacks.some.sackNo"],
      });
    }

    const cursor = decodeDynamicCursor(params.cursor);
    const finalWhere: Prisma.ShipmentWhereInput = cursor ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "asc") as Prisma.ShipmentWhereInput] } : where;

    const rows = await prisma.shipment.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: { id: true, shipmentNo: true, status: true, destination: true, procedureCode: true, createdAt: true, customer: { select: { id: true, code: true, name: true } }, branch: { select: { id: true, code: true, name: true } } },
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const ids = pageRows.map((s) => s.id);
    const nextCursor = hasMore ? buildNextDynamicCursor(pageRows[pageRows.length - 1] as unknown as Record<string, unknown>, "createdAt") : null;

    const [sackAgg, rollAgg] = ids.length
      ? await Promise.all([
          prisma.sack.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _count: { _all: true }, _sum: { weightKg: true } }),
          prisma.roll.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _count: { _all: true }, _sum: { currentQty: true } }),
        ])
      : [[], []];
    const sackByShip = new Map(sackAgg.map((g) => [g.shipmentId, g]));
    const rollByShip = new Map(rollAgg.map((g) => [g.shipmentId, g]));

    const data = pageRows.map((s) => {
      const sa = sackByShip.get(s.id);
      const ra = rollByShip.get(s.id);
      return { id: s.id, shipmentNo: s.shipmentNo, status: s.status, destination: s.destination, procedureCode: s.procedureCode, createdAt: s.createdAt, customer: s.customer, branch: s.branch, sackCount: sa?._count._all ?? 0, rollCount: ra?._count._all ?? 0, totalKg: Number(sa?._sum.weightKg ?? 0), totalQty: Number(ra?._sum.currentQty ?? 0) };
    });
    return { success: true, data, pagination: { nextCursor, hasMore, limit } };
  }

  /** Bir sevkiyatın tam çuval+rulo dökümü — board kartına tıklayınca lazy. */
  async getShipmentSackContents(shipmentId: string): Promise<ApiResponse<unknown>> {
    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true, plateNumber: true, driverName: true, carrier: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true, sackNo: true, seq: true, weightKg: true, notes: true,
            // `status`: hayalet top görünür kalsın (array FİLTRELENMEZ — operatörün
            // görüp çıkarabilmesi için); sayaçlar/gruplar aşağıda dışlar.
            rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, status: true, currentQty: true, width: true, qualityGrade: true, item: { select: { id: true, name: true } }, color: { select: { id: true, name: true, hex: true } } } },
            swatches: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, item: { select: { id: true, name: true } }, color: { select: { id: true, name: true, hex: true } } } },
          },
        },
      },
    });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");

    const sacks = sh.sacks.map((sk) => {
      const groups = new Map<string, { itemName: string; colorName: string | null; width: number | null; qty: Prisma.Decimal; rollCount: number }>();
      let sackQty = D0();
      // Gruplar + sayaçlar yalnız FİZİKSEL OLARAK ÇUVALDA olan toplardan (etiket ve
      // irsaliye ile aynı küme); `sk.rolls` görünümde tamamıyla döner.
      const present = sk.rolls.filter((r) => !SACK_ABSENT_STATUSES.includes(r.status));
      for (const r of present) {
        const key = `${r.item.name}|${r.color?.name ?? ""}|${r.width ?? ""}`;
        const g = groups.get(key) ?? { itemName: r.item.name, colorName: r.color?.name ?? null, width: r.width ? Number(r.width) : null, qty: D0(), rollCount: 0 };
        g.qty = g.qty.plus(r.currentQty);
        g.rollCount += 1;
        groups.set(key, g);
        sackQty = sackQty.plus(r.currentQty);
      }
      return {
        id: sk.id, sackNo: sk.sackNo, seq: sk.seq, weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        notes: sk.notes,
        rollCount: present.length, swatchCount: sk.swatches.length, totalQty: Number(sackQty),
        contents: [...groups.values()].map((g) => ({ itemName: g.itemName, colorName: g.colorName, width: g.width, qty: Number(g.qty), rollCount: g.rollCount })),
        rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, status: r.status, qty: Number(r.currentQty), width: r.width != null ? Number(r.width) : null, qualityGrade: r.qualityGrade ?? "", item: r.item, color: r.color })),
        swatches: sk.swatches.map((s) => ({ id: s.id, barcode: s.barcode, item: s.item, color: s.color })),
      };
    });

    return { success: true, data: { id: sh.id, shipmentNo: sh.shipmentNo, status: sh.status, plateNumber: sh.plateNumber, driverName: sh.driverName, carrier: sh.carrier, customer: sh.customer, branch: sh.branch, sackCount: sh.sacks.length, sacks } };
  }

  /**
   * Muhasebe sevk fişi — SEVK ANINDAKİ BRÜT değerler.
   *
   * ⚠️ Kaynak DONMUŞ belgedir (`PrintedDocument.snapshot`), canlı çuval sorgusu
   * DEĞİL. Sevkten SONRA gelen iade (`RollReturn` topun `sackId`'sini boşaltır)
   * ya da metraj düzeltmesi bu fişi GERİYE DÖNÜK değiştirmemeli: aksi halde aynı
   * sevk fişi geçen ay 501 m, bugün 452 m der — aynı belge numarasıyla — ve fatura
   * mutabakatı sessizce bozulur. Sektör standardı: fatura sevk irsaliyesinden
   * kesilir, iade AYRI belgeyle (iade irsaliyesi + iade faturası) kapanır.
   * Böylece fiş ile irsaliye (`renderShipmentDispatchHtml`) aynı snapshot'tan
   * beslenir ve tanım gereği BİREBİR aynı kalır.
   *
   * Donmuş belge YOKSA canlı içeriğe düşülür ve `frozen:false` işaretlenir —
   * meşru iki hal: (a) sevkiyat henüz PLANNED (irsaliye doğmadı → taslak fiş),
   * (b) eski kayıt; (b)'de `getCurrent` zaten lazy-init ile belgeyi kurar
   * (idempotent + audit'li), yani ikinci okumada `frozen:true` olur.
   *
   * İadeler bu fişte DÜŞÜLMEZ; yalnız `returns` özetiyle bildirilir (istemci
   * dipnot basar). Dökümü sevkiyat detayındaki "İadeler" ve muhasebe dönem
   * export'unun "İade" sayfasındadır.
   */
  /**
   * Ad rejimini CANLI okur — baskı yolundaki `buildRenderExtras` ile AYNI üç ayar.
   * Rejim snapshot'a girmez: ayarı değiştirmek eski fişi de yeni ayarla bastırır
   * (belge içeriği donuk, SUNUM canlı).
   */
  async getDispatchReport(shipmentId: string): Promise<ApiResponse<unknown>> {
    const doc = (
      await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, shipmentId)
    ).data as { snapshot: { doc: unknown }; status: string; version: number } | null;

    const content = doc
      ? (doc.snapshot.doc as ShipmentDispatchDoc)
      : await collectShipmentDocContent(prisma, shipmentId, { requireDispatched: false });
    if (!content) throw AppError.notFound("Sevkiyat bulunamadı");

    return {
      success: true,
      data: {
        ...content,
        frozen: Boolean(doc),
        docStatus: doc?.status ?? null,
        docVersion: doc?.version ?? null,
        returns: await summarizeShipmentReturns(prisma, shipmentId),
        // ⚠️ AD REJİMİ FİŞE DE GİDER (2026-09-10 saha bulgusu). Snapshot iki adı
        // da taşıyor (`name` ↔ `customerName`); HANGİSİNİN basılacağı ayardan
        // gelir ve baskı anında CANLI okunur. Bu alan olmadan muhasebe fişinin
        // Excel'i kararı hiç sormuyor, hep bizim adımızı basıyordu — oysa ayarın
        // kendi açıklaması "kapsam sevk irsaliyesi + MUHASEBE FİŞİDİR" diyor.
        // Karar `resolveDocNameMode`de, yani irsaliyeyi çizen helper'ın AYNISINDA.
        docNameMode: resolveDocNameMode({
          itemNameMode: await readShippingDocItemNameMode(),
          cekiNameMode: await readShippingDocCekiNameMode(),
          productColorSplit: await readShippingDocProductColorSplit(),
        }) satisfies DocNameMode,
      },
    };
  }

  /**
   * Muhasebe fişi — fasondan DOĞRUDAN sevk (DirectShipment) sürümü. Çuval Shipment'ının
   * getDispatchReport'u ile AYNI şekli (header/products/sacks/cekiRows/totals) üretir ki
   * muhasebe ekranındaki Fiş dialog'u tek kontratla çalışsın. Doğrudan sevkte ÇUVAL YOK
   * (sacks:[], kg:0, çeki satırları top-başına); ürün gruplaması "İsim Renk Encm." biçimiyle
   * collectShipmentDocContent ile birebir. Baskı/önizleme ayrıca SUBCONTRACTOR_DIRECT_SHIP
   * donmuş irsaliyesinden gelir — bu yalnız Excel/etiket için yapılandırılmış veridir.
   */
  async getDirectShipmentDispatchReport(id: string): Promise<ApiResponse<unknown>> {
    const ds = await prisma.directShipment.findUnique({
      where: { id },
      select: {
        shipmentNo: true,
        shippedAt: true,
        createdAt: true,
        customer: { select: { code: true, name: true, taxNumber: true, exportCode: true } },
        branch: { select: { code: true, name: true } },
        allocations: { select: { orderLine: { select: { order: { select: { orderNumber: true } } } } } },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
            // collectShipmentDocContent ile AYNI şekil — yalnız birini güncellemek
            // iki belgeyi ayrıştırır (bu metodun tek varlık sebebi şekil birliği).
            batch: { select: { batchNumber: true } },
          },
        },
      },
    });
    if (!ds) throw AppError.notFound("Fasondan sevk kaydı bulunamadı");

    const productMap = new Map<string, { name: string; rollCount: number; totalMeters: Prisma.Decimal }>();
    let totalMeters = D0();
    const cekiRows = ds.rolls.map((r) => {
      totalMeters = totalMeters.plus(r.currentQty);
      const widthStr = r.width != null ? `${Number(r.width)}cm.` : "";
      const stokAdi = [r.item.name, r.color?.name ?? "", widthStr].filter(Boolean).join(" ");
      const g = productMap.get(stokAdi) ?? { name: stokAdi, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      productMap.set(stokAdi, g);
      // Çuval yok → sackCode "—", kg top-başına taşınmaz (0).
      return { rollId: r.id, sackCode: "—", barcode: r.barcode, desen: r.item.name, varyant: r.color?.name ?? "", meters: Number(r.currentQty), kg: 0, batchNumber: r.batch?.batchNumber ?? null };
    });
    const products = [...productMap.values()].map((p) => ({ name: p.name, rollCount: p.rollCount, totalMeters: Number(p.totalMeters) }));
    const orderNos = [...new Set(ds.allocations.map((a) => a.orderLine.order.orderNumber))].join(", ");

    return {
      success: true,
      data: {
        header: {
          shipmentNo: ds.shipmentNo,
          customerName: ds.customer.name,
          customerCode: ds.customer.code,
          customerTaxNumber: ds.customer.taxNumber ?? null,
          branchName: ds.branch?.name ?? null,
          branchCode: ds.branch?.code ?? null,
          // Şirket ihracat kodu — tek "İhracat Kodu" satırına şube ihracat kodu
          // (branchCode) boşsa yedek olarak basılır (branchCode ?? customerExportCode).
          customerExportCode: ds.customer.exportCode ?? null,
          procedureCode: null,
          destination: ShipmentDestination.DOMESTIC,
          status: ShipmentStatus.DISPATCHED,
          date: ds.shippedAt.toISOString(),
          plateNumber: null,
          driverName: null,
          carrier: null,
          orderNos,
        },
        products,
        sacks: [],
        cekiRows,
        totals: { totalRolls: ds.rolls.length, totalMeters: Number(totalMeters), totalKg: 0, sackCount: 0 },
        // ⚠️ AD REJİMİ BURADA SABİT "bizdeki" (2026-09-10). Fasondan DOĞRUDAN sevk
        // ayarın kapsamı DIŞINDADIR — ayarın kendi açıklaması bunu söylüyor
        // ("fasondan DOĞRUDAN sevk irsaliyesi bu ayarın dışındadır") ve bu uç
        // zaten müşteri adı alanlarını hiç kurmuyor (`desen: r.item.name`).
        // Alanı BOŞ bırakmak yerine ADIYLA sabitlemek, Excel'in "rejim yok →
        // ne yapayım" diye tahmin etmesini engeller.
        docNameMode: resolveDocNameMode({ itemNameMode: "bizdeki" }) satisfies DocNameMode,
        // Çuval sevkiyatı fişiyle AYNI kontrat — istemci tek `DispatchReport` tipiyle
        // çalışır ve alan eksik gelirse Excel dipnotu `returns.count` okurken PATLAR.
        //
        // `frozen: true` burada "snapshot'tan okundu" demek DEĞİL (yukarısı canlı
        // sorgu); "bu rakam sevk anının değişmez kaydıdır" demek — doğrudan sevkte
        // iki yol da kapalı olduğu için geçerli: (1) iade YOLU YOK, `RollReturn.
        // fromShipmentId` Shipment'a bakar, DirectShipment'a değil; (2) sevk edilmiş
        // topun metrajı düzeltilemez (`ALWAYS_BLOCKED` — sevkteki top). Bu iki
        // koşuldan biri değişirse (ör. fason sevkine iade eklenirse) burası gerçek
        // özet döndürmeli, yoksa fiş sessizce geriye dönük değişmeye başlar.
        frozen: true,
        docStatus: PrintedDocStatus.ACTIVE,
        docVersion: 1,
        returns: { count: 0, meters: 0 },
      },
    };
  }

  // =========================================================================
  // SİPARİŞ SEÇİM EKRANI — açık siparişler + depo karşılaması (paketleme rehberi)
  // =========================================================================

  /**
   * Açık siparişler + her satırda depo karşılaması. openQty = istenen − sevk (rezerv yok).
   * Depo serbest stoğu (shipmentId=null, sackId=null, WAREHOUSE) spec bazında gösterilir.
   *
   * ⚠️ ARAMA SUNUCUDA (2026-09-04) — istemci süzmesi DEĞİL. Sebep tek satırda:
   * aşağıdaki `take: 300` bir KESMEDİR. İstemci elindeki (kesilmiş) diziyi
   * süzseydi, 300'ü aşan bir cariye ait sipariş aranınca ekran "sonuç yok" der
   * ve sipariş GERÇEKTEN varken siparişsiz sevke itilirdi — bu depoda adı konmuş
   * "istemci süzmesi yanlış kayıt-yok üretir" sınıfı (2026-08-12 top listesi dersi).
   * Süzgeç `where`e girince kesme süzülmüş kümeye uygulanır, yani sonuç doğru.
   *
   * Arama yolları sipariş listesinin (`order.service.listAvailableForPicker`)
   * AYNISI + renk adı: aynı soruya iki ekranda iki farklı cevap çıkmasın.
   */
  async listOpenOrdersWithCoverage(params: {
    customerId?: string;
    branchId?: string | null;
    search?: string;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.OrderWhereInput = { status: { notIn: ["CANCELLED", "COMPLETED"] } };
    if (params.customerId) where.customerId = params.customerId;
    if (params.branchId !== undefined) where.branchId = params.branchId;

    const search = params.search?.trim();
    if (search) {
      const or = buildTextSearch<Prisma.OrderWhereInput>(search, {
        text: [
          "customer.name",
          "lines.some.item.name",
          "lines.some.customerItemName",
          "lines.some.color.name",
        ],
        code: ["orderNumber"],
      });
      // ⚠️ SÖZLEŞME KAPISI (gözlenmiş bir hatanın yaması DEĞİL — ayrım yazılı
      // olsun): Prisma'da `OR: []` "hiçbir şey eşleşmesin" demektir, yani boş bir
      // dizi süzgeci listeyi sessizce boşaltır. `buildTextSearch` BUGÜN yalnız
      // BOŞ terimde `[]` döner ve o yol yukarıdaki `trim()` kontrolüyle zaten
      // kapalı (ölçüldü 2026-09-04: "-", "...", "·", "€", "…" dahil denenen her
      // boş-olmayan terim >=1 cümle üretti). Dal, helper'ın sözleşmesi değişirse
      // sessiz boş listeye düşmemek için duruyor.
      if (or.length > 0) where.OR = or;
    }

    const orders = await prisma.order.findMany({
      where,
      take: 300,
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { orderDate: "asc" }],
      select: {
        id: true, orderNumber: true, status: true, deadline: true, orderDate: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        lines: { select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, customerItemName: true, customerColorName: true, createdAt: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (orders.length === 0) return { success: true, data: [] };

    // Serbest depo stoğu (sevke-uygun) — spec bazında toplam. Yalnız WAREHOUSE (bitmiş, sevke
    // hazır); ham STOCK sayılmaz — ham satışı nadir/özel talep, "mevcut" göstergesini şişirmesin.
    // (Ham yine de çuvala okutulup sevk EDİLEBİLİR; sadece bu sayaçta görünmez.) sackId:null:
    // çuvaldaki (bekleyen) toplar serbest sayılmaz.
    const itemIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemId)))];
    const stockBySpec = await prisma.roll.groupBy({
      by: ["itemId", "colorId", "width"],
      where: { shipmentId: null, sackId: null, status: RollStatus.WAREHOUSE, itemId: { in: itemIds } },
      _sum: { currentQty: true },
    });
    const specAvail = (line: { itemId: string; colorId: string | null; width: Prisma.Decimal | null }): Prisma.Decimal =>
      stockBySpec.reduce((sum, g) => {
        if (g.itemId !== line.itemId) return sum;
        if (line.colorId != null && g.colorId != null && g.colorId !== line.colorId) return sum;
        if (line.width != null && g.width != null && !new Prisma.Decimal(line.width).equals(g.width)) return sum;
        return sum.plus(g._sum.currentQty ?? 0);
      }, D0());

    // MÜŞTERİDEKİ AD — `getShipmentById` ile AYNI kademe (2026-09-06): override >
    // master alias > yok. Bu uç `customerId`siz de çağrılabildiği için alias'lar
    // müşteri BAŞINA döngüyle değil, (customerId, itemId) çiftleriyle TEK sorgu
    // çiftinde çekilir — kaç müşteri olursa olsun 2 gidiş-dönüş.
    const { itemAlias: kumasAlias, colorAlias: renkAlias } = await batchLoadAliasesMulti(
      prisma,
      orders.map((o) => o.customer.id),
      orders.flatMap((o) => o.lines.map((l) => l.itemId)),
      orders.flatMap((o) => o.lines.map((l) => l.colorId)).filter((c): c is string => !!c),
    );

    const data = orders.map((o) => ({
      order: { id: o.id, orderNumber: o.orderNumber, status: o.status, deadline: o.deadline, customer: o.customer, branch: o.branch },
      lines: o.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        const openQty = requested.minus(shipped);
        const fromWarehouse = specAvail(l);
        // DEFAULT'a düşerse null — arayüz bizim adımızı "müşterideki ad" diye basmasın.
        const musteriKumas = resolveName(l.customerItemName, kumasAlias.get(`${o.customer.id}:${l.itemId}`), "");
        const musteriRenk = resolveName(
          l.customerColorName,
          l.colorId ? renkAlias.get(`${o.customer.id}:${l.colorId}`) : null,
          "",
        );
        return {
          lineId: l.id, item: l.item, color: l.color, width: l.width,
          customerItemName: musteriKumas.source === "DEFAULT" ? null : musteriKumas.name,
          customerColorName: musteriRenk.source === "DEFAULT" ? null : musteriRenk.name,
          requested, shipped, openQty, warehouseAvailable: fromWarehouse,
          covered: openQty.lessThanOrEqualTo(0) || fromWarehouse.greaterThanOrEqualTo(openQty),
        };
      }),
    }));
    return { success: true, data };
  }
}

export const shippingService = new ShippingService();

/**
 * Bir sevkiyattan İPTAL EDİLMEMİŞ iadelerin özeti (adet + metraj).
 *
 * Fişte/irsaliyede rakamı DÜŞMEK için değil, "bu belge sevk anına aittir, sonrasında
 * iade olmuş" dipnotunu bastırmak için. İptal edilen iade (`cancelledAt`) sayılmaz —
 * top sevkiyata geri döndüğü için zaten donmuş belgeyle tutarlıdır.
 */
async function summarizeShipmentReturns(
  db: PrintedDocDb,
  shipmentId: string,
): Promise<{ count: number; meters: number }> {
  const agg = await db.rollReturn.aggregate({
    where: { fromShipmentId: shipmentId, cancelledAt: null },
    _count: { _all: true },
    _sum: { qty: true },
  });
  return { count: agg._count._all, meters: Number(agg._sum.qty ?? 0) };
}

// =============================================================================
// RESMİ BELGE — Sevk İrsaliyesi snapshot builder'ı (PrintedDocument)
// =============================================================================
// Tek üretici: freeze (dispatch tx'i), reissue (revizyon), lazy-init. `collectShipmentDocContent`
// çuval içeriğinden (Sack→Roll) üretir — tahsis/allocation'a DOKUNMAZ.
//
// ⚠️ Bu fonksiyon CANLI okur; "sevk anı" garantisini veren şey donma (freeze) adımıdır.
// Muhasebe fişi (`getDispatchReport`) ile irsaliye BİREBİR aynı kalsın diye ikisi de
// donmuş SNAPSHOT'tan beslenir — buradan DEĞİL. Yeni bir "sevk içeriği" yüzeyi eklerken
// aynı kuralı uygula: sevk edilmiş bir sevkiyatın rakamını canlı sorgudan üretme.
//
// ⚠️⚠️ AMA "CANLI" ≠ "NET" (2026-08-05, kapatılan açık). Freeze tek koruma DEĞİLDİ:
// `reissue` ve lazy-init de bu üreticiyi çağırır ve onlar sevkten SONRA koşar. İade
// `Roll.sackId` + `shipmentId`'yi NULL'lar (`return.service.ts:322-325`) → o iki yol
// iadeden sonra NET bir "donmuş" resmi belge üretiyordu: aynı belge numarası, geçen ay
// 501 m, bugün 452 m. Sektör standardı bunun tersi: çıkış belgesi asla düzeltilmez,
// iade AYRI belgeyle kapanır. Bu yüzden içerik artık BRÜT kurulur — iptal edilmemiş
// `RollReturn` satırları geri eklenir.
//
// KAYNAK TERCİHİ snapshot DEĞİL `RollReturn`: `attachTotals`, `accounting-export` ve
// `getShipmentById` de aynı kaynağı seçti; dördüncü bir kaynak dördüncü bir rakam
// demekti (perf kuralı 13 ayrıca snapshot okumayı liste yüzeylerinde yasaklıyor).
//
// DİĞER ÇAĞIRANLARDA NO-OP: freeze sevk tx'inin İÇİNDE koşar (henüz iade yoktur) ve
// TASLAK önizleme PLANNED sevkiyat içindir — iade `roll.status=SHIPPED` istediği için
// orada `RollReturn` doğamaz, sorgu doğal olarak boş döner. Yani bu ekleme yalnız
// kırık olan iki yolu düzeltir, çalışanları AYNEN bırakır.
async function collectShipmentDocContent(
  db: PrintedDocDb,
  shipmentId: string,
  opts: { requireDispatched: boolean }
): Promise<ShipmentDispatchDoc | null> {
  const sh = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      shipmentNo: true, status: true, procedureCode: true, destination: true, dispatchedAt: true, createdAt: true,
      manualSackCount: true,
      plateNumber: true, driverName: true, carrier: true,
      // `customerId` + `orders.orderId` (2026-09-04) — "müşterideki ad" zinciri
      // müşteri×ürün master alias'ı ve sipariş satırı override'ını bu ikisiyle
      // çözer (bkz. `loadShipmentCustomerNames`).
      customerId: true,
      customer: { select: { code: true, name: true, taxNumber: true, exportCode: true } },
      branch: { select: { code: true, name: true } },
      orders: { select: { orderId: true, order: { select: { orderNumber: true } } } },
      sacks: {
        orderBy: { seq: "asc" },
        // ⚠️ RESMİ BELGE — hayalet toplar DIŞLANIR (`SACK_ABSENT_STATUSES`; `SHIPPED`
        // SAYILIR). Bu filtre olmadan çuvalda kayıtlı ama fiziksel olarak binada
        // olmayan top (kartelaya/tambura/fasona gitmiş) irsaliyenin ÇUVAL METRAJINA,
        // ÜRÜN ÖZETİNE, ÇEKİ satırlarına ve TOPLAM METRAJA giriyordu — ve bu içerik
        // `freezeForSource` ile DONUYORDU (müşteriye/gümrüğe giden hukuken bağlayıcı
        // belge). Donmuş eski snapshot'lar etkilenmez (JSON olarak saklı); filtre
        // yalnız YENİ build'leri etkiler (taslak önizleme, lazy-init reconstruction,
        // reissue) — reissue'de düzeltilmiş çıkması İSTENEN davranıştır.
        // `batch` = çeki satırındaki Parti No. Çuval KARIŞIK içerikli olabildiği için
        // parti çuval değil TOP başına taşınır. Kolon opt-in (defaultHidden) — müşteri
        // belgesinin yerleşimi sormadan değişmesin.
        // `id` ŞART: iade satırları `RollReturn.prevSackId` ile bu id'ye eşlenir
        // (brütleştirme). Onsuz iade edilen top hangi çuvala döneceğini bilemez.
        // `itemId`/`colorId` (2026-09-04) — "müşterideki ad" zincirinin ANAHTARI.
        // İlişkinin `name`i yetmez: override `OrderLine`da, master alias
        // `CustomerItemAlias`ta ve ikisi de KİMLİKLE eşlenir (ada göre eşleme,
        // aynı adı taşıyan iki kartı sessizce birleştirirdi).
        // `qualityGradeId`/`qualityGrade` (2026-09-13) — "müşterideki ad" POLİTİKA
        // anahtarı (`QualityGrade.skipCustomerName`). İkisi birden: FK canlı topta
        // dolu, kod eski/iade satırlarında tek kalan olabilir.
        select: { id: true, seq: true, sackNo: true, weightKg: true, rolls: { where: { status: { notIn: SACK_ABSENT_STATUSES } }, orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, currentQty: true, width: true, itemId: true, colorId: true, qualityGradeId: true, qualityGrade: true, item: { select: { name: true } }, color: { select: { name: true } }, batch: { select: { batchNumber: true } } } } },
      },
    },
  });
  if (!sh) return null;
  if (opts.requireDispatched && sh.status !== ShipmentStatus.DISPATCHED) return null;

  // ── BRÜTLEŞTİRME: iade edilmiş topları çuvallarına geri ekle ───────────────
  // (Gerekçe fonksiyon başlığında. Freeze/taslak yollarında bu sorgu boş döner.)
  const returnRows = await db.rollReturn.findMany({
    where: { fromShipmentId: shipmentId, cancelledAt: null },
    select: {
      rollId: true,
      prevSackId: true,
      qty: true,
      width: true,
      // Kimlikler ŞART: brütleştirmeyle geri eklenen top da "müşterideki ad"
      // zincirinden geçer; yalnız `name` taşınırsa iade satırı belgede BİZİM
      // adımızla, kardeşleri müşterinin adıyla basılırdı.
      itemId: true,
      colorId: true,
      item: { select: { name: true } },
      color: { select: { name: true } },
      // Barkod + parti CANLI toptan okunur: iade ikisini de DEĞİŞTİRMEZ
      // (metraj/kalite değişebilir — onlar iade anındaki `prev*` alanlarından).
      // ⚠️ KALİTE de kimlikler kadar ŞART (2026-09-13): "müşterideki ad" politikası
      // kaliteye bakar; taşımazsak iade satırı politikayı ATLAR ve alt kalite mal
      // müşterinin adıyla basılır — FAIL-SAFE'in TERS yönü. İade ANINDAKİ kalite
      // doğru olandır (top sonradan yeniden derecelenmiş olabilir).
      prevQualityGradeId: true,
      prevQualityGrade: true,
      roll: { select: { barcode: true, batch: { select: { batchNumber: true } } } },
    },
  });

  // YARIŞ KORUMASI: `shipment.findUnique` ile bu findMany AYRI sorgulardır (tx yok).
  // Arada bir iade commit olursa aynı top HEM canlı `sk.rolls`'ta HEM iade satırı
  // olarak gelir → belge metrajı ŞİŞER. Canlı id kümesiyle dedup o pencereyi kapatır.
  // (`getShipmentById` ile birebir aynı koruma.)
  const liveRollIds = new Set<string>();
  for (const sk of sh.sacks) for (const r of sk.rolls) liveRollIds.add(r.id);

  const returnsBySack = new Map<string, (typeof sh.sacks)[number]["rolls"]>();
  for (const rr of returnRows) {
    if (liveRollIds.has(rr.rollId)) continue;
    // `prevSackId` yoksa (kolon 2026-06'da eklendi — eski iadeler) hangi çuvala
    // döneceği bilinmiyor; uydurmak yerine ATLANIR. Belge o kadarıyla eksik kalır
    // ama YANLIŞ çuvala yazmaktan iyidir.
    if (!rr.prevSackId) continue;
    const row = {
      id: rr.rollId,
      barcode: rr.roll.barcode,
      currentQty: rr.qty,
      width: rr.width,
      itemId: rr.itemId,
      colorId: rr.colorId,
      item: { name: rr.item?.name ?? "" },
      color: rr.color ? { name: rr.color.name } : null,
      qualityGradeId: rr.prevQualityGradeId,
      qualityGrade: rr.prevQualityGrade,
      batch: rr.roll.batch ? { batchNumber: rr.roll.batch.batchNumber } : null,
    } as unknown as (typeof sh.sacks)[number]["rolls"][number];
    const arr = returnsBySack.get(rr.prevSackId);
    if (arr) arr.push(row);
    else returnsBySack.set(rr.prevSackId, [row]);
  }

  // Not: `totalKg` DEĞİŞMEZ — iade `Sack.weightKg`'a dokunmaz, yani o rakam zaten
  // brüt. Geri-ekleme kg'yi çift sayardı.
  // TEK KAYNAK: çuval satırı, ürün özeti ve çeki satırları BU listeden türetilir.
  // İkisini ayrı ayrı toplamak (biri canlı, biri brüt) çift sayım üretirdi.
  const sacksGross = sh.sacks.map((sk) => ({
    ...sk,
    rolls: [...sk.rolls, ...(returnsBySack.get(sk.id) ?? [])],
  }));

  // ── MÜŞTERİDEKİ AD (2026-09-04) ────────────────────────────────────────────
  // Donmuş çekirdeğe GİRER (annotation DEĞİL): irsaliye hukuki kayıttır ve
  // "sevk anındaki ad" doğru olandır; master alias sonradan düzeltilirse eski
  // belge DEĞİŞMEMELİ. Bu yüzden ad snapshot'a YAZILIR, hangi adın basılacağı
  // (`shipping.docItemNameMode`) ise render anında CANLI okunur — içerik donuk,
  // sunum canlı (refakat kartının 2026-08-06 kuralıyla aynı ayrım).
  //
  // ⚠️ Sevkten SONRA da koşar (reissue / lazy-init) — 2026-08-05 dersi. Zincir
  // o yollarda da doğrudur: override sipariş satırında kalıcıdır, master alias
  // canlı okunur (o gün geçerli olan ad reissue'de basılır; reissue zaten
  // "bugünkü doğruyu yeniden dondur" demektir).
  const customerNames = await loadShipmentCustomerNames(db, {
    customerId: sh.customerId,
    sackIds: sh.sacks.map((s) => s.id),
    orderIds: sh.orders.map((o) => o.orderId),
    itemIds: sacksGross.flatMap((sk) => sk.rolls.map((r) => r.itemId)),
    colorIds: sacksGross.flatMap((sk) => sk.rolls.map((r) => r.colorId ?? "")),
  });
  // MÜŞTERİ ADI POLİTİKASI (2026-09-13) — `QualityGrade.skipCustomerName`.
  // Karar SATIR düzeyindedir: sütunu `resolveDocNameMode` açar/kapatır, bu politika
  // yalnız o satırın HÜCRESİNİ boşaltır (bkz. schema notu).
  const namePolicy = await loadCustomerNamePolicy(db);
  // ⚠️ TİP, GERÇEKTEN YAZILAN ALANLARI SAYAR: `customerItemOnly`/`customerColorOnly`
  // aşağıda kuruluyordu ama bu tipte YOKTU (birleşim genişlemesi sayesinde derleyici
  // susuyordu) ve `products` eşlemesi onları zaten düşürüyor. Tipe alındılar ki
  // "yazılıyor ama çıktıya gitmiyor" görünür olsun — davranış DEĞİŞMEDİ.
  const productMap = new Map<
    string,
    {
      name: string;
      customerName: string | null;
      customerItemOnly: string | null;
      customerColorOnly: string | null;
      skipsCustomerName: boolean;
      rollCount: number;
      totalMeters: Prisma.Decimal;
    }
  >();
  const sackRows = sacksGross.map((sk) => {
    let sackMeters = D0();
    for (const r of sk.rolls) {
      sackMeters = sackMeters.plus(r.currentQty);
      const widthStr = r.width != null ? `${Number(r.width)}cm.` : "";
      const stokAdi = [r.item.name, r.color?.name ?? "", widthStr].filter(Boolean).join(" ");
      // GRUPLAMA ANAHTARI BİZİM ADIMIZDIR ve öyle KALIR: müşteri adına göre
      // gruplasaydık iki farklı ürün aynı alias altında birleşir, adet/metraj
      // sessizce toplanırdı. Müşteri adı gruba TAŞINIR, grubu belirlemez.
      // ⚠️ FAIL-SAFE: işaretli kalitede müşteri adı HİÇ çözülmez. Çözüp sonra
      // gizlemek, karışık satırda ilk topun adının gruba yapışmasına açık kapı
      // bırakırdı (grup `customerName`ini İLK top kurar).
      const rollSkips = namePolicy.skips(r.qualityGradeId, r.qualityGrade);
      const ci = rollSkips ? null : customerNames.itemName(r.itemId, r.colorId);
      const cc = rollSkips ? null : customerNames.colorName(r.colorId);
      const custName =
        ci || cc
          ? [ci ?? r.item.name, cc ?? r.color?.name ?? "", widthStr].filter(Boolean).join(" ")
          : null;
      // AYRIŞTIRILMIŞ İKİZLER (2026-09-06) — `shipping.docProductColorSplit` açıkken
      // renderer bunları KULLANIR, kapalıyken birleşik `customerName`i basar.
      // ⚠️ Birleşik dize AYNEN kalıyor: bayrak kapalıyken çıktı bayt-bayt aynı olsun
      // ve donmuş eski belgeler yeni alan olmadan da doğru basılabilsin.
      const custItemOnly = ci || cc ? [ci ?? r.item.name, widthStr].filter(Boolean).join(" ") : null;
      // ⚠️ FALLBACK YOK ve bu BİLİNÇLİ (kullanıcı düzeltmesi 2026-09-06):
      // "çoğu müşteri bizim renk adımızı kullanır." Yani renk karşılığının olmaması
      // eksik veri DEĞİL, normal hâldir. Ayrık kipte bizim adımızı "MÜŞTERİ VARYANT"
      // başlığı altında basmak onu müşterinin adıymış gibi gösterirdi — yanlış
      // etiketleme. Karşılığı olmayan satırda sütun BOŞ kalır.
      const custColorOnly = cc ?? null;
      const g =
        productMap.get(stokAdi) ??
        {
          name: stokAdi,
          customerName: custName,
          customerItemOnly: custItemOnly,
          customerColorOnly: custColorOnly,
          skipsCustomerName: false,
          rollCount: 0,
          totalMeters: D0(),
        };
      // ⚠️ KARIŞIK SATIRIN KURALI: grubun müşteri adını İLK top kurar, ama işaret
      // TÜM toplara sorulur ve OR'lanır. Tek bir işaretli top satırı bizim adımıza
      // düşürür — "en az bir alt kalite varsa müşterinin adını iliştirme".
      if (rollSkips) g.skipsCustomerName = true;
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      productMap.set(stokAdi, g);
    }
    return { code: sk.sackNo ?? `#${sk.seq}`, seq: sk.seq ?? 0, totalMeters: Number(sackMeters), totalKg: sk.weightKg != null ? Number(sk.weightKg) : 0, packageCount: sk.rolls.length };
  });

  // ⚠️ ÇEKİ SATIRI TOP BAŞINADIR — orada karışıklık sorusu YOKTUR, politika
  // doğrudan o topun kalitesine sorulur. (Ürün özetindeki OR'lama yalnız GRUP
  // satırı için gerekliydi.)
  const cekiRows = sacksGross.flatMap((sk) =>
    sk.rolls.map((r, idx) => {
      const skips = namePolicy.skips(r.qualityGradeId, r.qualityGrade);
      return { rollId: r.id, sackCode: sk.sackNo ?? `#${sk.seq}`, barcode: r.barcode, desen: r.item.name, varyant: r.color?.name ?? "", customerDesen: skips ? null : customerNames.itemName(r.itemId, r.colorId), customerVaryant: skips ? null : customerNames.colorName(r.colorId), width: r.width != null ? Number(r.width) : null, meters: Number(r.currentQty), kg: idx === 0 && sk.weightKg != null ? Number(sk.weightKg) : 0, batchNumber: r.batch?.batchNumber ?? null };
    })
  );

  const products = [...productMap.values()].map((p) => ({ name: p.name, customerName: p.skipsCustomerName ? null : p.customerName, rollCount: p.rollCount, totalMeters: Number(p.totalMeters) }));
  const totalRolls = products.reduce((s, p) => s + p.rollCount, 0);
  const totalMeters = Number(sackRows.reduce((s, r) => s.plus(r.totalMeters), D0()));
  const totalKg = Number(sackRows.reduce((s, r) => s.plus(r.totalKg), D0()));
  const orderNos = [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", ");

  return {
    // branchCode = şube ihracat kodu; customerExportCode = şirket ihracat kodu.
    // Belgede TEK "İhracat Kodu" satırı basılır: branchCode ?? customerExportCode
    // (şube önce, boşsa şirket) — "exportCode" section toggle'ıyla açılıp kapanır.
    header: { shipmentNo: sh.shipmentNo, customerName: sh.customer.name, customerCode: sh.customer.code, customerTaxNumber: sh.customer.taxNumber ?? null, branchName: sh.branch?.name ?? null, branchCode: sh.branch?.code ?? null, customerExportCode: sh.customer.exportCode ?? null, procedureCode: sh.procedureCode, destination: sh.destination, status: sh.status, date: (sh.dispatchedAt ?? sh.createdAt).toISOString(), plateNumber: sh.plateNumber, driverName: sh.driverName, carrier: sh.carrier, orderNos },
    products,
    sacks: sackRows,
    cekiRows,
    totals: {
      totalRolls,
      totalMeters,
      totalKg,
      // `sackCount` SİSTEMİN saydığı kayıt adedi — sözleşme değişmedi.
      sackCount: sh.sacks.length,
      // `manualSackCount` operatörün beyan ettiği FİZİKSEL adet. Belge ikisini
      // birlikte basar (biri diğerinin yerine geçmez): sahada 10 çuval tek çuval
      // kaydına yazıldığı için ikisi meşru olarak farklıdır ve fark BİLGİDİR.
      // null = beyan yok → belgede yalnız sistemin rakamı çıkar.
      manualSackCount: sh.manualSackCount,
    },
  };
}

/** Freeze / reissue / lazy-init — yalnız DISPATCHED sevkiyat belgelenir. */
async function buildShipmentDispatchDoc(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const content = await collectShipmentDocContent(db, shipmentId, { requireDispatched: true });
  if (!content) return null;
  return { documentNo: content.header.shipmentNo, doc: content as unknown as Record<string, unknown> };
}

/** Canlı önizleme (TASLAK) — sevk öncesi içerik üretir. */
async function buildShipmentDispatchPreview(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const content = await collectShipmentDocContent(db, shipmentId, { requireDispatched: false });
  if (!content) return null;
  return { documentNo: content.header.shipmentNo, doc: content as unknown as Record<string, unknown> };
}

registerPrintedDocBuilder(PrintedDocType.SHIPMENT_DISPATCH, {
  fresh: buildShipmentDispatchDoc,
  renderHtml: renderShipmentDispatchHtml,
  buildPreview: buildShipmentDispatchPreview,
  // Belge şablon profili: sevkiyatın müşterisine atanmış profil (yoksa genel ayar).
  resolveProfileId: async (db, sourceId) => {
    const s = await db.shipment.findUnique({
      where: { id: sourceId },
      select: { customer: { select: { documentProfileId: true } } },
    });
    return s?.customer?.documentProfileId ?? null;
  },
  // İrsaliye açıklaması — sevkiyata kayıtlı serbest not (annotation). Donmuş belgeye
  // girmez; her baskıda canlı çözülür, düzenlenince tekrar baskıda güncel çıkar.
  resolveLiveNote: async (db, sourceId) => {
    const s = await db.shipment.findUnique({
      where: { id: sourceId },
      select: { dispatchNote: true },
    });
    return s?.dispatchNote ?? null;
  },
  // Çuval yorumları — irsaliye ÇUVAL LİSTESİ'ndeki opsiyonel "AÇIKLAMA" kolonunu besler.
  // Annotation: donmuş çekirdeğe (collectShipmentDocContent) GİRMEZ → sevkten sonra
  // yazılan yorum da basılır, sürüm doğmaz, eski snapshot'lar etkilenmez. Anahtar
  // `sackNo`, çünkü snapshot satırındaki `code` alanı da sackNo'dur.
  resolveLiveRowNotes: async (db, sourceId) => {
    const rows = await db.sack.findMany({
      where: { shipmentId: sourceId, notes: { not: null } },
      select: { sackNo: true, notes: true },
    });
    const out: Record<string, string> = {};
    for (const r of rows) if (r.notes) out[r.sackNo] = r.notes;
    return out;
  },
  // Çuval İZLERİ (etiket) — irsaliye ÇUVAL LİSTESİ'ndeki opsiyonel "İZ" kolonunu
  // besler. Yorum kolonunun KARDEŞİ, ama AYRI kanal: iz ile yorum farklı
  // hassasiyette veridir ve tek anahtar "notu bas" diyene sessizce izi de
  // bastırırdı.
  //
  // ⚠️ Annotation: donmuş çekirdeğe (`collectShipmentDocContent`) GİRMEZ.
  // Girseydi (a) etiketleme sonrası reissue yeni belge sürümü doğururdu,
  // (b) DISPATCH'teki iz temizliği (`clearedAt`) snapshot ile canlı listeyi
  // KALICI çelişkiye sokardı — üretici sevkten SONRA da koşuyor (2026-08-05).
  //
  // ⚠️ `ACTIVE_TAG_WHERE` TEK KAYNAK: rozet/filtre/belge ayrışmasın. Sevk ANINDA
  // izler temizlendiği için DISPATCHED bir sevkiyatın çuvallarında bu sorgu
  // normalde BOŞ döner ve kolon hiç basılmaz — dolu döndüğü tek meşru hal,
  // sevkten SONRA yeni iz bırakılmış olmasıdır (bu da serbest).
  resolveLiveRowTags: async (db, sourceId) => {
    const rows = await db.sack.findMany({
      where: { shipmentId: sourceId },
      select: {
        sackNo: true,
        tags: {
          where: ACTIVE_TAG_WHERE,
          select: { tag: { select: { name: true, sortOrder: true } } },
          orderBy: [{ tag: { sortOrder: "asc" } }, { tag: { name: "asc" } }],
        },
      },
    });
    const out: Record<string, string> = {};
    for (const r of rows) {
      const names = r.tags.map((t) => t.tag.name).filter(Boolean);
      if (names.length) out[r.sackNo] = names.join(", ");
    }
    return out;
  },
});

// =============================================================================
// SEVKİYAT-TÜREVLİ BELGELER — Kalite Sertifikası / Packing List / Commercial Invoice
// =============================================================================
// Aynı Shipment kaynağının farklı görünümleri (sourceId = Shipment.id, her belge
// tipi kendi zinciri). Tek genişletilmiş collector: kalite, ambalaj ve fiyat verisi
// bir sorguda. Fatura fiyatı çuval→SackAllocation→OrderLine.unitPrice'tan türetilir.
async function collectShipmentDerived(db: PrintedDocDb, shipmentId: string) {
  const sh = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      shipmentNo: true, status: true, destination: true, dispatchedAt: true, createdAt: true, procedureCode: true,
      customer: { select: { code: true, name: true, taxNumber: true, exportCode: true, address: true, city: true, country: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      sacks: {
        orderBy: { seq: "asc" },
        select: {
          seq: true, sackNo: true, weightKg: true,
          // ⚠️ RESMİ BELGE (kalite sertifikası + muhasebe fişi) — irsaliye ile BİREBİR
          // aynı veriden türemesi zorunlu, dolayısıyla aynı hayalet filtresi.
          rolls: { where: { status: { notIn: SACK_ABSENT_STATUSES } }, orderBy: { createdAt: "asc" }, select: { barcode: true, currentQty: true, width: true, qualityGrade: true, item: { select: { name: true } }, color: { select: { name: true } }, qualityGradeRef: { select: { name: true } } } },
          // ⚠️ Para birimi SİPARİŞ BAŞLIĞINDA yaşar (`Order.currency`), satırda DEĞİL.
          // `orderLine.currency` seçmek PrismaClientValidationError üretir ve bu hata
          // DB'ye hiç gitmeden, sorgu kurulurken atılır → belge her çağrıda patlar.
          // tsc bunu GÖREMEZ: `PrintedDocDb` bir union tipidir ve union üzerinden çağrı
          // fazla-alan (excess property) kontrolünü düşürür.
          allocations: { select: { qty: true, orderLine: { select: { unitPrice: true, customerItemName: true, item: { select: { name: true } }, color: { select: { name: true } }, order: { select: { currency: true } } } } } },
        },
      },
    },
  });
  if (!sh) return null;

  const date = (sh.dispatchedAt ?? sh.createdAt).toISOString();
  const orderNos = [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", ");
  const addr = [sh.customer.address, sh.customer.city, sh.customer.country].filter(Boolean).join(", ") || null;

  // ── Kalite: kalite başına adet/metraj + top dökümü ──
  const gradeMap = new Map<string, { grade: string; rollCount: number; totalMeters: Prisma.Decimal }>();
  const qualityRolls: { sequence: number; barcode: string | null; itemName: string; colorName: string | null; width: number | null; grade: string; meters: number }[] = [];
  let seq = 0;
  for (const sk of sh.sacks) {
    for (const r of sk.rolls) {
      const grade = r.qualityGradeRef?.name ?? r.qualityGrade ?? "Belirsiz";
      const g = gradeMap.get(grade) ?? { grade, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      gradeMap.set(grade, g);
      qualityRolls.push({ sequence: ++seq, barcode: r.barcode, itemName: r.item.name, colorName: r.color?.name ?? null, width: r.width != null ? Number(r.width) : null, grade, meters: Number(r.currentQty) });
    }
  }
  const grades = [...gradeMap.values()].map((g) => ({ grade: g.grade, rollCount: g.rollCount, totalMeters: Number(g.totalMeters) }));
  const totalRolls = qualityRolls.length;
  const totalMeters = Number(qualityRolls.reduce((s, r) => s.plus(r.meters), D0()));

  // ── Ambalaj (packing): çuval bazlı ── (width = çuvaldaki farklı enler, cm)
  const packages = sh.sacks.map((sk) => {
    const contents = [...new Set(sk.rolls.map((r) => `${r.item.name}${r.color?.name ? ` ${r.color.name}` : ""}`))].join(", ");
    const meters = Number(sk.rolls.reduce((s, r) => s.plus(r.currentQty), D0()));
    const widths = [...new Set(sk.rolls.map((r) => (r.width != null ? Math.round(Number(r.width)) : null)).filter((w): w is number => w != null))]
      .sort((a, b) => a - b)
      .join(" / ");
    return { no: sk.sackNo ?? `#${sk.seq}`, contents, width: widths, meters, netKg: sk.weightKg != null ? Number(sk.weightKg) : 0, rollCount: sk.rolls.length };
  });
  const totalNetKg = Number(sh.sacks.reduce((s, sk) => s.plus(sk.weightKg ?? 0), D0()));

  // ── Fatura: allocation → orderLine fiyatı; (açıklama|fiyat|para) bazında grupla ──
  const invMap = new Map<string, { description: string; qty: Prisma.Decimal; unit: string; unitPrice: number | null; currency: string; amount: Prisma.Decimal | null }>();
  let anyPrice = false;
  let currency = "TRY";
  for (const sk of sh.sacks) {
    for (const al of sk.allocations) {
      const ol = al.orderLine;
      const desc = ol.customerItemName?.trim() || `${ol.item.name}${ol.color?.name ? ` · ${ol.color.name}` : ""}`;
      const up = ol.unitPrice != null ? Number(ol.unitPrice) : null;
      if (up != null) anyPrice = true;
      const lineCurrency = ol.order.currency;
      currency = lineCurrency;
      const key = `${desc}|${up ?? ""}|${lineCurrency}`;
      const row = invMap.get(key) ?? { description: desc, qty: D0(), unit: "m", unitPrice: up, currency: lineCurrency, amount: up != null ? D0() : null };
      row.qty = row.qty.plus(al.qty);
      if (up != null && row.amount != null) row.amount = row.amount.plus(new Prisma.Decimal(al.qty).times(up));
      invMap.set(key, row);
    }
  }
  const invoiceLines = [...invMap.values()].map((r) => ({ description: r.description, qty: Number(r.qty), unit: r.unit, unitPrice: r.unitPrice, amount: r.amount != null ? Number(r.amount) : null }));
  const curTotals = new Map<string, Prisma.Decimal>();
  for (const r of invMap.values()) {
    if (r.amount != null) curTotals.set(r.currency, (curTotals.get(r.currency) ?? D0()).plus(r.amount));
  }
  const invoiceTotals = [...curTotals.entries()].map(([currency, amount]) => ({ currency, amount: Number(amount) }));

  const header = { shipmentNo: sh.shipmentNo, customerName: sh.customer.name, customerCode: sh.customer.code, customerTaxNumber: sh.customer.taxNumber ?? null, customerAddress: addr, date, orderNos, procedureCode: sh.procedureCode };
  return { header, destination: sh.destination, grades, qualityRolls, packages, invoiceLines, invoiceTotals, currency, hasPrices: anyPrice, totals: { totalRolls, totalMeters, totalNetKg } };
}

async function buildQualityCertificateDoc(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const c = await collectShipmentDerived(db, shipmentId);
  if (!c) return null;
  const doc: QualityCertificateDoc = {
    header: { shipmentNo: c.header.shipmentNo, customerName: c.header.customerName, customerCode: c.header.customerCode, date: c.header.date, orderNos: c.header.orderNos },
    grades: c.grades,
    rolls: c.qualityRolls,
    totals: { rollCount: c.totals.totalRolls, totalMeters: c.totals.totalMeters },
  };
  return { documentNo: c.header.shipmentNo, doc: doc as unknown as Record<string, unknown> };
}

// Sevkiyat-türevli belgelerin ortak profil çözücüsü (müşteri profili).
const resolveShipmentProfileId = async (db: PrintedDocDb, sourceId: string) => {
  const s = await db.shipment.findUnique({ where: { id: sourceId }, select: { customer: { select: { documentProfileId: true } } } });
  return s?.customer?.documentProfileId ?? null;
};

registerPrintedDocBuilder(PrintedDocType.QUALITY_CERTIFICATE, { fresh: buildQualityCertificateDoc, renderHtml: renderQualityCertificateHtml, resolveProfileId: resolveShipmentProfileId });
