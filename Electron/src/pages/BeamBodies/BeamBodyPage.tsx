// =============================================================================
// LEVENT GÖVDESİ — kayıt sayfası · `definitions/beam-bodies/:id` (devere ek B4)
// =============================================================================
// Özet (sahip · durum · yer · ölçü · uyumlu tezgâhlar) + hareket geçmişi. Eylemler: düzenle, elle geçiş (önizlemeli),
// QR bas, kayıt iptali; son hareketin "Geri al"ı geçmiş satırında. Yazma `beam-body:write`, basım `label:print`.
// =============================================================================
import { Fragment, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Ban, ChevronDown, Pencil, Tag } from "lucide-react";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/services/apiClient";
import { BeamBodyFormDialog } from "./BeamBodyFormDialog";
import { BeamBodyLabelDialog, isBeamBodyLabelPrintable } from "./BeamBodyLabelDialog";
import { BeamBodyModeGate } from "./BeamBodyModeGate";
import { BeamBodyTimeline } from "./BeamBodyTimeline";
import { dimsText, ownerText, placeText } from "./model";
import { BEAM_BODIES_PATH, useBeamBody, useBeamBodyEvents } from "./service";
import { MANUAL_LABELS, TransitionDialog, manualKindsFor } from "./TransitionDialog";
import { CancelRegistrationDialog, UndoEventDialog } from "./UndoDialogs";
import { beamBodyStatusMeta, type BeamBody, type BeamBodyEvent, type BeamBodyManualKind } from "./types";

type DialogState = { kind: "edit" } | { kind: "label" } | { kind: "cancel" } | { kind: "move"; move: BeamBodyManualKind } | { kind: "undo"; event: BeamBodyEvent } | null;

export function BeamBodyPage() {
  return (
    <BeamBodyModeGate>
      <BeamBodyRecord />
    </BeamBodyModeGate>
  );
}

function BeamBodyRecord() {
  const { id } = useParams<{ id: string }>();
  const openTarget = useOpenTarget();
  const q = useBeamBody(id);
  const ev = useBeamBodyEvents(id);
  const [dialog, setDialog] = useState<DialogState>(null);
  const b = q.data;
  const meta = b ? beamBodyStatusMeta(b.status, b.statusLabel) : null;
  return (
    <PageShell>
      <PageHeader
        title={b ? b.bodyNo : "Levent gövdesi"}
        titleExtra={meta && <Badge className={cn("font-normal", meta.badgeClass)}>{meta.label}</Badge>}
        description={b ? `${ownerText(b.owner)} · ${placeText(b.place)}` : undefined}
        onBack={() => openTarget(BEAM_BODIES_PATH)}
        parent={{ label: "Levent Gövdeleri", to: BEAM_BODIES_PATH }}
        actions={b && <Actions b={b} onOpen={setDialog} />}
      />
      <PageBody className="space-y-6 p-4 sm:p-6">
        {q.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {q.isError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
        {b && <Summary b={b} />}
        {b && (
          <section className="space-y-3" aria-label="Hareket geçmişi">
            <h2 className="text-base font-semibold">Hareket geçmişi</h2>
            {ev.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
            {ev.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(ev.error)}</p>}
            {ev.data && <BeamBodyTimeline events={ev.data} onUndo={(event) => setDialog({ kind: "undo", event })} />}
          </section>
        )}
      </PageBody>
      {b && dialog?.kind === "edit" && <BeamBodyFormDialog initial={b} onClose={() => setDialog(null)} />}
      {b && dialog?.kind === "label" && <BeamBodyLabelDialog bodies={[b]} onClose={() => setDialog(null)} />}
      {b && dialog?.kind === "cancel" && <CancelRegistrationDialog body={b} onClose={() => setDialog(null)} />}
      {b && dialog?.kind === "move" && <TransitionDialog body={b} kind={dialog.move} onClose={() => setDialog(null)} />}
      {b && dialog?.kind === "undo" && <UndoEventDialog body={b} event={dialog.event} onClose={() => setDialog(null)} />}
    </PageShell>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Summary({ b }: { b: BeamBody }) {
  return (
    <section className="rounded-xl border border-card-border bg-card px-5 py-4 shadow-card" aria-label="Gövde özeti">
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Fact label="Sahibi">{ownerText(b.owner)}</Fact>
        <Fact label="Nerede">{placeText(b.place)}</Fact>
        <Fact label="En · flanş · dara">{dimsText(b)}</Fact>
        <Fact label="Uyumlu tezgâhlar">{b.machineFits.length === 0 ? "Hepsi (liste boş)" : b.machineFits.map((m) => m.name).join(", ")}</Fact>
        {b.ownerReturnDue && <Fact label="Uyarı"><span className="text-amber-700 dark:text-amber-300">Boş ve bizde — sahibine iade edilecek</span></Fact>}
        {!b.isActive && <Fact label="Kart">Pasif</Fact>}
        {b.notes && <Fact label="Not"><span className="whitespace-pre-line">{b.notes}</span></Fact>}
      </dl>
    </section>
  );
}

function Actions({ b, onOpen }: { b: BeamBody; onOpen: (d: DialogState) => void }) {
  const moves = manualKindsFor(b);
  return (
    <div className="flex items-center gap-2">
      <PermissionGate permission="label:print">
        <Button size="sm" variant="outline" disabled={!isBeamBodyLabelPrintable(b)} onClick={() => onOpen({ kind: "label" })}>
          <Tag className="mr-1 h-4 w-4" /> QR etiketi
        </Button>
      </PermissionGate>
      <PermissionGate permission="beam-body:write">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={moves.length === 0} title={moves.length === 0 ? "Bu durumda elle hareket yok (dolu/tezgâhtaki gövde sarım işlemleriyle hareket eder)" : undefined}>
              Hareket yaz <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {moves.map((k, i) => (
              <Fragment key={k}>
                {k === "SCRAP" && i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem className={k === "SCRAP" ? "text-destructive" : undefined} onSelect={() => onOpen({ kind: "move", move: k })}>
                  {MANUAL_LABELS[k]}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="outline" disabled={!b.isActive} onClick={() => onOpen({ kind: "edit" })}>
          <Pencil className="mr-1 h-4 w-4" /> Düzenle
        </Button>
        <Button size="sm" variant="outline" className="text-destructive" disabled={!b.isActive} onClick={() => onOpen({ kind: "cancel" })} title="Yanlış açılmış kartı iptal et (yalnız hareketsizken)">
          <Ban className="mr-1 h-4 w-4" /> Kaydı iptal et
        </Button>
      </PermissionGate>
    </div>
  );
}
