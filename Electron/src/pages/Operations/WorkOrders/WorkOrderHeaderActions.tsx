// İE detay başlığının gruplu eylemleri: `layoutHeaderActions` çıktısını çizer (menü ya da tek öğeli grupta düz düğme).
// Diyaloglar menünün DIŞINDA (başlıkta) durur; buradaki her öğe yalnız `onAction(id)` çağırır.
import type { ComponentType } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  FileText,
  History,
  Link2,
  PackageCheck,
  PackagePlus,
  Palette,
  Ruler,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { layoutHeaderActions, type HeaderActionId, type HeaderActionVisibility } from "./header-actions";

interface ActionDef {
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Düz düğme olarak çizildiğinde eski renk/ton (menüde nötr öğe). */
  flatClass?: string;
  flatVariant?: "outline" | "destructive" | "default";
}

const ACTIONS: Record<HeaderActionId, ActionDef> = {
  addBatch: { label: "Parti Ekle", icon: PackagePlus },
  fasonReceive: { label: "Fason Kabul", icon: PackageCheck },
  linkOrder: { label: "Sipariş Bağla", icon: Link2 },
  unlinkOrder: { label: "Sipariş Bağını Kopar", icon: Unlink },
  changeColor: { label: "Rengi Değiştir", icon: Palette },
  changeWidth: { label: "Eni Değiştir", icon: Ruler },
  documents: {
    label: "Belgeler",
    icon: FileText,
    flatVariant: "default",
    flatClass: "border-transparent bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500",
  },
  events: { label: "Hareketler", icon: History },
  complete: {
    label: "Kapat",
    icon: CheckCircle2,
    flatVariant: "default",
    flatClass: "border-transparent bg-success text-success-foreground hover:bg-success/90",
  },
  cancel: { label: "İptal Et", icon: Ban, flatVariant: "destructive" },
};

const DESTRUCTIVE_ITEM = "text-destructive focus:bg-destructive/10 focus:text-destructive";

export function WorkOrderHeaderActions({
  visible,
  onAction,
}: {
  visible: HeaderActionVisibility;
  onAction: (id: HeaderActionId) => void;
}) {
  return (
    <>
      {layoutHeaderActions(visible).map((slot) => {
        if (slot.kind === "button") {
          const def = ACTIONS[slot.action];
          const Icon = def.icon;
          return (
            <Button
              key={slot.group}
              type="button"
              size="sm"
              variant={def.flatVariant ?? "outline"}
              className={`gap-1 ${def.flatClass ?? ""}`}
              onClick={() => onAction(slot.action)}
              data-testid={`wo-action-${slot.action}`}
            >
              <Icon className="h-3.5 w-3.5" /> {def.label}
            </Button>
          );
        }
        return (
          // modal={false}: menüden açılan diyalog kapanınca gövdede pointer-events kilidi kalmasın (DetailMoreMenu ile aynı).
          <DropdownMenu key={slot.group} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="gap-1" data-testid={`wo-actions-${slot.group}`}>
                {slot.label}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              {slot.items.map((it, i) => {
                if (it.kind === "separator") return <DropdownMenuSeparator key={`sep-${i}`} />;
                const def = ACTIONS[it.action];
                const Icon = def.icon;
                return (
                  <DropdownMenuItem
                    key={it.action}
                    className={it.destructive ? DESTRUCTIVE_ITEM : undefined}
                    onSelect={() => onAction(it.action)}
                    data-testid={`wo-action-${it.action}`}
                  >
                    <Icon className="mr-2 h-4 w-4" /> {def.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </>
  );
}
