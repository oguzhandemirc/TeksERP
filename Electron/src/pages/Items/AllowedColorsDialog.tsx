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
import { colorService } from "@/pages/Colors/service";
import { ColorFormDialog } from "@/pages/Colors/ColorFormDialog";
import type { ColorFormValues } from "@/pages/Colors/schema";
import type { Color } from "@/pages/Colors/types";
import { nextSortOrder } from "@/lib/sort-order";
import { loadAllForPicker } from "@/lib/picker-loader";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string[];
  onChange: (next: string[]) => void;
}

const COLORS_QUERY_KEY = ["colors", "all-active"] as const;

export function AllowedColorsDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: Props) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const colorsQ = useQuery({
    queryKey: COLORS_QUERY_KEY,
    queryFn: () =>
      loadAllForPicker(colorService, {
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: (values: ColorFormValues) =>
      colorService.create({
        // Kod backend'de üretilir (RNK+GGAAYY+NNNN) — istemci göndermez.
        name: values.name.trim(),
        hex: values.hex || null,
        sortOrder: nextSortOrder(colorsQ.data?.data ?? []),
        isActive: values.isActive,
      } as Partial<Color>),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: COLORS_QUERY_KEY });
      const id = res.data?.id;
      if (id) onChange([...value, id]);
      setAddOpen(false);
    },
  });

  const items: MultiSelectItem[] = useMemo(
    () =>
      (colorsQ.data?.data ?? []).map((c) => ({
        id: c.id,
        label: c.name,
        hint: c.code,
        swatch: c.hex ?? null,
      })),
    [colorsQ.data?.data],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>İzinli Renkler</DialogTitle>
            <DialogDescription>
              Bu kumaş için seçilebilir renkler. Boş bırakılırsa tüm aktif renkler serbest.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {value.length === 0
                ? `${items.length} renk · seçim yok`
                : `${value.length} / ${items.length} renk seçili`}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 hover:text-white"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Yeni Renk
            </Button>
          </div>

          <div className="h-80">
            <MultiSelectCheckboxList
              items={items}
              value={value}
              onChange={onChange}
              placeholder="Renk ara..."
            />
          </div>

          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Not: Hiçbir renk seçmezseniz bu kumaşa <span className="font-medium text-foreground">tüm aktif renkler</span> serbesttir.
          </p>

          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ColorFormDialog
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
