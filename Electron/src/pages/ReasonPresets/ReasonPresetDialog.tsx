import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/ui/callout";
import {
  KIND_STORES_TEXT,
  reasonPresetService,
  type ReasonPreset,
  type ReasonPresetKind,
} from "./service";

export type ReasonPresetDialogMode = "edit" | "duplicate" | "create";

/**
 * Tek satır düzenleyici — mobildeki `ReasonPresetEditDialog`'un masaüstü ikizi.
 *
 * ⚠️ KOD ALANI YOK, bilinçli: kod rapor kırılımının anahtarıdır ve satırlarda
 * saklanır. Adı değiştirmek geçmişi bozmaz, kodu değiştirmek altı aylık fire
 * raporunu ikiye bölerdi.
 */
export function ReasonPresetDialog({
  open,
  onOpenChange,
  mode,
  kind,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ReasonPresetDialogMode;
  kind: ReasonPresetKind;
  preset?: ReasonPreset | null;
}) {
  const qc = useQueryClient();
  const storesText = KIND_STORES_TEXT[kind];
  const [label, setLabel] = useState("");
  const [fullText, setFullText] = useState("");

  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setLabel("");
      setFullText("");
    } else if (preset) {
      setLabel(mode === "duplicate" ? `${preset.label} (kopya)` : preset.label);
      setFullText(preset.fullText ?? "");
    }
  }, [open, mode, preset]);

  const save = useMutation({
    mutationFn: async () => {
      const name = label.trim();
      const text = storesText ? fullText.trim() || name : undefined;
      if (mode === "edit" && preset) {
        return reasonPresetService.update(preset.id, { label: name, fullText: text ?? null });
      }
      if (mode === "duplicate" && preset) {
        const row = await reasonPresetService.duplicate(preset.id, name);
        return text && text !== row.fullText
          ? reasonPresetService.update(row.id, { fullText: text })
          : row;
      }
      return reasonPresetService.create({ kind, label: name, fullText: text ?? null });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reason-presets"] });
      toast.success(mode === "edit" ? "Sebep güncellendi" : "Sebep eklendi");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error("Kaydedilemedi", { description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Sebebi düzenle" : mode === "duplicate" ? "Sebebi çoğalt" : "Yeni sebep"}
          </DialogTitle>
          <DialogDescription>
            Operatörün ekranda göreceği hazır mesaj. Sıra listedeki sırayla aynıdır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rp-label">Görünen ad</Label>
            <Input
              id="rp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              autoFocus
              placeholder="Örn. Top başı"
            />
          </div>

          {storesText && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-full">Kayda yazılacak tam metin</Label>
              <Input
                id="rp-full"
                value={fullText}
                onChange={(e) => setFullText(e.target.value)}
                maxLength={500}
                placeholder={label.trim() || "Boş bırakılırsa görünen ad kullanılır"}
              />
              <Callout tone="warning">
                Bu listede kayda metnin <b>kendisi</b> yazılır. Metni değiştirirsen eski kayıtlar eski
                metinle kalır ve raporda ayrı satır olarak görünür.
              </Callout>
            </div>
          )}

          {mode !== "create" && preset && (
            <p className="text-xs text-muted-foreground">
              Kod: <span className="font-mono font-semibold">{preset.code}</span>
              {mode === "edit"
                ? " — değişmez; raporlar bu kodu kullanır."
                : " → kopyaya yeni kod verilir."}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Vazgeç
          </Button>
          <Button onClick={() => save.mutate()} disabled={label.trim().length < 2 || save.isPending}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
