import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
import { colorService } from "@/pages/Colors/service";
import type { Color } from "@/pages/Colors/types";

/**
 * Saha #12: renk seçicide hızlı renk ekleme — Tanımlar'a gitmeden ad (+ ops. hex)
 * ile yeni PUBLIC renk yaratır ve hemen seçer. Ad standardı (BÜYÜK + sayı başta)
 * backend'de normalize edilir; müşteri ataması bilinçli YAPILMAZ (atanmış renk
 * exclusive olur — operatörü şaşırtmasın, gerekirse renk formundan atanır).
 * Hex girişi görsel color picker (react-colorful) ile — elle #RRGGBB yerine.
 */
export function QuickAddColor({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hex, setHex] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      colorService.create({
        // Kod backend'de üretilir (RNK+GGAAYY+NNNN) — istemci göndermez.
        name: name.trim(),
        hex: /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim() : null,
        isActive: true,
      } as Partial<Color>),
    onSuccess: (res) => {
      const created = res.data;
      toast.success(`Renk eklendi: ${created.name}`);
      void qc.invalidateQueries({ queryKey: ["colors"] });
      setOpen(false);
      setName("");
      setHex("");
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
          Yeni Renk Ekle
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
        placeholder="Renk adı (örn. beyaz 055)"
        className="h-8 min-w-[9rem] flex-1 text-sm"
        onKeyDown={(e) => {
          // isPending guard: çift-Enter mükerrer POST üretmesin (buton disabled ile aynı koşul).
          if (e.key === "Enter" && name.trim() && !createMut.isPending) {
            e.preventDefault();
            createMut.mutate();
          }
        }}
      />
      <ColorPickerInput value={hex} onChange={setHex} className="w-44" />
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
