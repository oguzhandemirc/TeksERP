import { useMemo, useState } from "react";
import { Controller, useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Check, Palette, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { itemService } from "@/pages/Items/service";
import type { ItemColorLink } from "@/pages/Items/types";
import { IncludeColorDialog } from "./IncludeColorDialog";
import type { WorkOrderFormValues } from "./schema";

/**
 * L2 — Hedef Renk picker. Buton → arama + liste modalı. Onlarca renk olabilir,
 * arama ile filtrelenir. Listede yoksa "Listeden Dahil Et" L3'ü açar.
 */
export function TargetColorPicker({
  control,
  disabled,
}: {
  control: Control<WorkOrderFormValues>;
  disabled?: boolean;
}) {
  const targetItemId = useWatch({ control, name: "targetItemId" });
  const [open, setOpen] = useState(false);
  const [includeOpen, setIncludeOpen] = useState(false);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allowed;
    return allowed.filter(
      (a) =>
        a.color.name.toLowerCase().includes(q) ||
        a.color.code.toLowerCase().includes(q),
    );
  }, [allowed, search]);

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
        const selected = allowed.find((a) => a.colorId === field.value);
        return (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setSearch("");
                setOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Palette className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Hedef Renk</span>
              <div className="ml-auto">
                {selected ? (
                  <Badge variant="muted" className="gap-1">
                    {selected.color.hex && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: selected.color.hex }}
                      />
                    )}
                    {selected.color.name}
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
                    Bu ürüne dahil renklerden birini seç. Listede yoksa "Listeden Dahil Et" ile ekle.
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
                  {allowed.length === 0 ? (
                    <div className="p-6 text-center text-xs italic text-muted-foreground">
                      Bu ürüne henüz hiç renk dahil edilmemiş.
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

                <DialogFooter className="gap-2 sm:gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIncludeOpen(true)}
                    className="gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Listeden Dahil Et
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <IncludeColorDialog
              open={includeOpen}
              onOpenChange={setIncludeOpen}
              itemId={targetItemId}
              allowedColorIds={allowedIdSet}
              onIncluded={(colorId) => {
                field.onChange(colorId);
                setIncludeOpen(false);
                setOpen(false);
              }}
            />
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
