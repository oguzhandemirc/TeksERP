import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScanField } from "@/components/scanner/ScanField";
import { packingService } from "./service";
import { invalidatePoolData } from "./useCustomerPool";
import type { PoolSack } from "./types";

interface Props {
  customerId: string;
  branchId: string | null;
  openSacks: PoolSack[];
  activeSackId: string | null;
  onSetActiveSack: (id: string) => void;
}

/**
 * Paketleme okutma çubuğu — barkod okut → aktif AÇIK çuvala ekle. Aktif çuval yoksa
 * otomatik açılır (openSack). "Yeni Çuval" ile sıradaki açık çuval açılır.
 */
export function ScanInBar({ customerId, branchId, openSacks, activeSackId, onSetActiveSack }: Props) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");

  const openMut = useMutation({
    mutationFn: () => packingService.openSack(customerId, branchId),
    onSuccess: (res) => {
      invalidatePoolData(qc, customerId);
      onSetActiveSack(res.data.id);
      toast.success("Yeni çuval açıldı");
    },
  });

  const scanMut = useMutation({
    mutationFn: async (barcode: string) => {
      let sackId = activeSackId;
      if (!sackId) {
        const opened = await packingService.openSack(customerId, branchId);
        sackId = opened.data.id;
        onSetActiveSack(sackId);
      }
      return packingService.scanIntoSack(sackId, barcode);
    },
    onSuccess: (res) => {
      invalidatePoolData(qc, customerId);
      toast.success(res.message ?? "Okutuldu");
    },
  });

  const activeSack = openSacks.find((s) => s.id === activeSackId);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-card px-6 py-3">
      <ScanField
        value={value}
        onChange={setValue}
        onScan={(code) => {
          scanMut.mutate(code);
          setValue("");
        }}
        placeholder="Top/kartela barkodu okut → aktif çuvala ekle"
        autoFocus
        submitLabel="Okut"
        busy={scanMut.isPending}
        busyLabel="Okutuluyor…"
        widthClassName="max-w-md"
      />
      <Button variant="outline" size="sm" disabled={openMut.isPending} onClick={() => openMut.mutate()}>
        <PackagePlus className="mr-1 h-4 w-4" /> Yeni Çuval
      </Button>
      <span className="text-xs text-muted-foreground">
        {activeSack
          ? `Aktif çuval: ${activeSack.manualCode ?? activeSack.sackNo}`
          : "Aktif açık çuval yok — okutunca otomatik açılır."}
      </span>
    </div>
  );
}
