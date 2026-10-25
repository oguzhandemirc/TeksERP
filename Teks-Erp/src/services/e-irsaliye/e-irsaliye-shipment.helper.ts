// =============================================================================
// e-İrsaliye ↔ SEVKİYAT çekirdeği (E6-SEVK, plan §1.4 · §3.8)
// =============================================================================
// Sevkiyat servisi yalnız ÇAĞRI satırı taşır; yüklemler burada tek kaynaktır:
//  · storno engeli (`resolveUndoBlockReason` girdisi) — GİB'e gitmiş kayıt geri alınamaz,
//  · iptal gövdesi (`cancelPlannedShipmentTx`) — yerel kaydı aynı tx'te IPTAL eder,
//  · kâğıt irsaliye revizyon kilidi — gönderimden sonra kâğıt belge revize edilmez,
//  · liste süzgeci (`listShipments`) — where parçası + satırın hafif alanları.
// Dispatch/create yolları DEĞİŞMEZ: e-İrsaliye sevk tx'ini asla düşürmez (sevk kancası yok).
// Her yazma yolu çağıranın tx'inde `lockShipmentScopeTx`ten SONRA koşar (yeni kilit uzayı yok).
// =============================================================================
import {
  EIrsaliyeSourceType, PrintedDocType, ShipmentStatus, type EIrsaliye, type EIrsaliyeStatus, type Prisma,
} from "@prisma/client";
import { factoryDayStartOfKey } from "../../constants/time";
import type prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { lockShipmentScopeTx } from "../helpers/shipment-locks.helper";
import { isSimulationAdapter } from "./adapters/registry";
import { simulasyonAdapter } from "./adapters/simulasyon.adapter";
import { DEAD_STATUSES, eIrsaliyeAuditEntry, LOCAL_STATUSES } from "./e-irsaliye-common.helper";
import { resolveEIrsaliyeGate } from "./e-irsaliye-readiness.helper";
import type { EIrsaliyeConfig } from "./e-irsaliye-settings";
import { transitionEIrsaliyeTx } from "./e-irsaliye-transition.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** GİB'e (portala/entegratöre) ulaşmış durumlar — bu kayıt varken çıkış geri sarılamaz. */
export const SENT_STATUSES: readonly EIrsaliyeStatus[] = ["GONDERILDI", "KABUL", "KISMI_KABUL", "REDDEDILDI"];

const REC_SELECT = { id: true, documentNo: true, status: true, adapter: true, shipmentId: true } as const;
export type ShipmentEIrsaliye = Pick<EIrsaliye, "id" | "documentNo" | "status" | "adapter" | "shipmentId">;
export type VoidedEIrsaliye = ShipmentEIrsaliye & { oncekiDurum: EIrsaliyeStatus };

const bySource = (shipmentId: string) => ({ sourceType: EIrsaliyeSourceType.SHIPMENT, sourceId: shipmentId });
const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** Canlı kayıt: IPTAL/REDDEDILDI dışı en yeni (partial unique kaynak başına tek tutar; sıra yine belirlenimli). */
export async function readLiveEIrsaliyeForShipmentTx(db: Db, shipmentId: string): Promise<ShipmentEIrsaliye | null> {
  return db.eIrsaliye.findFirst({
    where: { ...bySource(shipmentId), status: { notIn: [...DEAD_STATUSES] } },
    orderBy: NEWEST_FIRST,
    select: REC_SELECT,
  });
}

/**
 * Storno engelinin girdisi: GİB'e ulaşmış EN YENİ kayıt. Canlı kayıttan ayrı okunur, çünkü
 * REDDEDILDI canlı değildir (yerine yeni kayıt doğabilir) ama GİB'de belge olarak durur.
 */
export async function readSentEIrsaliyeForShipmentTx(db: Db, shipmentId: string): Promise<ShipmentEIrsaliye | null> {
  return db.eIrsaliye.findFirst({
    where: { ...bySource(shipmentId), status: { in: [...SENT_STATUSES] } },
    orderBy: NEWEST_FIRST,
    select: REC_SELECT,
  });
}

const noLabel = (rec: Pick<EIrsaliye, "documentNo" | "adapter">) =>
  `${rec.documentNo ?? "numarasız"}${isSimulationAdapter(rec.adapter) ? " (simülasyon)" : ""}`;

/** Storno engel cümlesi — önizleme ve mutasyon AYNI cümleyi basar. `null` = e-İrsaliye engel değil. */
export function eIrsaliyeUndoBlock(rec: Pick<EIrsaliye, "documentNo" | "status" | "adapter"> | null): string | null {
  if (!rec || !SENT_STATUSES.includes(rec.status)) return null;
  return `Bu sevkiyatın e-İrsaliyesi GİB'e gönderilmiş (${noLabel(rec)}) — geri alınamaz. Mal çıkmadıysa alıcı irsaliye yanıtıyla reddeder; mal çıktıysa iade akışını kullanın.`;
}

/** Yıkıcı önizlemelerin e-İrsaliye satırı (etkilenen kayıt somut listelenir). */
export function eIrsaliyePreviewRow(rec: ShipmentEIrsaliye | null) {
  if (!rec) return null;
  return {
    id: rec.id,
    documentNo: rec.documentNo,
    status: rec.status,
    simulasyon: isSimulationAdapter(rec.adapter),
    /** Numara üretilmiş ama GİB'e gitmemiş kayıt iptal edilirse seri sırasında boşluk kalır (plan R3). */
    numaraBosaDuser: rec.documentNo !== null && LOCAL_STATUSES.includes(rec.status),
    yerelIptalEdilebilir: LOCAL_STATUSES.includes(rec.status),
  };
}

/**
 * İptal gövdesinin e-İrsaliye ayağı: yerel kayıt (TASLAK/OLUSTURULDU/HATA) aynı tx'te IPTAL + olay.
 * GİB'e gitmiş kayıtta 409 — storno kapısı buraya ulaşmayı zaten keser; bu ikinci seddir.
 */
export async function voidLocalEIrsaliyeTx(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  userId: string | null,
): Promise<VoidedEIrsaliye | null> {
  const live = await readLiveEIrsaliyeForShipmentTx(tx, shipmentId);
  if (!live) return null;
  if (!LOCAL_STATUSES.includes(live.status)) {
    throw AppError.conflict(
      eIrsaliyeUndoBlock(live) ?? "Bu sevkiyatın e-İrsaliyesi GİB'e gönderilmiş — sevkiyat iptal edilemez.",
      { code: "EIRSALIYE_SENT", documentNo: live.documentNo },
    );
  }
  await transitionEIrsaliyeTx(tx, {
    id: live.id, from: [live.status], to: "IPTAL", event: "IPTAL_EDILDI", actorId: userId,
    note: "Sevkiyat iptal edildi — GİB'e gönderilmedi.",
  });
  return { ...live, status: "IPTAL", oncekiDurum: live.status };
}

/** İptal edilen e-İrsaliye kaydının audit izi (tx DIŞINDA, best-effort). */
export async function logVoidedEIrsaliye(userId: string | null | undefined, voided: VoidedEIrsaliye | null) {
  if (!voided) return;
  await AuditService.log(eIrsaliyeAuditEntry("UPDATE", userId ?? null, voided, { event: "IPTAL_EDILDI", oncekiDurum: voided.oncekiDurum }));
}

/**
 * Kâğıt sevk irsaliyesi revizyon kilidi: GİB'e gitmiş e-İrsaliye varken kâğıt belge revize
 * edilirse iki resmî belge ayrışır. Çağıranın tx'inin İLK ifadesidir (kilidi kendisi alır).
 */
export async function assertPaperReissueAllowedTx(
  tx: Prisma.TransactionClient,
  docType: PrintedDocType,
  sourceId: string,
): Promise<void> {
  if (docType !== PrintedDocType.SHIPMENT_DISPATCH) return;
  await lockShipmentScopeTx(tx, sourceId);
  const sent = await readSentEIrsaliyeForShipmentTx(tx, sourceId);
  if (!sent) return;
  throw AppError.conflict(
    `Bu sevkiyatın e-İrsaliyesi GİB'e gönderilmiş (${noLabel(sent)}) — kâğıt irsaliye artık revize edilemez. Düzeltme gerekiyorsa alıcı e-İrsaliyeyi irsaliye yanıtıyla reddeder ve yeni e-İrsaliye düzenlenir.`,
    { code: "EIRSALIYE_PAPER_LOCKED", documentNo: sent.documentNo },
  );
}

// ── Liste süzgeci ───────────────────────────────────────────────────────────

export const EIRSALIYE_LIST_FILTER_VALUES = [
  "EKSIK", "TASLAK", "OLUSTURULDU", "GONDERILDI", "KABUL", "KISMI_KABUL", "REDDEDILDI", "HATA", "SIMULASYON",
] as const;
export type EIrsaliyeListFilterValue = (typeof EIRSALIYE_LIST_FILTER_VALUES)[number];

/** Tek where parçası; değerler VEYA'lanır. Boş küme çağıranın işidir (bu helper'a gelmez). */
export function eIrsaliyeListWhere(values: readonly EIrsaliyeListFilterValue[], config: EIrsaliyeConfig): Prisma.ShipmentWhereInput {
  const parts = values.map((v): Prisma.ShipmentWhereInput => {
    if (v === "EKSIK") {
      return {
        status: ShipmentStatus.DISPATCHED,
        destination: "DOMESTIC",
        ...(config.yururlukTarihi ? { dispatchedAt: { gte: factoryDayStartOfKey(config.yururlukTarihi) } } : {}),
        eIrsaliyeler: { none: { status: { notIn: [...DEAD_STATUSES] } } },
      };
    }
    if (v === "SIMULASYON") return { eIrsaliyeler: { some: { adapter: simulasyonAdapter.kod, status: { not: "IPTAL" } } } };
    return { eIrsaliyeler: { some: { status: v } } };
  });
  return parts.length === 1 ? parts[0]! : { OR: parts };
}

/**
 * Ham süzgeç değeri → where parçası | null (süzgeç yok). Tanınmayan değer 400; hazırlık
 * YAPILANDIRILMAMIS iken süzgeç yok sayılmaz → 400 (fail-closed).
 */
export async function resolveEIrsaliyeListFilter(values: string[]): Promise<Prisma.ShipmentWhereInput | null> {
  if (values.length === 0) return null;
  const unknown = values.filter((v) => !(EIRSALIYE_LIST_FILTER_VALUES as readonly string[]).includes(v));
  if (unknown.length > 0) {
    throw AppError.badRequest(`Tanınmayan e-İrsaliye süzgeci: ${unknown.join(", ")}.`, { code: "EIRSALIYE_FILTER_INVALID", gecerli: [...EIRSALIYE_LIST_FILTER_VALUES] });
  }
  const gate = await resolveEIrsaliyeGate();
  if (gate.readiness.durum !== "HAZIR") {
    throw AppError.badRequest("e-İrsaliye yapılandırılmamış; e-İrsaliye süzgeci kullanılamaz.", {
      code: "EIRSALIYE_NOT_CONFIGURED", eksikler: gate.readiness.eksikler,
    });
  }
  return eIrsaliyeListWhere(values as EIrsaliyeListFilterValue[], gate.config);
}

/** Liste satırının hafif e-İrsaliye alanı — XML yok; IPTAL dışı en yeni kayıt. */
export const EIRSALIYE_LIST_SELECT = {
  where: { status: { not: "IPTAL" as const } },
  orderBy: NEWEST_FIRST,
  take: 1,
  select: { status: true, adapter: true },
} as const;

export function eIrsaliyeListFields(rows: ReadonlyArray<{ status: EIrsaliyeStatus; adapter: string }>) {
  const r = rows[0];
  return { eIrsaliyeStatus: r?.status ?? null, eIrsaliyeSimulasyon: r ? isSimulationAdapter(r.adapter) : false };
}

/** Gönderim/işaretleme claim'inin ek koşulu: sevkiyat hâlâ çıkmış olmalı (storno ile yarışta ikisi birden başarılı olmasın). */
export const SHIPMENT_STILL_DISPATCHED: Prisma.EIrsaliyeWhereInput = { shipment: { is: { status: ShipmentStatus.DISPATCHED } } };
