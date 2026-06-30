import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Scale } from "lucide-react";
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
import { useMachineScale } from "@/hooks/useMachineScale";
import { readWeightFromScale } from "@/lib/scale-read";
import { packingService } from "./service";
import { invalidateShipmentData } from "./useShipmentDetail";
import type { ShipmentSack } from "./types";

interface Props {
  shipmentId: string;
  sack: ShipmentSack | null;
  onOpenChange: (open: boolean) => void;
}

/** Virgüllü/noktalı sayıyı parse et ("12,5" → 12.5). Geçersiz → null. */
function parseKg(raw: string): number | null {
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Çuval tartısı + elle kod girişi. Backend en az birini ister; sevke-hazır için
 * ikisi de gerekir (yurtdışında tartı zorunlu) → operatörü ikisini de girmeye
 * yönlendirir. İçerik değiştiyse tartı sıfırlanmış olur, burada yeniden girilir.
 */
export function WeighSackDialog({ shipmentId, sack, onOpenChange }: Props) {
  const qc = useQueryClient();
  const open = !!sack;
  const [kg, setKg] = useState("");
  const [code, setCode] = useState("");
  const { scale } = useMachineScale();
  const [weighing, setWeighing] = useState(false);

  // Kantardan oku ("Tart"): simulate ise sahte, değilse seri IPC → parse → kg.
  const handleWeigh = async () => {
    if (weighing) return;
    setWeighing(true);
    try {
      const v = await readWeightFromScale(scale);
      if (v != null) setKg(String(v));
    } finally {
      setWeighing(false);
    }
  };

  useEffect(() => {
    if (sack) {
      setKg(sack.weightKg != null ? String(sack.weightKg) : "");
      setCode(sack.manualCode ?? "");
    }
  }, [sack]);

  const weightKg = parseKg(kg);
  const trimmedCode = code.trim();
  const kgInvalid = kg.trim() !== "" && weightKg === null;
  const canSubmit = (weightKg !== null || trimmedCode !== "") && !kgInvalid;

  const mut = useMutation({
    mutationFn: () =>
      packingService.weighSack(sack!.id, {
        ...(weightKg !== null ? { weightKg } : {}),
        ...(trimmedCode !== "" ? { manualCode: trimmedCode } : {}),
      }),
    onSuccess: () => {
      toast.success(`Çuval #${sack!.seq} güncellendi`);
      invalidateShipmentData(qc, shipmentId);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" /> Çuval #{sack?.seq} — Tartı & Kod
          </DialogTitle>
          <DialogDescription>
            Brüt tartı ve çuval kodu. Sevke hazır için ikisi de gerekir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Brüt Tartı (kg)</span>
            <div className="flex gap-2">
              <Input
                value={kg}
                onChange={(e) => setKg(e.target.value)}
                inputMode="decimal"
                placeholder="örn. 24,5"
                autoFocus
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleWeigh}
                disabled={weighing}
                title="Kantardan oku"
              >
                <Scale className="h-4 w-4" /> {weighing ? "..." : "Tart"}
              </Button>
            </div>
            {kgInvalid && <span className="mt-1 block text-xs text-destructive">Geçerli bir kg girin.</span>}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Çuval Kodu (elle yazılan)</span>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="çuval üstündeki kod"
              maxLength={64}
              className="font-mono"
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            İptal
          </Button>
          <Button disabled={!canSubmit || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
