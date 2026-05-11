// =============================================================================
// TeksERP — 2-Yıllık Operasyonel Yük Testi Seed Scripti
// =============================================================================
// Hedef: 2024-05-08 ile 2026-05-07 arasını kapsayan, ~1M+ satırlık çeşitlilikli
// fabrika simülasyonu. Mevcut PERF- prefix'li veriye DOKUNMAZ — kendi LOAD-
// prefix'iyle ayrı kayıt yaratır.
//
// Çeşitlilik eksenleri:
//   - 2 yıl, iş günü + sezon piki (Mart-May / Eyl-Kas) ağırlıklı tarih
//   - 5 farklı sipariş senaryosu (happy/late/partial/cancel/pending/urgent)
//   - 5 WO tipi (ORDER/STOCK/SAMPLE/REWORK/SERVICE)
//   - 4 step varyasyonu (3-7 step arası)
//   - 8 Roll yolculuğu (düz/scrap/A1/fason/kesim/rework/aktif/aged-stock)
//   - %3-4 hata, %15 hala açık
//   - %5 sevkiyat iptal, müşteri reassign
//   - System logs %30 6 aydan eski → arşiv testi için
//
// Çalıştırma:
//   cd Teks-Erp && npx ts-node scripts/seed-2yr.ts
//
// İdempotent: yeniden çalıştırılabilir — LOAD- prefix'li tüm kayıtları siler
// ve baştan üretir. PERF- ve diğer mevcut veriler korunur.
// =============================================================================

import {
  PrismaClient,
  RollStatus,
  OrderStatus,
  WorkOrderStatus,
  WorkOrderType,
  ShipmentStatus,
  StepStatus,
  RollOperationType,
  RollEntrySource,
  ScanType,
  TravelerCardStatus,
  PackagingQueueStatus,
  StationKind,
  StationType,
  ItemType,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { faker } from "@faker-js/faker/locale/tr";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL gerekli");
const pool = new Pool({ connectionString, max: 10 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Hedefler — 2 yıllık fabrika hacmi ──────────────────────────────────────
const TARGET = {
  customers: 100,
  branchesPerCustomer: 3,
  sacks: 8000,
  orders: 4000,
  workOrders: 5000,
  rolls: 60000,
  rollErrors: 2200,
  shipments: 2200,
  subDispatches: 450,
  travelerCards: 5000,
  packagingQueueLive: 200,
  machineLogs: 120000,
  systemLogs: 700000,
};

const BATCH = 1000;
const PREFIX = "LOAD-";
faker.seed(2026);

// ── Tarih aralığı ──────────────────────────────────────────────────────────
const NOW = new Date("2026-05-07T18:00:00Z");
const TWO_YEARS_AGO = new Date("2024-05-08T08:00:00Z");
const SIX_MONTHS_AGO = new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000);

// ── Helpers ────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted<T>(items: Array<[T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

function maybe<T>(value: T, ratio: number): T | null {
  return Math.random() < ratio ? value : null;
}

function chance(ratio: number): boolean {
  return Math.random() < ratio;
}

/**
 * 2 yıllık aralıkta iş günü + sezon ağırlıklı tarih üretir.
 * - Hafta sonu olasılığı: %15 (operatörler bazen Cumartesi de çalışır)
 * - Sezon piki Mart-Mayıs ve Eylül-Kasım: %40 daha yoğun
 * - Saat: 08-22 arası, vardiya değişiminde (16:00, 24:00) kümelenmiş
 * - Eski → yeni gradyan: 2024 başında %50 hacim, 2026'da tam hacim
 */
function workdayDate(): Date {
  for (let attempt = 0; attempt < 10; attempt++) {
    const ms =
      TWO_YEARS_AGO.getTime() + Math.random() * (NOW.getTime() - TWO_YEARS_AGO.getTime());
    const d = new Date(ms);
    const dow = d.getUTCDay(); // 0=Pazar
    if ((dow === 0 || dow === 6) && Math.random() > 0.15) continue;
    const month = d.getUTCMonth(); // 0=Ocak
    const isPeak = (month >= 2 && month <= 4) || (month >= 8 && month <= 10);
    if (!isPeak && Math.random() > 0.7) continue;
    // Yaşa göre olasılık (eski tarihler daha az)
    const ageRatio =
      (d.getTime() - TWO_YEARS_AGO.getTime()) / (NOW.getTime() - TWO_YEARS_AGO.getTime());
    if (ageRatio < 0.3 && Math.random() > 0.6) continue;
    // Saat: 8-22
    d.setUTCHours(8 + Math.floor(Math.random() * 14));
    d.setUTCMinutes(Math.floor(Math.random() * 60));
    return d;
  }
  return new Date(TWO_YEARS_AGO.getTime() + Math.random() * (NOW.getTime() - TWO_YEARS_AGO.getTime()));
}

function dateAfter(base: Date, minDays: number, maxDays: number): Date {
  const ms =
    base.getTime() + (minDays + Math.random() * (maxDays - minDays)) * 24 * 60 * 60 * 1000;
  return new Date(Math.min(ms, NOW.getTime()));
}

function recentDate(days: number): Date {
  return new Date(NOW.getTime() - Math.random() * days * 24 * 60 * 60 * 1000);
}

async function chunkInsert<T>(
  items: T[],
  insertFn: (chunk: T[]) => Promise<unknown>,
  label: string
): Promise<void> {
  if (items.length === 0) return;
  let done = 0;
  const start = Date.now();
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    await insertFn(chunk);
    done += chunk.length;
    process.stdout.write(`\r  ${label}: ${done}/${items.length}`);
  }
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(`\r  ${label}: ${done}/${items.length}  (${sec}s)\n`);
}

async function cleanLoadPrefixed() {
  console.log("\n[0] LOAD- prefix temizleniyor (idempotent re-run)...");

  // Bağımlılık sırasıyla sil (yapraklardan köke)
  const loadCustIds = (
    await prisma.customer.findMany({
      where: { code: { startsWith: `${PREFIX}MUS-` } },
      select: { id: true },
    })
  ).map((c) => c.id);

  // Sevkiyat ürünleri
  await prisma.shipmentItem.deleteMany({
    where: { shipment: { shipmentNumber: { startsWith: `${PREFIX}IRS-` } } },
  });
  await prisma.shipmentPlannedOrder.deleteMany({
    where: { shipment: { shipmentNumber: { startsWith: `${PREFIX}IRS-` } } },
  });
  await prisma.sack.updateMany({
    where: { shipment: { shipmentNumber: { startsWith: `${PREFIX}IRS-` } } },
    data: { shipmentId: null },
  });
  await prisma.shipment.deleteMany({
    where: { shipmentNumber: { startsWith: `${PREFIX}IRS-` } },
  });

  // Manifest
  await prisma.manifest.deleteMany({
    where: { manifestNo: { startsWith: `${PREFIX}MAN-` } },
  });

  // Subcontractor dispatch/receipt
  await prisma.subcontractorReceiptItem.deleteMany({
    where: { receipt: { receiptNo: { startsWith: `${PREFIX}SR-` } } },
  });
  await prisma.subcontractorReceipt.deleteMany({
    where: { receiptNo: { startsWith: `${PREFIX}SR-` } },
  });
  await prisma.subcontractorDispatchItem.deleteMany({
    where: { dispatch: { dispatchNo: { startsWith: `${PREFIX}SD-` } } },
  });
  await prisma.subcontractorDispatch.deleteMany({
    where: { dispatchNo: { startsWith: `${PREFIX}SD-` } },
  });

  // Traveler cards
  await prisma.travelerCardScan.deleteMany({
    where: { card: { cardNumber: { startsWith: `${PREFIX}RFK-` } } },
  });
  await prisma.travelerCard.deleteMany({
    where: { cardNumber: { startsWith: `${PREFIX}RFK-` } },
  });

  // Packaging queue
  await prisma.packagingQueue.deleteMany({
    where: { order: { orderNumber: { startsWith: `${PREFIX}` } } },
  });

  // Reproduction backlog
  await prisma.reproductionBacklog.deleteMany({
    where: { orderLine: { order: { orderNumber: { startsWith: `${PREFIX}` } } } },
  });

  // Roll-bağlı kayıtlar (LOAD- barcode'lu top'lara bağlı)
  await prisma.orderAllocation.deleteMany({
    where: { roll: { barcode: { startsWith: `${PREFIX}ROL-` } } },
  });
  await prisma.rollOperation.deleteMany({
    where: { roll: { barcode: { startsWith: `${PREFIX}ROL-` } } },
  });
  await prisma.rollMovement.deleteMany({
    where: { roll: { barcode: { startsWith: `${PREFIX}ROL-` } } },
  });
  await prisma.rollError.deleteMany({
    where: { roll: { barcode: { startsWith: `${PREFIX}ROL-` } } },
  });
  // parent ilişkisini önce kopar (child rolleri silmek için)
  await prisma.roll.updateMany({
    where: { parent: { barcode: { startsWith: `${PREFIX}ROL-` } } },
    data: { parentRollId: null },
  });
  await prisma.roll.deleteMany({
    where: { barcode: { startsWith: `${PREFIX}ROL-` } },
  });

  // WorkOrder ve adımları
  await prisma.workOrderTargetProperty.deleteMany({
    where: { workOrder: { batchNumber: { startsWith: `${PREFIX}WO-` } } },
  });
  await prisma.workOrderToOrderLine.deleteMany({
    where: { workOrder: { batchNumber: { startsWith: `${PREFIX}WO-` } } },
  });
  // WO step'leri rolelerden referanslanmasın (yukarıda LOAD-ROL silindi, ama mevcut
  // PERF- veya başka rolelerin currentStepId/producedInStepId'i LOAD- step'e bağlanmış olabilir)
  await prisma.roll.updateMany({
    where: { currentStep: { workOrder: { batchNumber: { startsWith: `${PREFIX}WO-` } } } },
    data: { currentStepId: null },
  });
  await prisma.roll.updateMany({
    where: {
      producedInStep: { workOrder: { batchNumber: { startsWith: `${PREFIX}WO-` } } },
    },
    data: { producedInStepId: null },
  });
  await prisma.workOrderStep.deleteMany({
    where: { workOrder: { batchNumber: { startsWith: `${PREFIX}WO-` } } },
  });
  await prisma.workOrder.deleteMany({
    where: { batchNumber: { startsWith: `${PREFIX}WO-` } },
  });

  // Order ve satırları
  await prisma.orderLineTargetProperty.deleteMany({
    where: { orderLine: { order: { orderNumber: { startsWith: `${PREFIX}` } } } },
  });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: `${PREFIX}` } },
  });

  // Customer + branch + sack
  if (loadCustIds.length > 0) {
    await prisma.sack.deleteMany({ where: { customerId: { in: loadCustIds } } });
    await prisma.customerBranch.deleteMany({ where: { customerId: { in: loadCustIds } } });
  }
  await prisma.customer.deleteMany({
    where: { code: { startsWith: `${PREFIX}MUS-` } },
  });

  // Önce log'lar (machine/station silmeden önce FK kalksın)
  await prisma.machineLog.deleteMany({
    where: { machine: { code: { startsWith: `${PREFIX}` } } },
  });
  await prisma.systemLog.deleteMany({
    where: { recordId: { startsWith: `LOAD::` } },
  });

  // Master data — sadece LOAD- prefix'liler (sıra: alt → üst FK)
  await prisma.subcontractorToCategory.deleteMany({
    where: { subcontractor: { code: { startsWith: `${PREFIX}` } } },
  });
  await prisma.subcontractor.deleteMany({
    where: { code: { startsWith: `${PREFIX}` } },
  });
  await prisma.subcontractorCategory.deleteMany({
    where: { code: { startsWith: `${PREFIX}` } },
  });
  await prisma.itemVariant.deleteMany({ where: { code: { startsWith: `${PREFIX}` } } });
  await prisma.item.deleteMany({ where: { code: { startsWith: `${PREFIX}` } } });
  await prisma.color.deleteMany({ where: { code: { startsWith: `${PREFIX}` } } });
  await prisma.fabricProperty.deleteMany({ where: { code: { startsWith: `${PREFIX}` } } });
  await prisma.machine.deleteMany({ where: { code: { startsWith: `${PREFIX}` } } });
  await prisma.station.deleteMany({ where: { code: { startsWith: `${PREFIX}` } } });
  await prisma.qualityGrade.deleteMany({ where: { code: { startsWith: `${PREFIX}` } } });
  await prisma.defectType.deleteMany({ where: { code: { startsWith: `${PREFIX}` } } });

  console.log("  Temizlendi.");
}

async function ensureMasterData(adminUserId: string) {
  console.log("\n[1] Master data tamamlanıyor (eksikse)...");

  // ── Stations: LOAD- prefix'iyle 6 istasyon ekle (mevcuda dokunma) ──────
  const stationDefs: Array<{ code: string; name: string; kind: StationKind; type: StationType }> = [
    { code: `${PREFIX}KK1`, name: "Ham Kabul (KK1)", kind: StationKind.RAW_QC, type: StationType.INTERNAL },
    { code: `${PREFIX}KK2-1`, name: "Kurşun + KK2 #1", kind: StationKind.PROCESS_QC, type: StationType.INTERNAL },
    { code: `${PREFIX}KK2-2`, name: "Kurşun + KK2 #2", kind: StationKind.PROCESS_QC, type: StationType.INTERNAL },
    { code: `${PREFIX}TAMBUR-1`, name: "Tambur #1", kind: StationKind.TAMBUR, type: StationType.INTERNAL },
    { code: `${PREFIX}PAKET-1`, name: "Paketleme #1", kind: StationKind.PACKAGING, type: StationType.INTERNAL },
    { code: `${PREFIX}SEVK`, name: "Sevkiyat", kind: StationKind.SHIPPING, type: StationType.INTERNAL },
    { code: `${PREFIX}FASON`, name: "Fason İstasyonu", kind: StationKind.SUBCONTRACTOR, type: StationType.EXTERNAL },
  ];
  await prisma.station.createMany({ data: stationDefs, skipDuplicates: true });
  const stations = await prisma.station.findMany({
    where: { code: { startsWith: `${PREFIX}` } },
    select: { id: true, code: true, kind: true },
  });
  const stationByKind = new Map<StationKind, string[]>();
  for (const s of stations) {
    const arr = stationByKind.get(s.kind) ?? [];
    arr.push(s.id);
    stationByKind.set(s.kind, arr);
  }

  // Machines (her istasyona 2 makine)
  const machineData = stations.flatMap((s, sIdx) =>
    Array.from({ length: 2 }, (_, mIdx) => ({
      id: randomUUID(),
      stationId: s.id,
      code: `${PREFIX}MAK-${String(sIdx + 1).padStart(2, "0")}-${mIdx + 1}`,
      name: `${s.code.replace(PREFIX, "")} Makine ${mIdx + 1}`,
    }))
  );
  await prisma.machine.createMany({ data: machineData, skipDuplicates: true });

  // ── Items + Variants ──────────────────────────────────────────────────
  const itemDefs: Array<{ code: string; name: string; itemType: ItemType }> = [
    { code: `${PREFIX}ITM-PATOS`, name: "Ham Patos Kumaş", itemType: ItemType.RAW_FABRIC },
    { code: `${PREFIX}ITM-VISKON`, name: "Ham Viskon", itemType: ItemType.RAW_FABRIC },
    { code: `${PREFIX}ITM-POLY`, name: "Ham Polyester", itemType: ItemType.RAW_FABRIC },
    { code: `${PREFIX}ITM-LIKRA`, name: "Ham Likralı Penye", itemType: ItemType.RAW_FABRIC },
    { code: `${PREFIX}ITM-PAMUK`, name: "Ham Pamuklu Süprem", itemType: ItemType.RAW_FABRIC },
    { code: `${PREFIX}ITM-IPLIK-30`, name: "Pamuk İplik 30/1", itemType: ItemType.YARN },
    { code: `${PREFIX}ITM-IPLIK-40`, name: "Pamuk İplik 40/1", itemType: ItemType.YARN },
    { code: `${PREFIX}ITM-WARP`, name: "Çözgü Tel Pamuk", itemType: ItemType.WARP },
    { code: `${PREFIX}ITM-CONS`, name: "Sarf - Etiket", itemType: ItemType.CONSUMABLE },
  ];
  await prisma.item.createMany({ data: itemDefs, skipDuplicates: true });
  const items = await prisma.item.findMany({
    where: { code: { startsWith: `${PREFIX}ITM-` } },
    select: { id: true, code: true, itemType: true },
  });

  // Each item gets 4 variants (RAW_FABRIC) or 2 (others)
  const variantData: Array<{ id: string; itemId: string; code: string; name: string }> = [];
  const fabricVariants = ["BALIK_SIRTA", "DUZ", "ZIGZAG", "DESEN_A", "DESEN_B", "EKOSEL"];
  for (const it of items) {
    const count = it.itemType === ItemType.RAW_FABRIC ? 5 : 2;
    for (let i = 0; i < count; i++) {
      const v = fabricVariants[i] ?? `VARYANT_${i + 1}`;
      variantData.push({
        id: randomUUID(),
        itemId: it.id,
        code: `${PREFIX}${v}-${it.code.split("-").pop()}`,
        name: `${v.replace("_", " ")} - ${it.code.split("-").pop()}`,
      });
    }
  }
  await prisma.itemVariant.createMany({ data: variantData, skipDuplicates: true });
  const variants = await prisma.itemVariant.findMany({
    where: { code: { startsWith: `${PREFIX}` } },
    select: { id: true, itemId: true },
  });
  const variantsByItem = new Map<string, string[]>();
  for (const v of variants) {
    const arr = variantsByItem.get(v.itemId) ?? [];
    arr.push(v.id);
    variantsByItem.set(v.itemId, arr);
  }

  // ── Colors ────────────────────────────────────────────────────────────
  const colorDefs = [
    { code: `${PREFIX}MAVI`, name: "Mavi", hex: "#1d4ed8", sortOrder: 1 },
    { code: `${PREFIX}KIRMIZI`, name: "Kırmızı", hex: "#dc2626", sortOrder: 2 },
    { code: `${PREFIX}YESIL`, name: "Yeşil", hex: "#16a34a", sortOrder: 3 },
    { code: `${PREFIX}SARI`, name: "Sarı", hex: "#eab308", sortOrder: 4 },
    { code: `${PREFIX}SIYAH`, name: "Siyah", hex: "#0f172a", sortOrder: 5 },
    { code: `${PREFIX}BEYAZ`, name: "Beyaz", hex: "#f8fafc", sortOrder: 6 },
    { code: `${PREFIX}GRI`, name: "Gri", hex: "#64748b", sortOrder: 7 },
    { code: `${PREFIX}MOR`, name: "Mor", hex: "#7c3aed", sortOrder: 8 },
  ];
  await prisma.color.createMany({ data: colorDefs, skipDuplicates: true });
  const colors = await prisma.color.findMany({
    where: { code: { startsWith: `${PREFIX}` } },
    select: { id: true },
  });

  // ── Fabric properties ─────────────────────────────────────────────────
  const propDefs = [
    { code: `${PREFIX}YANMAZ`, name: "Yanmazlık", category: "Dayanıklılık", sortOrder: 1 },
    { code: `${PREFIX}SU_GEC`, name: "Su Geçirmez", category: "Yüzey", sortOrder: 2 },
    { code: `${PREFIX}ANTIBAK`, name: "Antibakteriyel", category: "Kimyasal", sortOrder: 3 },
    { code: `${PREFIX}PARLAK`, name: "Parlak Apre", category: "Yüzey", sortOrder: 4 },
    { code: `${PREFIX}MAT`, name: "Mat Apre", category: "Yüzey", sortOrder: 5 },
  ];
  await prisma.fabricProperty.createMany({ data: propDefs, skipDuplicates: true });
  const props = await prisma.fabricProperty.findMany({
    where: { code: { startsWith: `${PREFIX}` } },
    select: { id: true },
  });

  // ── Defect types (mevcut 3 var, 5 daha ekleyelim) ────────────────────
  const defectDefs = [
    { code: `${PREFIX}LEKE`, name: "Yağ Lekesi", severity: "MAJOR" },
    { code: `${PREFIX}DEL`, name: "Delik", severity: "CRITICAL" },
    { code: `${PREFIX}ATKI`, name: "Atkı Atlaması", severity: "MAJOR" },
    { code: `${PREFIX}RNK`, name: "Renk Farkı", severity: "MINOR" },
    { code: `${PREFIX}CIZIK`, name: "Çizik", severity: "MINOR" },
    { code: `${PREFIX}KOPMA`, name: "İplik Kopması", severity: "MAJOR" },
    { code: `${PREFIX}KIRIK`, name: "Kırışık", severity: "MINOR" },
  ];
  await prisma.defectType.createMany({ data: defectDefs, skipDuplicates: true });
  const defects = await prisma.defectType.findMany({
    where: { code: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });

  // ── Quality grades ────────────────────────────────────────────────────
  const gradeDefs = [
    { code: `${PREFIX}1KAL`, name: "1. Kalite", color: "#10b981", sortOrder: 1 },
    { code: `${PREFIX}A1`, name: "A1 (2. Kalite)", color: "#f59e0b", sortOrder: 2 },
    { code: `${PREFIX}A2`, name: "A2", color: "#f97316", sortOrder: 3 },
    { code: `${PREFIX}FIRE`, name: "Fire / Hurda", color: "#dc2626", sortOrder: 4 },
  ];
  await prisma.qualityGrade.createMany({ data: gradeDefs, skipDuplicates: true });
  const grades = (await prisma.qualityGrade.findMany({ select: { code: true } })).map(
    (g) => g.code
  );

  // ── Subcontractor categories + firms ──────────────────────────────────
  const catDefs = [
    { code: `${PREFIX}DYE`, name: "Boyahane" },
    { code: `${PREFIX}WASH`, name: "Yıkama" },
    { code: `${PREFIX}SAND`, name: "Zımpara" },
    { code: `${PREFIX}PRINT`, name: "Baskı" },
    { code: `${PREFIX}SANFOR`, name: "Sanfor" },
  ];
  await prisma.subcontractorCategory.createMany({ data: catDefs, skipDuplicates: true });
  const cats = await prisma.subcontractorCategory.findMany({
    where: { code: { startsWith: `${PREFIX}` } },
    select: { id: true, code: true },
  });

  const subDefs = Array.from({ length: 12 }, (_, i) => ({
    id: randomUUID(),
    code: `${PREFIX}FAS-${String(i + 1).padStart(3, "0")}`,
    name: `${faker.company.name()} ${["Boyahanesi", "Yıkama Tesisi", "Apre", "Tekstil"][i % 4]}`,
    taxNumber: faker.string.numeric(10),
    phone: faker.phone.number(),
    address: faker.location.streetAddress(),
  }));
  await prisma.subcontractor.createMany({ data: subDefs, skipDuplicates: true });
  const subs = await prisma.subcontractor.findMany({
    where: { code: { startsWith: `${PREFIX}` } },
    select: { id: true },
  });

  // Her firma 1-3 kategoride hizmet versin
  const subCatLinks: Array<{ subcontractorId: string; categoryId: string }> = [];
  for (const s of subs) {
    const linkCount = 1 + Math.floor(Math.random() * 3);
    const seen = new Set<string>();
    for (let i = 0; i < linkCount; i++) {
      const c = pickRandom(cats);
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      subCatLinks.push({ subcontractorId: s.id, categoryId: c.id });
    }
  }
  await prisma.subcontractorToCategory.createMany({
    data: subCatLinks,
    skipDuplicates: true,
  });

  console.log(
    `  Master data tamam: ${stations.length} istasyon, ${items.length} item, ${variants.length} varyant, ${colors.length} renk, ${props.length} özellik, ${defects.length} hata tipi, ${cats.length} fason kategorisi, ${subs.length} fason firma`
  );

  return {
    stations,
    stationByKind,
    items: items.map((i) => ({ ...i, variantIds: variantsByItem.get(i.id) ?? [] })),
    colors,
    props,
    defects,
    grades,
    cats,
    subs,
    machines: machineData.map((m) => ({ id: m.id, stationId: m.stationId })),
  };
}

async function main() {
  const t0 = Date.now();
  console.log("─".repeat(70));
  console.log("TeksERP — 2 Yıllık Yük Testi Seed");
  console.log("Aralık:", TWO_YEARS_AGO.toISOString().slice(0, 10), "→", NOW.toISOString().slice(0, 10));
  console.log("Hedef:", TARGET);
  console.log("─".repeat(70));

  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  if (users.length === 0) throw new Error("En az bir kullanıcı (admin) gerekli");
  const adminUser = users.find((u) => u.username === "admin") ?? users[0];

  await cleanLoadPrefixed();

  const md = await ensureMasterData(adminUser.id);

  // ── 2) Customers + Branches + Sacks ──────────────────────────────────────
  console.log("\n[2] Müşteri + Şube + Çuval...");
  const customerData = Array.from({ length: TARGET.customers }, (_, i) => ({
    id: randomUUID(),
    code: `${PREFIX}MUS-${String(i + 1).padStart(4, "0")}`,
    name: `${faker.company.name()} Tekstil`,
    taxNumber: faker.string.numeric(10),
    type: "CUSTOMER" as const,
  }));
  await chunkInsert(
    customerData,
    (c) => prisma.customer.createMany({ data: c, skipDuplicates: true }),
    "Müşteri"
  );

  const branchData = customerData.flatMap((c) =>
    Array.from({ length: TARGET.branchesPerCustomer }, (_, i) => ({
      id: randomUUID(),
      customerId: c.id,
      code: `${c.code}-S${i + 1}`,
      name: `${faker.location.city()} Şubesi`,
      address: faker.location.streetAddress(),
      city: faker.location.city(),
      district: faker.location.county(),
      contactName: faker.person.fullName(),
      contactPhone: faker.phone.number(),
    }))
  );
  await chunkInsert(
    branchData,
    (c) => prisma.customerBranch.createMany({ data: c, skipDuplicates: true }),
    "Şube"
  );
  const branchByCustomer = new Map<string, string[]>();
  for (const b of branchData) {
    const arr = branchByCustomer.get(b.customerId) ?? [];
    arr.push(b.id);
    branchByCustomer.set(b.customerId, arr);
  }

  const sackData = Array.from({ length: TARGET.sacks }, (_, i) => ({
    id: randomUUID(),
    sackNumber: `${PREFIX}CVL-${String(i + 1).padStart(7, "0")}`,
    customerId: pickRandom(customerData).id,
    weightKg: maybe(faker.number.float({ min: 8, max: 35, fractionDigits: 2 }), 0.6),
  }));
  await chunkInsert(
    sackData,
    (c) => prisma.sack.createMany({ data: c, skipDuplicates: true }),
    "Çuval"
  );

  // ── 3) Orders + OrderLines ────────────────────────────────────────────────
  console.log("\n[3] Sipariş + Kalem (5 senaryo dağılımı)...");
  type OrderRow = {
    id: string;
    orderNumber: string;
    customerId: string;
    status: OrderStatus;
    orderDate: Date;
    deadline: Date;
    isUrgent: boolean;
  };
  const orderData: OrderRow[] = [];
  for (let i = 0; i < TARGET.orders; i++) {
    const orderDate = workdayDate();
    // 5 senaryo
    const scenario = pickWeighted([
      ["happy", 55],
      ["late", 15],
      ["partial", 12],
      ["urgent", 8],
      ["pending", 5],
      ["cancel", 5],
    ]);
    let status: OrderStatus;
    let deadlineDays: number;
    let isUrgent = false;
    switch (scenario) {
      case "happy":
        status = chance(0.85) ? "COMPLETED" : "APPROVED";
        deadlineDays = faker.number.int({ min: 14, max: 60 });
        break;
      case "late":
        status = chance(0.5) ? "APPROVED" : "PARTIAL_SHIPPED";
        deadlineDays = faker.number.int({ min: 7, max: 30 });
        // late = deadline geçmiş ama hala açık → orderDate'i NOW'a yakın çekme
        break;
      case "partial":
        status = "PARTIAL_SHIPPED";
        deadlineDays = faker.number.int({ min: 14, max: 45 });
        break;
      case "urgent":
        status = chance(0.4) ? "COMPLETED" : "APPROVED";
        deadlineDays = faker.number.int({ min: 3, max: 7 });
        isUrgent = true;
        break;
      case "pending":
        status = "PENDING";
        deadlineDays = faker.number.int({ min: 14, max: 60 });
        break;
      default:
        status = "CANCELLED";
        deadlineDays = faker.number.int({ min: 14, max: 60 });
        break;
    }
    const deadline = new Date(orderDate);
    deadline.setDate(deadline.getDate() + deadlineDays);
    const ymd = `${orderDate.getFullYear()}${String(orderDate.getMonth() + 1).padStart(2, "0")}`;
    orderData.push({
      id: randomUUID(),
      orderNumber: `${PREFIX}ORD-${ymd}-${String(i + 1).padStart(5, "0")}`,
      customerId: pickRandom(customerData).id,
      status,
      orderDate,
      deadline,
      isUrgent,
    });
  }
  await chunkInsert(
    orderData,
    (c) =>
      prisma.order.createMany({
        data: c.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customerId: o.customerId,
          status: o.status,
          orderDate: o.orderDate,
          deadline: o.deadline,
          completedAt: o.status === "COMPLETED" ? dateAfter(o.orderDate, 5, 30) : null,
          createdAt: o.orderDate,
          updatedAt: o.orderDate,
        })),
        skipDuplicates: true,
      }),
    "Sipariş"
  );

  // OrderLine: 1-4 satır per sipariş (uzun kuyruk)
  const orderLineData: Array<{
    id: string;
    orderId: string;
    itemId: string;
    variantId: string | null;
    quantity: number;
    width: number | null;
    targetColorId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  for (const o of orderData) {
    const lineCount = pickWeighted([
      [1, 50],
      [2, 30],
      [3, 15],
      [4, 5],
    ]);
    for (let i = 0; i < lineCount; i++) {
      const item = pickRandom(md.items);
      const variantId = item.variantIds.length > 0 ? pickRandom(item.variantIds) : null;
      orderLineData.push({
        id: randomUUID(),
        orderId: o.id,
        itemId: item.id,
        variantId,
        quantity: faker.number.int({ min: 100, max: 3000 }),
        width: chance(0.7) ? faker.number.int({ min: 140, max: 220 }) : null,
        targetColorId: chance(0.5) ? pickRandom(md.colors).id : null,
        createdAt: o.orderDate,
        updatedAt: o.orderDate,
      });
    }
  }
  await chunkInsert(
    orderLineData,
    (c) => prisma.orderLine.createMany({ data: c, skipDuplicates: true }),
    "Sipariş kalemi"
  );

  // ── 4) WorkOrders + Steps ─────────────────────────────────────────────────
  console.log("\n[4] İş emri + Adımlar (5 tip, 4 step varyasyonu)...");
  type WorkOrderRow = {
    id: string;
    batchNumber: string;
    type: WorkOrderType;
    status: WorkOrderStatus;
    width: number;
    targetQuantity: number;
    plannedStart: Date;
    plannedEnd: Date;
    targetItemId: string | null;
    targetColorId: string | null;
    createdAt: Date;
    stepKinds: StationKind[];
  };

  function stepKindsForVariation(): StationKind[] {
    const variation = pickWeighted([
      ["simple", 30],
      ["standard", 45],
      ["fason", 15],
      ["complex", 10],
    ]);
    switch (variation) {
      case "simple":
        return [StationKind.RAW_QC, StationKind.PROCESS_QC, StationKind.PACKAGING];
      case "standard":
        return [
          StationKind.RAW_QC,
          StationKind.PROCESS_QC,
          StationKind.TAMBUR,
          StationKind.PACKAGING,
        ];
      case "fason":
        return [
          StationKind.RAW_QC,
          StationKind.PROCESS_QC,
          StationKind.SUBCONTRACTOR,
          StationKind.TAMBUR,
          StationKind.PACKAGING,
        ];
      default:
        return [
          StationKind.RAW_QC,
          StationKind.PROCESS_QC,
          StationKind.SUBCONTRACTOR,
          StationKind.PROCESS_QC,
          StationKind.TAMBUR,
          StationKind.PACKAGING,
          StationKind.SHIPPING,
        ];
    }
  }

  const woData: WorkOrderRow[] = Array.from({ length: TARGET.workOrders }, (_, i) => {
    const type = pickWeighted<WorkOrderType>([
      ["ORDER_PRODUCTION", 55],
      ["STOCK_PRODUCTION", 20],
      ["SERVICE_PRODUCTION", 12],
      ["SAMPLE_PRODUCTION", 5],
      ["REPAIR_REWORK", 8],
    ]);
    const status = pickWeighted<WorkOrderStatus>([
      ["COMPLETED", 55],
      ["IN_PROGRESS", 20],
      ["PLANNED", 12],
      ["PAUSED", 8],
      ["CANCELLED", 5],
    ]);
    const plannedStart = workdayDate();
    const plannedEnd = dateAfter(plannedStart, 5, 30);
    const targetItem = pickRandom(md.items);
    return {
      id: randomUUID(),
      batchNumber: `${PREFIX}WO-${String(i + 1).padStart(6, "0")}`,
      type,
      status,
      width: faker.number.int({ min: 140, max: 220 }),
      targetQuantity: faker.number.int({ min: 200, max: 5000 }),
      plannedStart,
      plannedEnd,
      targetItemId: targetItem.id,
      targetColorId: chance(0.4) ? pickRandom(md.colors).id : null,
      createdAt: plannedStart,
      stepKinds: stepKindsForVariation(),
    };
  });
  await chunkInsert(
    woData,
    (c) =>
      prisma.workOrder.createMany({
        data: c.map((w) => ({
          id: w.id,
          batchNumber: w.batchNumber,
          type: w.type,
          status: w.status,
          width: w.width,
          targetQuantity: w.targetQuantity,
          plannedStartDate: w.plannedStart,
          plannedEndDate: w.plannedEnd,
          targetItemId: w.targetItemId,
          targetColorId: w.targetColorId,
          servicePricePerMeter:
            w.type === "SERVICE_PRODUCTION"
              ? faker.number.float({ min: 5, max: 30, fractionDigits: 2 })
              : null,
          createdAt: w.createdAt,
          updatedAt: w.createdAt,
        })),
        skipDuplicates: true,
      }),
    "İş emri"
  );

  // WorkOrderToOrderLine — ORDER_PRODUCTION tipi WO'lar OrderLine'lara bağlanır
  const linesByCustomer = new Map<string, typeof orderLineData>();
  for (const ol of orderLineData) {
    const order = orderData.find((o) => o.id === ol.orderId)!;
    const arr = linesByCustomer.get(order.customerId) ?? [];
    arr.push(ol);
    linesByCustomer.set(order.customerId, arr);
  }
  const wolData: Array<{ workOrderId: string; orderLineId: string; allocatedQty: number }> = [];
  const orderProdWOs = woData.filter((w) => w.type === "ORDER_PRODUCTION");
  for (const w of orderProdWOs) {
    if (orderLineData.length === 0) break;
    const linkCount = pickWeighted([
      [1, 70],
      [2, 25],
      [3, 5],
    ]);
    const seen = new Set<string>();
    for (let i = 0; i < linkCount; i++) {
      const ol = pickRandom(orderLineData);
      if (seen.has(ol.id)) continue;
      seen.add(ol.id);
      wolData.push({
        workOrderId: w.id,
        orderLineId: ol.id,
        allocatedQty: Math.min(w.targetQuantity, ol.quantity),
      });
    }
  }
  await chunkInsert(
    wolData,
    (c) => prisma.workOrderToOrderLine.createMany({ data: c, skipDuplicates: true }),
    "WO ↔ Sipariş"
  );

  // WO Steps
  type StepRow = {
    id: string;
    workOrderId: string;
    stationId: string;
    stationKind: StationKind;
    stepSequence: number;
    status: StepStatus;
    startedAt: Date | null;
    completedAt: Date | null;
    requiredCategoryId: string | null;
    plannedSubcontractorId: string | null;
  };
  const stepData: StepRow[] = [];
  const stepsByWO = new Map<string, StepRow[]>();
  for (const w of woData) {
    const woSteps: StepRow[] = [];
    for (let seq = 0; seq < w.stepKinds.length; seq++) {
      const kind = w.stepKinds[seq];
      const candidates = md.stationByKind.get(kind) ?? [];
      if (candidates.length === 0) continue;
      const stationId = pickRandom(candidates);
      // Step status: WO COMPLETED ise hepsi COMPLETED, IN_PROGRESS ise ilk N COMPLETED kalan PENDING
      let status: StepStatus;
      let startedAt: Date | null = null;
      let completedAt: Date | null = null;
      if (w.status === "COMPLETED") {
        status = "COMPLETED";
        startedAt = dateAfter(w.plannedStart, seq, seq + 2);
        completedAt = dateAfter(startedAt, 0, 3);
      } else if (w.status === "CANCELLED") {
        status = chance(0.5) ? "COMPLETED" : "PENDING";
        if (status === "COMPLETED") {
          startedAt = dateAfter(w.plannedStart, seq, seq + 2);
          completedAt = dateAfter(startedAt, 0, 3);
        }
      } else if (w.status === "IN_PROGRESS") {
        const progressedTo = Math.floor(w.stepKinds.length * 0.6);
        if (seq < progressedTo) {
          status = "COMPLETED";
          startedAt = dateAfter(w.plannedStart, seq, seq + 2);
          completedAt = dateAfter(startedAt, 0, 3);
        } else if (seq === progressedTo) {
          status = "ACTIVE";
          startedAt = dateAfter(w.plannedStart, seq, seq + 2);
        } else {
          status = "PENDING";
        }
      } else if (w.status === "PAUSED") {
        if (seq === 0) {
          status = "COMPLETED";
          startedAt = dateAfter(w.plannedStart, 0, 1);
          completedAt = dateAfter(startedAt, 0, 2);
        } else if (seq === 1) {
          status = "ACTIVE";
          startedAt = dateAfter(w.plannedStart, 1, 2);
        } else {
          status = "PENDING";
        }
      } else {
        status = "PENDING";
      }
      const isFason = kind === StationKind.SUBCONTRACTOR;
      const row: StepRow = {
        id: randomUUID(),
        workOrderId: w.id,
        stationId,
        stationKind: kind,
        stepSequence: seq + 1,
        status,
        startedAt,
        completedAt,
        requiredCategoryId: isFason ? pickRandom(md.cats).id : null,
        plannedSubcontractorId: isFason && chance(0.7) ? pickRandom(md.subs).id : null,
      };
      stepData.push(row);
      woSteps.push(row);
    }
    stepsByWO.set(w.id, woSteps);
  }
  await chunkInsert(
    stepData,
    (c) =>
      prisma.workOrderStep.createMany({
        data: c.map((s) => ({
          id: s.id,
          workOrderId: s.workOrderId,
          stationId: s.stationId,
          stepSequence: s.stepSequence,
          status: s.status,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          requiredCategoryId: s.requiredCategoryId,
          plannedSubcontractorId: s.plannedSubcontractorId,
        })),
        skipDuplicates: true,
      }),
    "WO Adım"
  );

  // ── 5) Rolls + Movements + Operations (8 yolculuk) ───────────────────────
  console.log("\n[5] Top + Hareket + Operasyon (8 yolculuk varyasyonu)...");
  type RollRow = {
    id: string;
    barcode: string;
    itemId: string;
    variantId: string | null;
    ownerCustomerId: string | null;
    initialQty: number;
    currentQty: number;
    weightKg: number;
    width: number;
    status: RollStatus;
    qualityGrade: string;
    entrySource: RollEntrySource;
    producedInStepId: string | null;
    currentStepId: string | null;
    parentRollId: string | null;
    sackId: string | null;
    journey: string;
    woId: string | null;
    createdAt: Date;
    journeySteps: StepRow[];
  };

  const sacksByCustomer = new Map<string, string[]>();
  for (const s of sackData) {
    const arr = sacksByCustomer.get(s.customerId) ?? [];
    arr.push(s.id);
    sacksByCustomer.set(s.customerId, arr);
  }

  const rollData: RollRow[] = [];
  // Roll'ları sıraya göre üretelim (parentRoll için child child sırası önemli)
  for (let i = 0; i < TARGET.rolls; i++) {
    const journey = pickWeighted([
      ["happy", 55],
      ["scrap", 5],
      ["aged_a1", 6],
      ["fason", 8],
      ["cut", 4],
      ["rework", 3],
      ["allocation_reassign", 4],
      ["active", 15],
    ]);
    // Hangi WO ile ilişkili
    const woCandidate = pickRandom(woData);
    const woSteps = stepsByWO.get(woCandidate.id) ?? [];
    const item = pickRandom(md.items);
    const variantId = item.variantIds.length > 0 ? pickRandom(item.variantIds) : null;
    const initialQty = faker.number.int({ min: 50, max: 600 });

    let status: RollStatus;
    let entrySource: RollEntrySource = RollEntrySource.PRODUCTION;
    let ownerCustomerId: string | null = null;
    let producedInStepId: string | null = woSteps[0]?.id ?? null;
    let currentStepId: string | null = null;
    let sackId: string | null = null;
    let qualityGrade = "1.KALITE";
    const isService = woCandidate.type === "SERVICE_PRODUCTION";
    if (isService) {
      ownerCustomerId = pickRandom(customerData).id;
      entrySource = RollEntrySource.CUSTOMER_SUPPLIED;
    } else if (item.code.includes("YARN") || item.code.includes("CONS")) {
      entrySource = RollEntrySource.SUPPLIER_RECEIPT;
    }

    switch (journey) {
      case "scrap":
        status = RollStatus.SCRAP;
        qualityGrade = "FIRE";
        break;
      case "aged_a1":
        status = RollStatus.A1_STOCK;
        qualityGrade = "A1";
        break;
      case "fason":
        status = chance(0.4)
          ? RollStatus.AT_SUBCONTRACTOR
          : RollStatus.RETURNED_FROM_SUBCONTRACTOR;
        currentStepId =
          woSteps.find((s) => s.stationKind === StationKind.SUBCONTRACTOR)?.id ?? null;
        break;
      case "cut":
        status = RollStatus.SCRAP; // parent SCRAP, child ayrı kayıt
        qualityGrade = "FIRE";
        break;
      case "rework":
        status = RollStatus.IN_PRODUCTION;
        currentStepId = pickRandom(woSteps)?.id ?? null;
        break;
      case "active":
        status = RollStatus.IN_PRODUCTION;
        currentStepId = pickRandom(woSteps)?.id ?? null;
        break;
      case "allocation_reassign":
        status = RollStatus.WAREHOUSE;
        sackId = chance(0.6) ? pickRandom(sackData).id : null;
        break;
      default: {
        // happy
        const subStatus = pickWeighted<RollStatus>([
          [RollStatus.WAREHOUSE, 30],
          [RollStatus.READY_FOR_SHIP, 15],
          [RollStatus.SHIPPED, 35],
          [RollStatus.PRODUCED, 10],
          [RollStatus.STOCK, 10],
        ]);
        status = subStatus;
        if (subStatus === RollStatus.WAREHOUSE) {
          sackId = chance(0.5) ? pickRandom(sackData).id : null;
        }
        break;
      }
    }

    const createdAt = woCandidate.plannedStart;
    rollData.push({
      id: randomUUID(),
      barcode: `${PREFIX}ROL-${String(i + 1).padStart(7, "0")}`,
      itemId: item.id,
      variantId,
      ownerCustomerId,
      initialQty,
      currentQty: status === RollStatus.SCRAP ? 0 : initialQty - faker.number.int({ min: 0, max: 8 }),
      weightKg: faker.number.float({ min: 5, max: 50, fractionDigits: 2 }),
      width: faker.number.int({ min: 140, max: 220 }),
      status,
      qualityGrade,
      entrySource,
      producedInStepId,
      currentStepId,
      parentRollId: null,
      sackId,
      journey,
      woId: woCandidate.id,
      createdAt,
      journeySteps: woSteps,
    });
  }

  // CUT yolculuğundakilerin %50'si için child top oluştur (yeni allocation)
  const cutParents = rollData.filter((r) => r.journey === "cut");
  const childCount = Math.floor(cutParents.length * 0.7);
  for (let i = 0; i < childCount; i++) {
    const parent = cutParents[i];
    const childIdx = rollData.length;
    rollData.push({
      id: randomUUID(),
      barcode: `${PREFIX}ROL-C${String(childIdx + 1).padStart(6, "0")}`,
      itemId: parent.itemId,
      variantId: parent.variantId,
      ownerCustomerId: parent.ownerCustomerId,
      initialQty: Math.floor(parent.initialQty * 0.6),
      currentQty: Math.floor(parent.initialQty * 0.6),
      weightKg: parent.weightKg * 0.6,
      width: parent.width,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.TAMBUR_SPLIT,
      producedInStepId: parent.producedInStepId,
      currentStepId: null,
      parentRollId: parent.id,
      sackId: null,
      journey: "cut_child",
      woId: parent.woId,
      createdAt: parent.createdAt,
      journeySteps: parent.journeySteps,
    });
  }

  await chunkInsert(
    rollData,
    (c) =>
      prisma.roll.createMany({
        data: c.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          itemId: r.itemId,
          variantId: r.variantId,
          ownerCustomerId: r.ownerCustomerId,
          initialQty: r.initialQty,
          currentQty: r.currentQty,
          weightKg: r.weightKg,
          width: r.width,
          status: r.status,
          qualityGrade: r.qualityGrade,
          entrySource: r.entrySource,
          producedInStepId: r.producedInStepId,
          currentStepId: r.currentStepId,
          parentRollId: r.parentRollId,
          sackId: r.sackId,
          createdById: adminUser.id,
          createdAt: r.createdAt,
          updatedAt: r.createdAt,
        })),
        skipDuplicates: true,
      }),
    "Top"
  );

  // RollMovement: her step'ten geçen rol için bir movement
  const movementData: Array<{
    id: string;
    rollId: string;
    workOrderStepId: string;
    qtyIn: number;
    qtyOut: number | null;
    weightIn: number | null;
    weightOut: number | null;
    enteredAt: Date;
    exitedAt: Date | null;
    operatorId: string;
  }> = [];
  for (const r of rollData) {
    if (r.journeySteps.length === 0) continue;
    // Hangi step'lere kadar geçti
    let lastStepIdx: number;
    if (r.status === RollStatus.SCRAP || r.journey === "cut") {
      lastStepIdx = Math.min(2, r.journeySteps.length - 1);
    } else if (r.status === RollStatus.IN_PRODUCTION) {
      lastStepIdx = Math.min(
        Math.floor(r.journeySteps.length * 0.6),
        r.journeySteps.length - 1
      );
    } else if (r.status === RollStatus.AT_SUBCONTRACTOR) {
      lastStepIdx = r.journeySteps.findIndex(
        (s) => s.stationKind === StationKind.SUBCONTRACTOR
      );
      if (lastStepIdx < 0) lastStepIdx = r.journeySteps.length - 2;
    } else if (r.status === RollStatus.STOCK || r.status === RollStatus.PRODUCED) {
      lastStepIdx = 0;
    } else {
      lastStepIdx = r.journeySteps.length - 1;
    }
    let cursor = new Date(r.createdAt);
    for (let i = 0; i <= lastStepIdx && i < r.journeySteps.length; i++) {
      const step = r.journeySteps[i];
      const isLastVisited = i === lastStepIdx && r.status === RollStatus.IN_PRODUCTION;
      const enteredAt = new Date(cursor);
      enteredAt.setHours(enteredAt.getHours() + faker.number.int({ min: 1, max: 24 }));
      const exitedAt = isLastVisited
        ? null
        : new Date(enteredAt.getTime() + faker.number.int({ min: 30, max: 480 }) * 60 * 1000);
      movementData.push({
        id: randomUUID(),
        rollId: r.id,
        workOrderStepId: step.id,
        qtyIn: r.initialQty,
        qtyOut: exitedAt ? r.currentQty + faker.number.int({ min: 0, max: 5 }) : null,
        weightIn: r.weightKg,
        weightOut: exitedAt ? r.weightKg - faker.number.float({ min: 0, max: 1, fractionDigits: 2 }) : null,
        enteredAt,
        exitedAt,
        operatorId: adminUser.id,
      });
      cursor = exitedAt ?? enteredAt;
    }
  }
  await chunkInsert(
    movementData,
    (c) => prisma.rollMovement.createMany({ data: c, skipDuplicates: true }),
    "Roll Hareketi"
  );

  // RollOperation: tipini step kind'a göre belirle
  const operationData: Array<{
    id: string;
    rollId: string;
    workOrderStepId: string;
    operationType: RollOperationType;
    operatorId: string;
    createdAt: Date;
  }> = [];
  for (const r of rollData) {
    if (r.journeySteps.length === 0) continue;
    for (const step of r.journeySteps) {
      let opType: RollOperationType | null = null;
      let chanceToLog = 0.5;
      switch (step.stationKind) {
        case StationKind.PROCESS_QC:
          opType = chance(0.6) ? RollOperationType.QC2_COMPLETED : RollOperationType.KURSUN_APPLIED;
          chanceToLog = 0.7;
          break;
        case StationKind.TAMBUR:
          opType = RollOperationType.TAMBUR_PROCESSED;
          chanceToLog = 0.8;
          break;
        case StationKind.PACKAGING:
          opType = RollOperationType.PACKAGED;
          chanceToLog = r.status === RollStatus.SCRAP ? 0 : 0.7;
          break;
        case StationKind.SUBCONTRACTOR:
          opType = chance(0.5)
            ? RollOperationType.SUBCONTRACTOR_SENT
            : RollOperationType.SUBCONTRACTOR_RETURNED;
          chanceToLog = 0.6;
          break;
        default:
          opType = null;
      }
      if (opType && chance(chanceToLog)) {
        operationData.push({
          id: randomUUID(),
          rollId: r.id,
          workOrderStepId: step.id,
          operationType: opType,
          operatorId: adminUser.id,
          createdAt: dateAfter(r.createdAt, 0, 14),
        });
      }
    }
  }
  // unique [rollId, stepId, operationType] — set'le dedup
  const opSeen = new Set<string>();
  const operationDedup = operationData.filter((o) => {
    const k = `${o.rollId}|${o.workOrderStepId}|${o.operationType}`;
    if (opSeen.has(k)) return false;
    opSeen.add(k);
    return true;
  });
  await chunkInsert(
    operationDedup,
    (c) => prisma.rollOperation.createMany({ data: c, skipDuplicates: true }),
    "Roll Operasyonu"
  );

  // ── 6) RollErrors ────────────────────────────────────────────────────────
  console.log("\n[6] Top hataları + allocation + reassign...");
  const errorData: Array<{
    id: string;
    rollId: string;
    startMeter: number;
    endMeter: number;
    defectTypeId: string;
    errorType: string;
    isProcessed: boolean;
    actionTaken: string | null;
    detectedAtStepId: string | null;
    detectedByUserId: string;
    detectedAt: Date;
    processedAtStepId: string | null;
    processedByUserId: string | null;
    processedAt: Date | null;
  }> = [];
  // Hata oranı ~%4
  const errorRolls = faker.helpers.arrayElements(
    rollData.filter((r) => r.status !== RollStatus.STOCK && r.journey !== "cut_child"),
    Math.min(TARGET.rollErrors, rollData.length)
  );
  for (const r of errorRolls) {
    const def = pickRandom(md.defects);
    const isProcessed = chance(0.85);
    const detectedAtStepId =
      r.journeySteps.find((s) => s.stationKind === StationKind.PROCESS_QC)?.id ?? null;
    const processedAtStepId =
      r.journeySteps.find((s) => s.stationKind === StationKind.TAMBUR)?.id ?? null;
    const startM = faker.number.int({ min: 0, max: Math.max(1, r.initialQty - 10) });
    errorData.push({
      id: randomUUID(),
      rollId: r.id,
      startMeter: startM,
      endMeter: startM + faker.number.int({ min: 1, max: 10 }),
      defectTypeId: def.id,
      errorType: def.name,
      isProcessed,
      actionTaken: isProcessed
        ? pickRandom(["CUT_FOR_SCRAP", "KEPT_AS_A1", "NO_ACTION"])
        : null,
      detectedAtStepId,
      detectedByUserId: adminUser.id,
      detectedAt: dateAfter(r.createdAt, 0, 7),
      processedAtStepId: isProcessed ? processedAtStepId : null,
      processedByUserId: isProcessed ? adminUser.id : null,
      processedAt: isProcessed ? dateAfter(r.createdAt, 7, 21) : null,
    });
  }
  await chunkInsert(
    errorData,
    (c) => prisma.rollError.createMany({ data: c, skipDuplicates: true }),
    "Roll Hatası"
  );

  // ── 7) OrderAllocation ───────────────────────────────────────────────────
  const linesByItem = new Map<string, typeof orderLineData>();
  for (const ol of orderLineData) {
    const arr = linesByItem.get(ol.itemId) ?? [];
    arr.push(ol);
    linesByItem.set(ol.itemId, arr);
  }
  const allocableRolls = rollData.filter(
    (r) =>
      r.status === RollStatus.WAREHOUSE ||
      r.status === RollStatus.READY_FOR_SHIP ||
      r.status === RollStatus.PRODUCED ||
      r.status === RollStatus.A1_STOCK ||
      r.status === RollStatus.SHIPPED
  );
  const allocData: Array<{
    id: string;
    rollId: string;
    orderLineId: string;
    allocatedQty: number;
    createdAt: Date;
  }> = [];
  for (const r of allocableRolls) {
    if (!chance(0.55)) continue;
    const lines = linesByItem.get(r.itemId);
    if (!lines || lines.length === 0) continue;
    const ol = pickRandom(lines);
    allocData.push({
      id: randomUUID(),
      rollId: r.id,
      orderLineId: ol.id,
      allocatedQty: Math.min(r.currentQty, ol.quantity),
      createdAt: dateAfter(r.createdAt, 1, 14),
    });
  }
  await chunkInsert(
    allocData,
    (c) => prisma.orderAllocation.createMany({ data: c, skipDuplicates: true }),
    "Allocation"
  );

  // Reproduction backlog: allocation_reassign yolculuğundaki rolelerin %30'una
  const backlogData: Array<{
    id: string;
    orderLineId: string;
    qtyDeficit: number;
    reason: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }> = [];
  for (const r of rollData.filter((x) => x.journey === "allocation_reassign")) {
    if (!chance(0.3)) continue;
    const lines = linesByItem.get(r.itemId);
    if (!lines || lines.length === 0) continue;
    const ol = pickRandom(lines);
    const isResolved = chance(0.6);
    backlogData.push({
      id: randomUUID(),
      orderLineId: ol.id,
      qtyDeficit: faker.number.int({ min: 50, max: 500 }),
      reason: `${PREFIX} reassign — acil sevk için ${faker.lorem.words(3)}`,
      createdAt: dateAfter(r.createdAt, 0, 5),
      resolvedAt: isResolved ? dateAfter(r.createdAt, 5, 30) : null,
    });
  }
  await chunkInsert(
    backlogData,
    (c) => prisma.reproductionBacklog.createMany({ data: c, skipDuplicates: true }),
    "Reproduction Backlog"
  );

  // ── 8) Shipments + Items + Manifests + PlannedOrders ─────────────────────
  console.log("\n[8] Sevkiyat + Manifest + Planlanan Siparişler...");
  const shipmentData = Array.from({ length: TARGET.shipments }, (_, i) => {
    const customerId = pickRandom(customerData).id;
    const branches = branchByCustomer.get(customerId) ?? [];
    const branchId = branches.length > 0 ? pickRandom(branches) : null;
    const status = pickWeighted<ShipmentStatus>([
      ["SHIPPED", 75],
      ["PREPARING", 18],
      ["CANCELLED", 7],
    ]);
    const baseDate = workdayDate();
    const shippedAt = status === "SHIPPED" ? baseDate : null;
    const plannedDate = status === "PREPARING" ? dateAfter(NOW, 0, 14) : null;
    return {
      id: randomUUID(),
      shipmentNumber: `${PREFIX}IRS-${String(i + 1).padStart(6, "0")}`,
      customerId,
      branchId,
      status,
      priority: status === "PREPARING" ? faker.number.int({ min: 0, max: 100 }) : 0,
      plannedDate,
      shippedAt,
      shippedById: status === "SHIPPED" ? adminUser.id : null,
      driverName: maybe(faker.person.fullName(), 0.7),
      plateNumber: maybe(
        `${faker.number.int({ min: 1, max: 81 })} ${faker.string.alpha({ length: 3, casing: "upper" })} ${faker.number.int({ min: 100, max: 999 })}`,
        0.75
      ),
      createdAt: baseDate,
      updatedAt: baseDate,
    };
  });
  await chunkInsert(
    shipmentData,
    (c) =>
      prisma.shipment.createMany({
        data: c,
        skipDuplicates: true,
      }),
    "Sevkiyat"
  );

  // ShipmentItem: SHIPPED rollelerden (rollId @unique)
  const shippedShipments = shipmentData.filter((s) => s.status === "SHIPPED");
  const eligibleRolls = rollData.filter(
    (r) => r.status === RollStatus.SHIPPED || r.status === RollStatus.READY_FOR_SHIP
  );
  const shipmentItemData: Array<{
    id: string;
    shipmentId: string;
    rollId: string;
    shippedQty: number;
    shippedWeight: number | null;
    rollBarcodeSnapshot: string;
    itemCodeSnapshot: string;
    createdAt: Date;
  }> = [];
  const usedRolls = new Set<string>();
  let rollCursor = 0;
  for (const sh of shippedShipments) {
    const itemCount = faker.number.int({ min: 5, max: 25 });
    for (let i = 0; i < itemCount; i++) {
      // round-robin yerine random + skip
      let attempt = 0;
      let roll = eligibleRolls[rollCursor % eligibleRolls.length];
      while (usedRolls.has(roll.id) && attempt < 10) {
        rollCursor++;
        roll = eligibleRolls[rollCursor % eligibleRolls.length];
        attempt++;
      }
      rollCursor++;
      if (usedRolls.has(roll.id)) continue;
      usedRolls.add(roll.id);
      shipmentItemData.push({
        id: randomUUID(),
        shipmentId: sh.id,
        rollId: roll.id,
        shippedQty: roll.currentQty,
        shippedWeight: roll.weightKg,
        rollBarcodeSnapshot: roll.barcode,
        itemCodeSnapshot: md.items.find((i) => i.id === roll.itemId)?.code ?? "",
        createdAt: sh.createdAt,
      });
    }
  }
  await chunkInsert(
    shipmentItemData,
    (c) => prisma.shipmentItem.createMany({ data: c, skipDuplicates: true }),
    "Sevkiyat kalemi"
  );

  // ShipmentPlannedOrder — sevkiyatların %60'ı için 1-3 sipariş bağı
  const plannedOrderData: Array<{
    id: string;
    shipmentId: string;
    orderId: string;
    sortOrder: number;
    addedByUserId: string;
  }> = [];
  for (const sh of shipmentData) {
    if (!chance(0.6)) continue;
    const ordersForCust = orderData.filter((o) => o.customerId === sh.customerId);
    if (ordersForCust.length === 0) continue;
    const count = pickWeighted([
      [1, 60],
      [2, 30],
      [3, 10],
    ]);
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      const o = pickRandom(ordersForCust);
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      plannedOrderData.push({
        id: randomUUID(),
        shipmentId: sh.id,
        orderId: o.id,
        sortOrder: i,
        addedByUserId: adminUser.id,
      });
    }
  }
  await chunkInsert(
    plannedOrderData,
    (c) => prisma.shipmentPlannedOrder.createMany({ data: c, skipDuplicates: true }),
    "Planlanan Sipariş"
  );

  // Manifest: shipped sevkiyatların %80'ine
  const manifestData: Array<{
    id: string;
    manifestNo: string;
    workOrderId: string;
    printedAt: Date;
    printedById: string;
    snapshot: object;
  }> = [];
  let manifestSeq = 1;
  for (const w of woData) {
    if (!chance(0.5)) continue;
    manifestData.push({
      id: randomUUID(),
      manifestNo: `${PREFIX}MAN-${String(manifestSeq++).padStart(6, "0")}`,
      workOrderId: w.id,
      printedAt: dateAfter(w.plannedStart, 1, 30),
      printedById: adminUser.id,
      snapshot: { workOrder: w.batchNumber, rollCount: faker.number.int({ min: 5, max: 50 }) },
    });
  }
  await chunkInsert(
    manifestData,
    (c) => prisma.manifest.createMany({ data: c, skipDuplicates: true }),
    "Manifest"
  );

  // ── 9) Subcontractor Dispatch + Receipt ──────────────────────────────────
  console.log("\n[9] Fason sevk + kabul...");
  const fasonSteps = stepData.filter((s) => s.stationKind === StationKind.SUBCONTRACTOR);
  const dispatchData: Array<{
    id: string;
    dispatchNo: string;
    workOrderId: string;
    stepId: string;
    subcontractorId: string;
    plannedSubcontractorId: string | null;
    plateNumber: string;
    driverName: string;
    dispatchedAt: Date;
    dispatchedById: string;
    totalQty: number;
    cancelledAt: Date | null;
    cancelledById: string | null;
    cancelReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  for (let i = 0; i < TARGET.subDispatches && i < fasonSteps.length; i++) {
    const step = fasonSteps[i];
    const subId = pickRandom(md.subs).id;
    const isCancelled = chance(0.05);
    const dispatchedAt = workdayDate();
    dispatchData.push({
      id: randomUUID(),
      dispatchNo: `${PREFIX}SD-${String(i + 1).padStart(6, "0")}`,
      workOrderId: step.workOrderId,
      stepId: step.id,
      subcontractorId: subId,
      plannedSubcontractorId: step.plannedSubcontractorId,
      plateNumber: `${faker.number.int({ min: 1, max: 81 })} ${faker.string.alpha({ length: 3, casing: "upper" })} ${faker.number.int({ min: 100, max: 999 })}`,
      driverName: faker.person.fullName(),
      dispatchedAt,
      dispatchedById: adminUser.id,
      totalQty: faker.number.int({ min: 200, max: 5000 }),
      cancelledAt: isCancelled ? dateAfter(dispatchedAt, 0, 2) : null,
      cancelledById: isCancelled ? adminUser.id : null,
      cancelReason: isCancelled ? "Fason firma reddi" : null,
      createdAt: dispatchedAt,
      updatedAt: dispatchedAt,
    });
  }
  await chunkInsert(
    dispatchData,
    (c) => prisma.subcontractorDispatch.createMany({ data: c, skipDuplicates: true }),
    "Fason Sevk"
  );

  // DispatchItem: fason yolculuğundaki rollelerden 3-10 tane
  const fasonRolls = rollData.filter(
    (r) =>
      r.status === RollStatus.AT_SUBCONTRACTOR ||
      r.status === RollStatus.RETURNED_FROM_SUBCONTRACTOR
  );
  const dispatchItemData: Array<{
    id: string;
    dispatchId: string;
    rollId: string;
    dispatchedQty: number;
    dispatchedWeight: number | null;
    createdAt: Date;
  }> = [];
  const usedFasonRolls = new Set<string>();
  let frCursor = 0;
  for (const d of dispatchData.filter((x) => x.cancelledAt === null)) {
    if (fasonRolls.length === 0) break;
    const itemCount = faker.number.int({ min: 3, max: 10 });
    for (let i = 0; i < itemCount; i++) {
      const r = fasonRolls[frCursor % fasonRolls.length];
      frCursor++;
      // unique olması şart değil; ama mantıken aynı rol bir kez sevk edilir
      const key = `${d.id}::${r.id}`;
      if (usedFasonRolls.has(key)) continue;
      usedFasonRolls.add(key);
      dispatchItemData.push({
        id: randomUUID(),
        dispatchId: d.id,
        rollId: r.id,
        dispatchedQty: r.initialQty,
        dispatchedWeight: r.weightKg,
        createdAt: d.dispatchedAt,
      });
    }
  }
  await chunkInsert(
    dispatchItemData,
    (c) => prisma.subcontractorDispatchItem.createMany({ data: c, skipDuplicates: true }),
    "Fason Sevk Kalemi"
  );

  // Receipt: dispatchlerin %85'i için (geri dönüş)
  const receiptData: Array<{
    id: string;
    receiptNo: string;
    workOrderId: string;
    stepId: string;
    subcontractorId: string;
    receivedAt: Date;
    receivedById: string;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  let receiptSeq = 1;
  for (const d of dispatchData) {
    if (d.cancelledAt) continue;
    if (!chance(0.85)) continue;
    const receivedAt = dateAfter(d.dispatchedAt, 3, 30);
    receiptData.push({
      id: randomUUID(),
      receiptNo: `${PREFIX}SR-${String(receiptSeq++).padStart(6, "0")}`,
      workOrderId: d.workOrderId,
      stepId: d.stepId,
      subcontractorId: d.subcontractorId,
      receivedAt,
      receivedById: adminUser.id,
      notes: chance(0.2) ? faker.lorem.sentence() : null,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    });
  }
  await chunkInsert(
    receiptData,
    (c) => prisma.subcontractorReceipt.createMany({ data: c, skipDuplicates: true }),
    "Fason Kabul"
  );

  // ReceiptItem: receipt başına 3-10 rol — RETURNED_FROM_SUBCONTRACTOR rollerini kullan
  const returnedRolls = rollData.filter(
    (r) => r.status === RollStatus.RETURNED_FROM_SUBCONTRACTOR
  );
  const receiptItemData: Array<{
    id: string;
    receiptId: string;
    newRollId: string;
    notes: string | null;
    createdAt: Date;
  }> = [];
  const usedReceiptRolls = new Set<string>();
  for (const rec of receiptData) {
    const itemCount = faker.number.int({ min: 3, max: 10 });
    for (let i = 0; i < itemCount; i++) {
      const r = pickRandom(returnedRolls);
      if (!r) break;
      if (usedReceiptRolls.has(r.id)) continue; // newRollId @unique
      usedReceiptRolls.add(r.id);
      receiptItemData.push({
        id: randomUUID(),
        receiptId: rec.id,
        newRollId: r.id,
        notes: null,
        createdAt: rec.receivedAt,
      });
    }
  }
  await chunkInsert(
    receiptItemData,
    (c) => prisma.subcontractorReceiptItem.createMany({ data: c, skipDuplicates: true }),
    "Fason Kabul Kalemi"
  );

  // ── 10) TravelerCard + Scan + PackagingQueue ─────────────────────────────
  console.log("\n[10] Refakat kartı + tarama + paketleme kuyruğu...");
  const cardData: Array<{
    id: string;
    cardNumber: string;
    barcode: string;
    workOrderId: string;
    version: number;
    status: TravelerCardStatus;
    printedAt: Date;
    printedById: string;
    voidedAt: Date | null;
    voidReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  const cardWOs = faker.helpers.arrayElements(woData, Math.min(TARGET.travelerCards, woData.length));
  for (let i = 0; i < cardWOs.length; i++) {
    const w = cardWOs[i];
    const status: TravelerCardStatus =
      w.status === "COMPLETED"
        ? "COMPLETED"
        : pickWeighted<TravelerCardStatus>([
            ["ACTIVE", 70],
            ["REPRINTED", 15],
            ["VOIDED", 5],
            ["COMPLETED", 10],
          ]);
    const printedAt = dateAfter(w.plannedStart, 0, 2);
    const seq = String(i + 1).padStart(7, "0");
    cardData.push({
      id: randomUUID(),
      cardNumber: `${PREFIX}RFK-${seq}`,
      barcode: `${PREFIX}RFKB-${seq}-C`,
      workOrderId: w.id,
      version: status === "REPRINTED" ? 2 : 1,
      status,
      printedAt,
      printedById: adminUser.id,
      voidedAt: status === "VOIDED" ? dateAfter(printedAt, 0, 7) : null,
      voidReason: status === "VOIDED" ? "Kayıp / Hasar" : null,
      createdAt: printedAt,
      updatedAt: printedAt,
    });
  }
  await chunkInsert(
    cardData,
    (c) => prisma.travelerCard.createMany({ data: c, skipDuplicates: true }),
    "Refakat Kartı"
  );

  // Scans: her active/completed kart için step başına ARRIVAL+DEPARTURE
  const scanData: Array<{
    id: string;
    cardId: string;
    stationId: string;
    workOrderStepId: string | null;
    scanType: ScanType;
    scannedAt: Date;
    scannedById: string;
  }> = [];
  for (const card of cardData) {
    if (card.status === "VOIDED") continue;
    const woSteps = stepsByWO.get(card.workOrderId) ?? [];
    let cursor = card.printedAt;
    for (const step of woSteps) {
      // %85 ihtimal scan kaydı var
      if (!chance(0.85)) continue;
      const arrival = new Date(cursor);
      arrival.setHours(arrival.getHours() + faker.number.int({ min: 1, max: 12 }));
      scanData.push({
        id: randomUUID(),
        cardId: card.id,
        stationId: step.stationId,
        workOrderStepId: step.id,
        scanType: ScanType.ARRIVAL,
        scannedAt: arrival,
        scannedById: adminUser.id,
      });
      const departure = new Date(arrival.getTime() + faker.number.int({ min: 60, max: 600 }) * 60 * 1000);
      if (departure < NOW) {
        scanData.push({
          id: randomUUID(),
          cardId: card.id,
          stationId: step.stationId,
          workOrderStepId: step.id,
          scanType: ScanType.DEPARTURE,
          scannedAt: departure,
          scannedById: adminUser.id,
        });
        cursor = departure;
      } else {
        cursor = arrival;
      }
    }
  }
  await chunkInsert(
    scanData,
    (c) => prisma.travelerCardScan.createMany({ data: c, skipDuplicates: true }),
    "Kart Tarama"
  );

  // PackagingQueue (canlı kuyruk — geçmiş tarihçe yok)
  const approvedOrders = orderData
    .filter((o) => o.status === "APPROVED")
    .slice(0, TARGET.packagingQueueLive);
  const queueData = approvedOrders.map((o, i) => ({
    id: randomUUID(),
    orderId: o.id,
    priority: i,
    isUrgent: o.isUrgent,
    urgentMarkedAt: o.isUrgent ? recentDate(7) : null,
    addedByUserId: adminUser.id,
    note: o.isUrgent ? "Acil — termin yakın" : null,
    status: PackagingQueueStatus.WAITING,
  }));
  await chunkInsert(
    queueData,
    (c) => prisma.packagingQueue.createMany({ data: c, skipDuplicates: true }),
    "Paketleme Kuyruğu"
  );

  // ── 11) MachineLog + SystemLog (en yüksek hacim) ─────────────────────────
  console.log("\n[11] MachineLog + SystemLog (yüksek hacim, sabırla)...");
  // MachineLog: 2 yıl boyunca dağılmış
  const machineLogData = Array.from({ length: TARGET.machineLogs }, () => {
    const m = pickRandom(md.machines);
    const logType = pickWeighted([
      ["STATUS_UPDATE", 85],
      ["MAINTENANCE", 10],
      ["ALARM", 5],
    ]);
    const createdAt = workdayDate();
    return {
      id: randomUUID(),
      machineId: m.id,
      logType,
      details: {
        speed: faker.number.int({ min: 200, max: 800 }),
        temperature: faker.number.float({ min: 20, max: 80, fractionDigits: 1 }),
        workingItem: `LINE_${faker.number.int({ min: 1, max: 10 })}`,
      },
      createdAt,
      updatedAt: createdAt,
    };
  });
  await chunkInsert(
    machineLogData,
    (c) => prisma.machineLog.createMany({ data: c, skipDuplicates: true }),
    "Makine Logu"
  );

  // SystemLog: her CUD bir kayıt. recordId="LOAD::*" pattern'i ile dolduralım.
  // %30'u 6 aydan eski (arşiv testi için)
  const systemLogData: Array<{
    id: string;
    userId: string;
    action: string;
    tableName: string;
    recordId: string;
    newData: object;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  const tableNames = [
    "ORDER",
    "WORK_ORDER",
    "ROLL",
    "SHIPMENT",
    "ROLL_MOVEMENT",
    "ROLL_OPERATION",
    "ALLOCATION",
    "TRAVELER_CARD",
    "SUBCONTRACTOR_DISPATCH",
    "PACKAGING_QUEUE",
    "USER_PERMISSION",
    "CUSTOMER",
    "ITEM",
    "STATION",
    "SACK",
  ];
  const actions = ["CREATE", "UPDATE", "DELETE"];
  for (let i = 0; i < TARGET.systemLogs; i++) {
    const isOld = chance(0.3);
    const createdAt = isOld
      ? new Date(
          TWO_YEARS_AGO.getTime() +
            Math.random() * (SIX_MONTHS_AGO.getTime() - TWO_YEARS_AGO.getTime())
        )
      : new Date(SIX_MONTHS_AGO.getTime() + Math.random() * (NOW.getTime() - SIX_MONTHS_AGO.getTime()));
    systemLogData.push({
      id: randomUUID(),
      userId: adminUser.id,
      action: pickWeighted([
        ["CREATE", 50],
        ["UPDATE", 45],
        ["DELETE", 5],
      ]),
      tableName: pickRandom(tableNames),
      recordId: `LOAD::${randomUUID()}`,
      newData: { fakeField: faker.lorem.word(), value: faker.number.int({ min: 1, max: 1000 }) },
      createdAt,
      updatedAt: createdAt,
    });
  }
  await chunkInsert(
    systemLogData,
    (c) => prisma.systemLog.createMany({ data: c, skipDuplicates: true }),
    "Sistem Logu"
  );

  // ── ÖZET ──────────────────────────────────────────────────────────────────
  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("─".repeat(70));
  console.log(`✅ Tamam — toplam süre ${totalSec}s`);
  console.log("─".repeat(70));

  const summary = await Promise.all([
    prisma.customer.count(),
    prisma.customerBranch.count(),
    prisma.order.count(),
    prisma.orderLine.count(),
    prisma.workOrder.count(),
    prisma.workOrderStep.count(),
    prisma.workOrderToOrderLine.count(),
    prisma.roll.count(),
    prisma.rollMovement.count(),
    prisma.rollOperation.count(),
    prisma.rollError.count(),
    prisma.orderAllocation.count(),
    prisma.reproductionBacklog.count(),
    prisma.sack.count(),
    prisma.shipment.count(),
    prisma.shipmentItem.count(),
    prisma.shipmentPlannedOrder.count(),
    prisma.manifest.count(),
    prisma.subcontractorDispatch.count(),
    prisma.subcontractorDispatchItem.count(),
    prisma.subcontractorReceipt.count(),
    prisma.subcontractorReceiptItem.count(),
    prisma.travelerCard.count(),
    prisma.travelerCardScan.count(),
    prisma.packagingQueue.count(),
    prisma.machineLog.count(),
    prisma.systemLog.count(),
  ]);
  console.log("Toplam DB kaydı (PERF + LOAD birleşik):");
  const labels = [
    "Customers",
    "Customer Branches",
    "Orders",
    "Order Lines",
    "Work Orders",
    "WO Steps",
    "WO ↔ Order Line",
    "Rolls",
    "Roll Movements",
    "Roll Operations",
    "Roll Errors",
    "Order Allocations",
    "Reproduction Backlog",
    "Sacks",
    "Shipments",
    "Shipment Items",
    "Shipment Planned Orders",
    "Manifests",
    "Subcontractor Dispatches",
    "Subcontractor Dispatch Items",
    "Subcontractor Receipts",
    "Subcontractor Receipt Items",
    "Traveler Cards",
    "Traveler Card Scans",
    "Packaging Queue",
    "Machine Logs",
    "System Logs",
  ];
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(28)} ${summary[i].toLocaleString("tr-TR")}`);
  }
  const grandTotal = summary.reduce((s, n) => s + n, 0);
  console.log(`  ${"TOPLAM".padEnd(28)} ${grandTotal.toLocaleString("tr-TR")}`);
}

main()
  .catch((err) => {
    console.error("\n❌ HATA:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
