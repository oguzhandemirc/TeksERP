import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
import { ScanField } from "@/components/scanner/ScanField";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";

interface Props {
  sackId: string;
}

/**
 * Editör okutma çubuğu — barkod okut → bu çuvala ekle. Depodaki serbest top/kartela
 * eklenir; başka depo çuvalındaki top okutulursa TAŞINIR (backend). Sevkiyattaki reddedilir.
 */
export function EditorScanBar({ sackId }: Props) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");

  const scanMut = useMutation({
    mutationFn: (barcode: string) => sackHubService.scanIntoSack(sackId, barcode),
    onSuccess: (res) => {
      invalidateSackHub(qc);
      toast.success(res.message ?? "Okutuldu");
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-primary/5 px-6 py-3">
      <PackagePlus className="h-5 w-5 shrink-0 text-primary" />
      <ScanField
        value={value}
        onChange={setValue}
        onScan={(code) => {
          scanMut.mutate(code);
          setValue("");
        }}
        placeholder="Top / kartela barkodu okut → bu çuvala ekle"
        autoFocus
        submitLabel="Okut"
        busy={scanMut.isPending}
        busyLabel="Okutuluyor…"
        widthClassName="max-w-md"
      />
      <span className="text-xs text-muted-foreground">Okutulan mal bu çuvala eklenir (depodaki başka çuvaldan gelirse taşınır).</span>
    </div>
  );
}
