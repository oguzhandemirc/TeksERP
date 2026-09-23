// =============================================================================
// RAPORLARDA YURTİÇİ/YURTDIŞI EKSENİ — İKİ KAYNAK, İKİSİ DE BEYANLI (R1, 2026-09-23)
// =============================================================================
// ① SEVK raporları `Shipment.destination` okur: sevk anında DONMUŞ değer, cari sonradan
//    değişse de geçmiş değişmez. Fasondan doğrudan sevkin yön kaydı YOKTUR → yön süzgecinde
//    hiçbir kümeye girmez, kırılımda "yön kaydı yok" kovasıdır (`direct-shipment-destination`).
// ② SİPARİŞ raporları (sevk öncesi, sevkiyat yok) zinciri okur: siparişin şubesinin yönü,
//    boşsa carinin yönü — `resolveShipmentDestination` ile AYNI zincir. Bu BUGÜNKÜ karttır:
//    kart değişince geçmiş raporun kümesi de değişir; ekranda eksen adı bunu söyler.
// Zincirin Prisma/SQL ikizleri burada yaşar ve `resolveShipmentDestination` ile birlikte
// değişir (boğaz ikiz — `test_rapor_yon_ekseni` üçünü aynı fikstürde karşılaştırır).
// =============================================================================
import { Prisma, type ShipmentDestination } from "@prisma/client";

/** Ekranda eksenin adı — hangi kaynaktan okunduğunu kullanıcıya söyler. */
export const DESTINATION_AXIS_LABELS = {
  ORDER: "Cari/şube yönü (bugünkü)",
  SHIPMENT: "Sevkiyat yönü (sevk anında)",
} as const;

/** Sipariş kökü (`Order`) — zincir: şube yönü doluysa o, değilse carinin yönü. */
export function orderDestinationWhere(d: ShipmentDestination): Prisma.OrderWhereInput {
  return {
    OR: [
      { branch: { is: { defaultDestination: d } } },
      {
        AND: [
          { OR: [{ branchId: null }, { branch: { is: { defaultDestination: null } } }] },
          { customer: { defaultDestination: d } },
        ],
      },
    ],
  };
}

/** Siparişin zincir DEĞERİ (ham SQL ifadesi; zincir boşsa NULL) — süzgeç ve kova bunu kullanır. */
export function orderDestinationValueSql(orderAlias = "o"): Prisma.Sql {
  const o = Prisma.raw(orderAlias);
  return Prisma.sql`COALESCE(
    (SELECT bdf."defaultDestination" FROM customer_branches bdf WHERE bdf.id = ${o}."branchId"),
    (SELECT cdf."defaultDestination" FROM customers cdf WHERE cdf.id = ${o}."customerId")
  )`;
}

/** `orderDestinationWhere` ham SQL ikizi (`orders <alias>`; tablo takma adları `bdf`/`cdf` sabit). */
export function orderDestinationSql(d: ShipmentDestination, orderAlias = "o"): Prisma.Sql {
  return Prisma.sql`AND ${orderDestinationValueSql(orderAlias)} = ${d}::"ShipmentDestination"`;
}

/** Sevkiyat kökü (`shipments <alias>`) — donmuş yön; süzgeç yoksa boş parça. */
export function shipmentDestinationSql(d: ShipmentDestination | undefined, shipmentAlias = "s"): Prisma.Sql {
  if (!d) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(shipmentAlias)}.destination = ${d}::"ShipmentDestination"`;
}
