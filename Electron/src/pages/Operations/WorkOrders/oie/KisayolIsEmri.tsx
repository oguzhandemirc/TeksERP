// Kısayol iş emri (K6): Terbiye formu kısayolun rotası UYGULANMIŞ açılır; üstte belirgin "Belge okut" (+ "Birden çok belge").
// Belge okutulunca aynı sayfada form kutuları belgeden dolar; "Elle doldur" bugünkü forma döner. Ayrı mod ekranı yok.
import { useState, type ReactNode } from "react";
import { Files, PencilLine, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGelenBelgeEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { UploadDialog } from "@/pages/Operations/GelenBelgeler/UploadDialog";
import { BelgedenIsEmriForm } from "./BelgedenIsEmriForm";
import { TopluBelgeForm } from "./TopluBelgeForm";
import { TopluYukleDialog } from "./TopluYukleDialog";
import { isScanRouteRef, SCAN_ROUTE_HINT, type RouteRef } from "./nav";

type View = { k: "manual" } | { k: "doc"; noteId: string } | { k: "bulk"; noteIds: string[] };

interface Props {
  route: RouteRef;
  /** Dışarıdan okutulmuş belge (formdaki genel "Belge okut") — doğrudan belge doldurmalı görünüm. */
  noteId: string | null;
  renderManual: (routeTemplateId: string | null, opts?: { belgeOkut?: boolean; shortcut?: boolean }) => ReactNode;
}

export function KisayolIsEmri({ route, noteId, renderManual }: Props) {
  const [view, setView] = useState<View>(noteId ? { k: "doc", noteId } : { k: "manual" });
  const [dialog, setDialog] = useState<null | "one" | "many">(null);
  const incomingDocsOn = useGelenBelgeEnabled();
  const { hasPermission } = useRoleAccess();
  const canScan = incomingDocsOn && hasPermission("gelen-belge:write");
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="oie-shortcut-form">
      {canScan && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-teal-50/60 px-6 py-3 dark:bg-teal-950/30">
          <Button type="button" size="lg" onClick={() => setDialog("one")} data-testid="oie-scan"
            className="gap-2 bg-teal-600 text-white hover:bg-teal-700">
            <ScanLine className="h-5 w-5" /> Belge okut
          </Button>
          <Button type="button" variant="outline" onClick={() => setDialog("many")} data-testid="oie-scan-many">
            <Files className="mr-1 h-4 w-4" /> Birden çok belge
          </Button>
          {view.k !== "manual" && (
            <Button type="button" variant="ghost" onClick={() => setView({ k: "manual" })} data-testid="oie-manual">
              <PencilLine className="mr-1 h-4 w-4" /> Elle doldur
            </Button>
          )}
          <span className="text-xs text-muted-foreground">Fotoğrafı ya da PDF'i seçin; okununca kutular kendiliğinden dolar.</span>
        </div>
      )}
      {/* Rotasız İE elle formdan açılmaz (form rota ister): yalnız belge okutarak. */}
      {view.k === "manual" && (isScanRouteRef(route)
        ? <p className="p-6 text-sm text-muted-foreground" data-testid="oie-scan-route-hint">Belgeyi okutun. {SCAN_ROUTE_HINT}</p>
        : renderManual(route.id, { belgeOkut: false, shortcut: true }))}
      {view.k === "doc" && <BelgedenIsEmriForm key={view.noteId} noteId={view.noteId} route={route} />}
      {view.k === "bulk" && <TopluBelgeForm noteIds={view.noteIds} route={route} />}
      {dialog === "one" && (
        <UploadDialog open autoSend target={{ kind: "new" }} onOpenChange={(o) => !o && setDialog(null)}
          onDone={(note) => { setDialog(null); setView({ k: "doc", noteId: note.id }); }} />
      )}
      {dialog === "many" && (
        <TopluYukleDialog open onOpenChange={(o) => !o && setDialog(null)}
          onDone={(ids) => { setDialog(null); setView({ k: "bulk", noteIds: ids }); }} />
      )}
    </div>
  );
}
