// "Etiketi düzenle" formunun tek alan satırı: serbest metin + (kumaş/renk için) listeden seç,
// değişen işareti, tek tek geri al, kayıtlı ezmeyi kaynağa döndür. Listeden seçim yalnız METNİ
// doldurur — katalog/cari bağı kurulmaz (etiket gösterimi).
import { Undo2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import type { Item } from "@/pages/Items/types";
import type { Color } from "@/pages/Colors/types";
import type { RollLabelEditField } from "@/services/rollLabelEditService";

interface Props {
  field: RollLabelEditField;
  /** undefined = değişmedi · null = kaynağa dön · metin = yeni değer. */
  draft: string | null | undefined;
  disabled: boolean;
  onChange: (value: string | null | undefined) => void;
}

function CatalogPick({ fieldKey, disabled, onPick }: { fieldKey: string; disabled: boolean; onPick: (v: string) => void }) {
  const cls = "h-8 whitespace-nowrap px-2 text-xs";
  if (fieldKey === "itemName" || fieldKey === "itemNameDefault") {
    return (
      <EntityPickerModal<Item>
        value={null}
        onChange={(_id, item) => item && onPick(item.name)}
        service={itemService}
        queryKey="items"
        getLabel={(i) => `${i.code} — ${i.name}`}
        placeholder="Listeden"
        title="Kumaş / desen seç"
        triggerClassName={cls}
        hideChevron
        disabled={disabled}
      />
    );
  }
  if (fieldKey === "colorName" || fieldKey === "colorNameDefault") {
    return (
      <EntityPickerModal<Color>
        value={null}
        onChange={(_id, c) => c && onPick(c.name)}
        service={colorService}
        queryKey="colors"
        getLabel={(c) => (c.code ? `${c.code} — ${c.name}` : c.name)}
        placeholder="Listeden"
        title="Renk seç"
        triggerClassName={cls}
        hideChevron
        disabled={disabled}
      />
    );
  }
  return null;
}

export function RollLabelEditFieldRow({ field, draft, disabled, onChange }: Props) {
  const changed = draft !== undefined;
  const value = draft === undefined ? field.value : (draft ?? "");
  const inputId = `label-edit-${field.key}`;
  return (
    <div className={cn("rounded-md border px-2 py-1.5", changed && "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20")}>
      <div className="mb-1 flex items-center gap-2">
        <label htmlFor={inputId} className="text-xs font-medium">
          {field.label}
        </label>
        {changed && <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">değişti</span>}
        {!changed && field.overridden && <span className="text-[10px] text-sky-700 dark:text-sky-400">elle yazılmış</span>}
        {field.measured && <span className="text-[10px] text-muted-foreground">yalnız etikette; topun ölçüsü değişmez</span>}
      </div>
      <div className="flex items-center gap-1">
        <Input
          id={inputId}
          value={value}
          disabled={disabled}
          maxLength={120}
          placeholder={draft === null ? "Kayıttaki değer basılır" : "(boş basılır)"}
          onChange={(e) => onChange(e.target.value === field.value && !field.overridden ? undefined : e.target.value)}
          className="h-8 text-sm"
        />
        <CatalogPick fieldKey={field.key} disabled={disabled} onPick={(v) => onChange(v === field.value ? undefined : v)} />
        {changed && (
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`${field.label} geri al`} title="Geri al" onClick={() => onChange(undefined)}>
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
        {!changed && field.overridden && (
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`${field.label} kayıttaki değere dön`} title="Kayıttaki değere dön" disabled={disabled} onClick={() => onChange(null)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
