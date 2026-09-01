// =============================================================================
// DEMO SEED — SEVKİYAT
// =============================================================================
// Sevkiyat ekranı 2 kayıtla açılıyordu; Sevkiyat Karnesi ve Müşteri Karnesi de
// o iki kayıttan besleniyordu. Bir ERP demosunda "sevkiyat" modülünün iki satırı
// olması, modülün yokluğundan daha kötü bir izlenim verir.
//
// ⚠️ HIZLI SEVK YOLU (`createShipmentFromRolls`) kullanılır: çuval yolu
// (aç → okut → tart → sevk) dört ayrı adım ve her biri kendi guard'ını taşır;
// demo verisi için gereksiz. Hızlı sevk de AYNI çekirdeği (`createShipmentCoreTx`)
// sürer, yani tahsis defteri ve `shippedQty` denormu gerçek yoldan doğar.
//
// ⚠️ SEVK EDİLEN TOP RENKLİ OLMALI (kullanıcı şartı): kaynak küme yalnız
// `WAREHOUSE` + `colorId != null` toplardır. Renksiz bir topu sevk etmek,
// düzeltilmek istenen kusuru geri getirirdi.
// =============================================================================
import prisma from "../../src/lib/prisma";
import { shippingService } from "../../src/services/shipping.service";
import { adim, say, not, demoToken, rastgele, sec } from "./_kit";

const ADET = 22;

export async function sevkiyatKur(): Promise<void> {
  adim(`Sevkiyat — ${ADET} sevk (hızlı sevk yolundan)`);

  const musteriler = await prisma.customer.findMany({
    where: { isActive: true, mergedIntoId: null, type: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true },
  });
  if (musteriler.length === 0) {
    not("Müşteri yok — sevkiyat kurulamaz.");
    return;
  }

  // ⚠️ TEK SEVKİYAT TEK DEPODAN ÇIKAR (servis kuralı). Karışık depolu bir
  // seçim "Seçilen toplar farklı depolarda" ile reddedilir — ölçüldü, 22
  // sevkin 21'i bu yüzden düştü. Varsayılan depo sabitlenir.
  const anaDepo = await prisma.warehouse.findFirst({
    where: { isActive: true },
    orderBy: { isDefault: "desc" },
    select: { id: true },
  });
  if (!anaDepo) {
    not("Aktif depo yok — sevkiyat kurulamaz.");
    return;
  }

  const r = rastgele(5150);
  let kurulan = 0;

  for (let i = 0; i < ADET; i++) {
    const token = demoToken(`shipment:${i}`);
    const varOlan = await prisma.shipment.findUnique({
      where: { clientToken: token },
      select: { id: true },
    });
    if (varOlan) continue;

    // ⭐ RENKLİ + serbest (çuvalsız, sevksiz) bitmiş toplar.
    const toplar = await prisma.roll.findMany({
      where: {
        status: "WAREHOUSE",
        warehouseId: anaDepo.id,
        colorId: { not: null },
        sackId: null,
        shipmentId: null,
        barcode: { startsWith: "DF" },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 2 + Math.floor(r() * 4),
    });
    if (toplar.length === 0) {
      not(`Sevk edilecek renkli bitmiş top kalmadı (${i}. sevkte durdu).`);
      break;
    }

    try {
      await shippingService.createShipmentFromRolls(
        {
          rollIds: toplar.map((t) => t.id),
          customerId: sec(musteriler, r).id,
          plateNumber: `34 DF ${String(100 + i)}`,
          driverName: "Demo Nakliye",
          clientToken: token,
        },
        undefined,
      );
      kurulan++;
      say("sevkiyat");
    } catch (e) {
      not(`Sevkiyat #${i} kurulamadı: ${(e as Error).message}`);
    }
  }

  const toplam = await prisma.shipment.count();
  console.log(`   yeni=${kurulan} · toplam sevkiyat=${toplam}`);
}
