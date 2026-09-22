// =============================================================================
// FASONDAN DOĞRUDAN SEVKİN YÖNÜ — kayıt YOK, uydurulmaz
// =============================================================================
// `DirectShipment` yön kolonu taşımaz. Yön süzgeçli her yüzeyde (sevkiyat listesi,
// muhasebe Excel'i, yön raporları) doğrudan sevk ne yurtiçi ne yurtdışı kümesine girer;
// satırda yönü "kayıt yok" diye görünür. Liste ile Excel aynı yüklemi BURADAN alır.
// =============================================================================

/** Doğrudan sevk satırının yönü — sabit "DOMESTIC" rapora uydurma yön olarak girmez. */
export const DIRECT_SHIPMENT_DESTINATION = null;

/** Yön süzgeci aktifken doğrudan sevk kümeye GİRMEZ; süzgeç yoksa girer. */
export function directShipmentsMatchDestinationFilter(destinationFilter: unknown): boolean {
  return destinationFilter == null;
}
