import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { packingService } from "./service";
import { invalidateShipmentData } from "./useShipmentDetail";
import type { KartelaStockGroup } from "./types";

interface Props {
  shipmentId: string;
  /** Aktif çuval — verilirse kartelalar bu çuvala eklenir. */
  sackId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function groupKey(g: KartelaStockGroup): string {
  return `${g.itemId}__${g.colorId ?? "none"}`;
}

/**
 * Seçerek kartela ekleme dialog'u — kartelaların fiziksel etiketi olmadığından
 * barkod okutma yerine ürün+renk stok grubu + adet seçilir; backend o gruptan N
 * müsait kartelayı atomik claim eder ve sevkiyata/çuvala bağlar (stoktan düşer).
 */
export function AddKartelaDialog({ shipmentId, sackId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [count, setCount] = useState("1");

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedKey(null);
      setCount("1");
    }
  }, [open]);

  const stockQuery = useQuery({
    queryKey: ["kartela", "stock", search],
    queryFn: () => packingService.listKartelaStock(search.trim() || undefined),
    enabled: open,
    staleTime: 5_000,
  });

  const groups = useMemo(() => stockQuery.data?.data ?? [], [stockQuery.data]);
  const selected = useMemo(
    () => groups.find((g) => groupKey(g) === selectedKey) ?? null,
    [groups, selectedKey],
  );

  const parsedCount = Number.parseInt(count.trim(), 10);
  const countValid =
    Number.isInteger(parsedCount) &&
    parsedCount >= 1 &&
    !!selected &&
    parsedCount <= selected.count;

  const mut = useMutation({
    mutationFn: () =>
      packingService.addKartela(shipmentId, {
        itemId: selected!.itemId,
        colorId: selected!.colorId,
        count: parsedCount,
        sackId,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.added} kartela eklendi`);
      invalidateShipmentData(qc, shipmentId);
      void qc.invalidateQueries({ queryKey: ["kartela", "stock"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Kartela Ekle
          </DialogTitle>
          <DialogDescription>
            Ürün + renk seç, adet gir. Seçilen kartelalar stoktan düşülerek
            {sackId ? " aktif çuvala" : " sevkiyata"} eklenir.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ürün / renk ara…"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {stockQuery.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</div>
          ) : groups.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Müsait kartela stoğu yok.
            </div>
          ) : (
            <ul className="space-y-1">
              {groups.map((g) => {
                const key = groupKey(g);
                const isSel = key === selectedKey;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedKey(key);
                        setCount((c) => {
                          const n = Number.parseInt(c, 10);
                          return Number.isInteger(n) && n >= 1 ? String(Math.min(n, g.count)) : "1";
                        });
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        isSel
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: g.colorHex ?? "transparent" }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{g.itemName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {g.colorName ?? "Renksiz"}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                        {g.count} adet
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Adet:</label>
            <Input
              type="number"
              min={1}
              max={selected?.count}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              disabled={!selected}
              className="w-24"
            />
            {selected && (
              <span className="text-xs text-muted-foreground">/ {selected.count} müsait</span>
            )}
          </div>
          <Button
            onClick={() => mut.mutate()}
            disabled={!countValid || mut.isPending}
            className="gap-1"
          >
            <Layers className="h-4 w-4" />
            {mut.isPending ? "Ekleniyor…" : "Ekle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
