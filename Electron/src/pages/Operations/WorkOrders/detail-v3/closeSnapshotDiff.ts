// Kapanış künyesi ↔ bugünkü üretim çıktısı karşılaştırması (saf, test edilir).
// Künye kapanış anında donar; canlı küme bugün okunur. İkisi AYNI tanımdan
// (`producedOutputWhere`) doğduğu için buradaki her fark gerçek bir olaydır.
import type { RollStatus } from "@/types/enums";
import { rollStatusLabels } from "@/types/enums";

export interface CloseSnapshotLine {
  rollId: string;
  barcode: string | null;
  producedQtyM: number;
  qtyM: number;
  colorLabel: string | null;
  qualityGrade: string | null;
  bucket: string;
  status: string;
}

export interface LiveProducedItem {
  id: string;
  barcode: string | null;
  qualityGrade: string;
  /** Üretim metresi (initialQty) — künyenin `producedQtyM`i ile aynı ölçü. */
  currentQty: number;
  status: RollStatus;
  color: { name: string } | null;
}

export interface RollChange {
  rollId: string;
  barcode: string | null;
  /** Kısa, okunur değişim cümleleri (ör. "Sevk edildi", "Kalite: 1.KALITE → FIRE"). */
  changes: string[];
}

const statusLabel = (s: string) => rollStatusLabels[s as RollStatus] ?? s;
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("tr-TR");

/** Top başına fark — değişmeyen top listede YOK (simple is more). */
export function diffCloseSnapshot(lines: CloseSnapshotLine[], live: LiveProducedItem[]): RollChange[] {
  const liveById = new Map(live.map((r) => [r.id, r]));
  const out: RollChange[] = [];
  for (const l of lines) {
    const r = liveById.get(l.rollId);
    if (!r) {
      out.push({ rollId: l.rollId, barcode: l.barcode, changes: ["Çıktı listesinden düştü (yeniden işlendi ya da iptal)"] });
      continue;
    }
    const c: string[] = [];
    if (r.status !== l.status) c.push(`Durum: ${statusLabel(l.status)} → ${statusLabel(r.status)}`);
    if ((r.qualityGrade || null) !== (l.qualityGrade || null)) c.push(`Kalite: ${l.qualityGrade ?? "—"} → ${r.qualityGrade || "—"}`);
    if ((r.color?.name ?? null) !== l.colorLabel) c.push(`Renk: ${l.colorLabel ?? "—"} → ${r.color?.name ?? "—"}`);
    const dm = r.currentQty - l.producedQtyM;
    if (Math.abs(dm) >= 0.05) c.push(`Metre: ${fmt(l.producedQtyM)} → ${fmt(r.currentQty)}`);
    if (c.length) out.push({ rollId: l.rollId, barcode: l.barcode, changes: c });
  }
  const inSnapshot = new Set(lines.map((l) => l.rollId));
  for (const r of live) {
    if (!inSnapshot.has(r.id)) out.push({ rollId: r.id, barcode: r.barcode, changes: ["Kapanıştan sonra eklendi"] });
  }
  return out;
}

/** "−1 top, −19 m" — fark yoksa null. İşaretli, sıfır bileşen yazılmaz. */
export function totalsDelta(
  snap: { count: number; meters: number },
  live: { count: number; meters: number },
): string | null {
  const dc = live.count - snap.count;
  const dm = Math.round((live.meters - snap.meters) * 10) / 10;
  const parts: string[] = [];
  if (dc !== 0) parts.push(`${dc > 0 ? "+" : "−"}${Math.abs(dc)} top`);
  if (dm !== 0) parts.push(`${dm > 0 ? "+" : "−"}${fmt(Math.abs(dm))} m`);
  return parts.length ? parts.join(", ") : null;
}
