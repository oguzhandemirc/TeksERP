import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import {
  labelKindLabels,
  type ContextDefaultRow,
  type LabelKind,
  type LabelTemplate,
} from "@/services/labelTemplateService";

/**
 * Tek bağlam satırı — bağlam adı + aktif şablon seçici + atamayı kaldır (X).
 * Yazma aksiyonları izin kapılı; izinsiz kullanıcı yalnız atanan adı görür.
 */
export function ContextDefaultRowItem({
  kind,
  assigned,
  activeTemplates,
  pending,
  onChange,
}: {
  kind: LabelKind;
  assigned: ContextDefaultRow | undefined;
  activeTemplates: LabelTemplate[];
  pending: boolean;
  onChange: (templateId: string | null) => void;
}) {
  // Atanan şablon pasifleştiyse seçenek listesinde yine görünsün (ad kaybolmasın).
  const assignedMissing =
    assigned !== undefined && !activeTemplates.some((t) => t.id === assigned.templateId);

  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-40 flex-1 text-sm font-medium">{labelKindLabels[kind]}</span>
        <PermissionGate
          permission="label-template:write"
          fallback={
            <span className="text-sm text-muted-foreground">
              {assigned ? assigned.templateName : "—"}
            </span>
          }
        >
          <Select
            value={assigned?.templateId ?? ""}
            onValueChange={(v) => onChange(v)}
            disabled={pending}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Şablon seç..." />
            </SelectTrigger>
            <SelectContent>
              {activeTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
              {assignedMissing && (
                <SelectItem value={assigned.templateId}>
                  {assigned.templateName} (pasif)
                </SelectItem>
              )}
              {activeTemplates.length === 0 && !assignedMissing && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Aktif şablon yok — önce Düzenler sekmesinden şablon oluşturun.
                </div>
              )}
            </SelectContent>
          </Select>
          {/* Atama yoksa düğme ANLAMSIZDIR ama yeri KORUNUR: `invisible` yer
              tutucu, atamalı/atamasız satırlarda seçicinin aynı sütunda
              kalmasını sağlar (Düzenler sekmesindeki yuva kuralının ikizi —
              `LabelTemplates/templateRowActions.ts`). Yetki yoksa düğme hiç
              çizilmez; o dalı PermissionGate zaten kapsıyor. */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title={assigned ? "Atamayı kaldır" : undefined}
            className={cn("h-8 w-8 text-muted-foreground", !assigned && "invisible")}
            aria-hidden={assigned ? undefined : true}
            tabIndex={assigned ? undefined : -1}
            disabled={pending || !assigned}
            onClick={assigned ? () => onChange(null) : undefined}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </PermissionGate>
      </div>
      {!assigned && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Varsayılan yok — bu bağlamda şablonsuz (katalog düzeni) basılır.
        </div>
      )}
    </li>
  );
}
