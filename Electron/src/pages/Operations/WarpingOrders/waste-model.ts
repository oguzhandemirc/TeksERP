// Sipariş özetindeki "Fire" metni — fireli öneri YÜZDE fireyle hesaplanır, sabit metre yalnız ek paydır.
// Yüzde sipariş açılışında iplik başına donar (`yarns[].wastePct`); KAYNAĞI saklanmaz → bugünkü kart/iplik değerleriyle
// aynı hesabı soran önizlemenin `wasteSources`ından okunur. Değer değişmişse "açılıştaki değer" denir (yanlış kaynak basılmaz).
import { formatQty } from "@/lib/format";
import { isBeamCountOpen } from "./order-model";
import type { WarpingOrder, WarpingOrderPreview, WarpWasteSource } from "./types";

export type WasteSourceLabel = "çözgü kartı" | "iplik kartı" | "açılıştaki değer" | null;

export function wasteSourceOf(yarnItemId: string, frozenPct: string, pv: WarpingOrderPreview | undefined): WasteSourceLabel {
  if (!pv?.wasteSources) return null;
  const now = pv.yarns.find((y) => y.yarnItemId === yarnItemId);
  if (!now || Number(now.wastePct) !== Number(frozenPct)) return "açılıştaki değer";
  if (now.wasteSource) return now.wasteSource === "IPLIK" ? "iplik kartı" : "çözgü kartı";
  const own = pv.wasteSources.some((s: WarpWasteSource) => s.kind === "IPLIK_PCT" && s.yarnItemId === yarnItemId);
  return own ? "iplik kartı" : "çözgü kartı";
}

const pctText = (pct: string, src: WasteSourceLabel) => `%${formatQty(pct, 2, 0)}${src ? ` (${src})` : ""}`;

/** Tüm ipliklerde aynı yüzde + kaynak → tek ifade; değilse harf başına. Yüzde fire yoksa "yok". */
export function percentWasteText(o: Pick<WarpingOrder, "yarns">, pv: WarpingOrderPreview | undefined): string {
  if (o.yarns.every((y) => Number(y.wastePct) === 0)) return "yok";
  const parts = o.yarns.map((y) => ({ letter: y.letter, text: pctText(y.wastePct, Number(y.wastePct) === 0 ? null : wasteSourceOf(y.yarnItemId, y.wastePct, pv)) }));
  const uniq = new Set(parts.map((p) => p.text));
  return uniq.size === 1 ? parts[0]!.text : parts.map((p) => `${p.letter} ${p.text}`).join(" · ");
}

/** Önizleme gövdesi siparişin donmuş girdileriyle — bugünkü kart değerleriyle aynı hesap. */
export function orderPreviewBody(o: WarpingOrder) {
  return {
    warpSpecId: o.warpSpec.id,
    ...(isBeamCountOpen(o)
      ? { openTargetLengthM: Number(o.targetLengthM) }
      : { beamLines: o.beamLines.map((b) => ({ beamCount: b.beamCount, beamLengthM: Number(b.beamLengthM) })) }),
    ...(o.extraSpecs.length > 0 ? { extraWarpSpecIds: o.extraSpecs.map((e) => e.id) } : {}),
    fixedWasteM: Number(o.fixedWasteM),
  };
}
