// =============================================================================
// TeksERP — MAKİNE KARTI İPTAL ÖNİZLEMESİ (yıkıcı işlem, kök CLAUDE.md "backend preview ucu")
// =============================================================================
// YAZMAZ. İptalin dokunacağı HER kaydı adıyla döner: bağı çözülecek tezgahlar · kartın açık duruşları (kart
// artık "bitti" gönderemez; watchdog eşikte geçici kapatır) · kartın bekleyen geç kapanışları (watchdog'un
// geçici kapattığı, gerçek bitişi gelmemiş duruş — iptalden sonra gerçek bitiş GELMEZ; kuyruğa düşmüş olan
// `lateEndedAt` yine uygulanır). Satırlar tezgah kodu sırasında (`machine-stop-bulk` önizleme deseni).
// Kırpma yok: arayüz etkilenen her kaydı listeler.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { WATCHDOG_PENDING_END_WHERE } from "./helpers/machine-stop-watchdog.helper";
import { COLLECTOR_PUBLIC_SELECT, type CollectorDto } from "./machine-collector.service";
import type { ApiResponse } from "../types/api.types";

interface MachineRef { machineId: string; machineCode: string; machineName: string }

export interface CollectorRevokeStopRow extends MachineRef {
  stopId: string;
  startedAt: Date;
  rawStopCode: string | null;
  reasonCode: string | null;
}

export interface CollectorRevokePendingRow extends CollectorRevokeStopRow {
  /** Watchdog'un geçici bitişi. */
  endedAt: Date | null;
  /** Dolu = gerçek bitiş geldi, mühür açılınca yine uygulanır; boş = gerçek bitiş artık gelmeyecek. */
  lateEndedAt: Date | null;
}

export interface CollectorRevokePreview {
  collector: CollectorDto;
  revocable: boolean;
  block: { code: string; message: string } | null;
  machines: MachineRef[];
  openStops: CollectorRevokeStopRow[];
  pendingEnds: CollectorRevokePendingRow[];
}

const STOP_SELECT = {
  id: true, startedAt: true, endedAt: true, lateEndedAt: true, rawStopCode: true, reasonCode: true,
  machine: { select: { id: true, code: true, name: true } },
} as const;

const byCode = (a: MachineRef, b: MachineRef) => a.machineCode.localeCompare(b.machineCode, "tr") || a.machineId.localeCompare(b.machineId);

type StopRow = { id: string; startedAt: Date; endedAt: Date | null; lateEndedAt: Date | null; rawStopCode: string | null; reasonCode: string | null; machine: { id: string; code: string; name: string } };

function stopRow(s: StopRow): CollectorRevokeStopRow {
  return { stopId: s.id, machineId: s.machine.id, machineCode: s.machine.code, machineName: s.machine.name, startedAt: s.startedAt, rawStopCode: s.rawStopCode, reasonCode: s.reasonCode };
}

/** İptal önizlemesi — aynı kapılar (`loom:spec-manage` + tezgah modülü) rotada. */
export async function previewCollectorRevoke(id: string): Promise<ApiResponse<CollectorRevokePreview>> {
  const collector = await prisma.machineCollector.findUnique({ where: { id }, select: COLLECTOR_PUBLIC_SELECT });
  if (!collector) throw AppError.notFound("Kart bulunamadı", { collectorId: id });
  const open = await prisma.machineStopEvent.findMany({ where: { collectorId: id, endedAt: null, revokedAt: null }, select: STOP_SELECT });
  const pending = await prisma.machineStopEvent.findMany({ where: { ...WATCHDOG_PENDING_END_WHERE, collectorId: id }, select: STOP_SELECT });
  const machines = collector.machines.map((m) => ({ machineId: m.machine.id, machineCode: m.machine.code, machineName: m.machine.name })).sort(byCode);
  const block = collector.revokedAt ? { code: "COLLECTOR_REVOKED", message: "Kart zaten iptal edilmiş." } : null;
  return {
    success: true,
    data: {
      collector,
      revocable: block === null,
      block,
      machines,
      openStops: open.map(stopRow).sort(byCode),
      pendingEnds: pending.map((s) => ({ ...stopRow(s), endedAt: s.endedAt, lateEndedAt: s.lateEndedAt })).sort(byCode),
    },
  };
}
