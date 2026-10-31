// =============================================================================
// TeksERP — Devere Faz 4: TOP TEZGAHTAN DOĞAR → bağlı leventlerden OTOMATİK tüketim (CONSUMED.rollId)
// =============================================================================
// Çağıran KK1 doğuş tx'idir (`createInitialEntry`, WEAVING + doff bağı) — bu dosya tx AÇMAZ, alır.
// Hangi levent: DEFTERDEN, doff ANINDA (`beamsMountedDuring(machine, doffedAt, doffedAt)`); "şu an bağlı"
// değil — KK1 saatler sonra gelse ve levent sökülmüş olsa bile doğru levent düşer. Her levente AYRI
// satır (çift levent = iki satır, pay bölünmez): çözgü = kumaş ÷ (1 − takeUp/100); take-up NULL → çözgü =
// kumaş + UYARI. Çok hatlı makine: hat payı = kumaş ÷ productionLineCount (beyanlı yaklaşıklık, 1e H2).
// Kalan yetmezse KK1 ENGELLENMEZ: kalana kadar yazılır + uyarı (H3; elle yol `assertCoversRemaining` sert).
// Ters yol: top iptali (CANCEL) → CONSUMED_CANCEL; SCRAP'ta YAZILMAZ — çözgü gerçekten tüketildi (H4).
// Bayrak `devere.autoConsume` DEFAULT false: kapalıyken bu dosya HİÇ satır/uyarı üretmez (bayt bayt).
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { readDevereAutoConsume, readDevereEnabled } from "./system-setting.service";
import { applyWarpBeamEventTx } from "./helpers/warp-beam-event.helper";
import { beamsMountedDuring, type BeamMountedDuringRow } from "./helpers/warp-beam-mount.helper";
import { remainingMTx } from "./helpers/warp-beam-ledger.helper";
import { readSharedBeamGroupsForRoll } from "./helpers/effective-construction.helper";
import { fastestGroupTakeUpPct } from "./helpers/warp-layer-beam.helper";
import { KK1_BEAM_CHANGE_WINDOW_HOURS, KK1_BEAM_CHANGE_WINDOW_MS } from "../constants/dokuma-kk1";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface AutoConsumeInput {
  rollId: string;
  doffEventId: string;
  /** Topun ölçülen kumaş metresi (`Roll.initialQty`). */
  fabricLengthM: Prisma.Decimal.Value;
  userId?: string | null;
  /**
   * S1 (D10): KK1'de BEYAN edilen levent — verilirse `beamsMountedDuring` yerine o levent düşer.
   * Şart: o tezgahta son `KK1_BEAM_CHANGE_WINDOW_HOURS` içinde MOUNTED ya da DISMOUNTED olayı;
   * yoksa 400 `WARP_BEAM_NOT_RECENT` (operatör sökümden sonra gelse de doğru levent düşer, uydurma düşmez).
   */
  beamOverrideId?: string | null;
}

/**
 * Beyan edilen leventi pencere kapısından geçirir ve `beamsMountedDuring` satırı biçiminde döner.
 * Pencere çıpası `doffedAt` (DB saati) — olay `createdAt`i de DB saatinden (tek saat kaynağı).
 */
async function resolveBeamOverrideTx(tx: Tx, beamId: string, machineId: string, doffedAt: Date): Promise<BeamMountedDuringRow> {
  const beam = await tx.warpBeam.findUnique({ where: { id: beamId }, select: { id: true, beamNo: true } });
  if (!beam) throw AppError.notFound("Levent bulunamadı", { code: "WARP_BEAM_NOT_FOUND", warpBeamId: beamId });
  const since = new Date(doffedAt.getTime() - KK1_BEAM_CHANGE_WINDOW_MS);
  const recent = await tx.warpBeamEvent.findFirst({
    where: { beamId, machineId, kind: { in: ["MOUNTED", "DISMOUNTED"] }, createdAt: { gte: since } },
    // "en son" okuyucusu eşitlik bozucuyla (aynı ms'de iki olay → id belirlenimli).
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { kind: true, mountPosition: true, createdAt: true },
  });
  if (!recent) {
    throw AppError.badRequest(
      `${beam.beamNo} leventi bu tezgaha son ${KK1_BEAM_CHANGE_WINDOW_HOURS} saat içinde takılmamış/sökülmemiş — levent beyanı kabul edilmedi.`,
      { code: "WARP_BEAM_NOT_RECENT", warpBeamId: beamId, machineId, windowHours: KK1_BEAM_CHANGE_WINDOW_HOURS },
    );
  }
  return { beamId: beam.id, beamNo: beam.beamNo, mountPosition: recent.mountPosition, mountedAt: recent.createdAt, dismountedAt: recent.kind === "DISMOUNTED" ? recent.createdAt : null };
}

/** Çözgü metresi: kumaş ÷ (1 − takeUp/100); take-up NULL → kumaş (ESTIMATED + uyarı). */
export function warpLengthFromFabric(fabricM: Prisma.Decimal, takeUpPct: Prisma.Decimal | null): Prisma.Decimal {
  if (takeUpPct == null) return fabricM.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  const factor = D(1).minus(takeUpPct.div(100));
  if (factor.lte(0)) return fabricM.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  return fabricM.div(factor).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * KK1 doğuş tx'inde, top satırı yaratıldıktan SONRA. Döner: uyarılar (KK1 yanıtının `warnings`ına eklenir).
 * Bayrak kapalı → [] (hiç sorgu bile yapılmaz). Bağlı levent yok → uyarı.
 */
export async function autoConsumeForRollTx(tx: Tx, input: AutoConsumeInput): Promise<string[]> {
  if (!(await readDevereAutoConsume(tx)) || !(await readDevereEnabled(tx))) {
    // Bayrak kapalıyken bayt bayt sessiz — yalnız YENİ alan (levent beyanı) geldiyse kayıp adıyla söylenir.
    return input.beamOverrideId ? ["Levent beyanı yok sayıldı — levent otomatik tüketimi (devere.autoConsume) kapalı."] : [];
  }
  const warnings: string[] = [];
  const doff = await tx.doffEvent.findUnique({ where: { id: input.doffEventId }, select: { machineId: true, doffedAt: true, machine: { select: { code: true, productionLineCount: true } } } });
  if (!doff) return warnings;
  // S1: beyan edilen levent pencere kapısından geçerse DEFTER penceresinin yerine o düşer (D10).
  const mounted = input.beamOverrideId
    ? [await resolveBeamOverrideTx(tx, input.beamOverrideId, doff.machineId, doff.doffedAt)]
    : await beamsMountedDuring(tx, doff.machineId, doff.doffedAt, doff.doffedAt);
  if (mounted.length === 0) {
    warnings.push(`${doff.machine.code}: indirme anında tezgahta bağlı levent yoktu — çözgü tüketimi yazılmadı (elle tüketim gerekebilir).`);
    return warnings;
  }
  const lines = Math.max(1, doff.machine.productionLineCount);
  const fabric = D(input.fabricLengthM).div(lines).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (lines > 1) warnings.push(`${doff.machine.code} ${lines} hatlı — top metresi hat payı olarak düşüldü (${fabric} m/levent; kardeş hat topları kendi payını düşer).`);
  // SY-B1 SHARED_BEAM: zemin leventinde ek tel grubu varsa kalan EN HIZLI tükenen gruptan düşer.
  const shared = await readSharedBeamGroupsForRoll(tx, input.rollId);
  for (const m of mounted) {
    const beam = await tx.warpBeam.findUniqueOrThrow({ where: { id: m.beamId }, select: { id: true, beamNo: true, status: true, currentMachineId: true, warpSpecId: true, warpSpec: { select: { takeUpPct: true } } } });
    const isSharedGround = shared !== null && beam.warpSpecId === shared.groundWarpSpecId;
    const takeUp = isSharedGround ? fastestGroupTakeUpPct(beam.warpSpec.takeUpPct, shared.layers) : beam.warpSpec.takeUpPct;
    const wanted = warpLengthFromFabric(fabric, takeUp);
    if (takeUp == null) warnings.push(`${beam.beamNo}: çözgü kartında take-up yok — çözgü = kumaş sayıldı (${wanted} m, tahmin).`);
    const remaining = await remainingMTx(tx, beam.id);
    const lengthM = Prisma.Decimal.min(wanted, remaining);
    if (lengthM.lte(0)) {
      warnings.push(`${beam.beamNo}: kalan 0 m — ${wanted} m tüketim yazılamadı (levent bitmiş olabilir; elle düzeltin).`);
      continue;
    }
    if (lengthM.lt(wanted)) warnings.push(`${beam.beamNo}: kalan ${remaining} m yetmedi — ${lengthM} m yazıldı, ${wanted.minus(lengthM)} m açık (kalanı düzeltin).`);
    // Terminal/sevkte levent (doff sonrası bitmiş olabilir): durum değişmez, claim aynı durumdan aynı duruma.
    await applyWarpBeamEventTx(tx, {
      beamId: beam.id,
      kind: "CONSUMED",
      from: beam.status,
      to: beam.status,
      data: { rollId: input.rollId, lengthM, lengthSource: "ESTIMATED", fabricLengthM: fabric, machineId: doff.machineId, mountPosition: m.mountPosition, reason: takeUp == null ? "Top doğuşu — take-up bilinmiyor, çözgü = kumaş" : `Top doğuşu — ${isSharedGround ? "ortak levent, en hızlı grup " : ""}take-up %${takeUp}`, createdById: input.userId ?? null },
    });
  }
  return warnings;
}

/** Top İPTALİ (CANCEL) tx'inde: bu toptan doğan her aktif CONSUMED için CONSUMED_CANCEL (ters bağ). SCRAP'ta ÇAĞRILMAZ. */
export async function cancelConsumedForRollTx(tx: Tx, rollId: string, reason: string, userId?: string | null): Promise<number> {
  const rows = await tx.warpBeamEvent.findMany({ where: { rollId, kind: "CONSUMED", reversal: null }, select: { id: true, beamId: true, lengthM: true, machineId: true, beam: { select: { status: true } } } });
  for (const ev of rows) {
    await applyWarpBeamEventTx(tx, { beamId: ev.beamId, kind: "CONSUMED_CANCEL", from: ev.beam.status, to: ev.beam.status, data: { reversesEventId: ev.id, rollId, lengthM: ev.lengthM, machineId: ev.machineId, reason: `Top iptali: ${reason}`.slice(0, 300), createdById: userId ?? null } });
  }
  return rows.length;
}

/** Top GERİ ALINDIĞINDA (restore) yeniden ileri yol: aynı hesapla yeni CONSUMED satırları (ters bağ yok). */
export async function reconsumeForRollTx(tx: Tx, roll: { id: string; doffEventId: string | null; initialQty: Prisma.Decimal.Value }, userId?: string | null): Promise<string[]> {
  if (!roll.doffEventId) return [];
  return autoConsumeForRollTx(tx, { rollId: roll.id, doffEventId: roll.doffEventId, fabricLengthM: roll.initialQty, userId });
}
