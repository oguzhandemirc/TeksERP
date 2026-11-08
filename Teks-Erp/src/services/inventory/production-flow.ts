// =============================================================================
// Inventory Service / production-flow
// =============================================================================
// Üretim akışı panosu (getProductionFlow) ve giriş kullanıcı/istasyon süzgeç listeleri.
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
  Roll,
  RollStatus,
  RollEntrySource,
  StationKind,
  StepStatus,
  ShipmentStatus,
} from "@prisma/client";
import {
  STEP_FLOW_WHERE,
} from "../helpers/quality-station.helper";
import { ROLL_LIST_INCLUDE } from "./shared";

// KANBAN KARTI'nın ilişki kümesi — LİSTE'nin (ROLL_LIST_INCLUDE) DAR alt kümesi.
//
// NEDEN AYRI: Üretim Akışı kartı ekranda 5 alan basar (kumaş adı · renk+hex ·
// barkod · metraj · kalite) ama kolon başına ROLL_LIST_INCLUDE'un 11 ilişkisini
// çekiyordu. ÖLÇÜLDÜ (2026-09-05, tekserp_demo): tek istek 115 sorgu / 13-20 ms;
// bu dar küme ile 66 sorgu (−43%). Kazanç BAYT değil ROUND-TRIP'tir — satır
// boyutu (rolls ort. 218 B) ihmal edilebilir, bedel ilişki SAYISI.
//
// NEDEN `select` DEĞİL `include`: skaler kümesi liste ile BİREBİR kalmalı.
// Detay paneli (RollDetailSheet) kart tıklanınca `detail ?? roll` fallback'iyle
// çizilir; skalerlerin biri eksik olsa panel açılışında boş hücre çıkardı. Ayrıca
// `select` yazılsaydı Roll'a eklenen yeni bir skaler karta SESSİZCE ulaşmaz,
// liste ile kart ayrışırdı ("ayrışan yüzey" sınıfı). Kart SAYI üreten hiçbir
// türetilmiş alanı taşımaz: metraj/kalite topun kendi skaleri, kolon toplamı
// `count()` ile AYNI `where`den doğar → kart ile liste ayrışamaz.
//
// ALT SELECT'LER PAYLAŞILIR (kopya değil ROLL_LIST_INCLUDE referansı): kartla
// liste aynı `item`/`color`/… şeklini döndürsün, biri değişince ikisi değişsin.
//
// DIŞARIDA BIRAKILANLAR ve gerekçesi (hepsi detay panelinde `detail?.` ile
// okunur, liste satırından DEĞİL → görünen davranış değişmez):
//   operations · createdBy · createdMachine · entryStation · warehouse · ownerCustomer (P1a "Sahibi" sütunu)
// `currentStep` id'ye daraltıldı: panelin "Bulunduğu İstasyon" satırı `detail`den
// gelir, ama panel `canAdjustRollQty` kararını `roll.currentStep == null` ile
// verir — ilişkiyi tümden atmak `undefined == null` üzerinden butonu YANLIŞ
// açardı (yetki yüzeyi). id'li hâli kararı doğru tutar, station+workOrder
// turlarını (kolon başına 2 sorgu) düşürür.
const ROLL_CARD_INCLUDE = {
  item: ROLL_LIST_INCLUDE.item,
  color: ROLL_LIST_INCLUDE.color,
  // Panel fallback'i `r.properties`i doğrudan liste satırından çizer.
  properties: ROLL_LIST_INCLUDE.properties,
  // Panel fallback'i `roll.shipment`/`roll.sack`ı çizer (Sevkiyat Rezervasyonu kartı).
  shipment: ROLL_LIST_INCLUDE.shipment,
  sack: ROLL_LIST_INCLUDE.sack,
  currentStep: { select: { id: true } },
} satisfies Prisma.RollInclude;

// FASON kolonu — kartın tek FARKI: panelin "Fason bilgisi" kartı `r.status ===
// "AT_SUBCONTRACTOR"` iken `roll.dispatchItems` fallback'ini çizer. Bu koşul
// YALNIZ fason kolonunda doğru olabilir (diğer üç kolon STOCK/WAREHOUSE süzer),
// bu yüzden 7 sorgu tutan `dispatchItems` zinciri yalnız burada taşınır.
const ROLL_CARD_INCLUDE_FASON = {
  ...ROLL_CARD_INCLUDE,
  dispatchItems: ROLL_LIST_INCLUDE.dispatchItems,
} satisfies Prisma.RollInclude;

// --- Üretim Akışı (Kanban) panosu — tek-istek aggregate şekli --------------
/** Kurşun/Tambur kolonları için parti (refakat kartı) kartı. */
export interface ProductionFlowQueueCard {
  id: string;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  totalCurrentQty: number;
  workOrderNumber: string;
  isUrgent: boolean;
}

/** Sevk kolonu kartı — çıkış bekleyen (PLANNED) planlı sevk. */
export interface ProductionFlowSackCard {
  id: string;
  shipmentNo: string;
  customer: { id: string; name: string };
  branch: { id: string; name: string } | null;
  sackCount: number;
  totalKg: number;
  totalQty: number;
}

/** Her kolon: en fazla 10 önizleme kaydı + gerçek toplam sayaç. */
export interface ProductionFlowData {
  hamStok: { rolls: Roll[]; total: number };
  /** Dışarıdan alınan yarı mamul — ham stokla AYNI raftadır ama farklı stok
   *  türüdür ve akışa Kurşun'dan girer (boyahaneyi atlar). */
  yariMamul: { rolls: Roll[]; total: number };
  fason: { rolls: Roll[]; total: number };
  kursun: { cards: ProductionFlowQueueCard[]; total: number };
  tambur: { cards: ProductionFlowQueueCard[]; total: number };
  depo: { rolls: Roll[]; total: number };
  sevk: { shipments: ProductionFlowSackCard[]; total: number };
}

export async function getProductionFlow(opts: {
    includeQueues: boolean;
    includeSevk: boolean;
  }): Promise<ApiResponse<ProductionFlowData>> {
    const PREVIEW = 10;

    // ÖLÇÜM 2026-09-05: kolon include'u ROLL_LIST_INCLUDE iken uç 115 sorgu
    // atıyordu; ROLL_CARD_INCLUDE ile 66 (kolon başına 24 → 9, fason 16).
    const rollColumn = async (
      status: RollStatus,
      extra: Prisma.RollWhereInput = {},
      include: Prisma.RollInclude = ROLL_CARD_INCLUDE,
    ) => {
      const where: Prisma.RollWhereInput = { status, ...extra };
      const [rolls, total] = await Promise.all([
        prisma.roll.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: PREVIEW,
          include,
        }),
        prisma.roll.count({ where }),
      ]);
      return { rolls, total };
    };

    const kursunColumn = async (): Promise<{ cards: ProductionFlowQueueCard[]; total: number }> => {
      if (!opts.includeQueues) return { cards: [], total: 0 };
      const where: Prisma.WorkOrderStepWhereInput = {
        // ⚠️ Kolon ADI "Kurşun" KALIR. Faz A'da küme birebir aynı (backfill
        // yalnız PROCESS_QC'yi işaretler); ikinci bir KK istasyonu doğarsa
        // kolonun ölçtüğü şey ile adı ayrışır — etiket kararı Faz B'de.
        station: { ...STEP_FLOW_WHERE },
        status: { not: StepStatus.COMPLETED },
        currentRolls: { some: {} },
      };
      const [steps, total] = await Promise.all([
        prisma.workOrderStep.findMany({
          where,
          // kursun-qc.listQueue ile aynı öncelik sırası (en kritik önce).
          orderBy: [
            { isUrgent: "desc" },
            { urgentMarkedAt: { sort: "asc", nulls: "last" } },
            { priority: "asc" },
            { startedAt: { sort: "asc", nulls: "last" } },
          ],
          take: PREVIEW,
          select: {
            id: true,
            isUrgent: true,
            workOrder: {
              select: {
                // DİKKAT: WO'da alan adı workOrderNumber (İE…) — eski batchNumber
                // select'i parti-redesign sonrası Prisma validation hatasıyla tüm
                // production-flow'u 500'e düşürüyordu (2026-07-15 düzeltildi).
                workOrderNumber: true,
                targetItem: { select: { name: true } },
                targetColor: { select: { name: true, hex: true } },
              },
            },
            movements: {
              where: { ...ACTIVE_MOVEMENT, exitedAt: null },
              select: { roll: { select: { currentQty: true } } },
            },
          },
        }),
        prisma.workOrderStep.count({ where }),
      ]);
      const cards = steps.map((s) => ({
        id: s.id,
        itemName: s.workOrder.targetItem?.name ?? null,
        colorName: s.workOrder.targetColor?.name ?? null,
        colorHex: s.workOrder.targetColor?.hex ?? null,
        openRollCount: s.movements.length,
        totalCurrentQty: s.movements
          .reduce((sum, m) => sum.plus(m.roll.currentQty), new Prisma.Decimal(0))
          .toNumber(),
        workOrderNumber: s.workOrder.workOrderNumber,
        isUrgent: s.isUrgent,
      }));
      return { cards, total };
    };

    const tamburColumn = async (): Promise<{ cards: ProductionFlowQueueCard[]; total: number }> => {
      if (!opts.includeQueues) return { cards: [], total: 0 };
      const where: Prisma.WorkOrderStepWhereInput = {
        station: { kind: StationKind.TAMBUR },
        status: { not: StepStatus.COMPLETED },
        currentRolls: { some: {} },
      };
      const [steps, total] = await Promise.all([
        prisma.workOrderStep.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: PREVIEW,
          select: {
            id: true,
            workOrder: {
              select: {
                workOrderNumber: true,
                targetItem: { select: { name: true } },
                targetColor: { select: { name: true, hex: true } },
              },
            },
            currentRolls: { select: { currentQty: true } },
          },
        }),
        prisma.workOrderStep.count({ where }),
      ]);
      const cards = steps.map((s) => ({
        id: s.id,
        itemName: s.workOrder.targetItem?.name ?? null,
        colorName: s.workOrder.targetColor?.name ?? null,
        colorHex: s.workOrder.targetColor?.hex ?? null,
        openRollCount: s.currentRolls.length,
        totalCurrentQty: s.currentRolls
          .reduce((sum, r) => sum.plus(r.currentQty), new Prisma.Decimal(0))
          .toNumber(),
        workOrderNumber: s.workOrder.workOrderNumber,
        isUrgent: false,
      }));
      return { cards, total };
    };

    const sevkColumn = async (): Promise<{ shipments: ProductionFlowSackCard[]; total: number }> => {
      if (!opts.includeSevk) return { shipments: [], total: 0 };
      const where: Prisma.ShipmentWhereInput = { status: ShipmentStatus.PLANNED };
      const [rows, total] = await Promise.all([
        prisma.shipment.findMany({
          where,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: PREVIEW,
          select: {
            id: true,
            shipmentNo: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        }),
        prisma.shipment.count({ where }),
      ]);
      const ids = rows.map((s) => s.id);
      const [sackAgg, rollAgg] = ids.length
        ? await Promise.all([
            prisma.sack.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _count: { _all: true }, _sum: { weightKg: true } }),
            prisma.roll.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _sum: { currentQty: true } }),
          ])
        : [[], []];
      const kgByShip = new Map(sackAgg.map((g) => [g.shipmentId, { count: g._count._all, kg: Number(g._sum.weightKg ?? 0) }]));
      const qtyByShip = new Map(rollAgg.map((g) => [g.shipmentId, Number(g._sum.currentQty ?? 0)]));
      const shipments = rows.map((s) => {
        const sk = kgByShip.get(s.id);
        return {
          id: s.id,
          shipmentNo: s.shipmentNo,
          customer: s.customer,
          branch: s.branch,
          sackCount: sk?.count ?? 0,
          totalKg: sk?.kg ?? 0,
          totalQty: qtyByShip.get(s.id) ?? 0,
        };
      });
      return { shipments, total };
    };

    // ⚠️ HAM STOK KOLONU İKİ KEZ DÜZELTİLDİ (2026-08-27):
    //
    // ① `currentStepId: null` EKLENDİ. Kolon eskiden düz `{ status: STOCK }`
    //    sorguyordu, yani bir adıma bağlı STOCK topu da sayıyordu — Envanter
    //    sekmesi (`rollScope=RAW_STOCK*`) saymıyor. İki yüzey aynı adı taşıyıp
    //    farklı rakam basıyordu ve bu YARI MAMULDEN BAĞIMSIZ, eski bir sapmaydı.
    //    (Bugün prod'da fark 0 — 283 STOCK topun hepsi adımsız — ama koşul
    //    olmadan eşitlik bir invariant değil, tesadüftü.)
    //
    // ② Yarı mamul AYRI KOLONA çıktı. Akış panosunda ikisi yan yana durur ama
    //    aynı kova değildir: yarı mamul boyahaneyi ATLAR, akışa Kurşun'dan
    //    girer. Tek kovada toplamak "ham kumaşım ne kadar" sorusuna yanlış
    //    cevap veriyordu.
    //
    // Kapsam tanımları Envanter sekmeleriyle BİREBİR (`inventory.service`
    // `rollScope` zinciri) — ayrışırlarsa aynı soruya iki rakam doğar.
    const RAW_ON_SHELF: Prisma.RollWhereInput = { currentStepId: null };
    const [hamStok, yariMamul, fason, depo, kursun, tambur, sevk] = await Promise.all([
      rollColumn(RollStatus.STOCK, {
        ...RAW_ON_SHELF,
        entrySource: { not: RollEntrySource.SEMI_FINISHED },
      }),
      rollColumn(RollStatus.STOCK, {
        ...RAW_ON_SHELF,
        entrySource: RollEntrySource.SEMI_FINISHED,
      }),
      rollColumn(RollStatus.AT_SUBCONTRACTOR, {}, ROLL_CARD_INCLUDE_FASON),
      rollColumn(RollStatus.WAREHOUSE),
      kursunColumn(),
      tamburColumn(),
      sevkColumn(),
    ]);

    return { success: true, data: { hamStok, yariMamul, fason, kursun, tambur, depo, sevk } };
  }

export async function listEntryUsers(): Promise<ApiResponse<{ id: string; name: string; code: string | null }[]>> {
    const groups = await prisma.roll.groupBy({
      by: ["createdById"],
      where: { createdById: { not: null } },
    });
    const ids = groups.map((g) => g.createdById).filter((v): v is string => !!v);
    if (ids.length === 0) return { success: true, data: [] };
    const users = await prisma.user.findMany({
      // ⚠️ Bu dropdown `username`i `code` ALT ETİKETİ olarak GÖRÜNÜR basıyor
      // (aşağıda) — takma adın tek başına yetmediği yüzeylerden biri. Süzgeç şart.
      where: { id: { in: ids } },
      select: { id: true, username: true, fullName: true },
      orderBy: { fullName: "asc" },
    });
    return {
      success: true,
      // FilterBar/PickerModal sözleşmesi: {id, name} (+ code alt etiketi).
      data: users.map((u) => ({ id: u.id, name: u.fullName ?? u.username, code: u.username })),
    };
  }

export async function listEntryStations(): Promise<ApiResponse<{ id: string; name: string; code: string | null }[]>> {
    const groups = await prisma.roll.groupBy({
      by: ["entryStationId"],
      where: { entryStationId: { not: null } },
    });
    const ids = groups.map((g) => g.entryStationId).filter((v): v is string => !!v);
    if (ids.length === 0) return { success: true, data: [] };
    const stations = await prisma.station.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });
    return { success: true, data: stations.map((st) => ({ id: st.id, name: st.name, code: st.code })) };
  }
