// =============================================================================
// DEMO SEED — API TURUNUN BULDUĞU BOŞ EKRANLAR
// =============================================================================
// `demo` hesabıyla 52 uç yoklandı: 0 hata, ama BEŞ ekran 200 dönüp SIFIR satır
// veriyordu. Boş bir liste, müşteriye "bu özellik yok" der.
//   ① Çuval Deposu  ② İplik Kg-Stok  ③ Kalem Fiyatları  ④ Tabletler
//   ⑤ Kur Farkı raporu
// =============================================================================
import prisma from "../../src/lib/prisma";
import { shippingService } from "../../src/services/shipping.service";
import { adim, say, not, demoToken, demoId, gunOnce, rastgele, sec } from "./_kit";

// -----------------------------------------------------------------------------
// ① ÇUVAL DEPOSU — paketleme ekranının gövdesi
// -----------------------------------------------------------------------------
// Sevkiyatlar HIZLI SEVK yolundan kuruldu (çuval kullanmaz) → Paketleme ekranı
// boş kaldı. Burada çuval yolu AYRICA sürülür: aç → topları okut. Çuvallar
// DEPODA açık bırakılır (sevkiyata atanmaz) ki ekran "üzerinde çalışılabilir"
// içerik göstersin.
export async function cuvalKur(): Promise<void> {
  adim("Çuval deposu — açık çuvallar");
  const musteriler = await prisma.customer.findMany({
    where: { isActive: true, mergedIntoId: null, type: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true },
    take: 8,
  });
  const r = rastgele(9090);

  for (let i = 0; i < 8; i++) {
    const token = demoToken(`sack:${i}`);
    const varOlan = await prisma.sack.findUnique({
      where: { clientToken: token },
      select: { id: true },
    });
    let sackId = varOlan?.id;

    if (!sackId) {
      try {
        const res = (await shippingService.openSack(
          {
            // Çuval bir DEPO nesnesidir — müşteri OPSİYONEL (kök CLAUDE.md).
            // Yarısı müşterisiz açılır ki ekran iki hâli de göstersin.
            customerId: i % 2 === 0 && musteriler.length > 0 ? sec(musteriler, r).id : null,
            clientToken: token,
          },
          undefined,
        )) as { data?: { id?: string } };
        sackId = res.data?.id;
        say("çuval");
      } catch (e) {
        not(`Çuval #${i} açılamadı: ${(e as Error).message}`);
        continue;
      }
    }
    if (!sackId) continue;

    // İçine top okut — boş çuval ekranı doldurmaz.
    const dolu = await prisma.roll.count({ where: { sackId } });
    if (dolu > 0) continue;
    const toplar = await prisma.roll.findMany({
      where: {
        status: "WAREHOUSE",
        colorId: { not: null },
        sackId: null,
        shipmentId: null,
        barcode: { startsWith: "DF" },
      },
      select: { barcode: true },
      take: 2 + Math.floor(r() * 3),
    });
    for (const t of toplar) {
      if (!t.barcode) continue;
      try {
        await shippingService.scanIntoSack({ sackId, barcode: t.barcode }, undefined);
        say("çuvala okutulan top");
      } catch (e) {
        not(`Çuvala okutma başarısız: ${(e as Error).message}`);
        break;
      }
    }
  }
}

// -----------------------------------------------------------------------------
// ② İPLİK KG-STOK
// -----------------------------------------------------------------------------
// İplik KARTLARI vardı ama HAREKET yoktu → ekran boş. `YarnStock` bir
// denormdur; defterle tutarlı olması için hareket + stok BİRLİKTE yazılır
// (`test_consistency §27` ikisini karşılaştırır).
export async function iplikStokKur(): Promise<void> {
  adim("İplik Kg-Stok");
  const iplikler = await prisma.item.findMany({
    where: { itemType: "YARN", isActive: true },
    select: { id: true },
  });
  const depo = await prisma.warehouse.findFirst({
    where: { isActive: true },
    orderBy: { isDefault: "desc" },
    select: { id: true },
  });
  if (iplikler.length === 0 || !depo) {
    not("İplik kartı ya da depo yok — İplik Kg-Stok boş kalacak.");
    return;
  }

  const r = rastgele(4242);
  for (const [i, y] of iplikler.entries()) {
    const mevcut = await prisma.yarnStock.findFirst({
      where: { itemId: y.id, warehouseId: depo.id },
      select: { id: true },
    });
    if (mevcut) continue;

    // Üç giriş + bir çıkış — ekranda hareket geçmişi de görünsün.
    const girisler = [400 + Math.round(r() * 600), 250 + Math.round(r() * 400), 180 + Math.round(r() * 300)];
    const cikis = 120 + Math.round(r() * 200);
    const bakiye = girisler.reduce((a, b) => a + b, 0) - cikis;

    const hareketler = [
      ...girisler.map((kg, j) => ({
        id: demoId(`yarnmov:${i}:in:${j}`),
        itemId: y.id,
        warehouseId: depo.id,
        // ⚠️ Alan adları: `kind` (yön DEĞİL) + `qtyKg` + `reason`.
        kind: "IN" as const,
        qtyKg: kg,
        reason: "Demo — iplik alımı",
        createdAt: gunOnce(60 - j * 12),
      })),
      {
        id: demoId(`yarnmov:${i}:out:0`),
        itemId: y.id,
        warehouseId: depo.id,
        kind: "OUT" as const,
        qtyKg: cikis,
        reason: "Demo — üretime çıkış",
        createdAt: gunOnce(10),
      },
    ];
    await prisma.yarnMovement.createMany({ data: hareketler as never, skipDuplicates: true });
    await prisma.yarnStock.create({
      data: { itemId: y.id, warehouseId: depo.id, balanceKg: bakiye },
    });
    say("iplik stok kalemi");
  }
}

// -----------------------------------------------------------------------------
// ③ KALEM FİYATLARI
// -----------------------------------------------------------------------------
// Fiyat çözüm zinciri (müşteri istisnası > kart varsayılanı) demoda GÖRÜNSÜN
// diye iki katman birden yazılır.
export async function fiyatKur(): Promise<void> {
  adim("Kalem fiyatları");
  const kalemler = await prisma.item.findMany({
    where: { itemType: "FABRIC", isActive: true },
    select: { id: true },
    take: 30,
  });
  const musteriler = await prisma.customer.findMany({
    where: { isActive: true, mergedIntoId: null, type: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true },
    take: 4,
  });
  if (kalemler.length === 0) {
    not("Kumaş yok — kalem fiyatı yazılamaz.");
    return;
  }
  const r = rastgele(1357);
  let yeni = 0;

  for (const k of kalemler) {
    for (const kind of ["SALE", "PURCHASE"] as const) {
      const varOlan = await prisma.itemPrice.findFirst({
        where: { itemId: k.id, customerId: null, kind, currency: "TRY" },
        select: { id: true },
      });
      if (varOlan) continue;
      const taban = kind === "SALE" ? 90 + r() * 160 : 60 + r() * 110;
      await prisma.itemPrice.create({
        data: {
          itemId: k.id,
          customerId: null,
          kind,
          currency: "TRY",
          price: Math.round(taban * 100) / 100,
        },
      });
      yeni++;
    }
  }
  // Müşteri İSTİSNASI — zincirin üst basamağı.
  for (const m of musteriler) {
    for (const k of kalemler.slice(0, 5)) {
      const varOlan = await prisma.itemPrice.findFirst({
        where: { itemId: k.id, customerId: m.id, kind: "SALE", currency: "TRY" },
        select: { id: true },
      });
      if (varOlan) continue;
      await prisma.itemPrice.create({
        data: {
          itemId: k.id,
          customerId: m.id,
          kind: "SALE",
          currency: "TRY",
          price: Math.round((80 + r() * 140) * 100) / 100,
        },
      });
      yeni++;
    }
  }
  say("kalem fiyatı", yeni);
}

// -----------------------------------------------------------------------------
// ④ TABLETLER
// -----------------------------------------------------------------------------
// ⚠️ FİZİKSEL CİHAZ GEREKMEZ: ekran `Device` satırlarını listeler. Onay bekleyen
// (PENDING) bir satır bilerek bırakılır — allowlist akışı demoda görünsün.
export async function cihazKur(): Promise<void> {
  adim("Tabletler");
  const makineler = await prisma.machine.findMany({ select: { id: true }, take: 3 });
  const tanimlar = [
    { ad: "Tablet — KK1 Giriş", durum: "APPROVED", kind: "TABLET", gun: 0 },
    { ad: "Tablet — Kurşun/KK2", durum: "APPROVED", kind: "TABLET", gun: 0 },
    { ad: "Tablet — Tambur", durum: "APPROVED", kind: "TABLET", gun: 1 },
    { ad: "Tablet — Depo/Sevkiyat", durum: "APPROVED", kind: "TABLET", gun: 0 },
    { ad: "Tablet — Fason", durum: "APPROVED", kind: "TABLET", gun: 3 },
    { ad: "Telefon — Saha Şefi", durum: "APPROVED", kind: "PHONE", gun: 2 },
    { ad: "Yeni Tablet (onay bekliyor)", durum: "PENDING", kind: "TABLET", gun: 0 },
  ];
  for (const [i, t] of tanimlar.entries()) {
    const deviceId = `DF-DEVICE-${String(i + 1).padStart(3, "0")}`;
    const varOlan = await prisma.device.findUnique({ where: { deviceId }, select: { id: true } });
    if (varOlan) continue;
    await prisma.device.create({
      data: {
        deviceId,
        name: t.ad,
        status: t.durum as never,
        kind: t.kind as never,
        machineId: t.durum === "APPROVED" ? makineler[i % Math.max(1, makineler.length)]?.id ?? null : null,
        lastSeenAt: gunOnce(t.gun),
      },
    });
    say("cihaz");
  }
}
