// =============================================================================
// Shipping Service / sack-open
// =============================================================================
// Çuval açma (openSack — token replay + taze yol) ve çuval müşterisini yeniden atama.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  SackWeightSource,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { tokenReplay } from "../helpers/token-replay.helper";
import { AuditService } from "../audit.service";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { p2002Mentions } from "../../utils/p2002";
import {
  readShippingManualWeightRestrictedEnabled,
} from "../system-setting.service";
import {
  assertManualWeightAllowed,
} from "../helpers/shipping-weigh-gate.helper";
import { resolveTargetWarehouseId } from "../helpers/warehouse.helper";
import {
  readPackingLotSettings,
} from "../helpers/packing-group.helper";
import { assertPackageNoFreeTx, assertPackageNoInputAllowed, reservePackageNosTx } from "../helpers/packing-group.helper";
import { markSackLabelsStaleOnCustomerChangeTx } from "../helpers/sack-label-stale.helper";
import { nextPoolPackageNoTx } from "../helpers/sack-seq.helper";
import { ApiResponse } from "../../types/api.types";
import { assertManualNumberAllowed } from "../helpers/manual-number.helper";
import type { ShippingService } from "../shipping.service";
import { nextSackNo, type ShippingServiceThis } from "./shared";

const SACK_REPLAY_SELECT = {
  id: true, sackNo: true, weightKg: true, customerId: true, branchId: true, packingGroupId: true, packageNo: true,
  customer: { select: { name: true } },
  branch: { select: { name: true, code: true } },
  packingGroup: { select: { name: true } },
} satisfies Prisma.SackSelect;

/**
 * Çuval açma replay'i (A4). ⚠️ AYNI TOKEN, FARKLI GÖVDE (BULGU-T4-003): A müşterisi için açılan çuval belirsiz
 * düşer, operatör B'yi seçip tekrar dener — A'nın çuvalını "Çuval açıldı" diye döndürmek topları YANLIŞ müşterinin
 * çuvalına okuttururdu. Müşterisiz çuval meşrudur (`null` = `null`). Parti ve elle ambalaj no da kimliktir.
 */
function sackReplay(gelen: { customerId?: string | null; branchId?: string | null; packingGroupId: string | null; packageNo: number | null }) {
  return tokenReplay<Prisma.SackGetPayload<{ select: typeof SACK_REPLAY_SELECT }>, ApiResponse<unknown>>({
    find: (db, clientToken) => db.sack.findUnique({ where: { clientToken }, select: SACK_REPLAY_SELECT }),
    alive: { neverDies: "çuval ölü hâl taşımaz; boş çuval silinince token da gider" },
    identity: (s) => [
      { ad: "customerId", mevcut: s.customerId, gelen: gelen.customerId },
      { ad: "branchId", mevcut: s.branchId, gelen: gelen.branchId },
      { ad: "packingGroupId", mevcut: s.packingGroupId, gelen: gelen.packingGroupId },
      ...(gelen.packageNo != null ? [{ ad: "packageNo", mevcut: s.packageNo, gelen: gelen.packageNo }] : []),
    ],
    collision: "Bu istemci anahtarı FARKLI bir müşteri/şube/parti için açılmış bir çuvala ait. Ekranı yenileyip çuvalı tekrar açın.",
    collisionEk: (s) => ({ sackNo: s.sackNo }),
    respond: (s) => ({
      success: true,
      data: {
        id: s.id, sackNo: s.sackNo, weightKg: s.weightKg, customerId: s.customerId, branchId: s.branchId,
        customerName: s.customer?.name ?? null, branchName: s.branch?.name ?? null, branchCode: s.branch?.code ?? null,
        packingGroupId: s.packingGroupId, packageNo: s.packageNo, packingGroupName: s.packingGroup?.name ?? null,
      },
      message: "Çuval açıldı",
    }),
  });
}

export async function openSack(this: ShippingServiceThis, 
    data: {
      customerId?: string | null; branchId?: string | null; weightKg?: number | null; sackNo?: string | null; clientToken?: string | null;
      packingGroupId?: string | null; packageNo?: number | null;
    },
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
    // ── Sevk partisi kapısı — REPLAY'DEN ÖNCE: cari partiden çözülür, gate onu kıyaslar ──
    const lot = await readPackingLotSettings();
    let lotGroup: { id: string; customerId: string; name: string } | null = null;
    if (lot.mode !== "sevk-partisi") {
      if (data.packingGroupId || data.packageNo != null) {
        throw AppError.badRequest("Sevk partisi modu kapalı — çuval partide açılamaz (ayar: Paketleme grubu davranışı)", {
          code: "PACKING_LOT_MODE_OFF",
        });
      }
    } else if (data.packingGroupId) {
      const g = await prisma.packingGroup.findUnique({
        where: { id: data.packingGroupId },
        select: { id: true, customerId: true, name: true, status: true },
      });
      if (!g) throw AppError.notFound("Sevk partisi bulunamadı");
      if (g.status !== "OPEN") {
        throw AppError.conflict(`${g.name} kapalı — çuval açmak için partiyi yeniden açın.`, { code: "PACKING_LOT_CLOSED" });
      }
      if (data.customerId && data.customerId !== g.customerId) {
        throw AppError.badRequest("Çuvalın carisi partinin carisinden farklı olamaz");
      }
      assertPackageNoInputAllowed(lot.noMode, data.packageNo);
      lotGroup = { id: g.id, customerId: g.customerId, name: g.name };
      data = { ...data, customerId: g.customerId };
    } else if (lot.required) {
      throw AppError.badRequest("Her çuval bir sevk partisinde açılmalı (ayar: partisiz çuval yasak)", {
        code: "PACKING_LOT_REQUIRED",
      });
    } else if (data.packageNo != null) {
      throw AppError.badRequest("Ambalaj numarası yalnız bir sevk partisinde açılan çuvala verilir");
    }
    // İdempotent replay (A4, R): aynı token'la tekrar gelen istek (timeout-retry / çift dokunuş) yeni BOŞ çuval
    // açmaz — ilk denemede açılan çuvalı döner. Kimlik parti kapısından SONRA (cari partiden çözülür).
    const replay = sackReplay({ customerId: data.customerId, branchId: data.branchId, packingGroupId: data.packingGroupId ?? null, packageNo: data.packageNo ?? null });
    return replay.run(data.clientToken, () => this.openSackFresh(data, { lot, lotGroup }, userId));
  }

export async function openSackFresh(
    data: Parameters<ShippingService["openSack"]>[0],
    { lot, lotGroup }: { lot: Awaited<ReturnType<typeof readPackingLotSettings>>; lotGroup: { id: string; customerId: string; name: string } | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
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
    // `numberSource` kapısı: SYSTEM'de elle değer reddedilir, MANUAL'de zorunlu,
    // ve OKUTULAN seri olduğu için elle değer kendi türüne çözülmek zorunda.
    assertManualNumberAllowed("sack", manualSackNo);
    let sack: {
      id: string; sackNo: string; weightKg: Prisma.Decimal | null; customerId: string | null; branchId: string | null;
      packingGroupId: string | null; packageNo: number | null;
    };
    sack = await withBarcodeRetry(() =>
    prisma.$transaction(async (tx) => {
      const sackNo = manualSackNo ?? (await nextSackNo(tx));
      // Çuval doğduğu yerde damgalanır (createInitialEntry'nin top için yaptığının
      // çuval karşılığı). Tek depolu fabrikada varsayılan depo yazılır ve hiçbir
      // yüzey okumaz — sıfır görünür fark; çok depoluda "bu depoda hangi çuvallar"
      // ve çuval-bütün transferin guard'ı buradan beslenir.
      const sackWarehouseId = await resolveTargetWarehouseId(tx, null);
      // Ambalaj no ÇUVALDAN ÖNCE ayrılır ama AYNI tx'te: sackNo yarışı tx'i geri
      // sararsa sayaç da geri sarar (boşluk kalmaz). Kilit (8033, ezmede) tx'in
      // bu partiye dokunan İLK ifadesidir — üstteki okumalar sequence/depo.
      let packageNo: number | null = null;
      if (lotGroup) {
        if (data.packageNo != null) {
          await assertPackageNoFreeTx(tx, { groupId: lotGroup.id, packageNo: data.packageNo, exceptSackId: null });
          packageNo = data.packageNo;
        } else {
          [packageNo] = await reservePackageNosTx(tx, {
            groupId: lotGroup.id, count: 1, numbering: lot.numbering, startsAtZero: lot.startsAtZero,
          });
        }
      } else {
        // Partisiz çuval: `packing.poolPackageNo = acilista` ise carinin havuz sayacından
        // (8035); `sevkte` (varsayılan) null kalır, numara sevkte `seq` olarak doğar.
        packageNo = await nextPoolPackageNoTx(tx, customerId);
      }
      return tx.sack.create({
        data: {
          packingGroupId: lotGroup?.id ?? null,
          packageNo,
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
        select: { id: true, sackNo: true, weightKg: true, customerId: true, branchId: true, packingGroupId: true, packageNo: true },
      });
    }),
    undefined,
    (err) => {
      // clientToken P2002'si retry EDİLMEZ (retry hep aynı token'ı yazar) —
      // propagate edilir, boğaz (`sackReplay.run`) replay yanıtına çevirir.
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
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: { sackNo: sack.sackNo, customerId, branchId, packingGroupId: sack.packingGroupId, packageNo: sack.packageNo },
    });
    return {
      success: true,
      data: { ...sack, customerName, branchName, branchCode, packingGroupName: lotGroup?.name ?? null },
      message: lotGroup && sack.packageNo != null ? `Çuval açıldı — ${lotGroup.name} · Ambalaj No ${sack.packageNo}` : "Çuval açıldı",
    };
  }

export async function reassignSackCustomer(
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
        : await markSackLabelsStaleOnCustomerChangeTx(tx, sackId, sack.customerId, customerId);
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
