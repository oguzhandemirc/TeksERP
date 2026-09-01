// =============================================================================
// DEMO SEED — İŞ EMİRLERİ (+ hedef renk) ve FASON ZİNCİRİ
// =============================================================================
// ⚠️ BU MODÜL "SIFIR VERİTABANI" TESTİNDE DOĞDU. Yerel geliştirme DB'sinde 86
// iş emri ve 65 fason sevki vardı ve her şey dolu görünüyordu — ama onların
// HİÇBİRİ bir seed'den gelmiyordu, bekçi paketinin fixture artıklarıydı.
// Sunucudaki TERTEMİZ veritabanında İş Emirleri ekranı BOMBOŞ açılacaktı.
//
// ⭐ HER İŞ EMRİ HEDEF RENK TAŞIR (`targetColorId`). Canlı demodaki "bitmiş
// toplar renksiz" kusurunun KÖK NEDENİ buydu: hedef rengi olmayan iş emri,
// boyahaneden renksiz mal döndürüyordu.
//
// ⚠️ ROTA ADIMINA PLANLI FİRMA YAZILIR — bu LOAD-BEARING: firma yoksa
// "fasona gönder" SESSİZ NO-OP olur (backend firmayı çözemezse sevki atlar,
// hata vermez). Sıfır DB'de iki rotanın da fason adımları firmasızdı.
// =============================================================================
import prisma from "../../src/lib/prisma";
import { WorkOrderService } from "../../src/services/workorder.service";
import { adim, say, not, demoToken, gunOnce, yayilmisGun, rastgele, sec } from "./_kit";

const woService = new WorkOrderService();
const ADET = 22;

/** Fason adımlarına planlı firma + kategori yazar (yoksa sevk sessizce atlanır). */
async function rotalariHazirla(): Promise<void> {
  const kategoriler = await prisma.subcontractorCategory.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });
  for (const kat of kategoriler) {
    const firma = await prisma.subcontractor.findFirst({
      where: {
        isActive: true,
        code: { not: { startsWith: "TEST-" } },
        categories: { some: { categoryId: kat.id } },
      },
      select: { id: true },
    });
    if (!firma) continue;
    // Adım, istasyonunun gerektirdiği kategoriye göre eşlenir.
    const guncellenen = await prisma.routeStep.updateMany({
      where: {
        plannedSubcontractorId: null,
        station: { name: { contains: kat.code === "BOYA" ? "Boyahane" : "Zımpara" } },
      },
      data: { plannedSubcontractorId: firma.id, requiredCategoryId: kat.id },
    });
    if (guncellenen.count > 0) say("rota adımına planlı fason", guncellenen.count);
  }
}

export async function isEmirleriKur(colorIds: string[]): Promise<void> {
  adim(`İş emirleri — ${ADET} emir (hepsi hedef renkli, ilk adım fasona gider)`);
  await rotalariHazirla();

  const rotalar = await prisma.route.findMany({
    where: { isActive: true },
    select: { id: true, steps: { select: { id: true } } },
  });
  const kullanilabilir = rotalar.filter((r) => r.steps.length > 0);
  if (kullanilabilir.length === 0) {
    not("Adımlı aktif rota yok — İş Emirleri ekranı boş kalır.");
    return;
  }
  const kumaslar = await prisma.item.findMany({
    where: { itemType: "FABRIC", isActive: true },
    select: { id: true },
    take: 40,
  });
  if (kumaslar.length === 0 || colorIds.length === 0) {
    not("Kumaş ya da renk yok — iş emri açılamaz.");
    return;
  }

  const r = rastgele(60606);
  for (let i = 0; i < ADET; i++) {
    const token = demoToken(`wo:${i}`);
    const varOlan = await prisma.workOrder.findUnique({
      where: { clientToken: token },
      select: { id: true },
    });
    if (varOlan) continue;

    // HAM top okutularak açılır (gerçek "Hızlı İş Emri" yolu) — böylece iş emri
    // BOŞ doğmaz, partisi ve refakat kartı olur, topları adımda görünür.
    //
    // ⚠️ TEK İŞ EMRİ TEK KUMAŞ İÇİNDİR (servis kuralı: "Okutulan toplar farklı
    // ürünlere ait"). Rastgele top seçmek 22 emrin 22'sini birden düşürdü —
    // toplar önce KUMAŞA göre gruplanır, sonra tek gruptan seçilir.
    const aday = await prisma.roll.findFirst({
      where: {
        status: "STOCK",
        entrySource: "SUPPLIER_RECEIPT",
        currentStepId: null,
        sackId: null,
        shipmentId: null,
        barcode: { startsWith: "DF" },
      },
      select: { itemId: true },
      orderBy: { createdAt: "asc" },
    });
    if (!aday) {
      not(`Ham top kalmadı — ${i}. iş emrinde durdu.`);
      break;
    }
    const toplar = await prisma.roll.findMany({
      where: {
        status: "STOCK",
        entrySource: "SUPPLIER_RECEIPT",
        itemId: aday.itemId,
        currentStepId: null,
        sackId: null,
        shipmentId: null,
        barcode: { startsWith: "DF" },
      },
      select: { barcode: true },
      take: 2 + Math.floor(r() * 2),
    });
    if (toplar.length === 0) {
      not(`Ham top kalmadı — ${i}. iş emrinde durdu.`);
      break;
    }

    const gun = yayilmisGun(i, ADET);
    // Üçte biri fasona GÖNDERİLİR (Fasonda sekmesi + Fason Karnesi dolsun),
    // gerisi içeride bekler (Üretimde sekmesi dolsun).
    const fasonaGitsin = i % 3 === 0;
    try {
      await woService.quickStart(
        {
          routeTemplateId: sec(kullanilabilir, r).id,
          // Hedef kumaş, okutulan topların kumaşıdır (aksi hâli plan-mal çelişkisi).
          targetItemId: aday.itemId,
          // ⭐ HEDEF RENK — bkz. dosya başlığı.
          targetColorId: sec(colorIds, r),
          width: 140 + Math.round(r() * 16) * 10,
          type: "STOCK_PRODUCTION",
          plannedStartDate: gunOnce(gun).toISOString(),
          rollBarcodes: toplar.map((t) => t.barcode as string),
          dispatchFirstStep: fasonaGitsin,
          clientToken: token,
        } as never,
        undefined,
      );
      say("iş emri");
      if (fasonaGitsin) say("fasona sevk edilen iş emri");
    } catch (e) {
      not(`İş emri #${i} kurulamadı: ${(e as Error).message}`);
    }
  }

  const wo = await prisma.workOrder.count();
  const fason = await prisma.subcontractorDispatch.count();
  const fasonda = await prisma.roll.count({ where: { status: "AT_SUBCONTRACTOR" } });
  console.log(`   iş emri=${wo} · fason sevki=${fason} · fasondaki top=${fasonda}`);
}
