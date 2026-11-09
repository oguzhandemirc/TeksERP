// =============================================================================
// İSTASYONDA BELGE OKUT — İE satırı: yükleme (işlem, top/metre, nerede) + "burada mı" sınıflaması (2026-11-06)
// =============================================================================
// `gelen-belge-istasyon-okutma.service`ten ayrıldı (dosya boyu). "Burada" = ekranın açık kart listesi
// (`station-open-step.helper`); rotasız İE = listenin "Sahada belirlenecek" kapısı (`scan-route-open-cards.helper`).
// =============================================================================
import { type Prisma, WorkOrderStatus } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { getStampContext } from "./work-session.helper";
import { whereRollsOfWorkOrder } from "./workorder-rolls.helper";
import { LOOKUP_NOTE_STATUSES } from "./workorder-doc-search.helper";
import { loadWorkOrderLocations, type WorkOrderLocation } from "./workorder-location.helper";
import {
  assertTamburStation, stationScreenOpenStepWhere, stationScreenStationWhere, stationScreenStepWhere, type StationScreen,
} from "./station-open-step.helper";
import { scanRouteStartableWorkOrderIds } from "./scan-route-open-cards.helper";
import { computeWoIncoming, woMemberRootInput } from "./wo-incoming.helper";
import type { WorkOrderVerification } from "./station-scan-score.helper";

/** Yanıt tavanı — tablet listesi; daha fazlası belge no'nun yanlış okunduğunu gösterir. */
export const MAX_WORK_ORDERS = 20;

export interface StationLookupWorkOrder {
  readonly id: string;
  readonly workOrderNumber: string;
  readonly status: WorkOrderStatus;
  /** Tabletin mevcut kart çözümüne verilecek kod: aktif refakat kartı barkodu (kartsız İE listeye girmez). */
  readonly cardBarcode: string;
  readonly batchNumbers: string[];
  /** Bu İE'ye top vermiş canlı belgeler (GB no + gönderen belge no). */
  readonly documents: Array<{ noteNo: string; senderDocNo: string | null; customerOrderNo: string | null; customerBatchNo: string | null }>;
  readonly createdAt: Date;
  /** İşlem: belge satırının işlem metni → belge başlığınınki → rota adı. */
  readonly processText: string | null;
  /** Canlı top sayısı ve metresi (konum helper'ından); adımda canlı top yoksa gelen kök sayısı ve metresi. */
  readonly rollCount: number;
  readonly meters: number;
  /** Kumaş nasıl geldi + gelen metre (İE Gelen kartıyla aynı kaynak); tablet tek parçayı "N top" yerine yazar. Eski tablet yok sayar. */
  readonly arrival?: { form: "SINGLE_PIECE" | "ROLLS"; meters: number } | null;
  /** "Şu an: Tambur 1 (3 top)" — `workorder-location.helper`. */
  readonly locationText: string;
  /** Bu ekranın açık kart listesinde mi; ekran bildirilmediyse null (eski istemci). */
  readonly atStation: AtStation | null;
  readonly atStationText: string | null;
  /** Fotoğraf okutmasında doğrulama puanı (`station-scan-verify.helper`); elle aramada / aynı fotoğrafta yok. */
  readonly verification?: WorkOrderVerification | null;
}

/**
 * HERE = ekranın açık kart listesinde · STARTABLE_HERE = rotasız İE, listede "Sahada belirlenecek" satırı (okutunca adım
 * buraya eklenir; tablet HERE gibi açar) · NOT_YET = adımı var, açık değil · PASSED = adımları bitti · NOT_ON_ROUTE = adımı yok.
 */
export type AtStation = "HERE" | "STARTABLE_HERE" | "NOT_YET" | "PASSED" | "NOT_ON_ROUTE";

/** İsteği yapan ekran ve (biliniyorsa) istasyonu: kurşun → oturum istasyonu, tambur → açık kart listesinin istasyonu. */
export interface StationLookupContext {
  readonly screen: StationScreen;
  readonly stationId: string | null;
  /** Oturum istasyonu — rotasız İE'nin adımı buraya eklenir (açık kart listesinin rotasız satırları gibi). */
  readonly sessionStationId?: string | null;
}

const StationLookupQuery = z.strictObject({
  screen: z.enum(["KURSUN_QC", "TAMBUR"], "Ekran KURSUN_QC ya da TAMBUR olmalı").optional(),
  stationId: z.uuid("Geçersiz istasyon").optional(),
}).refine((q) => !q.stationId || q.screen === "TAMBUR", { message: "İstasyon yalnız TAMBUR ekranında verilir (kurşunda oturum istasyonu kullanılır)", path: ["stationId"] });

/**
 * Sorgu dizgisinden ekran bağlamı; ekran yoksa null (eski istemci). "Burada" = ekranın açık kart listesi: kurşun oturum
 * istasyonunu, tambur listenin istasyonunu okur; rotasız İE'nin adımı OTURUM istasyonuna eklenir (open-cards gibi).
 */
export async function stationLookupContext(req: Parameters<typeof getStampContext>[0] & { query: unknown }): Promise<StationLookupContext | null> {
  const { screen, stationId } = StationLookupQuery.parse(req.query);
  if (!screen) return null;
  const sessionStationId = (await getStampContext(req))?.stationId ?? null;
  return { screen, stationId: screen === "TAMBUR" ? stationId ?? null : sessionStationId, sessionStationId };
}

/** Fail-closed: tambur istasyonu doğrulanır (açık kart listesiyle aynı kapı); kurşun istasyonu oturumdan gelir. */
export async function stationLabel(ctx: StationLookupContext): Promise<string> {
  if (ctx.screen === "TAMBUR") return ctx.stationId ? (await assertTamburStation(ctx.stationId)).name : "Tambur";
  if (!ctx.stationId) return "Kurşun / KK";
  const st = await prisma.station.findUnique({ where: { id: ctx.stationId }, select: { name: true } });
  return st?.name ?? "Kurşun / KK";
}

const AT_STATION_TEXT: Record<AtStation, string> = {
  HERE: "Burada bekliyor",
  STARTABLE_HERE: "Rotasız · burada başlatılabilir",
  NOT_YET: "Buraya henüz gelmedi",
  PASSED: "Buradan geçti",
  NOT_ON_ROUTE: "Rotasında bu istasyon yok",
};

const SCAN_ROUTED_NOT_STARTABLE_TEXT = "Rotasız · şu an burada başlatılamaz";

/** Bellek sınıflaması: `hereIds` ekranın açık kart yükleminden (DB), adım durumları ekranın istasyon yükleminden. */
export function classifyAtStation(here: boolean, stepStatuses: readonly string[], startableHere = false): AtStation {
  if (here) return "HERE";
  if (startableHere) return "STARTABLE_HERE";
  if (stepStatuses.length === 0) return "NOT_ON_ROUTE";
  return stepStatuses.every((s) => s === "COMPLETED") ? "PASSED" : "NOT_YET";
}

export async function markAtStation(wos: StationLookupWorkOrder[], ctx: StationLookupContext): Promise<StationLookupWorkOrder[]> {
  if (wos.length === 0) return wos;
  const ids = { workOrderId: { in: wos.map((w) => w.id) } };
  const here = await prisma.workOrderStep.findMany({
    where: { AND: [ids, stationScreenOpenStepWhere(ctx.screen, ctx.stationId)] }, select: { workOrderId: true },
  });
  const steps = await prisma.workOrderStep.findMany({
    where: { AND: [ids, stationScreenStepWhere(ctx.screen, ctx.stationId)] }, select: { workOrderId: true, status: true },
  });
  // Rotasız İE: açık kart listesinin "Sahada belirlenecek" satırıyla aynı kapı + where (oturum istasyonu).
  const startable = await scanRouteStartableWorkOrderIds({
    stationId: ctx.sessionStationId ?? null, stationWhere: stationScreenStationWhere(ctx.screen), workOrderIds: wos.map((w) => w.id),
  });
  const scanRouted = new Set((await prisma.workOrder.findMany({ where: { id: { in: wos.map((w) => w.id) }, scanRouted: true }, select: { id: true } })).map((w) => w.id));
  const hereIds = new Set(here.map((h) => h.workOrderId));
  return wos.map((w) => {
    const at = classifyAtStation(hereIds.has(w.id), steps.filter((s) => s.workOrderId === w.id).map((s) => s.status), startable.has(w.id));
    // Rotasız İE'de "rotasında yok" yanlış: rotası sahada belirlenir, yalnız şu an buraya eklenemez.
    const text = at === "NOT_ON_ROUTE" && scanRouted.has(w.id) ? SCAN_ROUTED_NOT_STARTABLE_TEXT : AT_STATION_TEXT[at];
    return { ...w, atStation: at, atStationText: text };
  });
}

/** "Şu an nerede" cümlesi — konum TEK kaynaktan; en çok üç istasyon. */
export function locationSentence(k: WorkOrderLocation): string {
  if (k.sinif === "BASLAMADI") return "Henüz başlamadı";
  if (k.istasyonlar.length === 0) return "Üretimde topu yok";
  const parts = k.istasyonlar.slice(0, 3).map((e) => {
    const fason = e.fasondaTop > 0 ? `, ${e.fasondaTop} fasonda${e.fasoncular.length > 0 ? `: ${e.fasoncular.join(", ")}` : ""}` : "";
    return `${e.ad} (${e.topSayisi} top${fason})`;
  });
  const more = k.istasyonlar.length > 3 ? ` +${k.istasyonlar.length - 3} istasyon` : "";
  return `Şu an: ${parts.join(", ")}${more}`;
}

export type LoadedWorkOrders = { workOrders: StationLookupWorkOrder[]; closed: string[] };

/**
 * Aktif refakat kartlı, iptal edilmemiş, arşivlenmemiş İE'ler — tablet kartı barkodla çözer, kartsız İE 404 olurdu.
 * Kartı kapanmış eşleşenler yalnız no olarak döner (cümle). `noteIds` verilirse belge listesi o belgelerle sınırlanır.
 */
export async function loadWorkOrders(where: Prisma.WorkOrderWhereInput, noteIds: string[] | null): Promise<LoadedWorkOrders> {
  const base: Prisma.WorkOrderWhereInput = { AND: [where, { status: { not: WorkOrderStatus.CANCELLED }, isActive: true }] };
  const rows = await prisma.workOrder.findMany({
    where: { AND: [base, { travelerCards: { some: { status: "ACTIVE" } } }] },
    select: {
      id: true, workOrderNumber: true, status: true, createdAt: true,
      travelerCards: { where: { status: "ACTIVE" }, select: { barcode: true }, take: 1 },
      batches: { select: { batchNumber: true }, orderBy: { createdAt: "asc" } },
      routeTemplate: { select: { name: true } },
      steps: { select: { id: true, station: { select: { id: true, name: true, type: true, kind: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_WORK_ORDERS,
  });
  const out: StationLookupWorkOrder[] = [];
  const locations = await loadWorkOrderLocations(rows);
  // İE başına dört sorgu (≤ 20): hangi belgeler bu İE'ye top verdi + satırların işlem metni + gelen kökleri ve satırları.
  for (const w of rows) {
    const docs = await prisma.customerDeliveryNote.findMany({
      where: { status: { in: [...LOOKUP_NOTE_STATUSES] }, ...(noteIds ? { id: { in: noteIds } } : {}), lines: { some: { roll: whereRollsOfWorkOrder(w.id) } } },
      select: { noteNo: true, senderDocNo: true, customerOrderNo: true, customerBatchNo: true, processText: true },
      orderBy: { noteNo: "asc" },
      take: 5,
    });
    const lineProcess = await prisma.customerDeliveryNoteLine.findMany({
      where: { roll: whereRollsOfWorkOrder(w.id), processText: { not: null }, note: { status: { in: [...LOOKUP_NOTE_STATUSES] } } },
      select: { processText: true }, distinct: ["processText"], orderBy: { processText: "asc" }, take: 3,
    });
    const konum = locations.get(w.id);
    const member = await woMemberRootInput(w.id);
    const incoming = member ? await computeWoIncoming(member) : null;
    const processText = joinedText(lineProcess.map((l) => l.processText)) ?? joinedText(docs.map((d) => d.processText)) ?? w.routeTemplate?.name ?? null;
    out.push({
      id: w.id, workOrderNumber: w.workOrderNumber, status: w.status, createdAt: w.createdAt,
      cardBarcode: w.travelerCards[0]!.barcode,
      batchNumbers: [...new Set(w.batches.map((b) => b.batchNumber))],
      documents: docs.map((d) => ({ noteNo: d.noteNo, senderDocNo: d.senderDocNo, customerOrderNo: d.customerOrderNo, customerBatchNo: d.customerBatchNo })),
      processText,
      // Adımda canlı top yoksa (rotasız / başlamamış) gelen kökler sayılır — "0 top · 0 m" yanıltır (tek parça 1 top · 241 m).
      ...(konum && konum.canliTop > 0 || !incoming
        ? { rollCount: konum?.canliTop ?? 0, meters: Math.round((konum?.istasyonlar.reduce((sum, e) => sum + e.metre, 0) ?? 0) * 10) / 10 }
        : { rollCount: incoming.rootCount, meters: Math.round(Number(incoming.meters) * 10) / 10 }),
      arrival: incoming ? { form: incoming.arrivalForm, meters: Math.round(Number(incoming.meters) * 10) / 10 } : null,
      locationText: konum ? locationSentence(konum) : "Üretimde topu yok",
      atStation: null,
      atStationText: null,
    });
  }
  const closed = out.length > 0 ? [] : (await prisma.workOrder.findMany({
    where: { AND: [base, { travelerCards: { none: { status: "ACTIVE" } } }] },
    select: { workOrderNumber: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 3,
  })).map((w) => w.workOrderNumber);
  return { workOrders: out, closed };
}

function joinedText(values: Array<string | null>): string | null {
  const list = [...new Set(values.map((v) => v?.trim() ?? "").filter((v) => v.length > 0))];
  return list.length > 0 ? list.join(" / ") : null;
}
