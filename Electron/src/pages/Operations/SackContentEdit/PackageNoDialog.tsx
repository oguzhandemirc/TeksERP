import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hash, Loader2 } from "lucide-react";
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
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { parsePackageNoInput } from "./packingLotUi";

/**
 * Ambalaj numarasını EZ — çuval editöründeki "Ambalaj No" kutusundan (saha 2026-09-22).
 * Sunucu kapısı: mod otomatik-ezilebilir / elle; çakışma 409 (aynı partide aynı no),
 * izin `shipping:packing-lot`. Kaydedince `onSaved(no)` ile başlık kutusu güncellenir.
 */
export function PackageNoDialog({
  sack,
  onOpenChange,
  onSaved,
}: {
  /** null → kapalı. */
  sack: { id: string; sackNo: string; packageNo: number | null; lotName: string | null } | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (packageNo: number) => void;
}) {
  const qc = useQueryClient();
  const open = sack !== null;
  const [raw, setRaw] = useState("");
  useEffect(() => {
    if (open) setRaw(sack?.packageNo != null ? String(sack.packageNo) : "");
  }, [open, sack?.packageNo]);
  const parsed = parsePackageNoInput(raw);
  const mut = useMutation({
    mutationFn: () => sackHubService.setSackPackageNo(sack!.id, parsed.value!),
    onSuccess: (res) => {
      toast.success(res.message ?? `Ambalaj no ${res.data.packageNo} yazıldı`);
      invalidateSackHub(qc);
      onSaved(res.data.packageNo);
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="h-4 w-4" /> Ambalaj no — {sack?.sackNo}
          </DialogTitle>
          <DialogDescription>
            {sack?.lotName ? `${sack.lotName} partisinde` : "Partide"} numara tekildir; dolu bir numara verilirse kaydedilmez.
          </DialogDescription>
        </DialogHeader>
        <Input
          inputMode="numeric"
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && parsed.value != null && !parsed.error) mut.mutate();
          }}
        />
        {parsed.error && <p className="text-xs text-destructive">{parsed.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Vazgeç
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || parsed.value == null || !!parsed.error}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
