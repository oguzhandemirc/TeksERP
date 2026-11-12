// İE gruplu eylemleri (detay başlığı + liste yan paneli): yerleşim `header-actions.ts`ten; menü ya da tek öğeli grupta düz düğme.
// Diyaloglar menünün DIŞINDA (çağıranda) durur; buradaki her öğe yalnız `onAction(id)` çağırır.
import type { ComponentType, ReactNode } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  FileText,
  History,
  Pencil,
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
import {
  layoutHeaderActions,
  layoutSheetActions,
  type ActionSlot,
  type HeaderActionVisibility,
  type SheetActionId,
  type SheetActionVisibility,
  type SheetGroupId,
  type HeaderActionId,
} from "./header-actions";

interface ActionDef {
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Düz düğme olarak çizildiğinde eski renk/ton (menüde nötr öğe). */
  flatClass?: string;
  flatVariant?: "outline" | "destructive" | "default";
}

const ACTIONS: Record<SheetActionId, ActionDef> = {
  edit: { label: "Düzenle", icon: Pencil },
  printHistory: { label: "Baskı geçmişi", icon: History },
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
  return <ActionGroupsBar slots={layoutHeaderActions(visible)} onAction={onAction} look="header" />;
}

/** Liste yan paneli: Düzenle ▾ + Diğer ▾ (birincil "Detayı Aç" çağıranda). `marks` öğe yanına, `groupMarks` menü düğmesine iz. */
export function WorkOrderSheetActions({
  visible,
  onAction,
  marks,
  groupMarks,
}: {
  visible: SheetActionVisibility;
  onAction: (id: SheetActionId) => void;
  marks?: Partial<Record<SheetActionId, ReactNode>>;
  groupMarks?: Partial<Record<SheetGroupId, ReactNode>>;
}) {
  return (
    <ActionGroupsBar slots={layoutSheetActions(visible)} onAction={onAction} look="sheet" marks={marks} groupMarks={groupMarks} />
  );
}

interface BarProps<A extends SheetActionId, G extends string> {
  onAction: (id: A) => void;
  /** header: shadcn Button; sheet: `.wo-v3 .btn` dili. */
  look: "header" | "sheet";
  marks?: Partial<Record<A, ReactNode>>;
  groupMarks?: Partial<Record<G, ReactNode>>;
}

function ActionGroupsBar<A extends SheetActionId, G extends string>({
  slots,
  ...rest
}: BarProps<A, G> & { slots: ActionSlot<A, G>[] }) {
  return (
    <>
      {slots.map((slot) =>
        slot.kind === "button" ? <FlatAction key={slot.group} slot={slot} {...rest} /> : <MenuAction key={slot.group} slot={slot} {...rest} />,
      )}
    </>
  );
}

function FlatAction<A extends SheetActionId, G extends string>({
  slot,
  onAction,
  look,
  marks,
}: BarProps<A, G> & { slot: Extract<ActionSlot<A, G>, { kind: "button" }> }) {
  const def = ACTIONS[slot.action];
  const Icon = def.icon;
  const content = (
    <>
      <Icon className="h-3.5 w-3.5" /> {def.label}
      {marks?.[slot.action]}
    </>
  );
  if (look === "sheet") {
    return (
      <button
        type="button"
        className={def.flatVariant === "destructive" ? "btn danger" : "btn"}
        onClick={() => onAction(slot.action)}
        data-testid={`wo-action-${slot.action}`}
      >
        {content}
      </button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant={def.flatVariant ?? "outline"}
      className={`gap-1 ${def.flatClass ?? ""}`}
      onClick={() => onAction(slot.action)}
      data-testid={`wo-action-${slot.action}`}
    >
      {content}
    </Button>
  );
}

function MenuAction<A extends SheetActionId, G extends string>({
  slot,
  onAction,
  look,
  marks,
  groupMarks,
}: BarProps<A, G> & { slot: Extract<ActionSlot<A, G>, { kind: "menu" }> }) {
  const triggerContent = (
    <>
      {slot.label}
      {groupMarks?.[slot.group]}
      <ChevronDown className="h-3.5 w-3.5" />
    </>
  );
  return (
    // modal={false}: menüden açılan diyalog kapanınca gövdede pointer-events kilidi kalmasın (DetailMoreMenu ile aynı).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {look === "sheet" ? (
          <button type="button" className="btn" data-testid={`wo-actions-${slot.group}`}>
            {triggerContent}
          </button>
        ) : (
          <Button type="button" size="sm" variant="outline" className="gap-1" data-testid={`wo-actions-${slot.group}`}>
            {triggerContent}
          </Button>
        )}
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
              {marks?.[it.action]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
