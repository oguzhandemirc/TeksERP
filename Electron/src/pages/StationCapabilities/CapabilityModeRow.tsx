import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TERIM } from "@/lib/terim";
import {
  STATION_PROPERTY_MODE_HINTS,
  STATION_PROPERTY_MODE_LABELS,
  type StationPropertyMode,
} from "./types";
import type { CapabilityDefault, DefaultValueOption } from "./capabilityDefaults";

export interface CapabilityRowView {
  id: string;
  name: string;
  mode: StationPropertyMode;
  isNew: boolean;
  valueType: "FLAG" | "CHOICE";
  variantOfName: string | null;
}

interface Props {
  row: CapabilityRowView;
  onMode: (mode: StationPropertyMode) => void;
  value: CapabilityDefault;
  options: DefaultValueOption[];
  onDefault: (next: CapabilityDefault) => void;
}

/** Bir yeteneğin MODU + K22 varsayılanları ("Varsayılan açık" · "Varsayılan değer"). */
export function CapabilityModeRow({ row, onMode, value, options, onDefault }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const picked = options.find((o) => o.id === value.defaultValueId) ?? null;
  return (
    <div className="space-y-1 rounded border-b pb-1.5 last:border-b-0" data-testid={`cap-row-${row.id}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm" title={row.name}>
          {row.name}
          {row.variantOfName && (
            <span className="ml-1 text-[11px] text-muted-foreground">({row.variantOfName} çeşidi)</span>
          )}
          {row.isNew && <span className="ml-1 text-[10px] text-muted-foreground">(yeni)</span>}
        </span>
        <div className="flex shrink-0 gap-1">
          {(["AUTO", "OPTIONAL", "REQUIRED"] as const).map((m) => {
            // SEÇİM tipli özellik AUTO olamaz: otomatik uygulanacak tek bir değer
            // yoktur (25GR mi 50GR mi?). Backend de reddeder.
            const autoBlocked = m === "AUTO" && row.valueType === "CHOICE";
            return (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={row.mode === m ? "default" : "outline"}
                className="h-7 px-2 text-[11px]"
                disabled={autoBlocked}
                title={
                  autoBlocked
                    ? "Değer listesi olan (SEÇİM tipli) özellik otomatik uygulanamaz — hangi değerin yazılacağı operatör kararıdır."
                    : STATION_PROPERTY_MODE_HINTS[m]
                }
                onClick={() => onMode(m)}
              >
                {STATION_PROPERTY_MODE_LABELS[m]}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 pl-1 text-[11px] text-muted-foreground">
        {row.mode === "OPTIONAL" ? (
          <label className="flex items-center gap-1.5">
            <Switch
              checked={value.defaultOn}
              aria-label={`${row.name} varsayılan açık`}
              onCheckedChange={(on) => onDefault({ ...value, defaultOn: on })}
              className="scale-75"
            />
            Varsayılan açık
          </label>
        ) : (
          <span title={`${TERIM.terbiyeIsEmri.tekil} rota adımında bu özellik her zaman seçili gelir.`}>
            {row.mode === "AUTO" ? `${TERIM.terbiyeIsEmri.cekim.bulunma} hep seçili` : `${TERIM.terbiyeIsEmri.cekim.bulunma} seçili gelir`}
          </span>
        )}
        {options.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            aria-label={`${row.name} varsayılan değer`}
            onClick={() => setPickerOpen(true)}
          >
            Varsayılan değer: {picked ? picked.name : "Yok"}
          </Button>
        )}
      </div>
      <DefaultValuePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={row.name}
        options={options}
        selectedId={value.defaultValueId}
        onPick={(id) => onDefault({ ...value, defaultValueId: id })}
      />
    </div>
  );
}

interface PickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  options: DefaultValueOption[];
  selectedId: string | null;
  onPick: (id: string | null) => void;
}

/** Varsayılan değer seçici — doğrudan modal (combobox yok); "Yok" değer varsayılanına bırakır. */
function DefaultValuePicker({ open, onOpenChange, title, options, selectedId, onPick }: PickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title} — varsayılan değer</DialogTitle>
          <DialogDescription>
            {TERIM.terbiyeIsEmri.tekil} rota adımında bu değer ön seçili gelir; müşteriye tanımlı değer varsa o önce gelir.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-1 overflow-auto">
          {[{ id: null, name: "Yok (değer varsayılanı)", propertyName: "" } as const, ...options].map((o) => (
            <button
              key={o.id ?? "none"}
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm hover:bg-muted",
                selectedId === o.id && "border-primary bg-primary/10",
              )}
              onClick={() => {
                onPick(o.id);
                onOpenChange(false);
              }}
            >
              <span>{o.name}</span>
              {o.propertyName && <span className="text-[11px] text-muted-foreground">{o.propertyName}</span>}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
