// =============================================================================
// Etiket Stüdyosu — eleman paleti (birleşik katalog alanları + yapısal elemanlar)
// =============================================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Type, QrCode, Barcode, Minus, Square, Ruler, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  labelTemplateService,
  labelKindLabels,
  type UnifiedCatalogField,
} from "@/services/labelTemplateService";
import type { LabelElementType } from "@/types/label-canvas";
import { skippedLanguages } from "@/types/label-canvas";
import { useIconCatalog } from "./useIconCatalog";

interface Props {
  onAddField: (f: UnifiedCatalogField) => void;
  onAddStructural: (type: Exclude<LabelElementType, "field">) => void;
  onAddIcon: (iconKey: string) => void;
}

const STRUCTURAL: Array<{
  type: Exclude<LabelElementType, "field">;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { type: "text", label: "Sabit Metin", icon: Type },
  { type: "qr", label: "QR Kod", icon: QrCode },
  { type: "code128", label: "Barkod + kod (Code128)", icon: Barcode },
  { type: "line", label: "Çizgi / Dolu Kutu", icon: Minus },
  { type: "box", label: "Çerçeve", icon: Square },
  { type: "lengthBanner", label: "Metraj Bandı", icon: Ruler },
];

/** Bakım sembolleri (ISO 3758) — katalog backend registry'sinden; hata → bölüm gizli. */
function IconPaletteSection({ onAddIcon }: { onAddIcon: (iconKey: string) => void }) {
  const [open, setOpen] = useState(false);
  const { categories, icons, isLoading, isError } = useIconCatalog();
  if (isError) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="flex-1 text-left">Bakım Sembolleri</span>
        {icons.length > 0 && <span className="text-[9px] font-normal">({icons.length})</span>}
      </button>
      {open &&
        (isLoading ? (
          <Skeleton className="mt-1.5 h-10 w-full" />
        ) : (
          <div className="mt-1.5 space-y-2">
            <p className="text-[10px] leading-snug text-muted-foreground">
              ZPL/HTML tam basar; PPLA/PPLB dilinde atlanır (raster baskı hariç).
            </p>
            {categories.map((cat) => {
              const group = icons.filter((i) => i.category === cat.key);
              if (group.length === 0) return null;
              return (
                <div key={cat.key}>
                  <h5 className="mb-1 text-[10px] font-medium text-muted-foreground">{cat.label}</h5>
                  <div className="flex flex-wrap gap-1">
                    {group.map((ic) => (
                      <button
                        key={ic.key}
                        type="button"
                        title={ic.label}
                        onClick={() => onAddIcon(ic.key)}
                        className="flex h-10 w-10 items-center justify-center rounded-md border p-1 hover:bg-accent"
                      >
                        {/* SVG kendi backend'imizden (auth'lu API) — stroke=currentColor tema rengine uyar. */}
                        <span
                          className="block h-full w-full [&>svg]:h-full [&>svg]:w-full"
                          dangerouslySetInnerHTML={{ __html: ic.svg }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

export function ElementPalette({ onAddField, onAddStructural, onAddIcon }: Props) {
  const catalogQ = useQuery({
    queryKey: ["label-unified-catalog"],
    queryFn: () => labelTemplateService.unifiedCatalog(),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">Elemanlar</h4>
        <div className="space-y-1">
          {STRUCTURAL.map(({ type, label, icon: Icon }) => {
            const skipped = skippedLanguages(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => onAddStructural(type)}
                className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent"
                title={skipped.length ? `${skipped.join(", ")} dilinde basılmaz` : undefined}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{label}</span>
                {skipped.length > 0 && (
                  <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground" title={`${skipped.join(", ")} dilinde basılmaz`}>
                    {skipped.join(",")}✕
                  </span>
                )}
                <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </div>

      <IconPaletteSection onAddIcon={onAddIcon} />

      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">
          Veri Alanları
        </h4>
        <p className="mb-1.5 text-[10px] leading-snug text-muted-foreground">
          Alan o baskı bağlamında değersizse etikette boş kalır (kayma olmaz).
        </p>
        {catalogQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          // Kendi iç scroll'u YOK — sol kolon tek scrollbar'la kayar (nested scroll olmaz).
          <div className="space-y-1">
            {(catalogQ.data ?? [])
              .filter((f) => f.type !== "qr" && f.type !== "barcode")
              .map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-auto w-full justify-start gap-1.5 px-2 py-1 text-left"
                  onClick={() => onAddField(f)}
                  title={`Bağlamlar: ${f.kinds.map((k) => labelKindLabels[k]).join(", ")}`}
                >
                  <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{f.defaultLabel}</span>
                    <span className="block truncate font-mono text-[9px] text-muted-foreground">
                      {f.key} · {f.kinds.length === 3 ? "tüm bağlamlar" : f.kinds.map((k) => labelKindLabels[k].split(" ")[0]).join("+")}
                    </span>
                  </span>
                </Button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
