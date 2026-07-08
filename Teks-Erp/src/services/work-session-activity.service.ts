// =============================================================================
// TeksERP - Work Session Activity (İşlem Dökümü) Service
// =============================================================================
// Bir çalışma oturumunun penceresinde (startedAt..endedAt ?? now) yapılan üretim
// izlerini MIGRATION'SIZ raporlar. Yüksek hacimli tablolarda deviceId/sessionId
// kolonu YOKTUR ve EKLENMEZ — cihaz/kullanıcı bağı WorkSession ayak izinden kurulur:
//   - MACHINE atfı: kayıt oturumun makinesine damgalı. Bir makinede tek aktif
//     oturum (partial unique) olduğundan pencere içinde KESİN kanıttır.
//   - OPERATOR_WINDOW atfı: kayıt machineId'siz ama operatör = oturum kullanıcısı
//     ve zaman penceresi içinde. Kesin cihaz kanıtı DEĞİL (aynı kullanıcı eşzamanlı
//     masaüstünden de işlem yapmış olabilir) — UI rozetle işaretler.
//
// ALTI olay kaynağı, KRONOLOJİK (artan) sırada birleştirilir:
//   0. Roll               (createdAt)  — KK1 KUMAŞ GİRİŞİ (top oluşturma). KK1 girişi
//      RollOperation/RollMovement ÜRETMEZ; atıf Roll.createdMachineId/createdById'de
//      kapanır → bu kaynak olmadan KK1 dökümü BOŞ görünürdü.
//   1. RollMovement GİRİŞ  (enteredAt)  — istasyona giriş
//   2. RollError           (detectedAt) — hata girişi (kaçıncı metre, hangi tür)
//   3. RollOperation       (createdAt)  — Kurşun / KK2 / Tambur / fason
//   4. RollMovement ÇIKIŞ  (exitedAt)   — istasyondan çıkış
//   5. SystemLog           (createdAt)  — TOP İPTALİ/SİLME. İptal fiziksel silme DEĞİL
//      (status→CANCELLED, satır kalır) ama "silme olayı"nı zaman çizelgesinde ayrı
//      göstermek için audit satırından (kim+ne zaman) okunur — tekil kayıt-aksiyonu
//      için audit doğru kaynak (makine yok → OPERATOR_WINDOW).
//
// SIRA GARANTİSİ: Kurşun+KK2 (ve açık-kumaş akışında hata+kurşun+KK2) AYNI
// transaction'da yazıldığından createdAt/detectedAt BİREBİR AYNIDIR (Postgres
// CURRENT_TIMESTAMP tx boyunca sabit). Bu yüzden zaman eşitken olaylar FAZ-RANK ile
// mantıksal sıraya sokulur (giriş < hata < kurşun < KK2 < ... < çıkış); yoksa sıra
// rastgele UUID'ye kalır ve "önce KK2 bitti sonra kurşunlandı" gibi imkânsız görünür.
//
// Movement İKİ olaydır: operatorId GİRİŞTE yazılır (machineId girişte YAZILMAZ),
// machineId işin yapıldığı makine olarak ÇIKIŞTA damgalanır. MOVE_IN yalnız operatör
// dalıyla, MOVE_OUT her iki dalla eşleşir. BİLİNEN SINIR: operatorId kapanışta
// güncellenmez; machineId'siz kapanan MOVE_OUT (iptal/redye/masaüstü) girişi yapanın
// penceresine düşer — çıkışı gerçekte kim yaptı migration'sız bilinemez (UI tooltip).
//
// PAGINATION: Döküm TEK bir oturumun penceresine kapalı (bir operatör, bir vardiya)
// → doğası gereği sınırlı. Cursor yerine sınır-korumalı tek çekiş: kaynak başına
// MAX+1 satır, birleşik MAX'ı aşarsa `truncated=true` ile dürüstçe işaretlenir.
// =============================================================================

import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { SESSION_INCLUDE } from "./work-session.service";
import type { Prisma } from "@prisma/client";

export type ActivityEventKind =
  | "ROLL_CREATED"
  | "MOVE_IN"
  | "ERROR"
  | "OPERATION"
  | "MOVE_OUT"
  | "ROLL_CANCELLED";
export type ActivityAttribution = "MACHINE" | "OPERATOR_WINDOW";

/** Olay satırındaki top — barkod + kumaş(ürün)/renk adı. */
export interface ActivityRoll {
  id: string;
  barcode: string | null;
  itemName: string | null;
  colorName: string | null;
}

export interface SessionActivityEvent {
  kind: ActivityEventKind;
  id: string;
  at: Date;
  attribution: ActivityAttribution;
  roll: ActivityRoll;
  station: { id: string; name: string; kind: string };
  operator: { id: string; username: string; fullName: string } | null;
  machine: { id: string; code: string; name: string } | null;
  operationType?: string;
  metadata?: unknown;
  qty?: number | null;
  weight?: number | null;
  notes?: string | null;
  /** ERROR: hatanın tespit edildiği metre noktası (RollError.startMeter). */
  errorMeter?: number | null;
  /** ERROR: hata türü etiketi (RollError.errorType snapshot ?? DefectType.name). */
  errorType?: string | null;
  /** ROLL_CREATED: topun sisteme giriş kaynağı (SUPPLIER_RECEIPT=KK1 kumaş girişi vb.). */
  entrySource?: string;
  /** MOVE_OUT: topun istasyona girişi (enteredAt) — çıkış satırında da gösterilir. */
  enteredAt?: Date | null;
  /** MOVE_OUT: istasyonda kaldığı süre (dk) = exitedAt − enteredAt. */
  stayMinutes?: number | null;
}

export interface SessionActivitySummary {
  rollCreatedCount: number;
  operationCount: number;
  moveInCount: number;
  moveOutCount: number;
  errorCount: number;
  rollCancelledCount: number;
}

/** Oturum penceresi başına en fazla olay — aşılırsa truncated. Oturum sınırlı olduğundan
 *  cömert; gerçek vardiyalar bunu nadiren aşar. */
const MAX_ACTIVITY_EVENTS = 1000;

// Kronolojik toplam sıra tie-break'i: aynı `at` (aynı transaction) içinde olayları
// istasyon-ziyareti mantığına göre dizer. RollOperationType enum sırasını izler
// (KURSUN_APPLIED < QC2_COMPLETED < TAMBUR_PROCESSED < ...).
const OP_RANK: Record<string, number> = {
  KURSUN_APPLIED: 3,
  QC2_COMPLETED: 4,
  TAMBUR_PROCESSED: 5,
  SUBCONTRACTOR_SENT: 6,
  SUBCONTRACTOR_RETURNED: 7,
};

function phaseRank(e: SessionActivityEvent): number {
  if (e.kind === "ROLL_CREATED") return 0; // top oluşturma (KK1) — genesis, en başta
  if (e.kind === "MOVE_IN") return 1;
  if (e.kind === "ERROR") return 2;
  if (e.kind === "MOVE_OUT") return 9;
  if (e.kind === "ROLL_CANCELLED") return 10; // terminal admin aksiyonu — en son
  return OP_RANK[e.operationType ?? ""] ?? 8; // OPERATION (bilinmeyen tür ortada)
}

/** Kronolojik artan: at asc → phaseRank asc → id asc (deterministik). */
function cmpAsc(a: SessionActivityEvent, b: SessionActivityEvent): number {
  const t = a.at.getTime() - b.at.getTime();
  if (t !== 0) return t;
  const pr = phaseRank(a) - phaseRank(b);
  if (pr !== 0) return pr;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Top adı için ürün + renk join'i (döküm satırında barkodun yanında kumaş adı).
const ROLL_FIELDS = {
  id: true,
  barcode: true,
  item: { select: { name: true } },
  color: { select: { name: true } },
} as const;
const ROLL_SELECT = { select: ROLL_FIELDS } as const;
const STATION_SELECT = {
  select: { station: { select: { id: true, name: true, kind: true } } },
} as const;
const OPERATOR_SELECT = { select: { id: true, username: true, fullName: true } } as const;
const MACHINE_SELECT = { select: { id: true, code: true, name: true } } as const;

interface RawRoll {
  id: string;
  barcode: string | null;
  item: { name: string } | null;
  color: { name: string } | null;
}
const mapRoll = (r: RawRoll): ActivityRoll => ({
  id: r.id,
  barcode: r.barcode,
  itemName: r.item?.name ?? null,
  colorName: r.color?.name ?? null,
});

const toNum = (v: Prisma.Decimal | null | undefined): number | null =>
  v == null ? null : Number(v);

export class WorkSessionActivityService {
  /**
   * Oturum penceresindeki işlem dökümü — kronolojik, altı kaynaklı, sınır-korumalı.
   */
  static async list(sessionId: string): Promise<{
    success: true;
    data: {
      session: unknown;
      summary: SessionActivitySummary;
      events: SessionActivityEvent[];
    };
    truncated: boolean;
    max: number;
  }> {
    const session = await prisma.workSession.findUnique({
      where: { id: sessionId },
      include: SESSION_INCLUDE,
    });
    if (!session) throw AppError.notFound("Çalışma oturumu bulunamadı");

    // Canlı oturumda pencere sonu = istek anı. Salt-okuma uç — idle sweep ÇAĞRILMAZ.
    const windowEnd = session.endedAt ?? new Date();
    const windowStart = session.startedAt;
    const window = { gte: windowStart, lte: windowEnd };
    const take = MAX_ACTIVITY_EVENTS + 1;

    // Makineli oturumda: makine damgası (kesin) VEYA damgasız+operatör (fallback).
    // Makinesiz (SHIPPING) oturumda yalnız fallback dalı mümkündür.
    const opAttribution: Prisma.RollOperationWhereInput & Prisma.RollMovementWhereInput =
      session.machineId
        ? {
            OR: [
              { machineId: session.machineId },
              { machineId: null, operatorId: session.userId },
            ],
          }
        : { machineId: null, operatorId: session.userId };

    // Roll oluşturma atfı — makine/kullanıcı alanları createdMachineId/createdById.
    const rollAttribution: Prisma.RollWhereInput = session.machineId
      ? {
          OR: [
            { createdMachineId: session.machineId },
            { createdMachineId: null, createdById: session.userId },
          ],
        }
      : { createdMachineId: null, createdById: session.userId };

    const [rolls, ops, moveIns, moveOuts, errors, cancelLogs] = await Promise.all([
      // KK1 kumaş girişi (top oluşturma) — [createdMachineId]/[createdById] index'li.
      prisma.roll.findMany({
        where: { AND: [{ createdAt: window }, rollAttribution] },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take,
        select: {
          ...ROLL_FIELDS,
          createdAt: true,
          initialQty: true,
          entrySource: true,
          createdMachineId: true,
          createdBy: OPERATOR_SELECT,
          createdMachine: MACHINE_SELECT,
        },
      }),
      prisma.rollOperation.findMany({
        where: {
          AND: [
            { createdAt: window },
            // Tambur bölünmesinin parent'tan kopyalanan satırları — çift sayım filtresi.
            { inheritedFromParentRollId: null },
            opAttribution,
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take,
        select: {
          id: true,
          operationType: true,
          createdAt: true,
          metadata: true,
          machineId: true,
          roll: ROLL_SELECT,
          step: STATION_SELECT,
          operator: OPERATOR_SELECT,
          machine: MACHINE_SELECT,
        },
      }),
      // GİRİŞ: movement create anında machineId YAZILMAZ — atıf yalnız operatör dalı.
      prisma.rollMovement.findMany({
        where: { AND: [{ enteredAt: window }, { operatorId: session.userId }] },
        orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
        take,
        select: {
          id: true,
          enteredAt: true,
          qtyIn: true,
          weightIn: true,
          notes: true,
          roll: ROLL_SELECT,
          step: STATION_SELECT,
          operator: OPERATOR_SELECT,
        },
      }),
      // ÇIKIŞ: machineId işin yapıldığı makine olarak kapanışta damgalanır.
      prisma.rollMovement.findMany({
        where: { AND: [{ exitedAt: window }, opAttribution] },
        orderBy: [{ exitedAt: "asc" }, { id: "asc" }],
        take,
        select: {
          id: true,
          enteredAt: true, // süre (kaldığı süre) hesabı için çıkış satırında da lazım
          exitedAt: true,
          qtyOut: true,
          weightOut: true,
          notes: true,
          machineId: true,
          roll: ROLL_SELECT,
          step: STATION_SELECT,
          operator: OPERATOR_SELECT,
          machine: MACHINE_SELECT,
        },
      }),
      // HATA: RollError'da makine yok — yalnız operatör dalı (detectedByUserId).
      prisma.rollError.findMany({
        where: { AND: [{ detectedAt: window }, { detectedByUserId: session.userId }] },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        take,
        select: {
          id: true,
          detectedAt: true,
          startMeter: true,
          errorType: true,
          roll: ROLL_SELECT,
          detectedAtStep: STATION_SELECT,
          detectedBy: OPERATOR_SELECT,
          defectType: { select: { name: true } },
        },
      }),
      // İPTAL/SİLME: top iptali audit'e yazılır (newData.status=CANCELLED). Bu tekil
      // kayıt-aksiyonu için audit DOĞRU kaynak (kim+ne zaman). SystemLog'da makineId
      // YOK → yalnız operatör dalı (userId), atıf OPERATOR_WINDOW. [userId,createdAt]
      // index'i eşitlik+aralığı daraltır. KRİTİK: CANCELLED süzmesi DB'de yapılır —
      // aksi halde her ROLL CUD'u (KK1 create/attach/tambur…) take bütçesini yer,
      // GEÇ yapılan iptal 1001-satır kesitinin dışında kalıp sessizce düşerdi
      // (truncated yalanı). JSON path predicate index-daraltılmış küçük kümede ucuz.
      prisma.systemLog.findMany({
        where: {
          AND: [
            { tableName: "ROLL" },
            { userId: session.userId },
            { createdAt: window },
            { newData: { path: ["status"], equals: "CANCELLED" } },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take,
        select: {
          id: true,
          recordId: true,
          createdAt: true,
          user: OPERATOR_SELECT,
        },
      }),
    ]);

    // cancelLogs zaten yalnız iptaller (DB süzdü). Top adlarını toplu çek.
    const cancelRollIds = [...new Set(cancelLogs.map((l) => l.recordId))];
    const cancelRolls = cancelRollIds.length
      ? await prisma.roll.findMany({ where: { id: { in: cancelRollIds } }, select: ROLL_FIELDS })
      : [];
    const cancelRollById = new Map(cancelRolls.map((r) => [r.id, r]));

    const attributionOf = (machineId: string | null): ActivityAttribution =>
      machineId && machineId === session.machineId ? "MACHINE" : "OPERATOR_WINDOW";

    // RollError.detectedAtStep boşsa (batch akışı) oturumun istasyonuna düş.
    const sessionStation = {
      id: session.station.id,
      name: session.station.name,
      kind: session.station.kind,
    };

    const events: SessionActivityEvent[] = [
      ...rolls.map(
        (r): SessionActivityEvent => ({
          kind: "ROLL_CREATED",
          id: r.id,
          at: r.createdAt,
          attribution: attributionOf(r.createdMachineId),
          roll: mapRoll(r),
          // Top oluşturmada henüz istasyon yok — oturumun yeri (KK1) gösterilir.
          station: sessionStation,
          operator: r.createdBy,
          machine: r.createdMachine,
          qty: toNum(r.initialQty),
          entrySource: r.entrySource,
        }),
      ),
      ...ops.map(
        (o): SessionActivityEvent => ({
          kind: "OPERATION",
          id: o.id,
          at: o.createdAt,
          attribution: attributionOf(o.machineId),
          roll: mapRoll(o.roll),
          station: o.step.station,
          operator: o.operator,
          machine: o.machine,
          operationType: o.operationType,
          metadata: o.metadata,
        }),
      ),
      ...moveIns.map(
        (m): SessionActivityEvent => ({
          kind: "MOVE_IN",
          id: m.id,
          at: m.enteredAt,
          attribution: "OPERATOR_WINDOW",
          roll: mapRoll(m.roll),
          station: m.step.station,
          operator: m.operator,
          machine: null,
          qty: toNum(m.qtyIn),
          weight: toNum(m.weightIn),
          notes: m.notes,
        }),
      ),
      ...moveOuts.map((m): SessionActivityEvent => {
        // exitedAt, where'deki lte koşuluyla not-null garanti — yalnız tip daraltma.
        const exitedAt = m.exitedAt as Date;
        const stayMs = exitedAt.getTime() - m.enteredAt.getTime();
        return {
          kind: "MOVE_OUT",
          id: m.id,
          at: exitedAt,
          attribution: attributionOf(m.machineId),
          roll: mapRoll(m.roll),
          station: m.step.station,
          operator: m.operator,
          machine: m.machine,
          qty: toNum(m.qtyOut),
          weight: toNum(m.weightOut),
          notes: m.notes,
          enteredAt: m.enteredAt,
          // Saat kayması → negatifi 0'a kırp (WorkSession süresiyle aynı politika).
          stayMinutes: Math.max(0, Math.round(stayMs / 60_000)),
        };
      }),
      ...errors.map(
        (er): SessionActivityEvent => ({
          kind: "ERROR",
          id: er.id,
          at: er.detectedAt,
          attribution: "OPERATOR_WINDOW",
          roll: mapRoll(er.roll),
          station: er.detectedAtStep?.station ?? sessionStation,
          operator: er.detectedBy,
          machine: null,
          errorMeter: toNum(er.startMeter),
          errorType: er.errorType ?? er.defectType?.name ?? null,
        }),
      ),
      ...cancelLogs.map((l): SessionActivityEvent => {
        const r = cancelRollById.get(l.recordId);
        return {
          kind: "ROLL_CANCELLED",
          id: l.id, // audit satırının id'si (aynı top farklı zamanlarda tekil kalır)
          at: l.createdAt,
          attribution: "OPERATOR_WINDOW", // audit'te makine yok
          roll: r
            ? mapRoll(r)
            : { id: l.recordId, barcode: null, itemName: null, colorName: null },
          station: sessionStation,
          operator: l.user,
          machine: null,
        };
      }),
    ].sort(cmpAsc);

    const truncated = events.length > MAX_ACTIVITY_EVENTS;
    const shown = truncated ? events.slice(0, MAX_ACTIVITY_EVENTS) : events;

    // F225: özet sayaçları TÜM events'ten (truncate edilmiş `shown`'dan değil) —
    // truncated olduğunda özet gerçek toplamı göstersin (liste kısalsa da doğru say).
    const summary: SessionActivitySummary = {
      rollCreatedCount: events.filter((e) => e.kind === "ROLL_CREATED").length,
      operationCount: events.filter((e) => e.kind === "OPERATION").length,
      moveInCount: events.filter((e) => e.kind === "MOVE_IN").length,
      moveOutCount: events.filter((e) => e.kind === "MOVE_OUT").length,
      errorCount: events.filter((e) => e.kind === "ERROR").length,
      rollCancelledCount: events.filter((e) => e.kind === "ROLL_CANCELLED").length,
    };

    return {
      success: true,
      data: { session, summary, events: shown },
      truncated,
      max: MAX_ACTIVITY_EVENTS,
    };
  }
}
