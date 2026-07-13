import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  MultiSelectCheckboxList,
  type MultiSelectItem,
} from "@/components/forms/MultiSelectCheckboxList";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { FabricPropertyFormDialog } from "@/pages/FabricProperties/FabricPropertyFormDialog";
import type { FabricPropertyFormValues } from "@/pages/FabricProperties/schema";
import type { FabricProperty } from "@/pages/FabricProperties/types";
import { nextSortOrder } from "@/lib/sort-order";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string[];
  onChange: (next: string[]) => void;
}

const PROPS_QUERY_KEY = ["fabric-properties", "all-active"] as const;

export function AllowedPropertiesDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: Props) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const propsQ = useQuery({
    queryKey: PROPS_QUERY_KEY,
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

  const createMut = useMutation({
    mutationFn: (values: FabricPropertyFormValues) =>
      fabricPropertyService.create({
        code: generateCode(CODE_PREFIXES.FABRIC_PROPERTY),
        name: values.name.trim(),
        category: values.category || null,
        description: values.description || null,
        color: values.color || null,
        sortOrder: nextSortOrder(propsQ.data?.data ?? []),
        isActive: values.isActive,
      } as Partial<FabricProperty>),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: PROPS_QUERY_KEY });
      const id = res.data?.id;
      if (id) onChange([...value, id]);
      setAddOpen(false);
    },
  });

  const items: MultiSelectItem[] = useMemo(
    () =>
      (propsQ.data?.data ?? []).map((p) => ({
        id: p.id,
        label: p.name,
        group: p.category ?? undefined,
        hint: p.code,
        swatch: p.color ?? null,
      })),
    [propsQ.data?.data],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>İzinli Özellikler</DialogTitle>
            <DialogDescription>
              Bu ürüne uygulanabilecek özellikler. Boş bırakılırsa tüm aktif özellikler serbest.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 hover:text-white"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Yeni Özellik
            </Button>
          </div>

          <div className="h-80">
            <MultiSelectCheckboxList
              items={items}
              value={value}
              onChange={onChange}
              placeholder="Özellik ara..."
            />
          </div>

          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Not: Hiçbir özellik seçmezseniz bu ürüne <span className="font-medium text-foreground">tüm aktif özellikler</span> serbesttir.
          </p>

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FabricPropertyFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={async (values) => {
          await createMut.mutateAsync(values);
        }}
        isSubmitting={createMut.isPending}
      />
    </>
  );
}
