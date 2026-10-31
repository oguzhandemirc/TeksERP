// =============================================================================
// DOKUMA İŞ EMRİ — etkin yapı özeti (salt-okunur; Seyitoğlu SY-A4, tasarım §2.8)
// =============================================================================
// Sunucunun TEK cevabını (`GET /api/item-construction/:itemId?recipeId=`) gösterir; istemci yapı
// hesaplamaz. Uyarılar kaydı engellemez, yalnız görünür.
// =============================================================================
import { AlertTriangle } from "lucide-react";
import type { EffectiveConstruction } from "@/pages/Items/construction-service";

const LAYER_MODE: Record<string, string> = { SEPARATE_BEAM: "ayrı levent", SHARED_BEAM: "zeminle aynı levent", CREEL: "cağlık" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function ConstructionSummary({ data, loading }: { data: EffectiveConstruction | null | undefined; loading: boolean }) {
  if (loading) return <p className="text-xs text-muted-foreground">Ürün yapısı okunuyor…</p>;
  if (!data) return null;
  const empty = !data.groundWarp && data.warpLayers.length === 0 && !data.weft && !data.weaveDesign;
  if (empty) return <p className="text-xs text-muted-foreground">Bu üründe atkı/desen kartı tanımlı değil.</p>;
  const w = data.weft;
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs" data-testid="construction-summary">
      <p className="text-sm font-medium">Etkin yapı{data.variantCode ? ` · ${data.variantCode}` : ""}</p>
      {data.groundWarp && <Row label="Zemin çözgü">{data.groundWarp.code} · {data.groundWarp.name}</Row>}
      {data.warpLayers.map((l) => (
        <Row key={l.sortOrder} label="Ek çözgü">
          {l.warpSpec.code} · {LAYER_MODE[l.beamMode] ?? l.beamMode}
        </Row>
      ))}
      {w && (
        <Row label="Atkı">
          {w.code}
          {w.sequenceCode ? ` · ${w.sequenceCode}` : ""}
          {w.picksPerCm != null ? ` · ${Number(w.picksPerCm)} atkı/cm` : ""}
          {w.weftProgramNo ? ` · WEFT ${w.weftProgramNo}` : ""}
        </Row>
      )}
      {w?.yarns.map((y) => (
        <Row key={y.sortOrder} label={`  ${y.letter}`}>
          {y.yarnItem.code} × {y.picksInRepeat}
          {y.cardYarnItem ? <span className="text-amber-700 dark:text-amber-400"> (varyant: kartta {y.cardYarnItem.code})</span> : null}
        </Row>
      ))}
      {data.weaveDesign && (
        <Row label="Desen">
          {data.weaveDesign.code} · {data.weaveDesign.kind}
          {data.weaveDesign.loomFileName ? ` · ${data.weaveDesign.loomFileName}` : ""}
        </Row>
      )}
      {data.warnings.map((x) => (
        <p key={x.code} className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {x.message}
        </p>
      ))}
    </div>
  );
}
