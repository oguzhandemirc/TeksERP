// =============================================================================
// Etiket şablonu havuzu — TEK SATIR (ad/rozetler + sabit aksiyon rayı)
// =============================================================================
// Satırda yalnız Yazdır + Stüdyoda Aç + "⋯" menüsü (B1); Yazdır anlamsızsa yerine
// BİREBİR aynı genişlikte görünmez yer tutucu konur → sütun satırdan satıra kaymaz.
// Yer tutucu "pasif düğme" DEĞİLDİR: `invisible` görünürlükten de erişilebilirlik
// ağacından da düşer, sekme sırasına girmez, tıklanamaz.
// =============================================================================

import { Fragment, type ReactNode } from "react";
import { Star, Trash2, Pencil, PowerOff, RotateCcw, Printer, Download, Copy, MoreHorizontal, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import {
  labelKindLabel,
  type ContextDefaultRow,
  type LabelTemplateListRow,
} from "@/services/labelTemplateService";
import {
  resolveTemplateMenuActions,
  resolveTemplateRowActions,
  type TemplateRowActionKey,
} from "./templateRowActions";

interface RowHandlers {
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onHardDelete: () => void;
  onPrint: () => void;
  onExport: () => void;
  onDuplicate: () => void;
}

export function PoolRow({
  template: t,
  defaults,
  ...handlers
}: { template: LabelTemplateListRow; defaults: ContextDefaultRow[] } & RowHandlers) {
  const defaultFor = defaults.filter((d) => d.templateId === t.id);
  const isAnyDefault = defaultFor.length > 0;
  return (
    <li className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{t.name}</span>
          {defaultFor.map((d) => (
            <Badge key={d.kind} variant="muted" className="gap-1 text-[10px]">
              <Star className="h-3 w-3" /> {labelKindLabel(d.kind)} varsayılanı
            </Badge>
          ))}
          {t.standalone && <Badge variant="secondary" className="text-[10px]">Serbest</Badge>}
          {!t.isActive && <Badge variant="outline" className="text-[10px]">Pasif</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {(t.variants ?? []).length === 0 ? (
            <span title="Kanvas varyantı yok — eski akış düzeninde basılır">akış düzeni (varyantsız)</span>
          ) : (
            (t.variants ?? []).map((v) => (
              <span key={v.id} className="rounded border px-1 font-mono text-[10px]" title={v.name}>
                {v.isPrimary && "★"}{Number(v.widthMm)}×{Number(v.heightMm)}
              </span>
            ))
          )}
          {t.kind && <span>· eski tür: {labelKindLabel(t.kind)}</span>}
        </div>
      </div>
      <RowActions template={t} isAnyDefault={isAnyDefault} {...handlers} />
    </li>
  );
}

/** Sabit genişlikli aksiyon rayı — satırın en sağında, kendi içinde asla sarmaz. */
function RowActions({
  template: t,
  isAnyDefault,
  onEdit,
  onDelete,
  onRestore,
  onHardDelete,
  onPrint,
  onExport,
  onDuplicate,
}: { template: LabelTemplateListRow; isAnyDefault: boolean } & RowHandlers) {
  const state = { isActive: t.isActive, isAnyDefault };
  const slots = resolveTemplateRowActions(state);
  const can = (key: TemplateRowActionKey) => slots.find((s) => s.key === key)?.applicable ?? false;
  const canWrite = useRoleAccess().hasPermission("label-template:write");
  const menu = resolveTemplateMenuActions(state, canWrite);
  const items: Record<TemplateRowActionKey, ReactNode> = {
    print: null,
    edit: null,
    export: <MenuItem key="export" icon={Download} label="JSON olarak dışa aktar" onSelect={onExport} />,
    duplicate: <MenuItem key="duplicate" icon={Copy} label="Çoğalt" onSelect={onDuplicate} />,
    toggle: t.isActive ? (
      <MenuItem key="toggle" icon={PowerOff} label="Pasife al" onSelect={onDelete} />
    ) : (
      <MenuItem key="toggle" icon={RotateCcw} label="Aktifleştir" onSelect={onRestore} />
    ),
    hardDelete: <MenuItem key="hardDelete" icon={Trash2} label="Kalıcı sil" onSelect={onHardDelete} destructive />,
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Slot slot="print" applicable={can("print")} size="sm" variant="outline" className="gap-1"
        title="Şablonu örnek veriyle yazdır (bağımsız baskı)" onClick={onPrint}>
        <Printer className="h-3.5 w-3.5" /> Yazdır
      </Slot>
      <PermissionGate permission="label-template:write">
        <Slot slot="edit" applicable={can("edit")} size="sm" variant="outline" className="gap-1"
          title="Etiket Stüdyosu'nda düzenle" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Stüdyoda Aç
        </Slot>
      </PermissionGate>
      {/* B1: seyrek ve yıkıcı işler tek "⋯" menüsünde — sütun her satırda aynı genişlikte kalır. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" data-action-slot="more" aria-label="Diğer işlemler" title="Diğer işlemler">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {menu.map((key, i) => (
            <Fragment key={key}>
              {key === "toggle" && i > 0 && <DropdownMenuSeparator />}
              {items[key]}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MenuItem({ icon: Icon, label, onSelect, destructive }: { icon: LucideIcon; label: string; onSelect: () => void; destructive?: boolean }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className={destructive ? "text-destructive focus:text-destructive" : undefined}>
      <Icon className="mr-2 h-4 w-4" /> {label}
    </DropdownMenuItem>
  );
}

/**
 * Tek aksiyon yuvası. `applicable=false` → aynı düğme `invisible` çizilir:
 * genişlik sabit px sınıfı uydurmadan BİREBİR korunur (içerik aynı), düğme
 * tıklanamaz/odaklanamaz ve ekran okuyucuya görünmez.
 */
function Slot({
  slot,
  applicable,
  title,
  onClick,
  className,
  size = "icon",
  variant = "ghost",
  children,
}: {
  slot: TemplateRowActionKey;
  applicable: boolean;
  title: string;
  onClick: () => void;
  className?: string;
  size?: "sm" | "icon";
  variant?: "ghost" | "outline";
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn(className, !applicable && "invisible")}
      data-action-slot={slot}
      data-slot-state={applicable ? "action" : "placeholder"}
      aria-hidden={applicable ? undefined : true}
      tabIndex={applicable ? undefined : -1}
      disabled={!applicable}
      title={applicable ? title : undefined}
      onClick={applicable ? onClick : undefined}
    >
      {children}
    </Button>
  );
}
