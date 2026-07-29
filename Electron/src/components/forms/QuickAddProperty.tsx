import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { FabricProperty } from "@/pages/FabricProperties/types";

/**
 * Özellik seçicide hızlı özellik ekleme — Tanımlar'a gitmeden ad ile yeni PUBLIC
 * `FabricProperty` yaratır ve hemen seçer (kod OZL-… otomatik). Renk hızlı-eklemesi
 * (QuickAddColor) ile aynı desen. Yalnız kumaş özellik KISITI YOKKEN gösterilir
 * (bkz. PropertyChipsField.allowQuickAdd) — kısıtlı kumaşta yeni global özellik o
 * kumaşın izinli listesinde olmayacağı için anlamsız.
 */
export function QuickAddProperty({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      // Kod backend'de üretilir (OZL+GGAAYY+NNNN) — istemci göndermez.
      fabricPropertyService.create({
        name: name.trim(),
        isActive: true,
      } as Partial<FabricProperty>),
    onSuccess: (res) => {
      const created = res.data;
      toast.success(`Özellik eklendi: ${created.name}`);
      void qc.invalidateQueries({ queryKey: ["fabric-properties"] });
      setOpen(false);
      setName("");
      onCreated(created.id);
    },
  });

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          className="gap-2 bg-emerald-600 font-medium text-white hover:bg-emerald-600/90"
          onClick={() => setOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Yeni Özellik Ekle
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Özellik adı (örn. Antibakteriyel)"
        className="h-8 min-w-[9rem] flex-1 text-sm"
        onKeyDown={(e) => {
          // isPending guard: çift-Enter mükerrer POST üretmesin (buton disabled ile aynı koşul).
          if (e.key === "Enter" && name.trim() && !createMut.isPending) {
            e.preventDefault();
            createMut.mutate();
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        disabled={!name.trim() || createMut.isPending}
        onClick={() => createMut.mutate()}
        className="bg-emerald-600 text-white hover:bg-emerald-600/90"
      >
        {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ekle"}
      </Button>
      <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(false)}>
        Vazgeç
      </Button>
    </div>
  );
}
