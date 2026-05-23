import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
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
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
import { cn } from "@/lib/utils";
import { colorService } from "@/pages/Colors/service";
import type { Color } from "@/pages/Colors/types";
import { itemService } from "@/pages/Items/service";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  allowedColorIds: Set<string>;
  /** Dahil edildiğinde otomatik seçilmesi istenirse. */
  onIncluded?: (colorId: string) => void;
}

/**
 * L3: Renk listesinden ürüne dahil et veya yeni renk oluştur.
 * Liste = ürüne dahil OLMAYAN aktif renkler (zaten dahil olanlar L2'de görünür).
 */
export function IncludeColorDialog({ open, onOpenChange, itemId, allowedColorIds, onIncluded }: Props) {
  const [mode, setMode] = useState<"list" | "create">("list");
  const [search, setSearch] = useState("");

  const allColorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open,
  });

  const candidates = useMemo(() => {
    const all = allColorsQ.data?.data ?? [];
    const q = search.trim().toLowerCase();
    return all
      .filter((c) => !allowedColorIds.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [allColorsQ.data?.data, allowedColorIds, search]);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setMode("list"); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "list" ? "Listeden Dahil Et" : "Yeni Renk Oluştur"}</DialogTitle>
          <DialogDescription>
            {mode === "list"
              ? "Bu ürüne henüz dahil olmayan renkler. Dahil edersen otomatik seçilir."
              : "Yeni renk kataloğa eklenir ve bu ürüne otomatik dahil edilir."}
          </DialogDescription>
        </DialogHeader>

        {mode === "list" ? (
          <ListView
            candidates={candidates}
            search={search}
            onSearch={setSearch}
            itemId={itemId}
            onIncluded={(colorId) => {
              onIncluded?.(colorId);
            }}
            onCreate={() => setMode("create")}
          />
        ) : (
          <CreateView
            itemId={itemId}
            initialName={search}
            onCancel={() => setMode("list")}
            onCreated={(colorId) => {
              onIncluded?.(colorId);
              setMode("list");
              setSearch("");
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListView({
  candidates,
  search,
  onSearch,
  itemId,
  onIncluded,
  onCreate,
}: {
  candidates: Color[];
  search: string;
  onSearch: (q: string) => void;
  itemId: string;
  onIncluded: (colorId: string) => void;
  onCreate: () => void;
}) {
  const qc = useQueryClient();
  const includeMut = useMutation({
    mutationFn: (colorId: string) => itemService.addAllowedColor(itemId, colorId),
    onSuccess: (_res, colorId) => {
      void qc.invalidateQueries({ queryKey: ["item-allowed-colors", itemId] });
      toast.success("Renk dahil edildi");
      onIncluded(colorId);
    },
  });

  return (
    <>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Renk ara..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-9 pl-8 text-sm"
          autoFocus
        />
      </div>

      <div className="max-h-[40vh] overflow-auto rounded-md border">
        {candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <span>{search ? `"${search}" eşleşmedi.` : "Dahil edilebilir renk yok."}</span>
            <Button type="button" size="sm" variant="outline" onClick={onCreate} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Yeni Renk Oluştur
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50"
              >
                {c.hex && (
                  <span
                    className="h-4 w-4 shrink-0 rounded-sm border"
                    style={{ backgroundColor: c.hex }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{c.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{c.code}</div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={includeMut.isPending}
                  onClick={() => includeMut.mutate(c.id)}
                >
                  Dahil Et
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DialogFooter className={cn(candidates.length === 0 && "hidden")}>
        <Button type="button" variant="outline" onClick={onCreate} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Yeni Renk Oluştur
        </Button>
      </DialogFooter>
    </>
  );
}

function CreateView({
  itemId,
  initialName,
  onCancel,
  onCreated,
}: {
  itemId: string;
  initialName: string;
  onCancel: () => void;
  onCreated: (colorId: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const [hex, setHex] = useState("");

  const createMut = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Renk adı boş bırakılamaz");
      if (hex && !/^#[0-9a-fA-F]{6}$/.test(hex)) {
        throw new Error("Renk kodu #RRGGBB formatında olmalı");
      }
      const created = await colorService.create({
        code: generateCode(CODE_PREFIXES.COLOR),
        name: trimmedName,
        hex: hex || null,
        isActive: true,
      } as Partial<Color>);
      const colorId = created.data.id;
      await itemService.addAllowedColor(itemId, colorId);
      return colorId;
    },
    onSuccess: (colorId) => {
      void qc.invalidateQueries({ queryKey: ["colors"] });
      void qc.invalidateQueries({ queryKey: ["item-allowed-colors", itemId] });
      toast.success("Renk oluşturuldu ve dahil edildi");
      onCreated(colorId);
    },
    onError: (err) => {
      if (err instanceof Error) toast.error(err.message);
    },
  });

  return (
    <>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium">Renk adı *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Beyaz, Kırmızı..."
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs font-medium">Renk kodu (opsiyonel)</label>
          <ColorPickerInput value={hex} onChange={setHex} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Hex kodu yazabilir veya paletten seçebilirsin.
          </p>
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Geri
        </Button>
        <Button
          type="button"
          disabled={createMut.isPending || !name.trim()}
          onClick={() => createMut.mutate()}
        >
          {createMut.isPending ? "Kaydediliyor..." : "Oluştur ve Dahil Et"}
        </Button>
      </DialogFooter>
    </>
  );
}
