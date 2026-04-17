import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, ScanLine, Ruler } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { rollService } from "@/services/rollService";
import SplitAllocateDialog from "@/pages/Tambur/SplitAllocateDialog";
import type { Roll } from "@/types/models";

export default function SplitAllocatePanel() {
  const [barcode, setBarcode] = useState("");
  const [roll, setRoll] = useState<Roll | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const lookupMutation = useMutation({
    mutationFn: (bc: string) => rollService.getByBarcode(bc),
    onSuccess: (res) => {
      if (res.data) {
        setRoll(res.data);
      }
    },
    onError: (err: unknown) => {
      setRoll(null);
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Top bulunamadı";
      toast.error(msg);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-5 w-5" />
          Paylaştırma — Top → Sipariş(ler) + Stok
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && barcode.trim()) {
                e.preventDefault();
                lookupMutation.mutate(barcode.trim());
              }
            }}
            placeholder="Top barkodu okutun…"
            className="h-12 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!barcode.trim() || lookupMutation.isPending}
            onClick={() => lookupMutation.mutate(barcode.trim())}
            isLoading={lookupMutation.isPending}
          >
            <ScanLine className="h-4 w-4" /> Sorgula
          </Button>
        </div>

        {roll && (
          <div className="rounded-md border p-3 bg-muted/30 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">{roll.barcode}</Badge>
              <span className="text-sm font-semibold">{roll.item?.code}</span>
              <span className="text-xs text-muted-foreground truncate">
                {roll.item?.name}
              </span>
              <span className="ml-auto flex items-center gap-1 text-sm">
                <Ruler className="h-3.5 w-3.5" />
                {roll.currentQty.toFixed(1)}m
              </span>
            </div>

            {roll.allocations && roll.allocations.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Mevcut tahsisler:{" "}
                {roll.allocations.map((a, i) => (
                  <Badge
                    key={a.id}
                    variant="outline"
                    className="text-[11px] mr-1"
                  >
                    {i + 1}. {a.orderLine?.order?.orderNumber ?? "?"} (
                    {a.allocatedQty.toFixed(1)}m)
                  </Badge>
                ))}
              </div>
            )}

            <Button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="w-full"
            >
              <Boxes className="h-4 w-4" /> Paylaştırma Başlat
            </Button>
          </div>
        )}

        <SplitAllocateDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          roll={roll}
        />
      </CardContent>
    </Card>
  );
}
