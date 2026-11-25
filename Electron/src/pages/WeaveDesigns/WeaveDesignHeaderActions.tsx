// Desen kartı başlık eylemleri — durum rozeti · Bas · Kopyala · Pasife al/Aktif et. Yazma eylemleri
// yalnız `warpspec:write` ile çizilir (sunucu yine kapıdır).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WeaveCardPrintButton } from "./WeaveCardPrintButton";
import { WeaveDesignCopyDialog } from "./WeaveDesignCopyDialog";
import { weaveDesignApi } from "./service";
import type { DesignFabric, WeaveDesign } from "./types";

export function WeaveDesignHeaderActions({ design: d, fabric, canWrite }: { design: WeaveDesign; fabric: DesignFabric | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [copying, setCopying] = useState(false);
  const toggleActive = useMutation({
    mutationFn: () => (d.isActive ? weaveDesignApi.deactivate(d.id) : weaveDesignApi.activate(d.id)),
    onSuccess: (r) => {
      toast.success(r.message ?? "Desen kartı güncellendi.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
    },
  });
  return (
    <div className="flex items-center gap-2">
      {d.isActive ? <Badge variant="default">Aktif</Badge> : <Badge variant="muted">Pasif</Badge>}
      <WeaveCardPrintButton fabric={fabric} />
      {canWrite && <Button size="sm" variant="outline" onClick={() => setCopying(true)}>Kopyala</Button>}
      {canWrite && (
        <Button size="sm" variant="outline" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate()}>
          {d.isActive ? "Pasife al" : "Aktif et"}
        </Button>
      )}
      {copying && <WeaveDesignCopyDialog source={d} onClose={() => setCopying(false)} onCreated={(newId) => nav(`/definitions/weave-designs/${newId}`)} />}
    </div>
  );
}
