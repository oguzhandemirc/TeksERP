import { Search, X, ShoppingBag, Package, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FacetSelect } from "./FacetSelect";
import type { FacetKind, ShipmentDetailFilter } from "./useShipmentDetailFilter";

const chipPrefix: Record<FacetKind, string> = { item: "Kumaş", color: "Renk", quality: "Kalite", width: "En" };

/** Sevkiyat detay araç çubuğu — arama + facet'ler (kumaş/renk/kalite/en) + sağda
 *  çuval/top özet pill'i + "Tümünü Aç/Kapat"; altta (varsa) kaldırılabilir çipler.
 *  Liste panelinin SABİT başlığı: alt ayraç + hafif zemin ile kayan liste kartıyla
 *  tek blok oluşturur. */
export function ShipmentDetailToolbar({ f }: { f: ShipmentDetailFilter }) {
  return (
    <div className="shrink-0 space-y-2 border-b bg-muted/20 px-3 py-2.5">
      {/* Filtreler + (sağda) çuval/top özet pill'i + Tümünü Aç — TEK satır, sarmaz;
          taşarsa satır yatay kaydırılır (pill hep üstte kalır, aşağı inmez). */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <div className="relative w-72 shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={f.q}
            onChange={(e) => f.setQ(e.target.value)}
            placeholder="Barkod, kumaş, renk, çuval no..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        <FacetSelect
          label="Kumaş"
          options={f.itemOptions.map((o) => ({ value: o.id, label: o.name }))}
          selected={f.itemFacet}
          onToggle={f.toggleItem}
          onClear={f.clearItem}
        />
        <FacetSelect
          label="Renk"
          options={f.colorOptions.map((o) => ({ value: o.id, label: o.name }))}
          selected={f.colorFacet}
          onToggle={f.toggleColor}
          onClear={f.clearColor}
        />
        <FacetSelect
          label="Kalite"
          options={f.qualityOptions.map((g) => ({ value: g, label: g }))}
          selected={f.qualityFacet}
          onToggle={f.toggleQuality}
          onClear={f.clearQuality}
        />
        <FacetSelect
          label="En"
          options={f.widthOptions.map((o) => ({ value: o.id, label: o.name }))}
          selected={f.widthFacet}
          onToggle={f.toggleWidth}
          onClear={f.clearWidth}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <CountPill f={f} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={f.allExpanded ? f.collapseAll : f.expandAll}
          >
            {f.allExpanded ? "Tümünü Kapat" : "Tümünü Aç"}
          </Button>
        </div>
      </div>

      {/* Aktif facet çipleri — yalnız filtre varken. */}
      {f.activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {f.activeChips.map((c) => (
            <Badge
              key={`${c.kind}:${c.value}`}
              variant="outline"
              className="gap-1 border-primary/40 bg-primary/5 py-0.5 pl-2 pr-1 text-xs font-normal"
            >
              <span className="text-muted-foreground">{chipPrefix[c.kind]}:</span>
              {c.label}
              <button
                type="button"
                onClick={() => f.removeChip(c.kind, c.value)}
                className="ml-0.5 rounded-sm p-0.5 hover:bg-muted"
                aria-label={`${chipPrefix[c.kind]} ${c.label} filtresini kaldır`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            onClick={f.clearAll}
          >
            Tümünü temizle
          </Button>
        </div>
      )}
    </div>
  );
}

/** Çuval/top özeti — Envanter RollsStats pill'iyle aynı stil (bordürlü, primary-tonlu,
 *  ikon + kalın değer + birim). Filtre aktifken "eşleşen/toplam" gösterir. */
function CountPill({ f }: { f: ShipmentDetailFilter }) {
  const sackVal = f.isFiltering ? `${f.filteredSacks.length}/${f.totalSacks}` : `${f.totalSacks}`;
  const rollVal = f.isFiltering ? `${f.matchCount}/${f.totalRolls}` : `${f.totalRolls}`;
  return (
    <div className="flex h-8 items-center gap-2.5 rounded-md border border-primary/25 bg-primary/5 px-3 shadow-sm">
      <PillStat icon={ShoppingBag} value={sackVal} unit="çuval" />
      <span className="h-3.5 w-px bg-primary/20" aria-hidden />
      <PillStat icon={Package} value={rollVal} unit="top" />
    </div>
  );
}

function PillStat({ icon: Icon, value, unit }: { icon: LucideIcon; value: string; unit: string }) {
  return (
    <div className="flex items-center gap-1">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <span className="text-sm font-bold text-foreground tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{unit}</span>
    </div>
  );
}
