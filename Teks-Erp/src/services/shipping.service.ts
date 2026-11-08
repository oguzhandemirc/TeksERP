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
// Bölme (2026-11-08, davranış aynı): bu dosya CEPHEDİR — sınıf, dışa açık adlar ve
// metot imzaları burada; gövdeler `services/shipping/*.ts` alan modüllerinde
// kelimesi kelimesine durur (cephe metodu modül fonksiyonunu `this` bağlamıyla çağırır).
// Çağıranlar yalnız bu yoldan import eder; alan modülleri cepheyi yalnız TİP olarak okur.
// =============================================================================
/* eslint-disable max-lines -- cephe: imzalar + JSDoc devralındı; ailenin max-lines katkısı bölme öncesi gibi TEK (shipping/list.ts sayılır) */

import {
  Prisma,
  SackWeightSource,
  ShipmentStatus,
  ShipmentDestination,
} from "@prisma/client";
import { specMatch } from "./helpers/allocation.helper";
import {
  type ShipmentEIrsaliye,
  type VoidedEIrsaliye,
} from "./e-irsaliye/e-irsaliye-shipment.helper";
import {
  readPackingLotSettings,
} from "./helpers/packing-group.helper";
import { ApiResponse } from "../types/api.types";
import {
  type ShipmentDestinationSource,
} from "./helpers/shipment-destination.helper";
import type { CursorPaginatedResponse } from "./base.service";
import type { Request } from "express";
import { uyari } from "../lib/logger";
import { type LoadPreview, type LoadPreviewInput } from "./helpers/shipment-load-preview.helper";
import { type LoadUnitInput, type LoadUnitPlan } from "./helpers/load-unit.helper";
import { type DeliveryToInput, type DeliveryToValue } from "./helpers/shipment-delivery.helper";
import { openSack as openSackImpl, openSackFresh as openSackFreshImpl, reassignSackCustomer as reassignSackCustomerImpl } from "./shipping/sack-open";
import { scanIntoSack as scanIntoSackImpl, addKartelaToSack as addKartelaToSackImpl, removeRollFromSack as removeRollFromSackImpl, removeSwatchFromSack as removeSwatchFromSackImpl, moveRollToSack as moveRollToSackImpl, distributeSackContents as distributeSackContentsImpl, previewDistributeSacks as previewDistributeSacksImpl, distributeSacksBulk as distributeSacksBulkImpl, moveRollsToSack as moveRollsToSackImpl, splitSack as splitSackImpl, markSackContentChangedTx as markSackContentChangedTxImpl } from "./shipping/sack-content";
import { weighSack as weighSackImpl, finishWeigh as finishWeighImpl, removeSack as removeSackImpl } from "./shipping/sack-weigh";
import { listRepairableShipments as listRepairableShipmentsImpl, previewRepairAllocation as previewRepairAllocationImpl, repairShipmentAllocation as repairShipmentAllocationImpl, olcTahsis as olcTahsisImpl } from "./shipping/repair";
import { listPool as listPoolImpl, getDestinationLock as getDestinationLockImpl, listCustomerPoolSacks as listCustomerPoolSacksImpl, listSackStoreBoard as listSackStoreBoardImpl } from "./shipping/pool";
import { loadSacksForShipment as loadSacksForShipmentImpl, assertOrdersBelong as assertOrdersBelongImpl, assertWeighed as assertWeighedImpl, setShipmentOrdersTx as setShipmentOrdersTxImpl, computeSackAllocations as computeSackAllocationsImpl, writeShipmentAllocationsTx as writeShipmentAllocationsTxImpl, flushAllocationAudit as flushAllocationAuditImpl } from "./shipping/allocation";
import { createShipment as createShipmentImpl, createShipmentInner as createShipmentInnerImpl, createShipmentCoreTx as createShipmentCoreTxImpl, decideShipmentDestinationTx as decideShipmentDestinationTxImpl, claimFirstDestinationTx as claimFirstDestinationTxImpl, logFirstShipmentDestination as logFirstShipmentDestinationImpl } from "./shipping/create";
import { findShippableRolls as findShippableRollsImpl, createShipmentFromRolls as createShipmentFromRollsImpl, createShipmentFromRollsInner as createShipmentFromRollsInnerImpl } from "./shipping/create-direct";
import { previewShipmentHold as previewShipmentHoldImpl, previewCreateShipment as previewCreateShipmentImpl, listOpenOrdersWithCoverage as listOpenOrdersWithCoverageImpl } from "./shipping/create-preview";
import { setShipmentOrders as setShipmentOrdersImpl, addSacksToShipment as addSacksToShipmentImpl, removeSackFromShipment as removeSackFromShipmentImpl, addLoadByScan as addLoadByScanImpl, addLooseRollsToShipment as addLooseRollsToShipmentImpl, addLooseRollsFresh as addLooseRollsFreshImpl, openUnitInShipmentTx as openUnitInShipmentTxImpl, removeRollFromLoadUnit as removeRollFromLoadUnitImpl, previewShipmentLoad as previewShipmentLoadImpl } from "./shipping/load";
import { setDestination as setDestinationImpl, setProcedureCode as setProcedureCodeImpl, setDeliveryTo as setDeliveryToImpl, setDispatchNote as setDispatchNoteImpl, setManualSackCount as setManualSackCountImpl, setShipmentInvoice as setShipmentInvoiceImpl, setDirectShipmentInvoice as setDirectShipmentInvoiceImpl, getDispatchNote as getDispatchNoteImpl, setSackNotes as setSackNotesImpl, sackNoteAppearsOnLabel as sackNoteAppearsOnLabelImpl, getSackNotes as getSackNotesImpl } from "./shipping/fields";
import { performDispatchTx as performDispatchTxImpl, dispatchShipment as dispatchShipmentImpl } from "./shipping/dispatch";
import { getCancelPreview as getCancelPreviewImpl, cancelPlannedShipmentTx as cancelPlannedShipmentTxImpl, cancelShipment as cancelShipmentImpl } from "./shipping/cancel";
import { resolveUndoBlockReason as resolveUndoBlockReasonImpl, getUndoDispatchPreview as getUndoDispatchPreviewImpl, writeUndoDispatchLedgerTx as writeUndoDispatchLedgerTxImpl, undoDispatch as undoDispatchImpl } from "./shipping/undo-dispatch";
import { listShipments as listShipmentsImpl, buildShipmentListSummary as buildShipmentListSummaryImpl } from "./shipping/list";
import { getDirectShipmentById as getDirectShipmentByIdImpl, getShipmentById as getShipmentByIdImpl, getShipmentSackContents as getShipmentSackContentsImpl } from "./shipping/detail";
import { getDispatchReport as getDispatchReportImpl, getDirectShipmentDispatchReport as getDirectShipmentDispatchReportImpl } from "./shipping/documents";
import type { ShipmentListSummary } from "./shipping/list";
import type { AllocationAuditTrail, ShipmentDestinationDecision, ShippingServiceThis } from "./shipping/shared";

export { dissolveLoadUnitsTx } from "./shipping/cancel";
export type { ShipmentListSummary } from "./shipping/list";
export { resolveShipmentDispatchContent } from "./shipping/documents";
export { openLoadUnitTx } from "./shipping/shared";


// Re-export saf primitifler (geriye uyum — eskiden bu dosyada tanımlıydı).
export {
  specMatch,
  allocate,
  computeLoadedByLine,
  type RollSpec,
  type LineForAlloc,
} from "./helpers/allocation.helper";

export class ShippingService {
  // =========================================================================
  // ÇUVAL DEPO HAVUZU — çuval aç / okut / tart (sevkiyattan bağımsız)
  // =========================================================================

  /**
   * Yeni çuval aç (depoda). shipmentId NULL, seq NULL. Müşteri OPSİYONEL — bilinen sipariş
   * için atanabilir, yoksa boş (genel stok); müşteri/şube sevk kurulurken de atanır. Çuval
   * sistem kodu (sackNo) otomatik üretilir. Mühür yok — depoda her an düzenlenebilir.
   *
   * SEVK PARTİSİ (`packing.groupMode = sevk-partisi`): `packingGroupId` verilirse çuval o
   * partide DOĞAR ve ambalaj numarasını aynı tx'te alır (sayaç ya da `packageNo` ezme —
   * `assertPackageNoInputAllowed` moda göre karar verir); cari partinin carisidir. Grup
   * modunda bu iki alan 400 (fail-closed). `packing.lotRequired` açıkken partisiz açma 400.
   */
  async openSack(
    data: {
      customerId?: string | null; branchId?: string | null; weightKg?: number | null; sackNo?: string | null; clientToken?: string | null;
      packingGroupId?: string | null; packageNo?: number | null;
    },
    userId?: string,
    /** F221 deseni — verilmezse elle-tartı kısıtı ATLANIR (dahili çağrı). */
    opts?: { permissions?: string[] }
  ): Promise<ApiResponse<unknown>> {
    return openSackImpl.call(this as unknown as ShippingServiceThis, data, userId, opts);
  }

  private async openSackFresh(
    data: Parameters<ShippingService["openSack"]>[0],
    { lot, lotGroup }: { lot: Awaited<ReturnType<typeof readPackingLotSettings>>; lotGroup: { id: string; customerId: string; name: string } | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return openSackFreshImpl(data, { lot, lotGroup }, userId);
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
    return reassignSackCustomerImpl(sackId, data, userId);
  }


  /**
   * Barkod okut → top ya da kartelayı depodaki çuvala ekle (depodaki serbest mal). Başka
   * depodaki çuvaldaki bir top bu çuvala okutulursa TAŞINIR (sevkiyattaki çuval reddedilir).
   */
  async scanIntoSack(
    data: { sackId: string; barcode: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return scanIntoSackImpl.call(this as unknown as ShippingServiceThis, data, userId);
  }

  /**
   * Sevkiyata SEÇEREK kartela ekle (barkodsuz) — açık havuz çuvalına N adet FIFO claim.
   */
  async addKartelaToSack(
    data: { sackId: string; itemId: string; colorId: string | null; count: number },
    userId?: string
  ): Promise<ApiResponse<{ added: number; swatchIds: string[]; sackId: string }>> {
    return addKartelaToSackImpl.call(this as unknown as ShippingServiceThis, data, userId);
  }

  /** Topu açık çuvaldan çıkar → serbest depoya döner (sackId null). */
  async removeRollFromSack(
    data: { rollId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return removeRollFromSackImpl.call(this as unknown as ShippingServiceThis, data, userId);
  }

  /** Kartelayı açık çuvaldan çıkar. */
  async removeSwatchFromSack(
    data: { swatchId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return removeSwatchFromSackImpl.call(this as unknown as ShippingServiceThis, data, userId);
  }

  /** Topu bir depodaki çuvaldan diğerine taşı. */
  async moveRollToSack(
    data: { rollId: string; sackId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return moveRollToSackImpl.call(this as unknown as ShippingServiceThis, data, userId);
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
    return distributeSackContentsImpl.call(this as unknown as ShippingServiceThis, data, userId);
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
    return listRepairableShipmentsImpl();
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
    return previewRepairAllocationImpl(shipmentId);
  }

  /**
   * TEK SEVKİYATIN DEFTERİNİ ONAR — mevcut `setShipmentOrders` motoruyla.
   *
   * ⚠️ Sipariş kümesi DEĞİŞTİRİLMEZ: sevkiyatın bugünkü siparişleri aynen geri
   * verilir. Yaptığı tek şey tahsisi BUGÜNÜN verisiyle yeniden kurmaktır.
   * Yeni bir sipariş eklemek ayrı bir karardır ve bu uçtan yapılmaz.
   */
  async repairShipmentAllocation(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    return repairShipmentAllocationImpl.call(this as unknown as ShippingServiceThis, shipmentId, userId);
  }

  /** Sevkiyatın toplam tahsis metrajı — onarım öncesi/sonrası ölçümü için. */
  private async olcTahsis(shipmentId: string): Promise<number> {
    return olcTahsisImpl(shipmentId);
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
    return previewDistributeSacksImpl(sackIds);
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
    return distributeSacksBulkImpl.call(this as unknown as ShippingServiceThis, data, userId);
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
    return moveRollsToSackImpl.call(this as unknown as ShippingServiceThis, data, userId);
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
    return splitSackImpl.call(this as unknown as ShippingServiceThis, data, userId);
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
    return weighSackImpl.call(this as unknown as ShippingServiceThis, data, userId, stamp, opts);
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
    return finishWeighImpl(data, resolvedSource, userId);
  }

  /**
   * Depodaki çuvalı sil. Sevkiyata atanmış çuval silinemez (önce sevkiyattan çıkar). Boş
   * çuval doğrudan; dolu çuval `withContents=true` ile içerik depoya döner. Depodaki çuvalın
   * tahsisi yoktur (tahsis yalnız sevkte yazılır) → temizlik gerekmez.
   */
  async removeSack(sackId: string, userId?: string, withContents = false): Promise<ApiResponse<unknown>> {
    return removeSackImpl(sackId, userId, withContents);
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
   * `labelDirty: false` koşulu gereksiz yazmayı eler (`markSackLabelsStaleOnCustomerChangeTx`
   * ve `Roll.labelDirty` emsali); baskıda temizlenir (`label.service.recordSackPrintEvent`).
   *
   * NOT: `Sack.notes` (çuval yorumu) bu fonksiyonun kapsamı DIŞINDADIR — not ne
   * ölçüm ne içeriktir (annotation); `setSackNotes` kendi kuralını uygular.
   */
  private async markSackContentChangedTx(
    tx: Prisma.TransactionClient,
    sackIds: (string | null | undefined)[]
  ): Promise<void> {
    return markSackContentChangedTxImpl(tx, sackIds);
  }

  // =========================================================================
  // HAVUZ GÖRÜNÜMÜ — müşteri-gruplu board
  // =========================================================================

  /**
   * Çuval depo board'u — müşteri bazlı özet (çuval sayısı, kg, metraj). Yalnız depodaki
   * (shipmentId NULL) çuvallar. Müşterisiz çuvallar "atanmamış" (customer=null) grubunda.
   */
  async listPool(params: { customerId?: string; search?: string }): Promise<ApiResponse<unknown>> {
    return listPoolImpl(params);
  }

  /** Sevk ekranının yön kilidi (panel + tablet aynı uç): yön, kaynak, ihracat kodu, hızlı sevk engeli. */
  async getDestinationLock(customerId: string, branchId: string | null): Promise<ApiResponse<unknown>> {
    return getDestinationLockImpl(customerId, branchId);
  }

  /**
   * Bir müşterinin depo çuvalları (sevkiyata atanmamış) — içerikleriyle. Paketleme
   * workspace'inin canlı kaynağı (çuval aç/okut/tart).
   */
  async listCustomerPoolSacks(customerId: string): Promise<ApiResponse<unknown>> {
    return listCustomerPoolSacksImpl(customerId);
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
    return loadSacksForShipmentImpl(sackIds, target);
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
    return assertOrdersBelongImpl(orderIds, customerId, branchId);
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
    return assertWeighedImpl(sacks, destination);
  }

  /** ShipmentOrder denorm'unu kullanıcının seçtiği sipariş kümesine ayarla. */
  private async setShipmentOrdersTx(tx: Prisma.TransactionClient, shipmentId: string, orderIds: string[]): Promise<void> {
    return setShipmentOrdersTxImpl(tx, shipmentId, orderIds);
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
    return computeSackAllocationsImpl(db, params);
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
    return writeShipmentAllocationsTxImpl.call(this as unknown as ShippingServiceThis, tx, shipmentId, orderIds, branchId);
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
    return flushAllocationAuditImpl(iz, userId);
  }

  /**
   * Depodan seçilen çuvallarla yeni sevkiyat kur (PLANNED). Müşteri/şube dialog'da seçilir
   * (müşterisiz çuvala backfill). Seçili siparişlere (opsiyonel) spec-FIFO tahsis yazılır;
   * shippedQty yalnız DISPATCH'te terfi eder. Fazla/eşleşmeyen/siparişsiz sevk edilebilir.
   */
  /** Sevkiyat kur (R): token her kuraldan önce okunur, kurulum hangi hatayla düşerse düşsün yeniden okunur. */
  async createShipment(
    ...args: Parameters<ShippingService["createShipmentInner"]>
  ): ReturnType<ShippingService["createShipmentInner"]> {
    return createShipmentImpl.call(this as unknown as ShippingServiceThis, ...args);
  }

  private async createShipmentInner(
    data: { sackIds: string[]; customerId: string; branchId?: string | null; orderIds?: string[]; orderless?: boolean; destination?: ShipmentDestination; destinationChosen?: boolean; procedureCode?: string | null; plateNumber?: string | null; driverName?: string | null; carrier?: string | null; clientToken?: string | null } & DeliveryToInput,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return createShipmentInnerImpl.call(this as unknown as ShippingServiceThis, data, userId);
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
      /** İstemcinin gönderdiği yön; kilitliyse kullanılmaz, boşsa sevkiyata yazılır. */
      requestedDestination?: ShipmentDestination;
      /** Operatörün açık seçimi mi — yalnız o zaman karta da yazılır (eski istemci göndermez). */
      destinationChosen?: boolean;
      /** Çözülen yönle koşan kapı (tartı) — tx içinde, yazımdan önce. */
      assertDestination: (destination: ShipmentDestination, lockSource: ShipmentDestinationSource | null) => void;
      procedureCode?: string | null;
      /** Teslim yeri (K18) — yoksa null; belge snapshot'ı aynı tx'te doğarsa donar. */
      deliveryCustomerId?: string | null;
      deliveryAddress?: string | null;
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
    yon: ShipmentDestinationDecision;
  }> {
    return createShipmentCoreTxImpl.call(this as unknown as ShippingServiceThis, tx, p);
  }

  /**
   * Sevk yönü KARARI — tx içinde, `resolveShipmentDestination(tx)` ile (TOCTOU ve
   * tx tutarken global client okuması yok). Kilitliyse istek yok sayılır ve farkı
   * UYARI olur; zincir boşsa açık istek İLK SEÇİMDİR ve zincirin boş kaldığı en
   * alt seviyeye (şube varsa şube, yoksa cari) atomik claim ile yazılır. İstek
   * yoksa kart boş kalır ve sevkiyat bugünkü gibi yurtiçi doğar.
   */
  private async decideShipmentDestinationTx(
    tx: Prisma.TransactionClient,
    p: { customerId: string; branchId: string | null; requested?: ShipmentDestination; chosen: boolean; userId?: string },
  ): Promise<ShipmentDestinationDecision> {
    return decideShipmentDestinationTxImpl.call(this as unknown as ShippingServiceThis, tx, p);
  }

  /**
   * İLK AÇIK YÖN SEÇİMİNİN TEK YAZARI — zincir boşken herhangi bir sevk yolunda
   * (kurulum ya da planlı sevkiyatta `setDestination`) yapılan açık seçim, zincirin
   * boş kaldığı en alt seviyeye (şube varsa şube, yoksa cari) atomik claim ile yazılır.
   * count 0 → kazanan tx içinde taze okunur: aynı değer başarı, farklı değer 409.
   * Açık niyet yoksa (`chosen` false — eski istemcinin önceden seçili değeri) değer
   * yalnız sevkiyata gider, karta YAZILMAZ; koşul BURADA yaşar, çağıran süzmez.
   */
  private async claimFirstDestinationTx(
    tx: Prisma.TransactionClient,
    p: { customerId: string; branchId: string | null; requested: ShipmentDestination; chosen: boolean; userId?: string },
  ): Promise<Omit<ShipmentDestinationDecision, "warning">> {
    return claimFirstDestinationTxImpl(tx, p);
  }

  /** İlk seçimle karta/şubeye yazılan yön — audit tx DIŞINDA, best-effort. */
  private async logFirstShipmentDestination(
    yon: Pick<ShipmentDestinationDecision, "firstChoice">,
    shipmentId: string,
    userId?: string,
  ): Promise<void> {
    return logFirstShipmentDestinationImpl(yon, shipmentId, userId);
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
    return findShippableRollsImpl(params);
  }

  /** Toplardan hızlı sevk (R) — `createShipment` ile aynı boğaz; gövde kimliği top kümesi. */
  async createShipmentFromRolls(
    ...args: Parameters<ShippingService["createShipmentFromRollsInner"]>
  ): ReturnType<ShippingService["createShipmentFromRollsInner"]> {
    return createShipmentFromRollsImpl.call(this as unknown as ShippingServiceThis, ...args);
  }

  private async createShipmentFromRollsInner(
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
    return createShipmentFromRollsInnerImpl.call(this as unknown as ShippingServiceThis, data, userId);
  }

  /** Cari kilidi önizlemesi (D4-I1) — kapının ikizi, aynı helper; red değil uyarı + `cariHold{}`. */
  private async previewShipmentHold(sackIds: string[], customerId: string | null) {
    return previewShipmentHoldImpl(sackIds, customerId);
  }

  /**
   * Sevkiyat kurulum ÖNİZLEMESİ (salt-okunur): çuval içerik dökümü + seçili siparişlere
   * hesaplanan tahsis + fazla/eşleşmeyen/mükerrer UYARILARI. DB'ye hiçbir şey yazmaz.
   */
  async previewCreateShipment(
    data: { sackIds: string[]; customerId?: string | null; branchId?: string | null; orderIds?: string[] }
  ): Promise<ApiResponse<unknown>> {
    return previewCreateShipmentImpl.call(this as unknown as ShippingServiceThis, data);
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
    return setShipmentOrdersImpl.call(this as unknown as ShippingServiceThis, shipmentId, orderIdsIn, userId);
  }

  /** PLANNED sevkiyata depodan çuval(lar) ekle (tahsisler yeniden hesaplanır). */
  async addSacksToShipment(shipmentId: string, sackIdsIn: string[], userId?: string): Promise<ApiResponse<unknown>> {
    return addSacksToShipmentImpl.call(this as unknown as ShippingServiceThis, shipmentId, sackIdsIn, userId);
  }

  /** PLANNED sevkiyattan çuval çıkar → depoya döner (tahsisler yeniden hesaplanır). */
  async removeSackFromShipment(shipmentId: string, sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    return removeSackFromShipmentImpl.call(this as unknown as ShippingServiceThis, shipmentId, sackId, userId);
  }

  /**
   * PLANNED sevkiyata OKUTARAK yük ekle (tablet, 9.2): çuval kodu → havuz çuvalı (`addSacksToShipment`);
   * top barkodu → dökme / araba birimi (`addLooseRollsToShipment`). Sınıflama tek boğazdan: çuval serisi
   * `matchesSeries`, top `resolveRollByScanCode` (müşteri kodu dahil).
   */
  async addLoadByScan(
    shipmentId: string,
    data: { barcode: string; unitKind?: "BULK" | "CART" | null; unitLabel?: string | null; clientToken?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return addLoadByScanImpl.call(this as unknown as ShippingServiceThis, shipmentId, data, userId);
  }

  /**
   * PLANNED sevkiyata dökme/araba yükü ekle (9.2). Dökme sevkiyatın TEK canlı birimine, araba aynı no'lu
   * canlı arabaya eklenir; yoksa birim `openLoadUnitTx` ile sevkiyatın içinde doğar. Bu birimde zaten
   * olan top atlanır — yeniden deneme durum-idempotenttir; token yalnız yeni birimde durur.
   */
  async addLooseRollsToShipment(
    shipmentId: string,
    input: LoadUnitInput & { clientToken?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return addLooseRollsToShipmentImpl.call(this as unknown as ShippingServiceThis, shipmentId, input, userId);
  }

  private async addLooseRollsFresh(shipmentId: string, plan: LoadUnitPlan, clientToken: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    return addLooseRollsFreshImpl.call(this as unknown as ShippingServiceThis, shipmentId, plan, clientToken, userId);
  }

  /** Sevkiyatın içinde yeni dökme/araba birimi — sıra sevkiyatın son sırasından devam eder. */
  private async openUnitInShipmentTx(
    tx: Prisma.TransactionClient,
    p: { shipment: { id: string; customerId: string; branchId: string | null }; plan: LoadUnitPlan; clientToken: string | null; warehouseId: string | null },
  ): Promise<{ id: string }> {
    return openUnitInShipmentTxImpl(tx, p);
  }

  /**
   * PLANNED sevkiyattaki dökme/araba biriminden TEK top çıkar (9.3) → top rafa döner. Birim boşalırsa
   * ÇÖZÜLÜR (`dissolvedAt`, sıra boşalır): dökme/araba havuza dönemez; çuvalın sevkiyattan çıkmasının
   * karşılığı budur. Tahsis yeniden yazılır — eski satırlar damgalanır (ters kayıt bugüne), silinmez.
   */
  async removeRollFromLoadUnit(shipmentId: string, rollId: string, userId?: string): Promise<ApiResponse<unknown>> {
    return removeRollFromLoadUnitImpl.call(this as unknown as ShippingServiceThis, shipmentId, rollId, userId);
  }

  /** Sevk öncesi yük önizlemesi (9.1) — salt-okur, engellemez; hesap tek helper'da. */
  async previewShipmentLoad(input: LoadPreviewInput): Promise<ApiResponse<LoadPreview>> {
    return previewShipmentLoadImpl(input);
  }

  /**
   * PLANNED sevkiyatın yönünü değiştir. Yön kilitliyse YALNIZ kilitli değere izin
   * verilir (sevkiyatı karta hizalamak için); farklı değer 409 + kaynak. Zincir boşsa
   * bu açık seçim İLK SEÇİMDİR ve kurulumla aynı yazardan karta yazılır.
   */
  async setDestination(shipmentId: string, destination: ShipmentDestination, userId?: string, destinationChosen = false): Promise<ApiResponse<unknown>> {
    return setDestinationImpl.call(this as unknown as ShippingServiceThis, shipmentId, destination, userId, destinationChosen);
  }

  /** Prosedür/ihracat kodu güncelle (PLANNED). */
  async setProcedureCode(shipmentId: string, procedureCode: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    return setProcedureCodeImpl(shipmentId, procedureCode, userId);
  }

  /**
   * Teslim yeri (K18) — yalnız PLANNED sevkiyatta yazılır/değişir/temizlenir. Atomik claim
   * `{id, status: PLANNED}`: sevk edilmişte belge donmuştur, değer artık değişmez (409).
   */
  async setDeliveryTo(shipmentId: string, input: DeliveryToInput, userId?: string): Promise<ApiResponse<DeliveryToValue>> {
    return setDeliveryToImpl(shipmentId, input, userId);
  }

  /** İrsaliye açıklaması (annotation) — sevkiyat DURUMU fark etmez, her an düzenlenir
   *  (SÜRÜM DOĞURMAZ; belge basılırken canlı çözülür). Boş → temizlenir. */
  async setDispatchNote(shipmentId: string, note: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    return setDispatchNoteImpl(shipmentId, note, userId);
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
    return setManualSackCountImpl(shipmentId, count, userId);
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
    return setShipmentInvoiceImpl(shipmentId, invoiceNo, invoicedAt, userId);
  }

  /** Fasondan doğrudan sevk fatura işareti — çuval sevkiyatıyla AYNI sözleşme.
   *  DirectShipment'ta statü yok (kayıt doğduğu an sevk edilmiştir) → statü guard'ı yok. */
  async setDirectShipmentInvoice(
    directShipmentId: string,
    invoiceNo: string | null,
    invoicedAt: Date | null,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return setDirectShipmentInvoiceImpl(directShipmentId, invoiceNo, invoicedAt, userId);
  }

  /** İrsaliye açıklamasını oku — irsaliye modalı notu ağır getDetail'siz alsın. */
  async getDispatchNote(shipmentId: string): Promise<ApiResponse<{ dispatchNote: string | null }>> {
    return getDispatchNoteImpl(shipmentId);
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
    return setSackNotesImpl.call(this as unknown as ShippingServiceThis, sackId, notes, userId);
  }

  /**
   * Bu çuvalın ETKİN etiket şablonu `sackNote` alanını basıyor mu?
   *
   * Çuval notu, katalogda OPT-IN bir alandır (`config/label-fields.ts` → SACK_FIELDS:
   * "şablona SÜRÜKLENMEZSE basılmaz") — yani çoğu kurulumda not kâğıda hiç çıkmaz.
   * Bu yüzden not düzenlemesi etiketi ancak alan şablonda VARSA bayatlatır.
   *
   * Şablon zinciri `markSackLabelsStaleOnCustomerChangeTx` ile AYNI:
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
    return sackNoteAppearsOnLabelImpl(customerId);
  }

  /** Çuval yorumunu oku — yorum sheet'i içerik listesi çekmeden notu alsın. */
  async getSackNotes(sackId: string): Promise<ApiResponse<{ notes: string | null }>> {
    return getSackNotesImpl(sackId);
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
    return performDispatchTxImpl.call(this as unknown as ShippingServiceThis, tx, shipmentId, data, userId);
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
    return dispatchShipmentImpl.call(this as unknown as ShippingServiceThis, shipmentId, data, userId);
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
    return getCancelPreviewImpl(shipmentId);
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
  ): Promise<VoidedEIrsaliye | null> {
    return cancelPlannedShipmentTxImpl(tx, shipmentId, expectedStatus, opts);
  }

  /**
   * Sevkiyatı iptal et (soft → CANCELLED). PLANNED iptal edilebilir: çuvallar depoya
   * döner, tahsisler silinir (sipariş bağı kalkar). DISPATCHED iptal edilemez.
   */
  async cancelShipment(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    return cancelShipmentImpl.call(this as unknown as ShippingServiceThis, shipmentId, userId);
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
    eIrsaliye: ShipmentEIrsaliye | null;
    /** H7: bu sevkin faturasına bağlı aktif hizmet bağlarının fatura numaraları. */
    serviceBilledDocNos: string[];
  }): string | null {
    return resolveUndoBlockReasonImpl(input);
  }

  /** Storno önizleme (yıkıcı işlem kuralı: etkilenen her kayıt somut listelenir). */
  async getUndoDispatchPreview(shipmentId: string): Promise<ApiResponse<unknown>> {
    return getUndoDispatchPreviewImpl.call(this as unknown as ShippingServiceThis, shipmentId);
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
  /**
   * Sevk stornosunun DEFTER ayağı — ayrı metot çünkü `undoDispatch` gövdesi
   * `max-lines-per-function` sınırına dayandı (kapı 2026-09-13'te durdurdu) ve
   * tavanı yükseltmek bir karardır; dokunulan yer sınıra çekilir.
   *
   * ⚠️ GENELLEŞTİRİLMEDİ: tek çağıranı var. İkinci çağıran çıktığında
   * `warehouse-ledger-reverse.helper`a taşınır — bugün taşımak, yarının şeklini
   * bilmeden dondurmak olurdu.
   */
  private async writeUndoDispatchLedgerTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    userId?: string,
  ): Promise<void> {
    return writeUndoDispatchLedgerTxImpl(tx, shipmentId, userId);
  }

  async undoDispatch(
    shipmentId: string,
    reason: string,
    userId?: string,
    opts: { releaseSacks?: boolean } = {},
  ): Promise<ApiResponse<unknown>> {
    return undoDispatchImpl.call(this as unknown as ShippingServiceThis, shipmentId, reason, userId, opts);
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
    return listShipmentsImpl.call(this as unknown as ShippingServiceThis, req);
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
    return buildShipmentListSummaryImpl(where, directWhere);
  }

  /** Fasondan doğrudan sevk (DirectShipment) detayı — birleşik Sevkiyatlar
   *  listesinden açılınca gösterilir. Toplar + karşılanan sipariş satırları +
   *  fason/İE bağlamı; irsaliye SUBCONTRACTOR_DIRECT_SHIP (sourceId=DirectShipment.id). */
  async getDirectShipmentById(id: string): Promise<ApiResponse<unknown>> {
    return getDirectShipmentByIdImpl(id);
  }

  /** Sevkiyat detayı — çuvallar + toplar + sipariş bazlı bu-sevkiyat tahsis dökümü. */
  async getShipmentById(id: string): Promise<ApiResponse<unknown>> {
    return getShipmentByIdImpl(id);
  }

  // =========================================================================
  // SEVK KAPISI — PLANNED board (yalnız sevk-onayı AÇIKKEN dolar)
  // =========================================================================

  /** Sevk Kapısı board LİSTESİ — onay bekleyen PLANNED sevkiyatlar; hafif + cursor. */
  async listSackStoreBoard(params: { status?: string; search?: string; destination?: string; cursor?: string; limit?: number }): Promise<CursorPaginatedResponse<unknown>> {
    return listSackStoreBoardImpl(params);
  }

  /** Bir sevkiyatın tam çuval+rulo dökümü — board kartına tıklayınca lazy. */
  async getShipmentSackContents(shipmentId: string): Promise<ApiResponse<unknown>> {
    return getShipmentSackContentsImpl(shipmentId);
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
    return getDispatchReportImpl(shipmentId);
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
    return getDirectShipmentDispatchReportImpl(id);
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
    return listOpenOrdersWithCoverageImpl(params);
  }
}

export const shippingService = new ShippingService();
