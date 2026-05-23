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
import { cn } from "@/lib/utils";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { FabricProperty } from "@/pages/FabricProperties/types";
import { itemService } from "@/pages/Items/service";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  allowedPropertyIds: Set<string>;
  /** Dahil edildiğinde seçili listeye otomatik eklenmesi istenirse. */
  onIncluded?: (propertyId: string) => void;
}

/**
 * L3: Özellik listesinden ürüne dahil et veya yeni özellik oluştur.
 * Liste = ürüne dahil OLMAYAN aktif özellikler.
 */
export function IncludePropertyDialog({
  open,
  onOpenChange,
  itemId,
  allowedPropertyIds,
  onIncluded,
}: Props) {
  const [mode, setMode] = useState<"list" | "create">("list");
  const [search, setSearch] = useState("");

  const allPropsQ = useQuery({
    queryKey: ["fabric-properties", "all"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open,
  });

  const candidates = useMemo(() => {
    const all = allPropsQ.data?.data ?? [];
    const q = search.trim().toLowerCase();
    return all
      .filter((p) => !allowedPropertyIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  }, [allPropsQ.data?.data, allowedPropertyIds, search]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setMode("list");
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "list" ? "Listeden Dahil Et" : "Yeni Özellik Oluştur"}</DialogTitle>
          <DialogDescription>
            {mode === "list"
              ? "Bu ürüne henüz dahil olmayan özellikler. Dahil edersen seçili listene de eklenir."
              : "Yeni özellik kataloğa eklenir ve bu ürüne otomatik dahil edilir."}
          </DialogDescription>
        </DialogHeader>

        {mode === "list" ? (
          <ListView
            candidates={candidates}
            search={search}
            onSearch={setSearch}
            itemId={itemId}
            onIncluded={(propertyId) => onIncluded?.(propertyId)}
            onCreate={() => setMode("create")}
          />
        ) : (
          <CreateView
            itemId={itemId}
            initialName={search}
            onCancel={() => setMode("list")}
            onCreated={(propertyId) => {
              onIncluded?.(propertyId);
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
  candidates: FabricProperty[];
  search: string;
  onSearch: (q: string) => void;
  itemId: string;
  onIncluded: (propertyId: string) => void;
  onCreate: () => void;
}) {
  const qc = useQueryClient();
  const includeMut = useMutation({
    mutationFn: (propertyId: string) => itemService.addAllowedProperty(itemId, propertyId),
    onSuccess: (_res, propertyId) => {
      void qc.invalidateQueries({ queryKey: ["item-allowed", itemId] });
      toast.success("Özellik dahil edildi");
      onIncluded(propertyId);
    },
  });

  return (
    <>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Özellik ara..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-9 pl-8 text-sm"
          autoFocus
        />
      </div>

      <div className="max-h-[40vh] overflow-auto rounded-md border">
        {candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <span>{search ? `"${search}" eşleşmedi.` : "Dahil edilebilir özellik yok."}</span>
            <Button type="button" size="sm" variant="outline" onClick={onCreate} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Yeni Özellik Oluştur
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {candidates.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50">
                {p.color && (
                  <span
                    className="h-4 w-4 shrink-0 rounded-sm border"
                    style={{ backgroundColor: p.color }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{p.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.category ? `${p.category} · ` : ""}
                    {p.code}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={includeMut.isPending}
                  onClick={() => includeMut.mutate(p.id)}
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
          <Plus className="h-3.5 w-3.5" /> Yeni Özellik Oluştur
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
  onCreated: (propertyId: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState("");

  const createMut = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Özellik adı boş bırakılamaz");
      const created = await fabricPropertyService.create({
        code: generateCode(CODE_PREFIXES.FABRIC_PROPERTY),
        name: trimmed,
        category: category.trim() || null,
        isActive: true,
      } as Partial<FabricProperty>);
      const propertyId = created.data.id;
      await itemService.addAllowedProperty(itemId, propertyId);
      return propertyId;
    },
    onSuccess: (propertyId) => {
      void qc.invalidateQueries({ queryKey: ["fabric-properties"] });
      void qc.invalidateQueries({ queryKey: ["item-allowed", itemId] });
      toast.success("Özellik oluşturuldu ve dahil edildi");
      onCreated(propertyId);
    },
    onError: (err) => {
      if (err instanceof Error) toast.error(err.message);
    },
  });

  return (
    <>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium">Özellik adı *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Şardonlu, Empirme..."
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs font-medium">Kategori (opsiyonel)</label>
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Terbiye, Görsel..."
          />
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
