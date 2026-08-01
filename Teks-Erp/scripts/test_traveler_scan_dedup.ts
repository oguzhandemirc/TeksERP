// TEST: Refakat kartı okutma dedup'u (İdempotency denetimi Faz 3).
// Aynı kart + istasyon + scanType 10 sn içinde 2. okutma → yeni satır/audit YOK,
// mevcut scan cached döner. Farklı scanType → yeni satır (meşru ARRIVAL/DEPARTURE).
//
// Çalıştır: npx tsx scripts/test_traveler_scan_dedup.ts
import prisma from "../src/lib/prisma";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ScanType, StationType } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new TravelerCardService();
const ts = Date.now();
let woId = "", cardBarcode = "", stationId = "", ADMIN = "";

async function scanCount(): Promise<number> {
  return prisma.travelerCardScan.count({ where: { card: { workOrderId: woId } } });
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { itemType: "FABRIC" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  // Kart okutmada matchingStep için istasyonun WO adımıyla eşleşmesi gerekmez (null olabilir).
  // NEDEN `type` (kind DEĞİL): "fason mu" ayrımının kanonik kaynağı `Station.type`'tır
  // (`subcontractor.service.ts` her yerde `station.type !== StationType.EXTERNAL` ile bakar).
  // Burada eskiden `kind: { not: StationKind.EXTERNAL }` yazıyordu — `StationKind`'da
  // EXTERNAL ÜYESİ YOK (o `StationType`'ta). Runtime'da `undefined` olduğu ve Prisma
  // `undefined` koşulu tamamen ATTIĞI için süzgeç sessizce `{ isActive: true }`'e
  // düşüyordu: test yeşil kalıyor ama "fason olmayan istasyon seç" garantisi yok
  // oluyordu. `scripts/` hiç derlenmediği için tsc bunu 1 saniyede söyleyemedi
  // (bkz. tsconfig.scripts.json). `orderBy` determinizm için: `findFirst` sırasız
  // çalışırsa DB'nin fiziksel satır sırasına kalır ve geri-yükleme/VACUUM sonrası
  // sessizce BAŞKA bir istasyon seçilebilir.
  const station = await prisma.station.findFirst({
    where: { type: { not: StationType.EXTERNAL }, isActive: true },
    orderBy: [{ createdAt: "asc" }, { code: "asc" }],
    select: { id: true },
  });
  if (!item || !admin || !station) throw new Error("Seed fixture eksik — önce 'npm run seed'");
  ADMIN = admin.id; stationId = station.id;

  // WO + tek adım + refakat kartı (create tx'inden doğar; barkod = İE numarası).
  // İE formatı: IE + GGAAYY(6) + NNNN(4) = IE + 10 hane (isCardCode/isDailyCode).
  const woNumber = `IE${String(ts).slice(-10)}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: woNumber, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      targetItemId: item.id,
      steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" }] },
    },
    select: { id: true, workOrderNumber: true },
  });
  woId = wo.id;
  const cardRes = await prisma.$transaction((tx) => svc.createForWorkOrder(tx, wo.id, ADMIN));
  cardBarcode = cardRes.card.barcode;

  // ═══ SD1 — 10 sn içinde aynı kart+istasyon+tip → dedup ═══
  console.log("\n=== SD1: aynı kart+istasyon+tip 2. okutma → satır artmaz (cached) ===");
  {
    const s1 = await svc.scan({ barcode: cardBarcode, stationId, scanType: ScanType.ARRIVAL }, ADMIN);
    const c1 = await scanCount();
    check("SD1: ilk okutma bir scan satırı yazdı", c1 === 1, `count ${c1}`);
    const s2 = await svc.scan({ barcode: cardBarcode, stationId, scanType: ScanType.ARRIVAL }, ADMIN);
    const c2 = await scanCount();
    check("SD1: 2. okutma (mükerrer) satır ARTIRMADI", c2 === 1, `count ${c2}`);
    check("SD1: 2. okutma AYNI scan kaydını döndü (idempotent)",
      (s2.data as { id: string }).id === (s1.data as { id: string }).id);
    check("SD1: mesaj mükerrer okutmayı bildirir", /mükerrer/i.test(s2.message ?? ""));
  }

  // ═══ SD2 — farklı scanType → yeni satır (meşru) ═══
  console.log("\n=== SD2: farklı scanType (DEPARTURE) → yeni satır (meşru ardışık okutma) ===");
  {
    await svc.scan({ barcode: cardBarcode, stationId, scanType: ScanType.DEPARTURE }, ADMIN);
    const c = await scanCount();
    check("SD2: DEPARTURE farklı tip → yeni satır (dedup ETMEDİ)", c === 2, `count ${c}`);
  }

  // ═══ SD3 — pencere dışı (>10 sn) aynı tip → yeni satır ═══
  console.log("\n=== SD3: pencere dışı (>10 sn önce) aynı tip → dedup ETMEZ (yeni okutma meşru) ===");
  {
    // İlk ARRIVAL scan'ini 11 sn geriye it (pencereyi aş) → yeni ARRIVAL yeni satır olmalı.
    const first = await prisma.travelerCardScan.findFirst({
      where: { card: { workOrderId: woId }, scanType: ScanType.ARRIVAL },
      orderBy: { scannedAt: "asc" }, select: { id: true },
    });
    await prisma.travelerCardScan.update({
      where: { id: first!.id },
      data: { scannedAt: new Date(Date.now() - 11_000) },
    });
    await svc.scan({ barcode: cardBarcode, stationId, scanType: ScanType.ARRIVAL }, ADMIN);
    const c = await scanCount();
    check("SD3: pencere dışı ARRIVAL → yeni satır yazıldı", c === 3, `count ${c}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: woId } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: woId } });
    await prisma.workOrder.deleteMany({ where: { id: woId } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
