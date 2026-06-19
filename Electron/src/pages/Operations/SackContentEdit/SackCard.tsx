import {
  ArrowRightLeft,
  Check,
  PackageMinus,
  Repeat,
  Scale,
  ScanLine,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SackRoll, SackSwatch, ShipmentSack } from "./types";

const fmtKg = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

interface Props {
  sack: ShipmentSack;
  /** Top çıkar/taşı/takas/yeniden-tartı yapılabilir mi (PREPARING/READY/AT_DOOR). */
  canEdit: boolean;
  /** Çuval aç/sil + aktif-çuval seçimi yalnız PREPARING'de. */
  canScanIn: boolean;
  active: boolean;
  /** Bekleyen takasın 1. topu (vurgu için). */
  swapSourceRollId: string | null;
  onSetActive: (sackId: string) => void;
  onRemoveRoll: (roll: SackRoll, sackId: string) => void;
  onMoveRoll: (roll: SackRoll, fromSackId: string) => void;
  onSwapRoll: (roll: SackRoll, sackId: string) => void;
  onRemoveSwatch: (sw: SackSwatch) => void;
  onWeigh: (sack: ShipmentSack) => void;
  onDelete: (sack: ShipmentSack) => void;
}

export function SackCard({
  sack,
  canEdit,
  canScanIn,
  active,
  swapSourceRollId,
  onSetActive,
  onRemoveRoll,
  onMoveRoll,
  onSwapRoll,
  onRemoveSwatch,
  onWeigh,
  onDelete,
}: Props) {
  const empty = sack.rolls.length === 0 && sack.swatches.length === 0;

  return (
    <Card className={cn(active && "ring-2 ring-primary")}>
      <CardContent className="space-y-2 p-3">
        {/* Çuval başlığı + aksiyonlar */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            Çuval #{sack.seq}
            {sack.manualCode ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
                {sack.manualCode}
              </span>
            ) : (
              <span className="text-[11px] font-normal italic text-muted-foreground">kodsuz</span>
            )}
            {active && (
              <Badge variant="default" className="h-4 px-1 text-[9px]">
                AKTİF
              </Badge>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
            <span className={cn(sack.weightKg == null && canEdit && "font-medium text-amber-600")}>
              {sack.weightKg != null ? `${fmtKg(sack.weightKg)} kg` : "tartılmadı"}
            </span>
            · {sack.rollCount} top
            {sack.swatchCount > 0 ? ` · ${sack.swatchCount} kartela` : ""}
          </span>
        </div>

        {(canEdit || canScanIn) && (
          <div className="flex flex-wrap gap-1">
            {canScanIn && !active && (
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onSetActive(sack.id)}>
                <ScanLine className="h-3.5 w-3.5" /> Aktif Yap
              </Button>
            )}
            {canScanIn && active && (
              <span className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                <Check className="h-3.5 w-3.5" /> Okutulanlar buraya
              </span>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onWeigh(sack)}>
                <Scale className="h-3.5 w-3.5" /> Tartı/Kod
              </Button>
            )}
            {canScanIn && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                onClick={() => onDelete(sack)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Çuvalı Sil
              </Button>
            )}
          </div>
        )}

        {/* İçerik */}
        {empty ? (
          <div className="text-[11px] text-muted-foreground">Boş çuval.</div>
        ) : (
          <ul className="space-y-1">
            {sack.rolls.map((r) => {
              const isSwapSource = swapSourceRollId === r.id;
              return (
                <li
                  key={r.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1 text-[11px]",
                    isSwapSource && "ring-1 ring-sky-500",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {r.color?.hex && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: r.color.hex }}
                      />
                    )}
                    <span className="truncate font-mono font-medium">{r.barcode ?? "Açık Kumaş"}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {r.item.name}
                      {r.color ? ` · ${r.color.name}` : ""}
                      {r.width != null ? ` · ${fmtInt(r.width)} cm` : ""} · {fmtM(r.currentQty)} m
                    </span>
                  </span>
                  {canEdit && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <RollAction title="Başka çuvala taşı" onClick={() => onMoveRoll(r, sack.id)}>
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                      </RollAction>
                      <RollAction
                        title={isSwapSource ? "Takas için 2. topu seç (iptal: tekrar bas)" : "Başka topla çuval takasla"}
                        active={isSwapSource}
                        onClick={() => onSwapRoll(r, sack.id)}
                      >
                        <Repeat className="h-3.5 w-3.5" />
                      </RollAction>
                      <RollAction title="Çuvaldan çıkar (depoya döner)" destructive onClick={() => onRemoveRoll(r, sack.id)}>
                        <PackageMinus className="h-3.5 w-3.5" />
                      </RollAction>
                    </span>
                  )}
                </li>
              );
            })}
            {sack.swatches.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded border border-dashed bg-muted/30 px-2 py-1 text-[11px]"
              >
                <span className="truncate">
                  <span className="font-mono font-medium">{s.barcode ?? "Kartela"}</span>
                  <span className="ml-1 text-muted-foreground">kartela</span>
                </span>
                {canEdit && (
                  <RollAction title="Çuvaldan çıkar" destructive onClick={() => onRemoveSwatch(s)}>
                    <PackageMinus className="h-3.5 w-3.5" />
                  </RollAction>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RollAction({
  title,
  onClick,
  children,
  destructive,
  active,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  destructive?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        destructive && "hover:text-destructive",
        active && "bg-sky-500/15 text-sky-600",
      )}
    >
      {children}
    </button>
  );
}
