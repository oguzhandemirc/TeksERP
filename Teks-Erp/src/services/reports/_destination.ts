// =============================================================================
// RAPORLARDA YURTİÇİ/YURTDIŞI EKSENİ — İKİ KAYNAK, İKİSİ DE BEYANLI (R1, 2026-09-23)
// =============================================================================
// ① SEVK raporları `Shipment.destination` okur: sevk anında DONMUŞ değer, cari sonradan
//    değişse de geçmiş değişmez. Fasondan doğrudan sevkin yön kaydı YOKTUR → yön süzgecinde
//    hiçbir kümeye girmez, kırılımda "yön kaydı yok" kovasıdır (`direct-shipment-destination`).
// ② SİPARİŞ raporları (sevk öncesi, sevkiyat yok) `Order.destination` okur: sipariş AÇILIRKEN
//    şube → cari zincirinden DONMUŞ değer (tek yazar `OrderService.create/update`); kart sonradan
//    değişse de geçmiş rapor değişmez. NULL = "yön belirsiz" (doğuşta zincir boştu).
// Sipariş yönünün raporlarda TEK okuma noktası burasıdır; canlı kart zinciri artık okunmaz
// (`test_rapor_yon_ekseni` kart değişiminden sonra rapor kümesinin kıpırdamadığını ölçer).
// =============================================================================
import { Prisma, type ShipmentDestination } from "@prisma/client";

/** Ekranda eksenin adı — hangi kaynaktan okunduğunu kullanıcıya söyler. */
export const DESTINATION_AXIS_LABELS = {
  ORDER: "Sipariş yönü (açılışta)",
  SHIPMENT: "Sevkiyat yönü (sevk anında)",
} as const;

/** Sipariş kökü (`Order`) — doğuşta donmuş yön. */
export function orderDestinationWhere(d: ShipmentDestination): Prisma.OrderWhereInput {
  return { destination: d };
}

/** Siparişin donmuş yön DEĞERİ (ham SQL ifadesi; NULL = yön belirsiz) — süzgeç ve kova bunu kullanır. */
export function orderDestinationValueSql(orderAlias = "o"): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(orderAlias)}."destination"`;
}

/** `orderDestinationWhere` ham SQL ikizi (`orders <alias>`). */
export function orderDestinationSql(d: ShipmentDestination, orderAlias = "o"): Prisma.Sql {
  return Prisma.sql`AND ${orderDestinationValueSql(orderAlias)} = ${d}::"ShipmentDestination"`;
}

/** Sevkiyat kökü (`shipments <alias>`) — donmuş yön; süzgeç yoksa boş parça. */
export function shipmentDestinationSql(d: ShipmentDestination | undefined, shipmentAlias = "s"): Prisma.Sql {
  if (!d) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(shipmentAlias)}.destination = ${d}::"ShipmentDestination"`;
}
