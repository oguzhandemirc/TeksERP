// K28 İE "Geldiği belge": iş emrinin toplarının geldiği gelen belge(ler) + fotoğraf aç; yeri "Belgeler" modalının başı (2026-11-10).
// Fotoğraf saklama ayarıyla silinmişse açıklama yazılır. Modül kapalı / izin yoksa / belge yoksa bölüm çizilmez.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useGelenBelgeEnabled } from "@/hooks/usePricingEnabled";
import { getWorkOrderSourceNotes, INCOMING_DOCUMENT_QUERY_KEY } from "@/pages/Operations/GelenBelgeler/service";
import { useScanImage } from "@/pages/Operations/GelenBelgeler/useScanImage";
import { isScanPurged, SCAN_PURGED_TEXT } from "@/pages/Operations/GelenBelgeler/photoRetention";
import { NOTE_STATUS_LABEL } from "@/pages/Operations/GelenBelgeler/noteStatus";
import type { WorkOrderSourceNote } from "@/pages/Operations/GelenBelgeler/photoRetentionTypes";

type Scan = WorkOrderSourceNote["scans"][number];

function ScanPage({ scan }: { scan: Scan }) {
  const img = useScanImage(scan.id, { purged: isScanPurged(scan) });
  if (img.purged) return <p className="text-sm text-muted-foreground" data-testid="source-doc-purged">{SCAN_PURGED_TEXT}</p>;
  if (img.isLoading) return <p className="text-sm text-muted-foreground">Fotoğraf yükleniyor…</p>;
  if (img.isError || !img.url) return <p className="text-sm text-destructive">Fotoğraf alınamadı.</p>;
  if (img.isPdf)
    return (
      <a className="text-sm underline" href={img.url} target="_blank" rel="noreferrer">
        PDF belgeyi aç
      </a>
    );
  return <img src={img.url} alt={`Sayfa ${scan.pageNo}`} className="max-h-[70vh] w-full object-contain" />;
}

function PhotoDialog({ note, onClose }: { note: WorkOrderSourceNote; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const scan = note.scans[Math.min(idx, note.scans.length - 1)];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="source-doc-dialog">
        <DialogHeader>
          <DialogTitle>{note.noteNo} fotoğrafı</DialogTitle>
          <DialogDescription>Belge no: {note.senderDocNo ?? "—"}</DialogDescription>
        </DialogHeader>
        {note.scans.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {note.scans.map((s, i) => (
              <Button key={s.id} size="sm" variant={i === idx ? "default" : "outline"} onClick={() => setIdx(i)}>
                Sayfa {s.pageNo}
                {s.regionNo ? `/${s.regionNo}` : ""}
              </Button>
            ))}
          </div>
        )}
        {scan && <ScanPage key={scan.id} scan={scan} />}
      </DialogContent>
    </Dialog>
  );
}

/** `onNavigate`: GB bağlantısına tıklanınca (modal kapansın diye) çağrılır. */
export function SourceDocsV3({ workOrderId, onNavigate }: { workOrderId: string; onNavigate?: () => void }) {
  const { hasPermission } = useRoleAccess();
  const enabled = useGelenBelgeEnabled() && hasPermission("gelen-belge:read");
  const q = useQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "is-emri-belgeleri", workOrderId],
    queryFn: () => getWorkOrderSourceNotes(workOrderId),
    enabled,
    staleTime: 60_000,
  });
  const [open, setOpen] = useState<WorkOrderSourceNote | null>(null);
  const notes = q.data?.notes ?? [];
  if (!enabled || notes.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="wo-source-docs-section">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Geldiği belge{q.data && q.data.total > notes.length ? ` (${notes.length} / ${q.data.total})` : ""}
      </div>
      <ul className="flex flex-col gap-2" data-testid="wo-source-docs">
        {notes.map((n) => {
          const allPurged = n.scans.length > 0 && n.scans.every(isScanPurged);
          return (
            <li key={n.id} className="flex flex-wrap items-center gap-3 text-sm" data-testid="wo-source-doc">
              <Link to={`/operations/gelen-belgeler/${n.id}`} className="font-medium underline" onClick={onNavigate}>
                {n.noteNo}
              </Link>
              <span className="text-muted-foreground">Belge no: {n.senderDocNo ?? "—"}</span>
              <span className="text-muted-foreground">{NOTE_STATUS_LABEL[n.status] ?? n.status}</span>
              {n.scans.length === 0 ? (
                <span className="text-muted-foreground">Fotoğraf yok</span>
              ) : allPurged ? (
                <span className="text-muted-foreground" data-testid="wo-source-doc-purged">{SCAN_PURGED_TEXT}</span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setOpen(n)} data-testid="wo-source-doc-open">
                  Fotoğrafı aç
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {open && <PhotoDialog note={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
