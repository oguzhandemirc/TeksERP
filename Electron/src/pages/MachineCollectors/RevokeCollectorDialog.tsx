// Kart iptali — yıkıcı durum geçişi: kart artık imza atamaz, TÜM tezgah bağları çözülür. Önizleme taze
// okumadır (`GET /:id`): onaydan önce o anki bağlı tezgahların her biri adıyla listelenir.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { machineCollectorService } from "./service";
import type { MachineCollector } from "./types";

interface Props {
  target: MachineCollector | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (c: MachineCollector) => void;
}

export function RevokeCollectorDialog({ target, busy, onCancel, onConfirm }: Props) {
  const preview = useQuery({
    queryKey: ["machine-collectors", "revoke-preview", target?.id],
    queryFn: () => machineCollectorService.get(target?.id ?? ""),
    enabled: target !== null,
    staleTime: 0,
    gcTime: 0,
  });
  const fresh = preview.data;
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Kart iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            {target?.name}: kart bir daha veri gönderemez, sırrı geçersiz olur. Kayıt silinmez; geçmiş duruşlar değişmez. Aşağıdaki tezgahların kartla bağı çözülür.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading && <p className="text-sm text-muted-foreground">Bağlı tezgahlar okunuyor…</p>}
        {preview.isError && <p className="text-sm text-destructive">Önizleme okunamadı — iptal için önce bağlı tezgahları görmek gerekir.</p>}
        {fresh && (
          <ul data-testid="revoke-machines" className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
            {fresh.machines.length === 0 && <li className="text-muted-foreground">Bağlı tezgah yok.</li>}
            {fresh.machines.map((m) => (
              <li key={m.machine.id}><span className="font-mono">{m.machine.code}</span> — {m.machine.name}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Vazgeç</Button>
          <Button variant="destructive" disabled={!fresh || busy || fresh.revokedAt !== null} onClick={() => fresh && onConfirm(fresh)}>
            Kartı iptal et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
