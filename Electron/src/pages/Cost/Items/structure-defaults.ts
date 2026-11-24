// Yapı alanı boş bırakılırsa hesaba giren değer (kart / parametre) — girdi anlık görüntüsünden okunur.
// Kaynak YAPI ise yedek değeri istemci bilmez (sunucu firstOf zinciri), yer tutucu genel kalır.
import type { CostInputSnap, Sourced } from "../shared/cost-types";
import { fmtDecFull } from "../shared/format";
import { SOURCE_LABEL } from "../shared/labels";
import type { StructureKey } from "./service";

export function structureDefault(g: CostInputSnap | undefined, k: StructureKey): Sourced | null {
  if (!g) return null;
  switch (k) {
    case "loomRpm": return g.loom?.rpm ?? null;
    case "efficiencyPct": return g.loom?.efficiencyPct ?? null;
    case "warpWastePct": return g.warp?.wastePct ?? null;
    case "weftWastePct": return g.weft?.wastePct ?? null;
    case "fabricWastePct": return g.fabricWastePct ?? null;
    case "weftLengthCm": return g.weft?.lengthCm ?? null;
    case "beamLengthM": return g.beam?.lengthM ?? null;
    case "lengthShrinkPct": return g.lengthShrinkPct ?? null;
    case "extraCostPerMTry": return null;
  }
}

/** Yer tutucu: "3 · Parametre"; değer yoksa "boş = varsayılan". */
export function defaultPlaceholder(s: Sourced | null): string {
  if (!s || s.source === "YAPI" || s.value === null || s.value === "") return "boş = varsayılan";
  return `${fmtDecFull(s.value)} · ${SOURCE_LABEL[s.source] ?? s.source}`;
}
