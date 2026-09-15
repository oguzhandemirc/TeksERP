// =============================================================================
// TeksERP — Raporlarda LEVENT / LOT EKSENİ (raporlar fazı R5b-b): top → levent → lot bağı defterden
// =============================================================================
// Kaynak tek: `WarpBeamEvent.CONSUMED.rollId` (Faz 4 otomatik tüketim; geri alınmış satır sayılmaz) ve
// `YarnMovement.WARP_ISSUE.lotId` (Faz 2 lot). İki soru, iki yüklem:
//   • TOP raporları (kalite/fire karnesi): "bu top hangi leventten?" → `r.id IN (…)` SQL parçası.
//   • TEZGAH raporları (randıman/pareto/vardiya, satır = makine × vardiya): "o vardiyada o levent tezgahta
//     bağlı mıydı?" → `beamsMountedDuring` penceresi ∩ vardiya penceresi (durum kolonu DEĞİL, defter).
// Süzgeç yoksa parça boş (`Prisma.empty`) — sorgu bayt bayt eski. Levent/lot bulunamazsa sonuç BOŞ, hata değil.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { beamsMountedDuring, type BeamMountedDuringRow } from "./warp-beam-mount.helper";

type Client = Prisma.TransactionClient;

export interface BeamLotFilterInput {
  warpBeamId?: string | null;
  lotNo?: string | null;
}

export interface BeamLotFilter {
  /** Süzgece giren levent kimlikleri — boş dizi meşru ("bu lottan levent yok" → rapor boş). */
  beamIds: string[];
  warpBeamId: string | null;
  lotNo: string | null;
}

/** Girdi yoksa null (süzgeç yok); leventi bilinmeyen id 404; lot metni TRIM, birebir eşleşir (normalize yok — Faz 2 kuralı). */
export async function resolveBeamLotFilter(client: Pick<Client, "warpBeam" | "yarnMovement">, input: BeamLotFilterInput): Promise<BeamLotFilter | null> {
  const warpBeamId = input.warpBeamId ?? null;
  const lotNo = input.lotNo?.trim() || null;
  if (!warpBeamId && !lotNo) return null;
  let beamIds: string[] | null = null;
  if (warpBeamId) {
    const b = await client.warpBeam.findUnique({ where: { id: warpBeamId }, select: { id: true } });
    if (!b) throw AppError.notFound("Levent bulunamadı", { code: "WARP_BEAM_NOT_FOUND", warpBeamId });
    beamIds = [b.id];
  }
  if (lotNo) {
    const rows = await client.yarnMovement.findMany({ where: { kind: "WARP_ISSUE", warpBeamId: { not: null }, lot: { lotNo } }, select: { warpBeamId: true }, distinct: ["warpBeamId"] });
    const lotBeams = rows.map((r) => r.warpBeamId).filter((x): x is string => !!x);
    beamIds = beamIds ? beamIds.filter((id) => lotBeams.includes(id)) : lotBeams;
  }
  return { beamIds: beamIds ?? [], warpBeamId, lotNo };
}

/** Top sorgularına eklenen WHERE parçası: `AND <topKolonu> IN (aktif CONSUMED.rollId)`; süzgeç yoksa boş, levent yoksa `AND false`. `rollColumn` sabit SQL kimliğidir (kullanıcı girdisi DEĞİL). */
export function rollsOfBeamsSql(f: BeamLotFilter | null, rollColumn = "r.id"): Prisma.Sql {
  if (!f) return Prisma.empty;
  if (f.beamIds.length === 0) return Prisma.sql`AND false`;
  return Prisma.sql`AND ${Prisma.raw(rollColumn)} IN (
    SELECT e."rollId" FROM warp_beam_events e
    WHERE e.kind = 'CONSUMED' AND e."rollId" IS NOT NULL AND e."beamId" IN (${Prisma.join(f.beamIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND NOT EXISTS (SELECT 1 FROM warp_beam_events x WHERE x."reversesEventId" = e.id))`;
}

export type MountWindows = Map<string, BeamMountedDuringRow[]>;

/** Makine başına süzgeç leventlerinin bağlı olduğu pencereler (`[from, to)`, defterden). */
export async function mountWindowsForBeams(client: { $queryRawUnsafe: Client["$queryRawUnsafe"] }, f: BeamLotFilter, machineIds: string[], window: { from: Date; to: Date }): Promise<MountWindows> {
  const out: MountWindows = new Map();
  const wanted = new Set(f.beamIds);
  for (const machineId of machineIds) {
    const rows = await beamsMountedDuring(client, machineId, window.from, window.to);
    out.set(machineId, rows.filter((r) => wanted.has(r.beamId)));
  }
  return out;
}

/** Vardiya penceresi `[startsAt, endsAt)` ile bağ penceresi kesişiyor mu (açık bağ = ∞). */
export function shiftHasBeam(windows: MountWindows, machineId: string, startsAt: Date, endsAt: Date): boolean {
  const rows = windows.get(machineId) ?? [];
  return rows.some((w) => w.mountedAt < endsAt && (w.dismountedAt == null || w.dismountedAt > startsAt));
}

export interface BeamOption { id: string; leventNo: string }
export const BEAM_OPTIONS_MAX = 200;

/** R5b-b2: pencerede verilen tezgahlara bağlı geçen leventler (panel seçicisi kaynağı; süzgeçten BAĞIMSIZ). En çok 200, levent no sıralı. */
export async function beamsMountedOnMachinesDuring(client: { $queryRawUnsafe: Client["$queryRawUnsafe"] }, machineIds: string[], from: Date, to: Date): Promise<BeamOption[]> {
  const seen = new Map<string, string>();
  for (const machineId of machineIds) {
    for (const r of await beamsMountedDuring(client, machineId, from, to)) seen.set(r.beamId, r.beamNo);
  }
  return [...seen.entries()].map(([id, leventNo]) => ({ id, leventNo })).sort((a, b) => a.leventNo.localeCompare(b.leventNo, "tr")).slice(0, BEAM_OPTIONS_MAX);
}
