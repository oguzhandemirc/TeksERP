// =============================================================================
// LEVENT GÖVDESİ QR ETİKETİ (LabelKind BEAM_BODY) — barkod = `bodyNo`; sevk/dönüş/takmada okutulur
// =============================================================================
// Tek gövde: ortak tezgah/levent diyaloğu (önizleme + adet). Çoklu seçim: toplu uç YOK (B1 kararı) — her gövde
// için `html?copies=N` sırayla istenir, basılır ve YALNIZ basılan gövdeye `print-event` yazılır; biri düşerse
// kalanlar durur ve kaçının basıldığı söylenir (sessiz yarım iş yok).
// =============================================================================
import { useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { LoomLabelPrintDialog, loomLabelSubject } from "@/components/labels/LoomLabelPrintDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { printTracked } from "@/lib/print";
import { LOOM_LABEL_COPIES_MAX, LOOM_LABEL_COPIES_MIN, loomLabelService, parseLabelCopies } from "@/services/loomLabelService";
import type { BeamBody } from "./types";

const DESC = "Etiket gövdenin flanşına yapıştırılır; iplik sevkinde, dönüş kabulünde ve tezgâha takarken okutulur. Şablon Etiket Stüdyosu'nda 'Levent gövdesi' türünden gelir.";

/** Hurda / iade edilmiş / pasif gövde sahada dolaşmaz — etiketi de basılmaz. */
export function isBeamBodyLabelPrintable(b: Pick<BeamBody, "status" | "isActive">): boolean {
  return b.isActive && b.status !== "SCRAPPED" && b.status !== "RETURNED_TO_OWNER";
}

export function BeamBodyLabelDialog({ bodies, onClose }: { bodies: Array<Pick<BeamBody, "id" | "bodyNo">>; onClose: () => void }) {
  if (bodies.length === 1) {
    const b = bodies[0]!;
    return <LoomLabelPrintDialog target="beam-bodies" subject={{ id: b.id, label: b.bodyNo }} title="Gövde QR etiketi bas" description={DESC} onOpenChange={(o) => !o && onClose()} />;
  }
  return <MultiLabelDialog bodies={bodies} onClose={onClose} />;
}

function MultiLabelDialog({ bodies, onClose }: { bodies: Array<Pick<BeamBody, "id" | "bodyNo">>; onClose: () => void }) {
  const [rawCopies, setRawCopies] = useState("1");
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const copies = parseLabelCopies(rawCopies);

  const printAll = async () => {
    if (copies === null || busy) return;
    setBusy(true);
    let printed = 0;
    try {
      for (const b of bodies.slice(done)) {
        const subject = { id: b.id, label: b.bodyNo };
        const html = await loomLabelService.getHtml("beam-bodies", b.id, copies);
        const out = await printTracked({ subject: loomLabelSubject("beam-bodies", subject, copies), html, workEndpoint: true });
        if (!out.proceed) break;
        await loomLabelService.recordPrint("beam-bodies", b.id, copies, out.printJob).catch(() => undefined);
        printed++;
        setDone((d) => d + 1);
      }
    } catch {
      // HTML alınamadı: sunucunun cümlesini genel bildirim bastı; kalanlar durur.
    } finally {
      setBusy(false);
    }
    const total = done + printed;
    if (total >= bodies.length) {
      toast.success(`${bodies.length} gövdenin etiketi yazdırıldı.`);
      onClose();
    } else if (printed > 0 || done > 0) {
      toast.warning(`${total}/${bodies.length} gövde basıldı — kalanlar için yeniden “Yazdır”.`);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bodies.length} gövdenin QR etiketi</DialogTitle>
          <DialogDescription>{DESC}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2" aria-label="Basılacak gövdeler">
            {bodies.map((b, i) => (
              <span key={b.id} className={i < done ? "rounded-badge bg-emerald-100 px-1.5 py-0.5 font-mono text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "rounded-badge bg-muted px-1.5 py-0.5 font-mono text-xs"}>
                {b.bodyNo}
              </span>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="bb-label-copies">Gövde başına adet</Label>
            <Input id="bb-label-copies" inputMode="numeric" className="w-28" value={rawCopies} onChange={(e) => setRawCopies(e.target.value)} aria-invalid={copies === null} />
            {copies === null && <p role="alert" className="text-xs text-destructive">Adet {LOOM_LABEL_COPIES_MIN}–{LOOM_LABEL_COPIES_MAX} arası tam sayı olmalı.</p>}
          </div>
          {done > 0 && <p className="text-xs text-muted-foreground">{done}/{bodies.length} basıldı (yeşil olanlar).</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Kapat</Button>
          <Button type="button" disabled={copies === null || busy} onClick={() => void printAll()}>
            <Printer className="h-4 w-4" /> {busy ? "Yazdırılıyor…" : done > 0 ? "Kalanları yazdır" : "Yazdır"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
