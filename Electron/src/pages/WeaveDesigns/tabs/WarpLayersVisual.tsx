// Ürün çözgüsünün tel düzeni: zemin + ek katmanlar (döner…) alt alta, her biri kendi raporuyla.
// Açılım sunucudan (`item-construction` → `endsSequence`); yoksa oransal blok.
import { WarpEndsStrip, type WarpEndsStripYarn } from "@/components/weave/WarpEndsStrip";
import { constructionSlots } from "@/components/weave/shared-palette";
import { WARP_LAYER_ROLE_LABEL, type EffectiveConstruction, type WarpRef } from "../types";

/** Kart satırları (sıralı) → şerit iplikleri; satırsız eski yanıtta ana iplik × toplam tel. */
export function stripYarnsOf(w: WarpRef): WarpEndsStripYarn[] {
  const rows = w.yarns && w.yarns.length > 0 ? [...w.yarns].sort((a, b) => a.sortOrder - b.sortOrder) : null;
  if (rows) return rows.map((r) => ({ label: r.yarnItem?.name ?? "İplik", endsCount: r.endsCount }));
  return [{ label: w.yarnItem?.name ?? "İplik", endsCount: w.endsCount }];
}

export function WarpLayersVisual({ construction }: { construction: EffectiveConstruction }) {
  const bands: Array<{ key: string; title: string; warp: WarpRef }> = [];
  if (construction.groundWarp) bands.push({ key: "ground", title: "Zemin", warp: construction.groundWarp });
  for (const l of construction.warpLayers) bands.push({ key: l.warpSpec.id, title: WARP_LAYER_ROLE_LABEL[l.role] ?? l.role, warp: l.warpSpec });
  if (bands.length === 0) return null;
  // Zemin + döner aynı ekranda: harf/renk iplik bazlı ortak listeden (aynı iplik her bantta aynı harf).
  const slots = constructionSlots(bands.map((b) => b.warp)).warp;
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3" data-testid="warp-layers-visual">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tel düzeni (çözgü raporu)</h4>
      {bands.map((b, i) => (
        <WarpEndsStrip key={b.key} title={`${b.title} · ${b.warp.code}`} yarns={stripYarnsOf(b.warp)} slots={slots[i]}
          endsSequence={b.warp.endsSequence ?? null} sequenceNote={b.warp.sequenceNote} cardEnds={b.warp.endsCount} />
      ))}
    </div>
  );
}
