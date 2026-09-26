// Kartela Hareketleri — olay grupları ve Türkçe etiketler (tek kaynak; istemci ikinci sözlük tutmaz).
import { SwatchEventType, SwatchStatus } from "@prisma/client";

export const SWATCH_EVENT_GROUPS = ["KABUL", "CUVAL", "SEVKIYAT", "DUSUM"] as const;
export type SwatchEventGroup = (typeof SWATCH_EVENT_GROUPS)[number];

export const SWATCH_EVENT_GROUP_LABEL: Record<SwatchEventGroup, string> = {
  KABUL: "Kabul",
  CUVAL: "Çuval",
  SEVKIYAT: "Sevkiyat",
  DUSUM: "Düşüm",
};

/** Her olay tipi TEK gruba düşer — eşli ters tip ileri tipiyle aynı grupta. */
export const SWATCH_EVENT_GROUP: Record<SwatchEventType, SwatchEventGroup> = {
  BORN: "KABUL",
  VOIDED: "KABUL",
  SACKED: "CUVAL",
  UNSACKED: "CUVAL",
  SHIPMENT_ADDED: "SEVKIYAT",
  SHIPMENT_REMOVED: "SEVKIYAT",
  SHIPPED: "SEVKIYAT",
  SHIP_UNDONE: "SEVKIYAT",
  REDUCED: "DUSUM",
  REDUCTION_REVERSED: "DUSUM",
};

export const SWATCH_EVENT_TITLE: Record<SwatchEventType, string> = {
  BORN: "Kabulde doğdu",
  VOIDED: "Kabul iptal edildi",
  SACKED: "Çuvala girdi",
  UNSACKED: "Çuvaldan çıktı",
  SHIPMENT_ADDED: "Sevkiyata eklendi",
  SHIPMENT_REMOVED: "Sevkiyattan çıkarıldı",
  SHIPPED: "Sevk edildi",
  SHIP_UNDONE: "Sevk geri alındı",
  REDUCED: "Stoktan düşüldü",
  REDUCTION_REVERSED: "Düşüm geri alındı",
};

export const SWATCH_STATUS_LABEL: Record<SwatchStatus, string> = {
  IN_STOCK: "Stokta",
  IN_SACK: "Çuvalda",
  IN_SHIPMENT: "Sevkiyatta",
  SHIPPED: "Sevk edildi",
  REDUCED: "Stoktan düşüldü",
  VOIDED: "İptal",
};

/**
 * Olayı başlatan işlem — tek yazara verilen HER `trigger` burada Türkçe karşılık bulur
 * (`test_swatch_event_yazar` §7 ölçer: kodda geçen tetik sözlükte yoksa kırmızı).
 */
export const SWATCH_TRIGGER_LABEL: Record<string, string> = {
  KARTELA_RECEIVE: "Kartela kabulü",
  KARTELA_RECEIPT_CANCEL: "Kabul iptali",
  SACK_SCAN: "Çuvala okutma",
  SACK_MOVE: "Çuvallar arası taşıma",
  SACK_UNSCAN: "Çuvaldan çıkarma",
  KARTELA_SELECT_ADD: "Seçerek çuvala ekleme",
  SACK_DISTRIBUTE: "Çuvalı dağıtma",
  SACK_REMOVE: "Çuvalı silme",
  SHIPMENT_CREATE: "Sevkiyat kurma",
  SHIPMENT_ADD_SACKS: "Sevkiyata çuval ekleme",
  SHIPMENT_REMOVE_SACK: "Sevkiyattan çuval çıkarma",
  SHIPMENT_CANCEL: "Sevkiyat iptali",
  SHIPMENT_DISPATCH: "Sevk",
  SHIPMENT_UNDO_DISPATCH: "Sevk geri alma",
  KARTELA_STOCK_REDUCE: "Stok düşümü",
  KARTELA_REDUCTION_REVERSE: "Düşüm stornosu",
  ANOMALI_DUZELTME: "Anomali düzeltme (betik)",
};
