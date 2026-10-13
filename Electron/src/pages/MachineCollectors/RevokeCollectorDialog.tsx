// Kart iptali — yıkıcı durum geçişi: kart artık imza atamaz, TÜM tezgah bağları çözülür. Önizleme SUNUCU ucudur
// (`GET /:id/revoke/preview`): bağı çözülecek tezgahlar, kartın açık duruşları ve bekleyen geç kapanışlar ADIYLA.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { machineCollectorService } from "./service";
import type { CollectorRevokePreview, MachineCollector } from "./types";

interface Props {
  target: MachineCollector | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (c: MachineCollector) => void;
}

function Section({ title, empty, testId, children, count }: { title: string; empty: string; testId: string; count: number; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{title} ({count})</p>
      <ul data-testid={testId} className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
        {count === 0 ? <li className="text-muted-foreground">{empty}</li> : children}
      </ul>
    </div>
  );
}

function PreviewBody({ p }: { p: CollectorRevokePreview }) {
  return (
    <div className="space-y-3">
      {p.block && <p className="text-sm text-destructive">{p.block.message}</p>}
      <Section title="Bağı çözülecek tezgahlar" empty="Bağlı tezgah yok." testId="revoke-machines" count={p.machines.length}>
        {p.machines.map((m) => (
          <li key={m.machineId}><span className="font-mono">{m.machineCode}</span> — {m.machineName}</li>
        ))}
      </Section>
      <Section title="Kartın açık duruşları — kart artık kapatamaz, süre aşımında geçici kapanır" empty="Açık duruş yok." testId="revoke-open-stops" count={p.openStops.length}>
        {p.openStops.map((s) => (
          <li key={s.stopId}>
            <span className="font-mono">{s.machineCode}</span> — {s.machineName} · {fmtFactoryDateTime(s.startedAt)}’den beri{s.rawStopCode ? ` · kod ${s.rawStopCode}` : ""}
          </li>
        ))}
      </Section>
      <Section title="Bekleyen geç kapanışlar" empty="Bekleyen geç kapanış yok." testId="revoke-pending-ends" count={p.pendingEnds.length}>
        {p.pendingEnds.map((s) => (
          <li key={s.stopId}>
            <span className="font-mono">{s.machineCode}</span> — {s.machineName} · {fmtFactoryDateTime(s.startedAt)} ·{" "}
            {s.lateEndedAt ? "gerçek bitiş kuyrukta, mühür açılınca uygulanır" : "gerçek bitiş artık gelmeyecek (geçici bitiş kalır)"}
          </li>
        ))}
      </Section>
    </div>
  );
}

export function RevokeCollectorDialog({ target, busy, onCancel, onConfirm }: Props) {
  const preview = useQuery({
    queryKey: ["machine-collectors", "revoke-preview", target?.id],
    queryFn: () => machineCollectorService.revokePreview(target?.id ?? ""),
    enabled: target !== null,
    staleTime: 0,
    gcTime: 0,
  });
  const fresh = preview.data;
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Kart iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            {target?.name}: kart bir daha veri gönderemez, sırrı geçersiz olur. Kayıt silinmez; geçmiş duruşlar değişmez. Etkilenecek kayıtlar aşağıda.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading && <p className="text-sm text-muted-foreground">Önizleme okunuyor…</p>}
        {preview.isError && <p className="text-sm text-destructive">Önizleme okunamadı — iptal için önce etkilenecek kayıtları görmek gerekir.</p>}
        {fresh && <PreviewBody p={fresh} />}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Vazgeç</Button>
          <Button variant="destructive" disabled={!fresh || busy || !fresh.revocable} onClick={() => fresh && onConfirm(fresh.collector)}>
            Kartı iptal et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
