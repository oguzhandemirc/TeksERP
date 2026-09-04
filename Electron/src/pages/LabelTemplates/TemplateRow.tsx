// =============================================================================
// Etiket şablonu havuzu — TEK SATIR (ad/rozetler + sabit aksiyon rayı)
// =============================================================================
// Aksiyonlar sağa yaslıdır ve HER satırda AYNI yuva dizisini çizer
// (`templateRowActions.ts`): o satırda anlamsız olan aksiyon yerine BİREBİR aynı
// genişlikte görünmez bir yer tutucu konur → ikonlar satırdan satıra kaymaz.
// Yer tutucu "pasif düğme" DEĞİLDİR: `invisible` görünürlükten de erişilebilirlik
// ağacından da düşer, sekme sırasına girmez, tıklanamaz.
// =============================================================================

import { Star, Trash2, Pencil, PowerOff, RotateCcw, Printer, Download, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import {
  labelKindLabels,
  type ContextDefaultRow,
  type LabelTemplate,
} from "@/services/labelTemplateService";
import {
  resolveTemplateRowActions,
  resolveToggleDirection,
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
}: { template: LabelTemplate; defaults: ContextDefaultRow[] } & RowHandlers) {
  const defaultFor = defaults.filter((d) => d.templateId === t.id);
  const isAnyDefault = defaultFor.length > 0;
  return (
    <li className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{t.name}</span>
          {defaultFor.map((d) => (
            <Badge key={d.kind} variant="muted" className="gap-1 text-[10px]">
              <Star className="h-3 w-3" /> {labelKindLabels[d.kind]} varsayılanı
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
          {t.kind && <span>· eski tür: {labelKindLabels[t.kind]}</span>}
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
}: { template: LabelTemplate; isAnyDefault: boolean } & RowHandlers) {
  const slots = resolveTemplateRowActions({ isActive: t.isActive, isAnyDefault });
  const can = (key: TemplateRowActionKey) => slots.find((s) => s.key === key)?.applicable ?? false;
  const toggleDir = resolveToggleDirection({ isActive: t.isActive, isAnyDefault });

  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Baskı + dışa aktar = okuma işlemleri — write gate'inin DIŞINDA. */}
      <Slot slot="print" applicable={can("print")} size="sm" variant="outline" className="gap-1"
        title="Şablonu örnek veriyle yazdır (bağımsız baskı)" onClick={onPrint}>
        <Printer className="h-3.5 w-3.5" /> Yazdır
      </Slot>
      <Slot slot="export" applicable={can("export")} className="h-8 w-8"
        title="JSON olarak dışa aktar" onClick={onExport}>
        <Download className="h-3.5 w-3.5" />
      </Slot>
      {/* Yazma yuvaları BİTİŞİK son ek — izin yoksa hepsi birlikte düşer, sıra bozulmaz. */}
      <PermissionGate permission="label-template:write">
        <Slot slot="duplicate" applicable={can("duplicate")} className="h-8 w-8"
          title="Şablonu çoğalt (kopya)" onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" />
        </Slot>
        <Slot slot="edit" applicable={can("edit")} size="sm" variant="outline" className="gap-1"
          title="Etiket Stüdyosu'nda düzenle" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Stüdyoda Aç
        </Slot>
        {/* Pasife Al ↔ Aktifleştir TEK yuva: karşılıklı dışlayan iki yön, aynı sütun. */}
        {toggleDir === "deactivate" ? (
          <Slot slot="toggle" applicable={can("toggle")} className="h-8 w-8 text-destructive"
            title="Pasife Al (geri alınabilir)" onClick={onDelete}>
            <PowerOff className="h-3.5 w-3.5" />
          </Slot>
        ) : (
          <Slot slot="toggle" applicable={can("toggle")} className="h-8 w-8 text-primary"
            title="Aktifleştir" onClick={onRestore}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Slot>
        )}
        <Slot slot="hardDelete" applicable={can("hardDelete")} className="h-8 w-8 text-destructive"
          title="Kalıcı Sil (GERİ ALINAMAZ)" onClick={onHardDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Slot>
      </PermissionGate>
    </div>
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
