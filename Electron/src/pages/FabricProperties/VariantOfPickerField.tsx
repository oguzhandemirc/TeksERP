import { useState } from "react";
import { Check, ChevronsUpDown, GitBranch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FabricProperty } from "./types";

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  /** Tüm özellikler (sayfanın zaten yüklediği liste) — burada BAYRAK'lar süzülür. */
  properties: FabricProperty[];
  /** Düzenlenen özelliğin id'si: kendine bağ ve "zaten çeşidi var" ayrımı için. */
  selfId?: string | null;
}

/**
 * "Şunun çeşidi" seçici (KQ-D4): tetik düğme → modal liste (combobox YOK —
 * UI tercihi). Bir bayrağın tek çeşidi olur; başka çeşidi olan bayrak pasif
 * görünür (backend de 400 verir, burada Kaydet'e saklanmaz).
 */
export function VariantOfPickerField({ value, onChange, properties, selfId }: Props) {
  const [open, setOpen] = useState(false);
  const flags = properties
    .filter((p) => p.valueType === "FLAG" && p.id !== selfId)
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const takenBy = (flagId: string) =>
    properties.find((p) => p.variantOfPropertyId === flagId && p.id !== selfId) ?? null;
  const selected = value ? properties.find((p) => p.id === value) ?? null : null;
  const triggerText = value ? (selected?.name ?? "Seçili bayrak") : "Çeşit değil (bağımsız seçim)";

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50 sm:max-w-sm"
      >
        <GitBranch className="h-4 w-4 shrink-0 text-primary" />
        <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}>
          {triggerText}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Şunun çeşidi</DialogTitle>
            <DialogDescription>
              Bu seçimin değeri basıldığında seçtiğiniz bayrak da topa yazılır (örn. Kurşun
              gramajı → Kurşunlu).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-auto">
            <VariantRow
              label="Çeşit değil (bağımsız seçim)"
              active={value === null}
              onClick={() => pick(null)}
            />
            {flags.map((f) => {
              const taken = takenBy(f.id);
              return (
                <VariantRow
                  key={f.id}
                  label={f.name}
                  hint={
                    taken
                      ? `Zaten bir çeşidi var: ${taken.name}`
                      : f.isActive
                        ? (f.category ?? undefined)
                        : "Pasif"
                  }
                  active={value === f.id}
                  disabled={taken !== null}
                  onClick={() => pick(f.id)}
                />
              );
            })}
            {flags.length === 0 && (
              <div className="px-2 py-4 text-sm text-muted-foreground">Tanımlı bayrak özellik yok.</div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VariantRow({
  label,
  hint,
  active,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50",
        active && "border-primary bg-primary/5",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}
