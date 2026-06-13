import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { colorService } from "@/pages/Colors/service";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import type { Color } from "@/pages/Colors/types";

/**
 * Saha #12: renk seçicide hızlı renk ekleme — Tanımlar'a gitmeden ad (+ ops. hex)
 * ile yeni PUBLIC renk yaratır ve hemen seçer. Ad standardı (BÜYÜK + sayı başta)
 * backend'de normalize edilir; müşteri ataması bilinçli YAPILMAZ (atanmış renk
 * exclusive olur — operatörü şaşırtmasın, gerekirse renk formundan atanır).
 */
export function QuickAddColor({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hex, setHex] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      colorService.create({
        code: generateCode(CODE_PREFIXES.COLOR),
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        Yeni Renk Ekle
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed p-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Renk adı (örn. beyaz 055)"
        className="h-8 flex-1 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) {
            e.preventDefault();
            createMut.mutate();
          }
        }}
      />
      <Input
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        placeholder="#RRGGBB"
        className="h-8 w-24 font-mono text-xs"
      />
      <Button
        type="button"
        size="sm"
        disabled={!name.trim() || createMut.isPending}
        onClick={() => createMut.mutate()}
      >
        {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ekle"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Vazgeç
      </Button>
    </div>
  );
}
