// "Bu desene özel kopya" onayı: hangi kumaşın yeni karta geçeceğini ve hangilerinin eski kartta kalacağını
// listeler (liste sunucudan, `filter[weftSpecId]`). Kod/ad önerilir; aynı gövdenin tekrarı sunucuda aynı kopyayı döner.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listWeftSpecUsers, weftSpecApi } from "../service";
import type { DesignFabric, WeftSpecDetail } from "../types";
import { suggestForkCode, suggestForkName, WEFT_CODE_MAX, WEFT_NAME_MAX } from "./weft-fork-defaults";

interface Props { spec: WeftSpecDetail; fabric: DesignFabric; onClose: () => void }

export function WeftSpecForkDialog({ spec, fabric, onClose }: Props) {
  const qc = useQueryClient();
  const [code, setCode] = useState(() => suggestForkCode(spec.code, fabric.code));
  const [name, setName] = useState(() => suggestForkName(spec.name, fabric.code));
  const users = useQuery({ queryKey: ["weft-specs", "users-list", spec.id], queryFn: () => listWeftSpecUsers(spec.id) });
  const staying = (users.data ?? []).filter((f) => f.id !== fabric.id);
  const fork = useMutation({
    mutationFn: () => weftSpecApi.fork(spec.id, { itemId: fabric.id, code: code.trim(), name: name.trim() }),
    onSuccess: (r) => {
      toast.success(r.replayed ? "Özel kopya zaten oluşturulmuştu." : `${fabric.code} artık ${r.weftSpec.code} atkı kartını kullanıyor.`);
      void qc.invalidateQueries({ queryKey: ["weft-specs"] });
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
      void qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6">Bu desene özel kopya — {spec.code}</DialogTitle>
          <DialogDescription>Kart iplikleri, sıra kodu ve sıklığıyla kopyalanır; yalnız aşağıdaki kumaş yeni karta geçer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border p-3 text-sm" data-testid="fork-moving">
            <p className="font-medium">Yeni karta geçecek</p>
            <p>{fabric.code} — {fabric.name}</p>
          </div>
          <div className="rounded-md border p-3 text-sm" data-testid="fork-staying">
            <p className="font-medium">Eski kartta ({spec.code}) kalacak</p>
            {users.isLoading && <p className="text-muted-foreground">Yükleniyor…</p>}
            {users.isError && <p className="text-destructive">Kumaş listesi alınamadı.</p>}
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
              {staying.map((f) => <li key={f.id}>{f.code} — {f.name}</li>)}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Açık dokuma iş emirleri ve kayıtlı standart maliyet sürümleri değişmez.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wf-code">Yeni kart kodu *</Label>
              <Input id="wf-code" value={code} maxLength={WEFT_CODE_MAX} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Yeni kart adı *</Label>
              <Input id="wf-name" value={name} maxLength={WEFT_NAME_MAX} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!code.trim() || !name.trim() || fork.isPending || users.isLoading} onClick={() => fork.mutate()}>Kopyala ve bu kumaşa bağla</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
