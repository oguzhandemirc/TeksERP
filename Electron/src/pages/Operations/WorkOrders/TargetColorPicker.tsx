import { useMemo, useState } from "react";
import { Controller, useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Check, Palette, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import type { ItemColorLink } from "@/pages/Items/types";
import type { WorkOrderFormValues } from "./schema";

/**
 * L2 — Hedef Renk picker. Buton → arama + liste modalı.
 *
 * Domain kuralı: ürünün `allowedColors` boş ise **sınırsız** — tüm renk
 * kataloğu seçilebilir. Doluysa sadece o liste. Bu sayede ürüne özel renk
 * setlemek opsiyonel kalır.
 */
export function TargetColorPicker({
  control,
  disabled,
  lockedTooltip,
}: {
  control: Control<WorkOrderFormValues>;
  disabled?: boolean;
  lockedTooltip?: string;
}) {
  const targetItemId = useWatch({ control, name: "targetItemId" });
  const targetColorId = useWatch({ control, name: "targetColorId" });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const itemQ = useQuery({
    queryKey: ["item-allowed-colors", targetItemId],
    queryFn: () => itemService.getById(targetItemId as string),
    enabled: Boolean(targetItemId),
    staleTime: 60_000,
  });

  const allowed = useMemo<ItemColorLink[]>(
    () => itemQ.data?.data?.allowedColors ?? [],
    [itemQ.data?.data?.allowedColors],
  );
  const allowedIdSet = useMemo(() => new Set(allowed.map((a) => a.colorId)), [allowed]);
  const itemLoaded = itemQ.isSuccess;
  const isUnrestricted = itemLoaded && allowed.length === 0;

  // Sınırsız modda tüm renk kataloğunu çek. Sınırlı modda hiç çağrılmaz.
  const fullColorsQ = useQuery({
    queryKey: ["colors", "picker", "wo-target"],
    queryFn: () => loadAllForPicker(colorService),
    enabled: isUnrestricted,
    staleTime: 60_000,
  });

  // Sınırlı modda kayıtlı renk listeden çıkarılmış olabilir (orphan).
  // Sınırsız modda zaten her renk kabul, fallback gereksiz.
  const fallbackColorQ = useQuery({
    queryKey: ["color", targetColorId],
    queryFn: () => colorService.getById(targetColorId as string),
    enabled:
      Boolean(targetColorId) &&
      itemLoaded &&
      !isUnrestricted &&
      !allowedIdSet.has(targetColorId as string),
    staleTime: 60_000,
  });

  // Picker listesinde gösterilecek setin tek kaynağı. Sınırlı → allowed,
  // sınırsız → tüm katalog (ItemColorLink şekline normalize).
  const effective = useMemo<ItemColorLink[]>(() => {
    if (!isUnrestricted) return allowed;
    return (fullColorsQ.data?.data ?? []).map((c) => ({
      colorId: c.id,
      color: { id: c.id, code: c.code, name: c.name, hex: c.hex },
    }));
  }, [isUnrestricted, allowed, fullColorsQ.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return effective;
    return effective.filter(
      (a) =>
        a.color.name.toLowerCase().includes(q) ||
        a.color.code.toLowerCase().includes(q),
    );
  }, [effective, search]);

  if (!targetItemId) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-xs italic text-muted-foreground">
        Önce hedef ürün seç
      </div>
    );
  }

  return (
    <Controller
      control={control}
      name="targetColorId"
      render={({ field }) => {
        const inEffective = effective.find((a) => a.colorId === field.value);
        const fallbackColor = fallbackColorQ.data?.data;
        const displayColor = inEffective?.color ?? (field.value ? fallbackColor : null);
        // Orphan: kayıtlı renk, sınırlı modda allowed listesinde yoksa.
        // Sınırsız modda her renk geçerli, orphan yok.
        const isOrphan = Boolean(
          field.value && !isUnrestricted && !inEffective && fallbackColor,
        );
        return (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setSearch("");
                setOpen(true);
              }}
              title={disabled ? lockedTooltip : undefined}
              className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Palette className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Hedef Renk</span>
              <div className="ml-auto">
                {displayColor ? (
                  <Badge
                    variant={isOrphan ? "outline" : "muted"}
                    className="gap-1"
                    title={
                      isOrphan
                        ? "Bu renk ürünün izinli renkler listesinde yok. Açık seçim olarak kayıtlı."
                        : undefined
                    }
                  >
                    {displayColor.hex && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: displayColor.hex }}
                      />
                    )}
                    {displayColor.name}
                    {isOrphan && <span className="text-amber-600">!</span>}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Renksiz</span>
                )}
              </div>
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Hedef Renk</DialogTitle>
                  <DialogDescription>
                    {isUnrestricted
                      ? "Ürünün izinli renk listesi boş — tüm renkler seçilebilir."
                      : "Bu ürüne dahil renklerden birini seç."}
                  </DialogDescription>
                </DialogHeader>

                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Renk ara..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 pl-8 text-sm"
                    autoFocus
                  />
                </div>

                <div className="max-h-[50vh] overflow-auto rounded-md border">
                  {effective.length === 0 ? (
                    <div className="p-6 text-center text-xs italic text-muted-foreground">
                      {isUnrestricted
                        ? fullColorsQ.isLoading
                          ? "Renkler yükleniyor..."
                          : "Sistemde tanımlı renk yok."
                        : "Bu ürüne henüz hiç renk dahil edilmemiş."}
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {!search.trim() && (
                        <ColorRow
                          selected={!field.value}
                          name="Renksiz"
                          hex={null}
                          dimmed
                          onClick={() => {
                            field.onChange(null);
                            setOpen(false);
                          }}
                        />
                      )}
                      {filtered.length === 0 ? (
                        <li className="p-4 text-center text-xs italic text-muted-foreground">
                          "{search}" eşleşmedi.
                        </li>
                      ) : (
                        filtered.map((a) => (
                          <ColorRow
                            key={a.colorId}
                            selected={field.value === a.colorId}
                            name={a.color.name}
                            hex={a.color.hex}
                            onClick={() => {
                              field.onChange(a.colorId);
                              setOpen(false);
                            }}
                          />
                        ))
                      )}
                    </ul>
                  )}
                </div>

              </DialogContent>
            </Dialog>
          </>
        );
      }}
    />
  );
}

function ColorRow({
  selected,
  onClick,
  name,
  code,
  hex,
  dimmed,
}: {
  selected: boolean;
  onClick: () => void;
  name: string;
  code?: string;
  hex?: string | null;
  dimmed?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50",
          selected && "bg-primary/10",
        )}
      >
        <span
          className={cn(
            "h-4 w-4 shrink-0 rounded-sm border",
            !hex && "bg-muted",
          )}
          style={hex ? { backgroundColor: hex } : undefined}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate",
              dimmed && !selected && "text-muted-foreground italic",
            )}
          >
            {name}
          </div>
          {code && (
            <div className="truncate text-[11px] text-muted-foreground">{code}</div>
          )}
        </div>
        {selected && <Check className="h-4 w-4 text-primary" />}
      </button>
    </li>
  );
}
