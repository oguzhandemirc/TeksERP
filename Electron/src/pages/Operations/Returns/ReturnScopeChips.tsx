import { Boxes, Package, Scan, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReturnScopeKind } from "./returnScope";

type PickKind = "sack" | "shipment" | "lot";

const CHIPS: { kind: ReturnScopeKind; label: string; icon: typeof Scan; pick: PickKind | null; hint: string }[] = [
  { kind: "ROLL", label: "Top", icon: Scan, pick: null, hint: "Top barkodu okutun" },
  { kind: "SACK", label: "Çuval", icon: Package, pick: "sack", hint: "Çuval kodu okutun ya da sevkiyattan çuval seçin" },
  { kind: "SHIPMENT", label: "Sevkiyat", icon: Truck, pick: "shipment", hint: "Sevkiyat no okutun ya da listeden seçin — tüm çuvallar gelir" },
  { kind: "LOT", label: "Sevk partisi", icon: Boxes, pick: "lot", hint: "Cari → parti; partinin sevk edilmiş çuvalları gelir" },
];

/**
 * KAPSAM ÇİPLERİ — iki iş: (1) barkodu olmayan kapsamı seçmek (sevkiyat listesi, cari →
 * parti), (2) okutulan kodun hangi tür olarak çözüldüğünü GÖSTERMEK (aktif çip). Çip
 * bir süzgeç değildir: okutan hiç seçmez, arayan çipten girer. Top çipi yalnız gösterge
 * (topun barkodu vardır, seçicisi yoktur).
 */
export function ReturnScopeChips({
  active,
  canPick,
  onPick,
  label,
}: {
  active: ReturnScopeKind | null;
  canPick: boolean;
  onPick: (k: PickKind) => void;
  label: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CHIPS.map((c) => {
        const Icon = c.icon;
        const isActive = active === c.kind;
        const clickable = canPick && c.pick !== null;
        return (
          <button
            key={c.kind}
            type="button"
            disabled={!clickable}
            title={c.hint}
            onClick={() => c.pick && onPick(c.pick)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
              isActive ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
              clickable && !isActive && "hover:bg-muted/60 hover:text-foreground",
              !clickable && !isActive && "cursor-default opacity-70",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {c.label}
            {isActive && label && <span className="ml-1 font-mono opacity-90">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
