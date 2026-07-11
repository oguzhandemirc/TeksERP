import { PackageX, Layers, Scale } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import type { ContentSack } from "./types";

const fmtKg = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });
const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 2 });

interface Props {
  sack: ContentSack;
  /** PLANNED sevkiyatta çuval havuza geri çıkarılabilir. */
  canRemove: boolean;
  onRemove: (sack: ContentSack) => void;
  removing: boolean;
}

/**
 * Tek çuvalın SALT-OKUNUR dökümü — kod + kg + içerik ürün-özeti + top/kartela
 * listesi. `sackStoreService.shipmentContents` verisinden beslenir; içerik
 * düzenleme (rol çıkar/taşı) burada YOK (o Paketleme havuz ekranında).
 */
export function ShipmentSackReadonly({ sack, canRemove, onRemove, removing }: Props) {
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-sm font-semibold">{sack.sackNo}</span>
              {sack.manualCode && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {sack.manualCode}
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Scale className="h-3 w-3" />
                {sack.weightKg != null ? `${fmtKg(sack.weightKg)} kg` : "tartılmadı"}
              </span>
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {sack.rollCount} top · {fmtM(sack.totalQty)} m
              </span>
              {sack.swatchCount > 0 && <span>{sack.swatchCount} kartela</span>}
            </div>
          </div>
          {canRemove && (
            <PermissionGate permission="shipping:write">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1 text-xs text-destructive"
                disabled={removing}
                onClick={() => onRemove(sack)}
              >
                <PackageX className="h-3.5 w-3.5" /> Çuval Çıkar
              </Button>
            </PermissionGate>
          )}
        </div>

        {/* İçerik ürün-özeti (ürün · renk · en → top/metraj) */}
        {sack.contents.length > 0 && (
          <ul className="space-y-0.5 rounded border bg-muted/30 p-2 text-xs">
            {sack.contents.map((c) => (
              <li
                key={`${c.itemName}|${c.colorName ?? ""}|${c.width ?? ""}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">
                  {c.itemName}
                  {c.colorName ? ` · ${c.colorName}` : ""}
                  {c.width != null ? ` · ${c.width} cm` : ""}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {c.rollCount} top · {fmtM(c.qty)} m
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Tek tek top dökümü (barkodlu) */}
        {sack.rolls.length > 0 && (
          <ul className="divide-y text-xs">
            {sack.rolls.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  {r.color?.hex && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border"
                      style={{ backgroundColor: r.color.hex }}
                    />
                  )}
                  <span className="shrink-0 font-mono">{r.barcode ?? "—"}</span>
                  <span className="truncate text-muted-foreground">
                    {r.item.name}
                    {r.color ? ` · ${r.color.name}` : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {fmtM(r.qty)} m{r.width != null ? ` · ${r.width} cm` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
