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
//
// ⭐ SEVKİYAT SİPARİŞ GÜDÜMLÜ (2026-09-01). Eskiden sevk RASTGELE bir müşteriye
// ve `orderIds` VERİLMEDEN kuruluyordu; sonuç ölçüldü: veritabanında **0 tahsis,
// 0 sevk görmüş sipariş kalemi**. Yani demoda hiçbir sipariş hiç karşılanmamıştı
// — Siparişler ekranında her şey "Açık", Karşılanma raporu boş, müşteri "sipariş
// bağladım, sevk ettim, sipariş kapanmadı" derdi.
//
// ⚠️ KÖK NEDEN TAHSİS EŞLEŞMESİ: `specMatch` kumaşı KESİN, renk/eni ise iki taraf
// da doluysa TAM eşit ister (tekstilde en bir spec'tir, doğru kural). Sipariş
// kalemi (`sales.ts`) ile stok topu spec'lerini BAĞIMSIZ rastgele ürettiği için
// 90 kalemin yalnız 17'si stoktaki bir topla eşleşiyordu. Sipariş üretimden ÖNCE
// koştuğu için bunu `sales.ts`te çözmek mümkün değil (o an stok yok) → hizalama
// burada, üretimden SONRA yapılır: açık kalemin renk/eni GERÇEK bir bitmiş topun
// spec'ine çekilir. Kumaş DEĞİŞTİRİLMEZ (talebin kimliği odur).
// =============================================================================
import prisma from "../../src/lib/prisma";
import { shippingService } from "../../src/services/shipping.service";
import { adim, say, not, demoToken, rastgele, sec } from "./_kit";

const ADET = 22;
/** Siparişe yazılacak sevk sayısı — gerisi stok/serbest sevk olarak kalır. */
const SIPARISLI = 12;

/**
 * Açık sipariş kalemlerinin renk/enini GERÇEK bitmiş stok spec'ine çeker.
 *
 * Kumaşa DOKUNULMAZ — talebin kimliği odur; değiştirilirse sipariş artık başka
 * bir şeyin siparişi olur. Değişen yalnız o kumaşın hangi varyantının istendiği.
 * Stokta o kumaştan hiç bitmiş top yoksa kalem OLDUĞU GİBİ bırakılır: meşruen
 * açık kalan sipariş demoda BULUNMALI (hepsi kapanırsa "Açık Siparişler" ekranı
 * boşalır ve bu da bir kusurdur).
 */
async function hizalaSiparisKalemleri(): Promise<number> {
  const kalemler = await prisma.orderLine.findMany({
    where: { cancelledAt: null, order: { status: { notIn: ["CANCELLED"] } } },
    select: { id: true, itemId: true, colorId: true, width: true },
  });

  let hizalanan = 0;
  for (const k of kalemler) {
    const stok = await prisma.roll.findMany({
      where: { itemId: k.itemId, status: "WAREHOUSE", colorId: { not: null }, sackId: null, shipmentId: null },
      select: { colorId: true, width: true },
    });
    if (stok.length === 0) continue;

    // Zaten eşleşiyor mu? (`specMatch` ile aynı yüklem: null taraf gevşek eşleşir)
    const eslesiyor = stok.some(
      (s) =>
        (k.colorId == null || s.colorId == null || s.colorId === k.colorId) &&
        (k.width == null || s.width == null || Number(s.width) === Number(k.width)),
    );
    if (eslesiyor) continue;

    // En çok tekrar eden spec'e çek — "fabrikanın bu kumaştan çok ürettiği varyant".
    const sayac = new Map<string, { colorId: string; width: number | null; n: number }>();
    for (const s of stok) {
      if (s.colorId == null) continue;
      const w = s.width == null ? null : Number(s.width);
      const anahtar = `${s.colorId}|${w ?? ""}`;
      const v = sayac.get(anahtar) ?? { colorId: s.colorId, width: w, n: 0 };
      v.n += 1;
      sayac.set(anahtar, v);
    }
    const en = [...sayac.values()].sort((a, b) => b.n - a.n)[0];
    if (!en) continue;

    await prisma.orderLine.update({
      where: { id: k.id },
      data: { colorId: en.colorId, width: en.width },
    });
    hizalanan++;
  }
  return hizalanan;
}

/**
 * Açık kalemlere KARŞILIK sevk kurar → `SackAllocation` + `shippedQty` gerçek
 * yoldan doğar, sipariş durumları PARTIAL_SHIPPED/COMPLETED'a taşınır.
 *
 * ⚠️ Metrajın bir kısmı bilerek eksik bırakılır (kalemin ~%60'ı): hepsi tam
 * kapatılırsa "Kısmi Sevk" durumu demoda hiç görünmez.
 */
async function siparisliSevkKur(anaDepoId: string): Promise<number> {
  const kalemler = await prisma.orderLine.findMany({
    where: { cancelledAt: null, shippedQty: 0, order: { status: { notIn: ["CANCELLED"] } } },
    select: {
      id: true, itemId: true, colorId: true, width: true, quantity: true,
      order: { select: { id: true, customerId: true } },
    },
    orderBy: { createdAt: "asc" },
    take: SIPARISLI * 3,
  });

  const r = rastgele(7788);
  let kurulan = 0;
  for (const k of kalemler) {
    if (kurulan >= SIPARISLI) break;
    const token = demoToken(`order-shipment:${k.id}`);
    if (await prisma.shipment.findUnique({ where: { clientToken: token }, select: { id: true } })) continue;

    const toplar = await prisma.roll.findMany({
      where: {
        itemId: k.itemId, status: "WAREHOUSE", warehouseId: anaDepoId,
        sackId: null, shipmentId: null, colorId: k.colorId ?? { not: null },
        ...(k.width != null ? { width: k.width } : {}),
      },
      select: { id: true, currentQty: true },
      orderBy: { createdAt: "asc" },
      take: 6,
    });
    if (toplar.length === 0) continue;

    // Kalemin ~%60'ını kapat → "Kısmi Sevk" durumu demoda görünsün.
    const hedef = Number(k.quantity) * (0.45 + r() * 0.35);
    const secilen: string[] = [];
    let toplam = 0;
    for (const t of toplar) {
      if (toplam >= hedef && secilen.length > 0) break;
      secilen.push(t.id);
      toplam += Number(t.currentQty);
    }

    try {
      await shippingService.createShipmentFromRolls(
        {
          rollIds: secilen,
          customerId: k.order.customerId,
          orderIds: [k.order.id],
          plateNumber: `34 SP ${String(200 + kurulan)}`,
          driverName: "Demo Nakliye",
          clientToken: token,
        },
        undefined,
      );
      kurulan++;
      say("siparişe yazılan sevkiyat");
    } catch (e) {
      not(`Siparişli sevk kurulamadı (${k.id.slice(0, 8)}): ${(e as Error).message}`);
    }
  }
  return kurulan;
}

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

  // ① Açık kalemleri gerçek stok spec'ine hizala, ② karşılıklarını sevk et.
  const hizalanan = await hizalaSiparisKalemleri();
  console.log(`   sipariş kalemi hizalandı=${hizalanan}`);
  const siparisli = await siparisliSevkKur(anaDepo.id);
  console.log(`   siparişe yazılan sevkiyat=${siparisli}`);

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
  const tahsis = await prisma.sackAllocation.count();
  const sevkliKalem = await prisma.orderLine.count({ where: { shippedQty: { gt: 0 } } });
  console.log(
    `   yeni=${kurulan} · toplam sevkiyat=${toplam} · tahsis=${tahsis} · sevk görmüş kalem=${sevkliKalem}`,
  );
  if (tahsis === 0) {
    not("Hiç tahsis yazılmadı — sipariş karşılanma zinciri BOŞ kalır (hizalama/eşleşme bozulmuş).");
  }
}
