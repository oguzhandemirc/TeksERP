import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { cn } from "@/lib/utils";
import type { LabelTemplateListRow } from "@/services/labelTemplateService";
import { assignableTemplatePickerService } from "./templatePickerService";
import {
  MAX_SET_SIZE,
  moveEntry,
  removalNeedsConfirm,
  removeEntry,
  toggleStar,
  type OptionSetDraft,
  type SetEntry,
} from "./labelOptionSet";

interface Props {
  title: string;
  draft: OptionSetDraft;
  disabled: boolean;
  onChange: (next: OptionSetDraft) => void;
  onAdd: (entry: SetEntry) => void;
  /** Yıldız yokken satır altında çıkan açıklama (müşteride: herkes için varsayılan). */
  noDefaultHint: ReactNode;
  /** Varsayılanı kaldırma onayının açıklaması. */
  removeDefaultText: string;
  testId?: string;
}

/** Tek bağlamın sıralı etiket seti — yıldız (varsayılan), ↑/↓, kaldır, modal seçiciyle ekle. */
export function LabelOptionSetEditor({ title, draft, disabled, onChange, onAdd, noDefaultHint, removeDefaultText, testId }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const remove = (id: string) => (removalNeedsConfirm(draft, id) ? setConfirmId(id) : onChange(removeEntry(draft, id)));
  const remaining = draft.entries.filter((e) => e.templateId !== confirmId).map((e) => e.name);

  return (
    <section className="space-y-2" data-testid={testId}>
      <h4 className="text-sm font-medium">{title}</h4>
      {draft.entries.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Bu sette şablon yok.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {draft.entries.map((e, i) => (
            <SetRow
              key={e.templateId}
              entry={e}
              isDefault={draft.defaultTemplateId === e.templateId}
              first={i === 0}
              last={i === draft.entries.length - 1}
              disabled={disabled}
              onStar={() => onChange(toggleStar(draft, e.templateId))}
              onMove={(dir) => onChange(moveEntry(draft, e.templateId, dir))}
              onRemove={() => remove(e.templateId)}
            />
          ))}
        </ul>
      )}
      {!draft.defaultTemplateId && <p className="text-xs text-amber-600 dark:text-amber-500">{noDefaultHint}</p>}
      <PermissionGate permission="label-template:write">
        <div className="w-56">
          <EntityPickerModal<LabelTemplateListRow>
            value={null}
            onChange={(id, item) => id && item && onAdd({ templateId: id, name: item.name, active: item.isActive })}
            service={assignableTemplatePickerService}
            queryKey="label-option-set-picker"
            filters={{ exclude: draft.entries.map((x) => x.templateId).join(",") }}
            getLabel={(t) => t.name}
            icon={Plus}
            placeholder="Şablon ekle"
            title={`${title} — şablon ekle`}
            description="Seçilen şablon setin sonuna eklenir; yıldızla varsayılan yapılır."
            disabled={disabled || draft.entries.length >= MAX_SET_SIZE}
            lockedTooltip={draft.entries.length >= MAX_SET_SIZE ? `Bir sette en çok ${MAX_SET_SIZE} şablon olur.` : undefined}
            hideChevron
            triggerClassName="h-8"
          />
        </div>
      </PermissionGate>
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(o) => !o && setConfirmId(null)}
        title="Varsayılan şablon kaldırılsın mı?"
        description={`${removeDefaultText} Sette kalanlar: ${remaining.length ? remaining.join(", ") : "yok"}.`}
        confirmLabel="Kaldır"
        destructive
        onConfirm={() => {
          if (confirmId) onChange(removeEntry(draft, confirmId));
          setConfirmId(null);
        }}
      />
    </section>
  );
}

function SetRow(props: {
  entry: SetEntry;
  isDefault: boolean;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onStar: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { entry, isDefault, first, last, disabled } = props;
  const starIcon = <Star className={cn("h-4 w-4", isDefault ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />;
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm" data-testid="option-set-row">
      <PermissionGate permission="label-template:write" fallback={<span className="flex h-8 w-8 items-center justify-center">{starIcon}</span>}>
        <Button
          type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled}
          aria-pressed={isDefault}
          aria-label={isDefault ? `${entry.name} varsayılan — yıldızı kaldır` : `${entry.name} varsayılan yap`}
          title={isDefault ? "Varsayılan (yıldızı kaldırmak için tıklayın)" : "Varsayılan yap"}
          onClick={props.onStar}
        >
          {starIcon}
        </Button>
      </PermissionGate>
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {isDefault && <Badge variant="secondary">Varsayılan</Badge>}
      {!entry.active && <Badge variant="outline" className="text-amber-600">Pasif</Badge>}
      <PermissionGate permission="label-template:write">
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled || first} aria-label={`${entry.name} yukarı taşı`} onClick={() => props.onMove(-1)}>
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled || last} aria-label={`${entry.name} aşağı taşı`} onClick={() => props.onMove(1)}>
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className="gap-1 text-muted-foreground" disabled={disabled} aria-label={`${entry.name} kaldır`} onClick={props.onRemove}>
          <X className="h-3.5 w-3.5" /> Kaldır
        </Button>
      </PermissionGate>
    </li>
  );
}
