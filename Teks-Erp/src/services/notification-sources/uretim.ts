// =============================================================================
// ÜRETİM · DOKUMA · KURŞUN · TAMBUR · BAKIM OLAYLARI — S2 (geniş katalog 2026-11-14)
// =============================================================================
// Her OLAY türünün TEK yayma noktası bu dosyadaki fonksiyondur; çağıranlar iş kaydını değiştiren tx'in İÇİNDEN,
// durum geçişinin tek boğazından çağırır (duruş → `machine-stop.service`, levent → `applyWarpBeamEventTx`,
// kurşun → `applyKursunOperationTx`). Replay/no-op yolunda çağrılmaz. Bayrak kapalıyken no-op; yük tutar taşımaz.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { BREAKDOWN_STOP_REASON_CODES } from "../../constants/reason-presets";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { readKursunTarget } from "../helpers/process-summary.helper";
import { off, who, type Actor } from "./satis";

type Tx = EmitDb & Prisma.TransactionClient;

/** Arıza duruşu mu — `bakim.*` türlerinin tek yüklemi (KOSUL kaynağı da bunu okur). */
export const isBreakdownReason = (code: string | null | undefined): boolean => !!code && BREAKDOWN_STOP_REASON_CODES.includes(code);

const clip = (s: string, n = 120): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── Bakım ───────────────────────────────────────────────────────────────────
async function stopFacts(tx: Tx, stopId: string) {
  const s = await tx.machineStopEvent.findUnique({
    where: { id: stopId },
    select: { id: true, reasonCode: true, durationSec: true, revokedAt: true, machine: { select: { id: true, name: true } } },
  });
  if (!s || s.revokedAt || !isBreakdownReason(s.reasonCode)) return null;
  const preset = await tx.reasonPreset.findFirst({ where: { kind: "MACHINE_STOP", code: s.reasonCode! }, select: { label: true } });
  return { ...s, sebep: preset?.label ?? s.reasonCode! };
}

/** `bakim.ariza` — duruş arıza sebebiyle sınıflandı (sebepli açılış · ilk sınıflama · arızaya yeniden sınıflama). */
export async function emitBreakdownStopTx(tx: Tx, stopId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await stopFacts(tx, stopId);
  if (!f) return;
  await emitNotification(tx, "bakim.ariza", { type: "machine_stop", id: stopId, key: f.machine.id }, {
    makineId: f.machine.id, makineAd: f.machine.name, sebep: f.sebep,
  }, { actorUserId: who(actor) });
}

/** `bakim.tamamlandi` — arıza sebepli duruş kapandı (`closeStopCore` ana claim'i). */
export async function emitBreakdownClosedTx(tx: Tx, stopId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await stopFacts(tx, stopId);
  if (!f) return;
  await emitNotification(tx, "bakim.tamamlandi", { type: "machine_stop", id: stopId, key: f.machine.id }, {
    makineId: f.machine.id, makineAd: f.machine.name, sebep: f.sebep, sureDk: Math.round((f.durationSec ?? 0) / 60),
  }, { actorUserId: who(actor) });
}

// ── Levent ──────────────────────────────────────────────────────────────────
/** `dokuma.levent-takildi` (MOUNTED) · `dokuma.levent-bitti` (EXHAUSTED) — levent olayının tek yazarı `applyWarpBeamEventTx`. */
export async function emitWarpBeamEventTx(
  tx: Tx,
  { beamId, kind, machineId }: { beamId: string; kind: string; machineId: string | null },
  actor: Actor,
): Promise<void> {
  if (kind !== "MOUNTED" && kind !== "EXHAUSTED") return;
  if (await off(tx)) return;
  const beam = await tx.warpBeam.findUnique({ where: { id: beamId }, select: { beamNo: true } });
  if (!beam) return;
  const m = machineId ? await tx.machine.findUnique({ where: { id: machineId }, select: { name: true } }) : null;
  const subject = { type: "warp_beam", id: beamId, key: beamId };
  const payload = { leventId: beamId, leventNo: beam.beamNo, tezgahAd: m?.name ?? "—" };
  const opts = { actorUserId: who(actor) };
  if (kind === "MOUNTED") await emitNotification(tx, "dokuma.levent-takildi", subject, payload, opts);
  else await emitNotification(tx, "dokuma.levent-bitti", subject, payload, opts);
}

// ── Koşum (desen/renk) ──────────────────────────────────────────────────────
type RunFabric = { itemId: string | null; colorId: string | null };

async function fabricLabel(tx: Tx, f: RunFabric): Promise<string> {
  const item = f.itemId ? await tx.item.findUnique({ where: { id: f.itemId }, select: { name: true } }) : null;
  const color = f.colorId ? await tx.color.findUnique({ where: { id: f.colorId }, select: { name: true } }) : null;
  return [item?.name, color?.name].filter(Boolean).join(" · ") || "—";
}

/** `dokuma.desen-degisti` — koşum "Değiştir" ile yenilendi ve kumaş/renk farklı (`openMachineRunFresh`). */
export async function emitRunPatternChangedTx(
  tx: Tx,
  { machineId, from, to }: { machineId: string; from: RunFabric; to: RunFabric },
  actor: Actor,
): Promise<void> {
  if (from.itemId === to.itemId && from.colorId === to.colorId) return;
  if (await off(tx)) return;
  const m = await tx.machine.findUnique({ where: { id: machineId }, select: { name: true } });
  if (!m) return;
  await emitNotification(tx, "dokuma.desen-degisti", { type: "machine", id: machineId, key: machineId }, {
    tezgahId: machineId, tezgahAd: m.name, eskiKumas: await fabricLabel(tx, from), yeniKumas: await fabricLabel(tx, to),
  }, { actorUserId: who(actor) });
}

// ── Kurşun ──────────────────────────────────────────────────────────────────
/** `kursun.gramaj-sapmasi` — basılan gramaj İE'nin aktif hedefinden farklı (`applyKursunOperationTx` yeni satırı). */
export async function emitKursunDeviationTx(
  tx: Tx,
  a: { rollId: string; stepId: string; valueId: string | null },
  actor: Actor,
): Promise<void> {
  if (!a.valueId) return;
  if (await off(tx)) return;
  const step = await tx.workOrderStep.findUnique({ where: { id: a.stepId }, select: { workOrderId: true, workOrder: { select: { workOrderNumber: true } } } });
  if (!step) return;
  // Hedef = İE kartı/raporla AYNI okuyucu (`readKursunTarget`); hedef yoksa sapma yok.
  const target = await readKursunTarget(step.workOrderId, tx);
  if (!target || target.valueId === a.valueId) return;
  const roll = await tx.roll.findUnique({ where: { id: a.rollId }, select: { barcode: true } });
  const value = await tx.fabricPropertyValue.findUnique({ where: { id: a.valueId }, select: { name: true } });
  await emitNotification(tx, "kursun.gramaj-sapmasi", { type: "work_order", id: step.workOrderId, key: step.workOrderId }, {
    isEmriId: step.workOrderId, isEmriNo: step.workOrder.workOrderNumber, topNo: roll?.barcode ?? "—",
    gramaj: value?.name ?? "—", hedef: target.valueName,
  }, { actorUserId: who(actor) });
}

// ── Tambur ──────────────────────────────────────────────────────────────────
/** `tambur.yeniden-islem` — Tambur'daki top boya adımına geri gönderildi (`sendToDye` → `manualMove` tx'i). */
export async function emitSendToDyeTx(
  tx: Tx,
  a: { workOrderId: string; workOrderNumber: string; rollBarcode: string | null; targetStationName: string; reason: string },
  actor: Actor,
): Promise<void> {
  if (await off(tx)) return;
  await emitNotification(tx, "tambur.yeniden-islem", { type: "work_order", id: a.workOrderId, key: a.workOrderId }, {
    isEmriId: a.workOrderId, isEmriNo: a.workOrderNumber, topNo: a.rollBarcode ?? "—",
    istasyonAd: a.targetStationName, sebep: clip(a.reason.trim()),
  }, { actorUserId: who(actor) });
}
