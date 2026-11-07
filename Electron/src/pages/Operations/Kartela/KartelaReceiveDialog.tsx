// Kartela Kabul — bir sevkin firmadaki topları için dönen kartela adedi (+ ölçüm bayrağı açıksa cm/kg).
// Tablet "Kartela Kabul" ekranının panel eşi; gövde `buildReceiveReturns` ile tabletin `selectedReturns`ı.
// `/receive` clientToken almaz (bilinçli; sunucu aynı top kümesini idempotent döndürür) → düğme kilidi
// + istek uçuştayken diyalog kapanmaz.
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useKartelaMeasurementEnabled } from "@/hooks/usePricingEnabled";
import { safeFormat } from "@/lib/format";
import { toastServerSuccess } from "@/lib/serverNotes";
import { kartelaService, type KartelaReceiveRequest } from "./service";
import { buildReceiveReturns, EMPTY_ENTRY, refreshKartelaLists, type KartelaJob, type ReceiveEntry } from "./kartelaActions";
import { ReceiveRollRow } from "./ReceiveRollRow";
import { useSingleFlight } from "./useSingleFlight";

interface Props {
  job: KartelaJob | null;
  onClose: () => void;
}

export function KartelaReceiveDialog({ job, onClose }: Props) {
  const qc = useQueryClient();
  const showMeasure = useKartelaMeasurementEnabled();
  const once = useSingleFlight();
  const [entries, setEntries] = useState<Record<string, ReceiveEntry>>({});
  const [manifestNo, setManifestNo] = useState("");
  const [notes, setNotes] = useState("");
  const jobId = job?.dispatchId ?? null;
  // Başka bir sevk açılınca form sıfırlanır (tablet `openJob`).
  useEffect(() => {
    setEntries({});
    setManifestNo("");
    setNotes("");
  }, [jobId]);

  const returns = useMemo(
    () => (job ? buildReceiveReturns(job.rolls.map((o) => o.roll.id), entries) : []),
    [job, entries],
  );
  const totalSwatches = returns.reduce((s, r) => s + r.count, 0);
  const mut = useMutation({
    mutationFn: (body: KartelaReceiveRequest) => kartelaService.receive(body),
    onSuccess: (res) => {
      toastServerSuccess(res, "Kartela kabulü yapıldı");
      refreshKartelaLists(qc);
      onClose();
    },
    // onError YOK: apiClient 4xx mesajını zaten basar; girilen adetler korunur.
  });
  const pending = mut.isPending;
  const submit = () => {
    if (!job || returns.length === 0 || pending) return;
    const body = {
      subcontractorId: job.firm.id,
      dispatchId: job.dispatchId,
      manifestNo: manifestNo.trim() || null,
      notes: notes.trim() || null,
      returns,
    };
    once((done) => mut.mutate(body, { onSettled: done }));
  };
  const change = (open: boolean) => {
    if (!open && !pending) onClose();
  };

  return (
    <Dialog open={job !== null} onOpenChange={change}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Kartela Kabulü {job ? `· ${job.dispatchNo}` : ""}</DialogTitle>
          <DialogDescription>
            {job ? `${job.firm.name} · ${safeFormat(job.dispatchedAt, "dd.MM.yyyy HH:mm")} · ${job.rolls.length} top` : ""}
            {" — "}adet girilen top tükenir, o kadar kartela doğar.
          </DialogDescription>
        </DialogHeader>
        {job && (
          <ReceiveRollsTable job={job} entries={entries} setEntries={setEntries} showMeasure={showMeasure} disabled={pending} />
        )}
        <div className="grid gap-2 sm:grid-cols-[14rem_1fr]">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">İrsaliye no</span>
            <Input value={manifestNo} maxLength={64} disabled={pending} onChange={(e) => setManifestNo(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Not</span>
            <Textarea rows={1} value={notes} maxLength={1000} disabled={pending} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm text-muted-foreground" data-testid="kabul-ozet">
            {returns.length > 0 ? `${returns.length} top → ${totalSwatches} kartela` : "Kabul edilecek topların kartela adedini girin."}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={pending} onClick={onClose}>Vazgeç</Button>
            <Button className="gap-1.5" disabled={returns.length === 0 || pending} onClick={submit}>
              <PackageCheck className="h-4 w-4" />
              {pending ? "Kaydediliyor…" : "Kabul Et"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveRollsTable({ job, entries, setEntries, showMeasure, disabled }: {
  job: KartelaJob;
  entries: Record<string, ReceiveEntry>;
  setEntries: Dispatch<SetStateAction<Record<string, ReceiveEntry>>>;
  showMeasure: boolean;
  disabled: boolean;
}) {
  // Aynı anda tek topun kartela-kartela ölçüsü açık (uzun sevkte tablo boğulmasın).
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Top</TableHead>
            <TableHead>Kumaş / Renk</TableHead>
            <TableHead className="text-right">Gönderilen m</TableHead>
            <TableHead>Kartela adedi</TableHead>
            {showMeasure && <TableHead>Uzunluk (cm)</TableHead>}
            {showMeasure && <TableHead>Ağırlık (kg)</TableHead>}
            {showMeasure && <TableHead>Ölçü</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {job.rolls.map((o) => (
            <ReceiveRollRow key={o.roll.id} item={o} showMeasure={showMeasure} disabled={disabled}
              entry={entries[o.roll.id] ?? EMPTY_ENTRY}
              onChange={(e) => setEntries((prev) => ({ ...prev, [o.roll.id]: e }))}
              expanded={expanded === o.roll.id}
              onToggleExpand={() => setExpanded((cur) => (cur === o.roll.id ? null : o.roll.id))} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
