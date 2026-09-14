// =============================================================================
// TeksERP — Levent TEZGAH BAĞI yardımcıları (devere Faz 3, DEVERE-LEVENT-TARAMASI §4.7/§4.8/§7.3)
// =============================================================================
// Burada YAZICI yok; kapılar ve türetimler tek yerde: bayrak kapısı (409, yetki değil), aktif
// ileri DURUM olayı (LIFO iptal yüklemi — TS ↔ SQL boğaz-ikiz), makinedeki bağlı leventler,
// açık koşum sayısı (tezgah tarafının yüklemiyle AYNI sabit), koşum penceresindeki leventler
// (`beamsMountedDuring` ↔ `BEAMS_MOUNTED_DURING_SQL`; tezgah raporları YALNIZ helper'ı çağırır),
// tartıdan metre (#13/#14).
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readDevereEnabled, readDevereMountTracking, readDokumaEnabled } from "../system-setting.service";
import { WARP_BEAM_STATUS_EVENT_KINDS, type WarpBeamEventKind } from "../../constants/warp-beam";
import { OPEN_MACHINE_RUN_WHERE } from "./machine-run-open.helper";

type Client = Prisma.TransactionClient;

/** Bayrak KAPALI = durum, yetki değil: 409 (403 MODULE_DISABLED devere kapısında zaten önce sorulur). */
export async function assertMountTrackingOnTx(tx: Pick<Client, "systemSetting">): Promise<void> {
  if (!(await readDevereMountTracking(tx))) {
    throw AppError.conflict(
      'Levent tezgah bağı defteri bu kurulumda kapalı — levent sarıldıktan sonra "hazır" kalır, takma/sökme/tüketim yazılmaz. Genel Ayarlar › Devere / Levent › "Levent tezgah bağı defteri" ile açılır.',
      { code: "WARP_MOUNT_TRACKING_OFF" },
    );
  }
}

/**
 * LIFO YÜKLEMİ — leventin en yeni, iptal edilmemiş DURUM DEĞİŞTİREN olayı. Yalnız bu olay geri
 * alınabilir (WOUND · SHIP_OUT · RETURNED_IN · MOUNTED · DISMOUNTED · EXHAUSTED · SCRAPPED);
 * CONSUMED/ADJUST zinciri kilitlemez (§4.7). SQL ikizi `ACTIVE_FORWARD_EVENT_SQL` (mutabakat §43).
 */
export async function activeForwardStatusEventTx(client: Pick<Client, "warpBeamEvent">, beamId: string) {
  return client.warpBeamEvent.findFirst({
    where: { beamId, kind: { in: [...WARP_BEAM_STATUS_EVENT_KINDS] }, reversal: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, fromStatus: true, toStatus: true, machineId: true, mountPosition: true, lengthM: true, createdAt: true },
  });
}
/** Boğaz-ikiz: `activeForwardStatusEventTx` ile AYNI küme — mutabakat §43 bunu okur. */
export const ACTIVE_FORWARD_EVENT_SQL = `
  SELECT DISTINCT ON (e."beamId") e."beamId", e.kind, e."toStatus", e."machineId", e."mountPosition"
  FROM warp_beam_events e
  WHERE e.kind IN (${WARP_BEAM_STATUS_EVENT_KINDS.map((k) => `'${k}'`).join(", ")})
    AND NOT EXISTS (SELECT 1 FROM warp_beam_events r WHERE r."reversesEventId" = e.id)
  ORDER BY e."beamId", e."createdAt" DESC`;

/** Makinede şu an bağlı leventler (durum kolonundan — "şu an ne"). */
export async function mountedBeamsOnMachineTx(client: Pick<Client, "warpBeam">, machineId: string) {
  return client.warpBeam.findMany({
    where: { status: WarpBeamStatus.MOUNTED, currentMachineId: machineId },
    orderBy: { currentPosition: "asc" },
    select: { id: true, beamNo: true, currentPosition: true, warpSpecId: true },
  });
}

/** Makinede AÇIK koşum sayısı — tezgah tarafının yüklemi (`OPEN_MACHINE_RUN_WHERE`), ikinci kopya yok. */
export async function openRunCountOnMachineTx(client: Pick<Client, "machineRun">, machineId: string): Promise<number> {
  return client.machineRun.count({ where: { machineId, ...OPEN_MACHINE_RUN_WHERE } });
}

/**
 * SÖKÜM / BİTİŞ KAPISI (tezgah doc §7.3, düzeltilmiş (1)): sökümden sonra makinede kalan bağlı
 * levent sayısı n — açık koşum varsa: n == 0 → 409 (önce koşumu kapat) · 0 < n < yuva → UYARI ·
 * n == yuva → sessiz. Dokuma modülü kapalıysa koşum yoktur, kapı uygulanmaz.
 */
export async function assertDismountAllowedTx(
  tx: Pick<Client, "machineRun" | "warpBeam" | "systemSetting">,
  machine: { id: string; code: string; warpBeamSlots: number },
  beamNo: string,
): Promise<string[]> {
  const warnings: string[] = [];
  if (!(await readDokumaEnabled(tx))) return warnings;
  const openRuns = await openRunCountOnMachineTx(tx, machine.id);
  if (openRuns === 0) return warnings;
  const remaining = (await mountedBeamsOnMachineTx(tx, machine.id)).length - 1;
  if (remaining <= 0) {
    throw AppError.conflict(`${machine.code} makinesinde açık koşum var — ${beamNo} sökülünce tezgahta bağlı levent kalmaz. Önce koşumu kapatın.`, { code: "WARP_DISMOUNT_OPEN_RUN", openRuns });
  }
  if (remaining < machine.warpBeamSlots) warnings.push(`${machine.code}: açık koşum sürerken ${machine.warpBeamSlots} yuvadan ${remaining} dolu kalıyor.`);
  return warnings;
}

/**
 * KOŞUM AÇILIŞI UYARISI (tezgah doc §7.3): devere + bağ defteri açıkken, levent tüketen makinede
 * yuvadan az levent bağlıysa uyarır — sert değil (leventsiz koşum meşru: bağ defteri henüz
 * doldurulmamış olabilir). Yuva 0 (cağlıklı makine) sessiz.
 */
export async function runOpenBeamWarning(client: Pick<Client, "machine" | "warpBeam" | "systemSetting">, machineId: string): Promise<string | null> {
  if (!(await readDevereEnabled(client)) || !(await readDevereMountTracking(client))) return null;
  const m = await client.machine.findUnique({ where: { id: machineId }, select: { code: true, warpBeamSlots: true, station: { select: { consumesWarpBeam: true } } } });
  if (!m || !m.station.consumesWarpBeam || m.warpBeamSlots <= 0) return null;
  const n = (await mountedBeamsOnMachineTx(client, machineId)).length;
  if (n >= m.warpBeamSlots) return null;
  return n === 0 ? `${m.code}: tezgahta bağlı levent yok — koşum leventsiz açılıyor (levent defteri).` : `${m.code}: ${m.warpBeamSlots} levent yuvasından ${n} dolu.`;
}

/** Bağlanabilir makine: aktif + istasyonu levent TÜKETİR; yuva 1..warpBeamSlots. */
export async function loadLoomMachineTx(tx: Pick<Client, "machine">, machineId: string, position: number) {
  const m = await tx.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true, name: true, isActive: true, warpBeamSlots: true, station: { select: { name: true, consumesWarpBeam: true } } } });
  if (!m || !m.isActive) throw AppError.badRequest("Tezgah bulunamadı ya da pasif");
  if (!m.station.consumesWarpBeam) {
    throw AppError.badRequest(`"${m.station.name}" istasyonu levent tüketmez — makine bir dokuma/raşel istasyonunda olmalı (istasyon kartında "levent tüketir").`, { code: "WARP_BEAM_MACHINE_NOT_LOOM" });
  }
  if (!Number.isInteger(position) || position < 1 || position > m.warpBeamSlots) {
    throw AppError.badRequest(`${m.code} makinesinin ${m.warpBeamSlots} levent yuvası var — yuva 1..${m.warpBeamSlots} olmalı (istenen ${position}).`, { code: "WARP_SLOT_OUT_OF_RANGE", warpBeamSlots: m.warpBeamSlots });
  }
  return m;
}

/** Yuva ön kontrolü — Türkçe 409; `warp_beams_machine_position_uq` ikinci hat (yarışta P2002 → 409). */
export async function assertSlotFreeTx(tx: Pick<Client, "warpBeam">, machineId: string, position: number, machineCode: string): Promise<void> {
  const busy = await tx.warpBeam.findFirst({ where: { status: WarpBeamStatus.MOUNTED, currentMachineId: machineId, currentPosition: position }, select: { beamNo: true } });
  if (busy) throw AppError.conflict(`${machineCode} makinesinin ${position}. yuvasında ${busy.beamNo} bağlı — önce onu sökün.`, { code: "WARP_SLOT_BUSY", busyBeamNo: busy.beamNo });
}

/** Koşum penceresine düşen leventler — TEK KAYNAK SQL; tezgah raporları yalnız bunu çağırır (AST tripwire). */
export const BEAMS_MOUNTED_DURING_SQL = `
  SELECT m."beamId", b."beamNo", m."mountPosition", COALESCE(m."setupStartedAt", m."createdAt") AS "mountedAt", d."createdAt" AS "dismountedAt"
  FROM warp_beam_events m
  JOIN warp_beams b ON b.id = m."beamId"
  LEFT JOIN LATERAL (
    SELECT x."createdAt" FROM warp_beam_events x
    WHERE x."beamId" = m."beamId" AND x.kind IN ('DISMOUNTED', 'EXHAUSTED', 'SCRAPPED', 'SHIP_OUT')
      AND x."createdAt" > m."createdAt"
      AND NOT EXISTS (SELECT 1 FROM warp_beam_events r WHERE r."reversesEventId" = x.id)
    ORDER BY x."createdAt" ASC LIMIT 1
  ) d ON true
  WHERE m.kind = 'MOUNTED' AND m."machineId" = $1::uuid
    AND NOT EXISTS (SELECT 1 FROM warp_beam_events r WHERE r."reversesEventId" = m.id)
    AND COALESCE(m."setupStartedAt", m."createdAt") < $3::timestamptz
    AND COALESCE(d."createdAt", now()) > $2::timestamptz
  ORDER BY "mountedAt"`;

export interface BeamMountedDuringRow {
  beamId: string;
  beamNo: string;
  mountPosition: number | null;
  mountedAt: Date;
  dismountedAt: Date | null;
}

/** `[from, to)` penceresinde makineye bağlı olan leventler — pencere `setupStartedAt ?? createdAt` ∩ koşum. */
export async function beamsMountedDuring(client: { $queryRawUnsafe: Client["$queryRawUnsafe"] }, machineId: string, from: Date, to: Date): Promise<BeamMountedDuringRow[]> {
  return client.$queryRawUnsafe<BeamMountedDuringRow[]>(BEAMS_MOUNTED_DURING_SQL, machineId, from, to);
}

/** Tartıdan metre (#13/#14): (brüt − dara) ÷ (tel × denye ÷ 9.000.000). Dara yoksa null — metre ESTIMATED'a düşer. */
export function warpLengthFromWeight(grossKg: Prisma.Decimal.Value, tareKg: Prisma.Decimal.Value | null | undefined, endsCount: number, denier: Prisma.Decimal.Value | null | undefined): Prisma.Decimal | null {
  if (tareKg == null || denier == null || endsCount <= 0) return null;
  const kgPerM = new Prisma.Decimal(endsCount).mul(denier).div(9_000_000);
  if (kgPerM.lte(0)) return null;
  const net = new Prisma.Decimal(grossKg).minus(tareKg);
  if (net.lt(0)) return null;
  return net.div(kgPerM).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

export type StatusEventKind = (typeof WARP_BEAM_STATUS_EVENT_KINDS)[number];
export const isStatusEventKind = (k: WarpBeamEventKind): k is StatusEventKind => (WARP_BEAM_STATUS_EVENT_KINDS as readonly string[]).includes(k);
