import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScanField } from "@/components/scanner/ScanField";
import { packingService } from "./service";
import { useScanDrainer } from "./useScanDrainer";
import { invalidateShipmentData } from "./useShipmentDetail";
import type { ShipmentSack } from "./types";

interface Props {
  shipmentId: string;
  sacks: ShipmentSack[];
  activeSackId: string | null;
  onSetActiveSack: (sackId: string) => void;
}

/**
 * Aktif-çuval okutma çubuğu (PREPARING) — tabanca topu okutur, kod aktif çuvala
 * SIRAYLA (drainer) eklenir; aynı sevkiyatta başka çuvaldaki topu okutmak onu
 * taşır, BAŞKA sevkiyattaki/uygunsuz top backend 409/400 → interceptor toast'lar.
 * Çuval yokken "Çuval Aç" ile başlanır (açılan çuval otomatik aktif olur).
 */
export function ScanInBar({ shipmentId, sacks, activeSackId, onSetActiveSack }: Props) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");

  const { push, busy, queueLength } = useScanDrainer({
    onScan: async (code) => {
      try {
        // Aktif çuval yoksa otomatik aç (mobil ensureActiveSack) — okutulan top
        // ASLA çuvalsız (loose) kalmaz; drainer seri olduğundan sonraki okutmalar
        // bu çuvalı kullanır. Aksi halde scan sackId:null → görünmez loose içerik.
        let target = activeSackId;
        if (!target) {
          const res = await packingService.addSack(shipmentId);
          target = res.data.id;
          onSetActiveSack(target);
          toast.success(`Çuval #${res.data.seq} açıldı`);
        }
        await packingService.scan(shipmentId, code, target);
      } finally {
        // 409/400 olsa bile (atomik claim kaybı vb.) bayat listeyi tazele.
        invalidateShipmentData(qc, shipmentId);
      }
    },
  });

  const addSackMut = useMutation({
    mutationFn: () => packingService.addSack(shipmentId),
    onSuccess: (res) => {
      const sack = res.data;
      toast.success(`Çuval #${sack.seq} açıldı`);
      invalidateShipmentData(qc, shipmentId);
      onSetActiveSack(sack.id);
    },
  });

  const noSacks = sacks.length === 0;

  return (
    <div className="space-y-1.5 border-b bg-muted/30 px-6 py-3">
      <div className="flex items-center gap-2">
        <ScanField
          value={value}
          onChange={setValue}
          onScan={(code) => {
            push(code);
            setValue("");
          }}
          placeholder={noSacks ? "Top okut → ilk çuval otomatik açılır" : "Top barkodu okut → aktif çuvala ekle"}
          expectPrefix={["ROLL", "SWATCH"]}
          autoFocus
          widthClassName="max-w-md"
          className="flex-1"
        />
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={addSackMut.isPending}
          onClick={() => addSackMut.mutate()}
        >
          <PackagePlus className="h-4 w-4" /> Çuval Aç
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {busy || queueLength > 0
          ? `Okutuluyor… (${queueLength} bekliyor)`
          : noSacks
            ? "İlk top okutulunca çuval otomatik açılır; sonrakiler aynı çuvala girer. Elle açmak için 'Çuval Aç'."
            : "Okutulan toplar aktif (çerçeveli) çuvala eklenir. Aktif çuvalı değiştirmek için kartındaki 'Aktif Yap'a basın."}
      </p>
    </div>
  );
}
