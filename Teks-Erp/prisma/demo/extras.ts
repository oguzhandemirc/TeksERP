// =============================================================================
// DEMO SEED — BOŞ KALAN EKRANLAR (kartela · depo transferi · stok sayımı · kur)
// =============================================================================
// Doğrulama tablosu bu üç ekranı SIFIR gösterdi. Boş bir ekran, demoyu gezen
// kişiye "bu özellik yok" der — ürünün en pahalı yanlış anlaşılması.
//
// ⚠️ HEPSİ GERÇEK SERVİS YOLUNDAN: kartela/transfer/sayım defterleri, statü
// geçişleri ve belge zincirleri ham insert'le kurulamaz (kurulursa "demoda
// çalışıyor, sahada patlıyor" sınıfı doğar).
// =============================================================================
import prisma from "../../src/lib/prisma";
import { kartelaService } from "../../src/services/kartela.service";
import { warehouseTransferService } from "../../src/services/warehouse-transfer.service";
import { stockCountService } from "../../src/services/stock-count.service";
import { adim, say, not, demoToken, gunOnce } from "./_kit";

// -----------------------------------------------------------------------------
// KARTELA — dört sekme birden (Sevkler · Kabuller · Kartelada Toplar · Stok)
// -----------------------------------------------------------------------------
export async function kartelaKur(): Promise<void> {
  adim("Kartela — sevk + kabul");
  const firma = await prisma.subcontractor.findFirst({
    where: {
      isActive: true,
      categories: { some: { category: { code: { contains: "KARTELA" } } } },
      code: { not: { startsWith: "TEST-" } },
    },
    select: { id: true, name: true },
  });
  if (!firma) {
    not("Kartela firması yok — Kartela ekranının dört sekmesi de boş kalacak.");
    return;
  }

  // Kartelaya yalnız BİTMİŞ (depoda duran) top gider.
  const adaylar = await prisma.roll.findMany({
    where: { status: "WAREHOUSE", sackId: null, shipmentId: null, barcode: { startsWith: "DF" } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 14,
  });
  if (adaylar.length < 6) {
    not(`Kartelaya gönderilecek yeterli top yok (${adaylar.length}).`);
    return;
  }

  // İki sevk: biri KABUL EDİLMİŞ (Kartela Stoğu dolsun), biri AÇIK
  // (Kartelada Toplar sekmesi dolsun).
  const gruplar = [
    { ad: "kapali", rolls: adaylar.slice(0, 8).map((x) => x.id) },
    { ad: "acik", rolls: adaylar.slice(8, 14).map((x) => x.id) },
  ];

  for (const g of gruplar) {
    const mevcut = await prisma.kartelaDispatch.findFirst({
      where: { notes: `DF-KARTELA-${g.ad}` },
      select: { id: true },
    });
    let dispatchId = mevcut?.id;
    if (!dispatchId) {
      try {
        const res = (await kartelaService.dispatch(
          {
            subcontractorId: firma.id,
            rollIds: g.rolls,
            plateNumber: "34 DF 1234",
            driverName: "Demo Sürücü",
            notes: `DF-KARTELA-${g.ad}`,
          },
          undefined,
        )) as { data?: { id?: string } };
        dispatchId = res.data?.id;
        say("kartela sevki");
      } catch (e) {
        not(`Kartela sevki (${g.ad}) kurulamadı: ${(e as Error).message}`);
        continue;
      }
    }
    if (g.ad !== "kapali" || !dispatchId) continue;

    // ⚠️ KABUL EDİLECEK TOPLAR SEVKTEN OKUNUR, taze sorgudan DEĞİL. İkinci
    // koşumda `adaylar` sorgusu AT_KARTELA olanları eler ve BAŞKA toplar seçer;
    // onları kabule göndermek "Top ... kabul edilemez (durum: WAREHOUSE)" verir.
    // Kaynak, sevkin kendi kalemleridir.
    const sevkToplari = await prisma.kartelaDispatchItem.findMany({
      where: { dispatchId },
      select: { rollId: true },
    });
    const kabulToplari = sevkToplari.map((x) => x.rollId);
    if (kabulToplari.length === 0) {
      not("Kartela sevkinde kalem yok — kabul atlandı.");
      continue;
    }

    // KABUL — her toptan N kartela döner → `Swatch` stoğu doğar.
    const zatenKabul = await prisma.kartelaReceipt.findFirst({
      where: { dispatchId },
      select: { id: true },
    });
    if (zatenKabul) continue;
    try {
      await kartelaService.receive(
        {
          subcontractorId: firma.id,
          dispatchId,
          // ⚠️ Alan adı `returns` (`items` DEĞİL) ve adet `count`: top KOMPLE
          // tükenir, karşılığında N kartela doğar.
          returns: kabulToplari.map((rollId) => ({
            rollId,
            count: 25,
            bulkLengthCm: 30,
            bulkWeightKg: 0.08,
          })),
          notes: "Demo kabul",
        },
        undefined,
      );
      say("kartela kabulü");
    } catch (e) {
      not(`Kartela kabulü kurulamadı: ${(e as Error).message}`);
    }
  }
}

// -----------------------------------------------------------------------------
// DEPO TRANSFERİ
// -----------------------------------------------------------------------------
export async function transferKur(): Promise<void> {
  adim("Depo transferi");
  const depolar = await prisma.warehouse.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { isDefault: "desc" },
  });
  if (depolar.length < 2) {
    not("Tek depolu kurulum — Depo Transferi ekranı zaten görünmez (karo gizli).");
    return;
  }
  const [merkez, sube] = depolar;

  for (let i = 0; i < 4; i++) {
    const token = demoToken(`transfer:${i}`);
    const varOlan = await prisma.warehouseTransfer.findUnique({
      where: { clientToken: token },
      select: { id: true },
    });
    if (varOlan) continue;

    const toplar = await prisma.roll.findMany({
      where: {
        status: { in: ["WAREHOUSE", "A1_STOCK"] },
        warehouseId: merkez?.id,
        sackId: null,
        shipmentId: null,
        barcode: { startsWith: "DF" },
      },
      select: { id: true },
      take: 3,
      skip: i * 3,
    });
    if (toplar.length === 0) {
      not("Transfer için uygun top kalmadı.");
      break;
    }
    try {
      await warehouseTransferService.create(
        {
          fromWarehouseId: merkez?.id as string,
          toWarehouseId: sube?.id as string,
          rollIds: toplar.map((t) => t.id),
          notes: "Şubeye sevk için depo değişimi",
          clientToken: token,
        },
        undefined,
      );
      say("depo transferi");
    } catch (e) {
      not(`Depo transferi #${i} kurulamadı: ${(e as Error).message}`);
    }
  }
}

// -----------------------------------------------------------------------------
// STOK SAYIMI
// -----------------------------------------------------------------------------
export async function sayimKur(): Promise<void> {
  adim("Stok sayımı");
  const depolar = await prisma.warehouse.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { isDefault: "desc" },
  });
  if (depolar.length === 0) {
    not("Depo yok — stok sayımı kurulamaz.");
    return;
  }
  // ⚠️ DEPO BAŞINA TEK AÇIK (DRAFT) SAYIM kuralı var → merkez için TAMAMLANMIŞ,
  // şube için AÇIK sayım kurulur; ekran hem "devam eden" hem "geçmiş" gösterir.
  const mevcut = await prisma.stockCount.count();
  if (mevcut > 0) return; // idempotentlik: sayım varsa dokunma

  for (const [i, w] of depolar.slice(0, 2).entries()) {
    try {
      const res = await stockCountService.create({ warehouseId: w.id, notes: "Dönem sayımı" }, undefined);
      say("stok sayımı");
      // İlkini TAMAMLA — "geçmiş sayım" görünümü için.
      if (i === 0 && res.data?.id) {
        await stockCountService.complete(res.data.id, undefined).catch((e: Error) => {
          not(`Sayım tamamlanamadı: ${e.message}`);
        });
      }
    } catch (e) {
      not(`Stok sayımı kurulamadı: ${(e as Error).message}`);
    }
  }
}

// -----------------------------------------------------------------------------
// KUR TARİHÇESİ — Kur Farkı raporunun ÖN KOŞULU
// -----------------------------------------------------------------------------
// Tek kur satırı varsa dövizli fatura ile dövizli tahsilat AYNI kuru damgalar ve
// kur farkı HER SATIRDA 0,00 çıkar — rapor "çalışmıyor" görünür.
export async function kurTarihcesiKur(): Promise<void> {
  adim("Kur tarihçesi (120 gün × 4 para birimi)");
  const bazlar: Record<string, number> = { USD: 44.1, EUR: 47.6, GBP: 55.2, RUB: 0.48 };
  const satirlar: Array<{ rateDate: Date; currency: string; rate: number; source: string }> = [];
  for (let g = 120; g >= 0; g--) {
    const d = gunOnce(g);
    const t = (120 - g) / 120;
    for (const [cur, baz] of Object.entries(bazlar)) {
      // Yumuşak yükseliş + küçük deterministik dalga (gerçekçi trend).
      const trend = baz * (1 + 0.08 * t);
      const dalga = Math.sin((120 - g) / 7) * baz * 0.004;
      satirlar.push({
        rateDate: d,
        currency: cur,
        rate: Math.round((trend + dalga) * 10000) / 10000,
        source: "TCMB",
      });
    }
  }
  let yeni = 0;
  for (const s of satirlar) {
    const r = await prisma.exchangeRate.upsert({
      where: { rateDate_currency: { rateDate: s.rateDate, currency: s.currency as never } },
      update: {},
      create: {
        rateDate: s.rateDate,
        currency: s.currency as never,
        rate: s.rate,
        source: s.source as never,
      },
      select: { id: true },
    });
    if (r) yeni++;
  }
  say("kur satırı (upsert)", yeni);
}
