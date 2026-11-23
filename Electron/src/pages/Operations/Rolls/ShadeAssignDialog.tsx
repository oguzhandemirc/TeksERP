import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SHADE_QUICK_OPTIONS, normalizeShadeInput, shadeLockReason, shadeService } from "./shadeService";
import type { Roll } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rolls: Roll[];
  onDone?: () => void;
}

/**
 * Seçili toplara ton grubu harfi ata / kaldır. Hızlı seçim büyük harf düğmeleri (A–F), nadir kod için kısa kutu.
 * Kilitli toplar (sevk/dışarıda/tüketilmiş) listede adıyla görünür ve gönderilmez.
 */
export function ShadeAssignDialog({ open, onOpenChange, rolls, onDone }: Props) {
  const qc = useQueryClient();
  const [pick, setPick] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const locked = rolls.filter((r) => shadeLockReason(r.status) !== null);
  const eligible = rolls.filter((r) => shadeLockReason(r.status) === null);
  const customNorm = custom.trim() === "" ? undefined : normalizeShadeInput(custom);
  const target: string | null | undefined = custom.trim() !== "" ? customNorm : pick;
  const customInvalid = custom.trim() !== "" && customNorm === undefined;

  const mut = useMutation({
    mutationFn: (code: string | null) => shadeService.setShade(eligible.map((r) => r.id), code),
    onSuccess: (res) => {
      toast.success(res.message ?? "Ton kaydedildi");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      onDone?.();
      onOpenChange(false);
    },
  });

  const close = (o: boolean) => {
    if (!o) {
      setPick(null);
      setCustom("");
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ton ata</DialogTitle>
          <DialogDescription>
            {eligible.length} topa ton grubu harfi verilecek. Aynı siparişe tek ton gitmesi için sevk ekranı bu harfe bakar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ShadePicker
            pick={pick}
            custom={custom}
            customInvalid={customInvalid}
            onPick={(s) => {
              setPick(s);
              setCustom("");
            }}
            onCustom={setCustom}
          />
          {locked.length > 0 && (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {locked.length} top atlanacak (sevk edilmiş / dışarıda / tüketilmiş):{" "}
              <span className="font-mono">{locked.map((r) => r.barcode ?? "(barkodsuz)").join(", ")}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={mut.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => target !== undefined && mut.mutate(target)}
            disabled={mut.isPending || eligible.length === 0 || target === undefined}
          >
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {target ? `Ton ${target} ata` : "Tonu kaldır"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PickerProps {
  pick: string | null;
  custom: string;
  customInvalid: boolean;
  onPick: (s: string | null) => void;
  onCustom: (v: string) => void;
}

/** Hızlı harf düğmeleri + "Yok" + nadir kod kutusu. */
function ShadePicker({ pick, custom, customInvalid, onPick, onCustom }: PickerProps) {
  const customEmpty = custom.trim() === "";
  return (
    <>
      <div className="grid grid-cols-7 gap-2">
        {SHADE_QUICK_OPTIONS.map((s) => (
          <Button
            key={s}
            type="button"
            variant={pick === s && customEmpty ? "default" : "outline"}
            className="h-12 text-lg font-semibold"
            onClick={() => onPick(s)}
          >
            {s}
          </Button>
        ))}
        <Button
          type="button"
          variant={pick === null && customEmpty ? "secondary" : "outline"}
          className="h-12 text-sm"
          onClick={() => onPick(null)}
          title="Tonu kaldır"
        >
          Yok
        </Button>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Başka kod</span>
        <Input
          value={custom}
          onChange={(e) => onCustom(e.target.value)}
          maxLength={4}
          placeholder="ör. A2"
          className={cn("w-28 font-semibold uppercase", customInvalid && "border-destructive")}
        />
        {customInvalid && <span className="text-xs text-destructive">1–4 harf/rakam</span>}
      </label>
    </>
  );
}
