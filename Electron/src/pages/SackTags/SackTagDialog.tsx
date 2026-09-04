import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";

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
import { cn } from "@/lib/utils";
import {
  TAG_HEX_RE,
  TAG_PRESET_HEXES,
  isDarkHex,
  sackTagService,
  type SackTag,
} from "./service";

/**
 * Tek etiket düzenleyici — `ReasonPresetDialog` dilinde.
 *
 * ⚠️ KOD ALANI YOK, bilinçli: kod addan türer ve rapor/entegrasyon anahtarıdır.
 * Adı düzeltmek geçmişi bozmaz, kodu değiştirmek eski atamaların anahtarını
 * ikiye bölerdi (`ReasonPreset` ile birebir aynı gerekçe).
 */
export function SackTagDialog({
  open,
  onOpenChange,
  tag,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → yeni etiket. */
  tag: SackTag | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [hex, setHex] = useState(TAG_PRESET_HEXES[0]!.hex);

  useEffect(() => {
    if (!open) return;
    setName(tag?.name ?? "");
    setHex(tag?.hex ?? TAG_PRESET_HEXES[0]!.hex);
  }, [open, tag]);

  const trimmed = name.trim();
  const hexValid = TAG_HEX_RE.test(hex);
  const canSave = trimmed.length >= 2 && hexValid;

  const save = useMutation({
    mutationFn: () =>
      tag
        ? sackTagService.update(tag.id, { name: trimmed, hex: hex.toUpperCase() })
        : sackTagService.create({ name: trimmed, hex: hex.toUpperCase() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sack-tags"] });
      toast.success(tag ? "Etiket güncellendi" : "Etiket eklendi");
      onOpenChange(false);
    },
    // Sunucu "bu adla bir etiket zaten var" diyebilir — mesajı AYNEN göster.
    onError: (err: Error) => toast.error("Kaydedilemedi", { description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tag ? "Etiketi düzenle" : "Yeni etiket"}</DialogTitle>
          <DialogDescription>
            Çuvala bırakılan iz — çuvalın kendisini değiştirmez, yalnız işaret bırakır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Görünen ad</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
              placeholder="Örn. Kontrol edilecek"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Renk</Label>
            <div className="flex flex-wrap gap-1.5">
              {TAG_PRESET_HEXES.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  onClick={() => setHex(p.hex)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md border transition",
                    hex.toUpperCase() === p.hex ? "ring-2 ring-offset-1 ring-foreground/60" : "",
                  )}
                  style={{ backgroundColor: p.hex }}
                >
                  {hex.toUpperCase() === p.hex && (
                    <Check className={cn("size-4", isDarkHex(p.hex) ? "text-white" : "text-black")} />
                  )}
                </button>
              ))}
            </div>
            {/* Hazır liste bir KISAYOL, kısıt değil — serbest hex de kabul edilir. */}
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                maxLength={7}
                className="w-28 font-mono"
                aria-label="Renk kodu"
              />
              <span
                className="rounded px-2 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: hexValid ? hex : "transparent",
                  color: hexValid ? (isDarkHex(hex) ? "#fff" : "#000") : undefined,
                }}
              >
                {trimmed || "Önizleme"}
              </span>
              {!hexValid && <span className="text-xs text-destructive">#RRGGBB olmalı</span>}
            </div>
          </div>

          {tag && (
            <p className="text-xs text-muted-foreground">
              Kod: <span className="font-mono font-semibold">{tag.code}</span> — değişmez.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Vazgeç
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
