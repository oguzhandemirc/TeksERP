import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ScanBarcode, Plus, X, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { workOrderService } from "@/services/workOrderService";

interface AttachRollsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string | null;
  batchNumber: string;
}

export default function AttachRollsDialog({
  open,
  onOpenChange,
  workOrderId,
  batchNumber,
}: AttachRollsDialogProps) {
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [currentBarcode, setCurrentBarcode] = useState("");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      workOrderService.attachRolls(workOrderId!, barcodes),
    onSuccess: (res) => {
      const data = res.data;
      if (data.attached > 0) {
        toast.success(`${data.attached} top başarıyla bağlandı`);
      }
      if (data.errors.length > 0) {
        data.errors.forEach((err) => toast.error(err));
      }
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["rolls"] });
      onOpenChange(false);
      setBarcodes([]);
    },
    onError: () => {
      toast.error("Top bağlama işlemi başarısız");
    },
  });

  const addBarcode = () => {
    const trimmed = currentBarcode.trim();
    if (trimmed && !barcodes.includes(trimmed)) {
      setBarcodes((p) => [...p, trimmed]);
      setCurrentBarcode("");
    }
  };

  const removeBarcode = (bc: string) => {
    setBarcodes((p) => p.filter((b) => b !== bc));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setBarcodes([]);
          setCurrentBarcode("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Top Bağla</DialogTitle>
          <DialogDescription>
            <strong>{batchNumber}</strong> iş emrine top barkodlarını ekleyin.
            Toplar STOCK durumundan IN_PRODUCTION'a çevrilecektir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-muted-foreground shrink-0" />
            <Input
              value={currentBarcode}
              onChange={(e) => setCurrentBarcode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addBarcode())}
              placeholder="Barkod okutun veya yazın..."
              autoFocus
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addBarcode}
              disabled={!currentBarcode.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {barcodes.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">
                {barcodes.length} barkod eklendi
              </span>
              <div className="flex flex-wrap gap-1">
                {barcodes.map((bc) => (
                  <Badge key={bc} variant="secondary" className="gap-1 font-mono text-xs">
                    {bc}
                    <button
                      type="button"
                      onClick={() => removeBarcode(bc)}
                      className="cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            İptal
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={barcodes.length === 0 || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {barcodes.length} Top Bağla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
