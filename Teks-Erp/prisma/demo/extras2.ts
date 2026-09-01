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
// ⚠️ SATIŞ ALIŞTAN TÜRETİLİR — bağımsız rastgele DEĞİL.
//
// İlk yazımda ikisi ayrı aralıklardan çekiliyordu (satış 90-250, alış 60-170) ve
// aralıklar ÖRTÜŞÜYORDU: 30 kartın 5'inde ALIŞ ≥ SATIŞ çıktı (ölçüldü, canlıda).
// Müşteri istisnası da bağımsızdı → 20 istisnanın 6'sı MALİYETİN ALTINDA,
// 3'ü LİSTE FİYATININ ÜSTÜNDEydi. Fiyat ekranına bakan biri bunu ilk bakışta
// görür ve "veriler uydurma" der — demonun inandırıcılığı burada kırılır.
//
// Doğru model tek yönlü bir zincirdir:
//     alış  →  satış = alış × marj  →  müşteri fiyatı = satış × iskonto
// Böylece satış DAİMA alışın üstünde, müşteri fiyatı DAİMA listenin altında ama
// maliyetin üstünde kalır (en kötü hâlde alış × 1.28 × 0.88 ≈ alış × 1.13).
//
// ⚠️ RASTGELE SIRA, ATLAMA MANTIĞINDAN ÖNCE İLERLETİLİR: eski kod değerleri
// "kayıt yoksa" dalının İÇİNDE çekiyordu, yani akış kaç kaydın zaten var
// olduğuna göre kayıyor ve seed her koşumda FARKLI fiyat üretiyordu. Değerler
// artık koşulsuz çekilir → aynı kalem her koşumda aynı fiyatı alır.
//
// ⚠️ UPSERT (skip DEĞİL): mevcut tutarsız satırlar da düzeltilsin. `ItemPrice`
// fiziksel güncellemeye açıktır (kök CLAUDE.md'de bilinçli istisna) ve defter
// bağı yoktur — kesilmiş faturalar `InvoiceLine.unitPrice` ile DONMUŞTUR, yani
// geçmiş belgeler bu düzeltmeden etkilenmez.
export async function fiyatKur(): Promise<void> {
  adim("Kalem fiyatları");
  // ⭐ FİYAT KARTI HER AKTİF KUMAŞA YAZILIR (2026-09-01). Eskiden `take: 30`
  // vardı ve 125 kumaşın 68'i FİYATSIZ kalıyordu. Bu, ekranda boş bir hücre
  // değil KAPALI BİR YOLDU: sevkiyattan üretilen fatura taslağı `unitPrice: 0`
  // ile doğuyor, `confirm` de fiyatsız faturayı DOĞRU biçimde reddediyor
  // ("… birim fiyatı girilmemiş — fiyatsız fatura onaylanamaz") → müşteri
  // rastgele bir kumaşla fatura kesmeye kalkınca duvara çarpıyordu. Ölçüldü:
  // SAMARA ALTIN'da tam bu yaşandı. Sınırın hiçbir gerekçesi yoktu; 125 kumaş
  // × 2 kart ≈ 250 satır, maliyeti yok.
  const kalemler = await prisma.item.findMany({
    where: { itemType: "FABRIC", isActive: true },
    select: { id: true },
    orderBy: { code: "asc" },
  });
  const musteriler = await prisma.customer.findMany({
    where: { isActive: true, mergedIntoId: null, type: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true },
    orderBy: { code: "asc" },
    take: 4,
  });
  if (kalemler.length === 0) {
    not("Kumaş yok — kalem fiyatı yazılamaz.");
    return;
  }

  const r = rastgele(1357);
  const yuvarla = (x: number): number => Math.round(x * 100) / 100;
  let yazilan = 0;

  /** Değer değiştiyse yazar; aynıysa dokunmaz (ikinci koşum "0 yeni" versin). */
  async function fiyatYaz(
    itemId: string,
    customerId: string | null,
    kind: "SALE" | "PURCHASE",
    price: number,
  ): Promise<void> {
    const mevcut = await prisma.itemPrice.findFirst({
      where: { itemId, customerId, kind, currency: "TRY" },
      select: { id: true, price: true },
    });
    if (mevcut) {
      if (Number(mevcut.price) === price) return;
      await prisma.itemPrice.update({ where: { id: mevcut.id }, data: { price } });
    } else {
      await prisma.itemPrice.create({
        data: { itemId, customerId, kind, currency: "TRY", price },
      });
    }
    yazilan++;
  }

  const satisFiyati = new Map<string, number>();
  for (const k of kalemler) {
    const alis = yuvarla(60 + r() * 110);
    const marj = 1.28 + r() * 0.34; // %28-%62 brüt marj
    const satis = yuvarla(alis * marj);
    satisFiyati.set(k.id, satis);
    await fiyatYaz(k.id, null, "PURCHASE", alis);
    await fiyatYaz(k.id, null, "SALE", satis);
  }

  // Müşteri İSTİSNASI — zincirin üst basamağı: liste fiyatına İSKONTO.
  for (const m of musteriler) {
    for (const k of kalemler.slice(0, 5)) {
      const liste = satisFiyati.get(k.id);
      const iskonto = 0.88 + r() * 0.08; // %4-%12 iskonto
      if (liste == null) continue;
      await fiyatYaz(k.id, m.id, "SALE", yuvarla(liste * iskonto));
    }
  }
  // ── ONARIM TURU — bu seed'in ŞU ANKİ diliminin DIŞINDA kalan satırlar ─────
  // ⚠️ Üretimi düzeltmek TEK BAŞINA YETMEZ: eski kod fiyatları SIRASIZ 30 kaleme
  // yazmıştı, yeni kod `code`'a göre ilk 30'a yazıyor → eski tutarsız satırlar
  // başka kalemlerde ÖKSÜZ kalıyor ve ekranda görünmeye devam ediyordu
  // (ölçüldü: düzeltmeden sonra hâlâ 4 kart + 10 istisna bozuktu).
  // Bu tur, kim yazmış olursa olsun TÜM tutarsız satırları onarır.
  const tumKartlar = await prisma.itemPrice.findMany({
    where: { customerId: null, currency: "TRY" },
    select: { id: true, itemId: true, kind: true, price: true },
  });
  const kart = new Map<string, { alis?: { id: string; v: number }; satis?: { id: string; v: number } }>();
  for (const row of tumKartlar) {
    const g = kart.get(row.itemId) ?? {};
    if (row.kind === "PURCHASE") g.alis = { id: row.id, v: Number(row.price) };
    if (row.kind === "SALE") g.satis = { id: row.id, v: Number(row.price) };
    kart.set(row.itemId, g);
  }
  let onarilan = 0;
  // ⚠️ BAND: yalnız "alış ≥ satış" değil, İNANILMAZ MARJ da aynı sınıf kusurdur.
  // Bağımsız rastgele üretim %272'ye varan marjlar bırakmıştı (ölçüldü, 52 kartın
  // 9'u %90 üstü). Toptan kumaşta makul aralık ~%25-70; dışına taşanlar bandın
  // içine çekilir. Onarım SABİT çarpanla yapılır — rastgele olsaydı aynı girdi
  // her koşumda farklı sonuç verir ve idempotentlik bozulurdu.
  const ALT_MARJ = 0.25;
  const UST_MARJ = 0.7;
  for (const [itemId, g] of kart) {
    if (!g.alis || !g.satis || g.alis.v <= 0) continue;
    const marj = (g.satis.v - g.alis.v) / g.alis.v;
    if (marj >= ALT_MARJ && marj <= UST_MARJ) continue;
    const yeniSatis = yuvarla(g.alis.v * (marj > UST_MARJ ? 1.55 : 1.35));
    await prisma.itemPrice.update({ where: { id: g.satis.id }, data: { price: yeniSatis } });
    g.satis.v = yeniSatis;
    kart.set(itemId, g);
    onarilan++;
  }
  // Müşteri istisnaları: maliyetin ALTINA düşemez, listenin ÜSTÜNE çıkamaz.
  const istisnalar = await prisma.itemPrice.findMany({
    where: { customerId: { not: null }, currency: "TRY", kind: "SALE" },
    select: { id: true, itemId: true, price: true },
  });
  for (const ist of istisnalar) {
    const g = kart.get(ist.itemId);
    if (!g?.alis || !g.satis) continue;
    const v = Number(ist.price);
    if (v >= g.alis.v && v <= g.satis.v) continue;
    await prisma.itemPrice.update({
      where: { id: ist.id },
      data: { price: yuvarla(g.satis.v * 0.93) },
    });
    onarilan++;
  }
  if (onarilan > 0) say("tutarsız fiyat onarıldı", onarilan);

  say("kalem fiyatı (yazılan/düzeltilen)", yazilan);
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
