// =============================================================================
// Inventory Service / shared
// =============================================================================
// Ortak yardımcılar, sabitler ve taşınan metotların `this` tipi.
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ROLL_PROPERTY } from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { outstandingItemOfOpenDispatch } from "../helpers/fason-open-dispatch.helper";
import type { InventoryService } from "../inventory.service";

// Rulo liste/kart cevabının ortak include'u — findAllRolls (liste) ve
// getProductionFlow (Üretim Akışı kartları) AYNI şekli döndürsün diye tek kaynak.
// Detay paneli (RollDetailSheet) bu şekli anlık gösterim + fallback için okur,
// ağırı (`operations`, iade, kartela) `/api/rolls/:id` ile lazy çeker. Enum ÜYESİ
// içermez → modül-yükleme TDZ riski yok (top-level'da RollStatus deref edilmez).
export const ROLL_LIST_INCLUDE = {
  item: { select: { id: true, code: true, name: true, itemType: true, unit: true } },
  color: { select: { id: true, code: true, name: true, hex: true } },
  operations: { where: ACTIVE_OPERATION, select: { operationType: true } },
  createdBy: { select: { id: true, username: true, fullName: true } },
  // 2026-08-05: "Ekleyen" sütunu kişinin altına MAKİNEYİ de yazıyor. Bu satır
  // olmasaydı sütun makine kısmını HİÇ basamazdı ve kimse fark etmezdi — aynı
  // gün düzeltilen `manualReason` hatasının birebir aynısı ("alan var sanıldı,
  // o yanıtta yoktu"). To-one ilişki: sayfa başına tek ek sorgu, N+1 yok.
  createdMachine: { select: { id: true, name: true, code: true } },
  // GİRİŞ İSTASYONU — yazma tarafı olmadan görünmez, okuma tarafı olmadan yazılan
  // değer görünmez. İkisi AYNI commit'te olmalı.
  entryStation: { select: { id: true, code: true, name: true } },
  // DEPO — "mal hangi depoda" sorusunun liste yüzeyi. `warehouseId` skaler olarak
  // zaten dönüyordu ama ADI olmadan kolon yazılamazdı (aynı sınıf hata:
  // "alan var sanıldı, o yanıtta yoktu"). Liste ve DETAY aynı şekli döner —
  // ayrışırsa satır ile panel aynı top için farklı şey söyler.
  warehouse: { select: { id: true, code: true, name: true } },
  // EMANET sahibi — "Sahibi" sütunu (ister 3.2); to-one, sayfa başına tek ek sorgu.
  ownerCustomer: { select: { id: true, name: true } },
  properties: {
    where: ACTIVE_ROLL_PROPERTY,
    select: {
      propertyId: true,
      property: { select: { id: true, code: true, name: true } },
      // SEÇİM tipli özellikte operatörün seçtiği DEĞER (GRAMAJ=50GR).
      // Liste ve detay AYNI şekli döner — ayrışırsa satır ile panel aynı top
      // için farklı şey söyler.
      value: { select: { code: true, name: true } },
    },
  },
  shipment: { select: { id: true, shipmentNo: true, status: true } },
  sack: { select: { id: true, sackNo: true, seq: true } },
  // TOPUN ŞU AN BULUNDUĞU ADIM/İSTASYON (2026-08-04 saha talebi).
  //
  // Eskiden liste yanıtı bu veriyi HİÇ taşımıyordu — yani "Üretimde" sekmesinde
  // operatörün ilk sorusu ("hangi kumaş hangi istasyonda?") frontend'de
  // cevaplanamıyordu; kolon yazılamazdı çünkü veri yoktu. Aynı boşluk detay
  // panelinde de vardı.
  //
  // İlişki TEKİLDİR (to-one) → Prisma bunu sayfa başına tek ek sorguyla çözer,
  // N+1 doğmaz (dispatchItems'ın LATERAL take:1 emsaliyle aynı maliyet sınıfı).
  // Alanlar `select` ile daraltıldı (perf kuralı 7): istasyon kimliği + adım
  // sırası + iş emri numarası — kolon, filtre ve "hangi işe ait" sorusu için
  // gereken asgari küme.
  //
  // ⚠️ Ham Stok / Bitmiş Depo / Çuvalda sekmelerinde bu alan HER ZAMAN null'dur
  // (o toplar bir adımda değildir) — kolon oralarda "—" basar ve bu doğrudur.
  currentStep: {
    select: {
      id: true,
      stepSequence: true,
      station: { select: { id: true, code: true, name: true, kind: true } },
      workOrder: { select: { id: true, workOrderNumber: true } },
    },
  },
  // Fasonda görünürlüğü: topun AÇIK (dönmemiş) son fason sevk kalemi — liste
  // "İşlem" + "Fason Firması" kolonlarını besler. Açık-kalem tanımı F85 ile
  // birebir (iptalsiz + doğrudan-sevksiz dispatch + aktif receipt-item'ı yok)
  // → dönmüş/eski topta dizi BOŞ döner; kartela emsalinden (findRollById
  // kartelaDispatchItems) farkı receipt-none koşulu: bu include TÜM sekmelerce
  // paylaşıldığı için dönmüş STOCK topunda bayat firma göstermemek ŞART.
  // take:1 → Prisma sayfa başına tek LATERAL sorgu (N+1 yok); rollId +
  // sourceDispatchItemId indeksli, anti-join ucuz.
  dispatchItems: {
    where: outstandingItemOfOpenDispatch(),
    // "En güncel açık kalem" — özet ucu (getRollSubcontractorSummary open_items)
    // ile hizalı: dispatch.dispatchedAt DESC. Bir topun iki açık kalemi zorunlu
    // olarak iki AYRI dispatch'te (farklı dispatchedAt) olur (@@unique dispatchId,
    // rollId) → tek anahtar en güncel kalemi kesin seçer; kolon/detay ile şerit
    // kartı çoklu-açık-kalem anomalisinde AYNI firmayı gösterir.
    orderBy: { dispatch: { dispatchedAt: "desc" } },
    take: 1,
    select: {
      dispatch: {
        select: {
          dispatchNo: true,
          dispatchedAt: true,
          // "İşlem" (kategori) kaynağı: adımın requiredCategory'si BOŞ olabilir
          // (rota tasarımında girilmemiş) → firmanın kendi kategorisine düşülür
          // (firma tek kategoriliyse). Frontend activeCategoryOf() bu iki alandan
          // türetir; özet ucu + filtre de aynı COALESCE(step, firma-tek-kategori)
          // tanımını paylaşır.
          subcontractor: {
            select: {
              id: true,
              name: true,
              code: true,
              categories: { select: { category: { select: { id: true, name: true } } } },
            },
          },
          step: { select: { requiredCategory: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} as const;
/** Topun doğduğu gelen belgenin durumu — geri alma yüklemi (`deliveryNoteStatus` sinyali) okur. */
export async function noteStatusOf(rollId: string) {
  const line = await prisma.customerDeliveryNoteLine.findUnique({ where: { rollId }, select: { note: { select: { status: true } } } });
  return line?.note.status ?? null;
}

/**
 * Taşınan metotların `this` tipi — cephe sınıfı `.call(this, …)` ile bağlar, böylece
 * gövdedeki `this.<metot>(…)` çağrıları eskisi gibi AYNI örnekte koşar (private üyeler
 * indeksli erişim tipiyle okunur).
 */
export type InventoryServiceThis = {
  buildCancelDiagnostics: InventoryService["buildCancelDiagnostics"];
  buildRollWhere: InventoryService["buildRollWhere"];
  createInitialEntryFresh: InventoryService["createInitialEntryFresh"];
  createOpenFabricFresh: InventoryService["createOpenFabricFresh"];
  initialEntryReplay: InventoryService["initialEntryReplay"];
  openFabricReplay: InventoryService["openFabricReplay"];
  readManualEntryReason: InventoryService["readManualEntryReason"];
};
