// =============================================================================
// Shipping Service / shared
// =============================================================================
// Ortak yardımcılar, sabitler ve taşınan metotların `this` tipi.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  ShipmentStatus,
  ShipmentDestination,
  LoadUnitKind,
} from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { tokenReplay } from "../helpers/token-replay.helper";
import { nextSeriesNo } from "../number-series.service";
import {
  NON_SACKABLE_STATUSES,
} from "../helpers/sack-invariants.helper";
import { ApiResponse } from "../../types/api.types";
import {
  type ResolvedShipmentDestination,
  type ShipmentDestinationSource,
} from "../helpers/shipment-destination.helper";
import type { ShippingService } from "../shipping.service";

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
export const SHIPPABLE_ROLL_WHERE = {
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
/** Sevkiyat kurulurken verilen yön kararı; `firstChoice` doluysa karta/şubeye yazıldı. */
export interface ShipmentDestinationDecision {
  destination: ShipmentDestination;
  /** Yön kilitten geldiyse kaynağı (şube/cari); ilk seçim ya da örtük yurtiçi ise null. */
  lockSource: ShipmentDestinationSource | null;
  /** Kilitliyken istemci farklı yön gönderdiyse `ApiResponse.warnings` satırı. */
  warning: string | null;
  firstChoice: { tableName: "CUSTOMER" | "CUSTOMER_BRANCH"; recordId: string; destination: ShipmentDestination } | null;
}

const DESTINATION_WORD: Record<ShipmentDestination, string> = { DOMESTIC: "yurtiçi", EXPORT: "yurtdışı" };

/** Kilit mesajı — uyarı (kilitli değer kullanıldı) ve 409 (reddedildi) aynı cümleyi paylaşır. */
export function destinationLockMessage(
  istenen: ShipmentDestination,
  kilit: ResolvedShipmentDestination,
  kullanildi = true,
): string {
  const kilitli = DESTINATION_WORD[kilit.destination ?? ShipmentDestination.DOMESTIC];
  const kim = kilit.source === "BRANCH" ? "bu şube" : "bu cari";
  return (
    `Seçilen ${DESTINATION_WORD[istenen]}; ${kim} ${kilitli} olarak kilitli` +
    (kullanildi ? `, ${kilitli} kullanıldı.` : ". Yön cari/şube kartından değiştirilir.")
  );
}

/**
 * Yük birimini açar — TEK YARATICI. SACK-dışı birim sevkiyat çekirdeği shipmentId'yi
 * yazana dek havuzda görünür; DEFERRED trigger commit anında doğrular.
 */
export async function openLoadUnitTx(
  tx: Prisma.TransactionClient,
  p: { sackNo: string; kind: LoadUnitKind; label: string | null; customerId: string; branchId: string | null; warehouseId: string | null; clientToken?: string | null; shipmentId?: string; seq?: number },
): Promise<{ id: string }> {
  return tx.sack.create({
    data: {
      sackNo: p.sackNo,
      // PLANNED'a ekleme (9.2): birim sevkiyatın içinde doğar; token mantıksal denemenin kaydıdır.
      ...(p.shipmentId ? { shipmentId: p.shipmentId, seq: p.seq ?? null } : {}),
      clientToken: p.clientToken ?? null,
      unitKind: p.kind,
      unitLabel: p.kind === LoadUnitKind.CART ? p.label : null,
      customerId: p.customerId,
      branchId: p.branchId,
      warehouseId: p.warehouseId,
    },
    select: { id: true },
  });
}

export async function nextSackNo(tx: Prisma.TransactionClient): Promise<string> {
  return nextSeriesNo("sack", async (prefix) => {
    const todays = await tx.sack.findMany({
      where: { sackNo: { gte: prefix, startsWith: prefix } },
      select: { sackNo: true, createdAt: true },
    });
    return todays.map((s) => ({ code: s.sackNo, createdAt: s.createdAt }));
  });
}

/** Tahsis yazımının audit izi — tx dışına taşınır (best-effort). */
export interface AllocationAuditTrail {
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

type ShipmentReplayRow = {
  id: string; shipmentNo: string; status: ShipmentStatus; customerId: string; branchId: string | null;
  sacks: Array<{ id: string }>; rolls: Array<{ id: string }>;
};

/**
 * Sevkiyat replay'i (A4). 4. durum (BULGU-T3-010): tablet "Hemen Sevk Et" der, sunucu kurar ve çıkarır ama yanıt
 * ağda kaybolur; bu arada masaüstünden storno + kapatma yapılırsa aynı token'a "Sevkiyat kuruldu" demek, mal
 * çıkmamışken operatörü evrak beklemeye gönderirdi → 409 `SHIPMENT_CANCELLED` (kesin hata: tablet token'ı bırakır).
 * Gövde kapısı: müşteri + şube + çuval (sevkiyat) ya da top (hızlı sevk) kümesi.
 */
export function shipmentReplay(ident: { customerId: string; branchId: string | null; sackIds?: string[]; rollIds?: string[] }) {
  const idSet = (ids: string[]) => [...new Set(ids)].sort().join(",");
  return tokenReplay<ShipmentReplayRow, ApiResponse<unknown>>({
    find: (db, clientToken) =>
      db.shipment.findUnique({
        where: { clientToken },
        select: { id: true, shipmentNo: true, status: true, customerId: true, branchId: true, sacks: { select: { id: true } }, rolls: { select: { id: true } } },
      }),
    alive: (p) => {
      if (p.status !== ShipmentStatus.CANCELLED) return;
      throw AppError.conflict(`Bu sevkiyat (${p.shipmentNo}) kurulmuş ama İPTAL EDİLMİŞ — mal çıkmadı. Sevkiyatı yeniden kurun.`, {
        code: "SHIPMENT_CANCELLED",
        shipmentNo: p.shipmentNo,
      });
    },
    identity: (p) => [
      { ad: "customerId", mevcut: p.customerId, gelen: ident.customerId },
      { ad: "branchId", mevcut: p.branchId, gelen: ident.branchId },
      ident.rollIds
        ? { ad: "toplar", mevcut: idSet(p.rolls.map((r) => r.id)), gelen: idSet(ident.rollIds) }
        : { ad: "cuvallar", mevcut: idSet(p.sacks.map((x) => x.id)), gelen: idSet(ident.sackIds ?? []) },
    ],
    collision: (p) => `Bu form daha önce ${p.shipmentNo} sevkiyatı olarak kaydedilmiş — yeni sevkiyat için ekranı kapatıp yeniden açın.`,
    collisionEk: (p) => ({ shipmentNo: p.shipmentNo }),
    respond: (p) => {
      const dispatched = p.status === ShipmentStatus.DISPATCHED;
      return {
        success: true,
        data: { id: p.id, shipmentNo: p.shipmentNo, status: p.status, dispatched },
        message: dispatched ? `Sevk edildi: ${p.shipmentNo}` : `Sevkiyat kuruldu: ${p.shipmentNo}`,
      };
    },
  });
}

/**
 * Taşınan metotların `this` tipi — cephe sınıfı `.call(this, …)` ile bağlar, böylece
 * gövdedeki `this.<metot>(…)` çağrıları eskisi gibi AYNI örnekte koşar (private üyeler
 * indeksli erişim tipiyle okunur).
 */
export type ShippingServiceThis = Pick<ShippingService, "addLooseRollsToShipment" | "addSacksToShipment" | "distributeSackContents" | "previewDistributeSacks" | "setShipmentOrders"> & {
  addLooseRollsFresh: ShippingService["addLooseRollsFresh"];
  assertOrdersBelong: ShippingService["assertOrdersBelong"];
  assertWeighed: ShippingService["assertWeighed"];
  buildShipmentListSummary: ShippingService["buildShipmentListSummary"];
  cancelPlannedShipmentTx: ShippingService["cancelPlannedShipmentTx"];
  claimFirstDestinationTx: ShippingService["claimFirstDestinationTx"];
  computeSackAllocations: ShippingService["computeSackAllocations"];
  createShipmentCoreTx: ShippingService["createShipmentCoreTx"];
  createShipmentFromRollsInner: ShippingService["createShipmentFromRollsInner"];
  createShipmentInner: ShippingService["createShipmentInner"];
  decideShipmentDestinationTx: ShippingService["decideShipmentDestinationTx"];
  finishWeigh: ShippingService["finishWeigh"];
  flushAllocationAudit: ShippingService["flushAllocationAudit"];
  loadSacksForShipment: ShippingService["loadSacksForShipment"];
  logFirstShipmentDestination: ShippingService["logFirstShipmentDestination"];
  markSackContentChangedTx: ShippingService["markSackContentChangedTx"];
  maybeAutoDraftInvoiceAfterDispatch: ShippingService["maybeAutoDraftInvoiceAfterDispatch"];
  olcTahsis: ShippingService["olcTahsis"];
  openSackFresh: ShippingService["openSackFresh"];
  openUnitInShipmentTx: ShippingService["openUnitInShipmentTx"];
  performDispatchTx: ShippingService["performDispatchTx"];
  previewShipmentHold: ShippingService["previewShipmentHold"];
  resolveUndoBlockReason: ShippingService["resolveUndoBlockReason"];
  sackNoteAppearsOnLabel: ShippingService["sackNoteAppearsOnLabel"];
  setShipmentOrdersTx: ShippingService["setShipmentOrdersTx"];
  writeShipmentAllocationsTx: ShippingService["writeShipmentAllocationsTx"];
  writeUndoDispatchLedgerTx: ShippingService["writeUndoDispatchLedgerTx"];
};
