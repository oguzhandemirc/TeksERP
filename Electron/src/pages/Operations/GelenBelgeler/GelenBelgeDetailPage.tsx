// GELEN BELGE DETAYI — fotoğraf + satır vurgusu, başlık eşleme, toplam şeridi, satırlar, kılavuzlu hücre girişi, onay.
import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ScanSearch } from "lucide-react";
import { CariHoldStrip } from "@/pages/Finance/CariHold/CariHoldStrip";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ScanViewer } from "./ScanViewer";
import { NoteHeaderForm } from "./NoteHeaderForm";
import { TotalsStrip } from "./TotalsStrip";
import { NoticesStrip } from "./NoticesStrip";
import { NotePeerStrips } from "./DuplicateDocNo";
import { LinesTable } from "./LinesTable";
import { AddLineForm } from "./AddLineForm";
import { LineImportButton } from "./LineImportButton";
import { CellReviewDialog } from "./CellReviewDialog";
import { ApproveDialog } from "./ApproveDialog";
import { ScanReadBanner } from "./ScanReadBanner";
import { AddPagesAction } from "./AddPagesAction";
import { DeleteDraftNoteAction } from "./DeleteDraftNoteAction";
import { CancelNoteAction, CancelReasonLine } from "./CancelNoteAction";
import { buildReviewQueue, lineRect } from "./review-queue";
import { isApprovable, isEditable, isWorkOrderOpenable, NOTE_STATUS_LABEL, NOTE_STATUS_VARIANT, SOURCE_LABEL } from "./noteStatus";
import { useNoteDetail } from "./useNoteDetail";
import { ProcessGramajPanel } from "./ProcessGramajPanel";
import { useProcessGramaj } from "./processChoices";
import { OpenWorkOrderAction } from "./OpenWorkOrderAction";
import { BatchNoPicker } from "./BatchNoPicker";
import { KursunMetersCard } from "./KursunMetersCard";
import { PartiesCard } from "./PartiesCard";
import { TanimaKarti } from "./TanimaKarti";
import { showsPerDocument } from "./partiMetre";
import type { DeliveryNoteDetail } from "./types";
import { noteCountText } from "./noteLines";
import { useNoteTabTitle } from "./useNoteTabTitle";
import { retentionFor } from "./photoRetention";
import { TeachButton, UnknownTypeStrip } from "./tanit/TeachEntry";

const LIST_PATH = "/operations/gelen-belgeler";

interface DetailActionsProps {
  note: DeliveryNoteDetail;
  reviewCount: number;
  addPages: ReactNode;
  onReview: () => void;
  onApprove: () => void;
}

function DetailActions({ note, reviewCount, addPages, onReview, onApprove }: DetailActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {addPages}
      {/* S1b belge tipi tanıtma: izin + okunmuş fotoğraf yoksa bileşen çizilmez. */}
      <TeachButton note={note} />
      {reviewCount > 0 && (
        <Button variant="outline" onClick={onReview}>
          <ScanSearch className="mr-1 h-4 w-4" />
          Gözden geçir ({reviewCount})
        </Button>
      )}
      {isApprovable(note.status) && (
        <PermissionGate permission="gelen-belge:approve">
          <Button onClick={onApprove} disabled={note.lines.length === 0}>
            <CheckCircle2 className="mr-1 h-4 w-4" />
            Onayla
          </Button>
        </PermissionGate>
      )}
      {/* Belgeden iş emri (D4-D2): topları doğmuş belgede; açılacak parti kalmadıysa pasif + gerekçe. */}
      {isWorkOrderOpenable(note.status) && <OpenWorkOrderAction noteId={note.id} />}
      {/* Onaylı belge iptali (K15): önizleme + ters kayıt; bileşen durum ve izni kendisi süzer. */}
      <CancelNoteAction note={note} />
      {/* Taslak silme: yalnız DRAFT (bileşen kendisi de süzer); backend aynı izin + DRAFT claim'i. */}
      {note.status === "DRAFT" && (
        <PermissionGate permission="gelen-belge:write">
          <DeleteDraftNoteAction note={note} listPath={LIST_PATH} />
        </PermissionGate>
      )}
    </div>
  );
}

/** Belge gelmeden önceki kabuk (yükleniyor / yüklenemedi). */
function DetailLoading({ failed }: { failed: boolean }) {
  return (
    <PageShell>
      <PageHeader title="Gelen Belge" parent={{ label: "Gelen Belgeler", to: LIST_PATH }} />
      <PageBody className="p-6 text-sm text-muted-foreground">{failed ? "Belge yüklenemedi." : "Yükleniyor…"}</PageBody>
    </PageShell>
  );
}

/** Okuma yönergeleri ("yeniden okutun / elle girin", S1b "tipi seçin") yalnız açık belgede anlamlıdır; kapanmışta çizilmez. */
function ReadGuidance({ note, editable, canRequeue, onRequeued }: { note: DeliveryNoteDetail; editable: boolean; canRequeue: boolean; onRequeued: () => void }) {
  return (
    <>
      {note.status === "DRAFT" && <ScanReadBanner scans={note.scans} lines={note.lines} editable={editable} canRequeue={canRequeue} onRequeued={onRequeued} />}
      {note.status !== "CANCELLED" && <UnknownTypeStrip note={note} />}
    </>
  );
}

export function IncomingDocumentDetailPage() {
  const { id = "" } = useParams();
  const { note, suggestions, header, line, removeLine, invalidate } = useNoteDetail(id);
  const { hasPermission } = useRoleAccess();
  const [selected, setSelected] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const n = note.data;
  const gramaj = useProcessGramaj(n, suggestions.data, !!n && isApprovable(n.status) && hasPermission("gelen-belge:approve"));
  const multiParty = useNoteTabTitle(id, n?.noteNo);
  if (!n) return <DetailLoading failed={note.isError} />;
  const editable = isEditable(n.status) && hasPermission("gelen-belge:write");
  const reviewCount = buildReviewQueue(n.lines).length;
  const sel = n.lines.find((l) => l.id === selected) ?? null;
  const perDoc = showsPerDocument(n);
  return (
    <PageShell>
      <PageHeader
        title={`Gelen Belge ${n.noteNo}`}
        titleExtra={<Badge variant={NOTE_STATUS_VARIANT[n.status]}>{NOTE_STATUS_LABEL[n.status]}</Badge>}
        statusLine={`Kaynak: ${SOURCE_LABEL[n.sourceKind]} · ${noteCountText(n.lines)}`}
        parent={{ label: "Gelen Belgeler", to: LIST_PATH }}
        actions={
          <DetailActions
            note={n}
            reviewCount={editable ? reviewCount : 0}
            addPages={n.status === "DRAFT" && hasPermission("gelen-belge:write") ? <AddPagesAction note={n} onDone={() => void invalidate()} /> : null}
            onReview={() => setReviewOpen(true)}
            onApprove={() => setApproveOpen(true)}
          />
        }
      />
      <PageBody className="min-h-0 p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          {isApprovable(n.status) && <CariHoldStrip message={n.cariHold?.message} title="Cari kilitli — bu belge onaylanamaz" />}
          <ReadGuidance note={n} editable={editable} canRequeue={hasPermission("gelen-belge:write")} onRequeued={() => void invalidate()} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ScanViewer scans={n.scans} highlight={sel ? lineRect(sel) : null} highlightScanId={sel?.scanId ?? null} selectionKey={sel?.id ?? null} />
            <div className="flex min-w-0 flex-col gap-4">
              {perDoc && <BatchNoPicker note={n} editable={editable} onPatch={(p) => header.mutate(p)} />}
              {perDoc && <KursunMetersCard note={n} editable={editable} onPatch={(p) => header.mutateAsync(p)} />}
              <NoteHeaderForm note={n} suggestions={suggestions.data} editable={editable} onPatch={(p) => header.mutate(p)} />
              {n.status !== "CANCELLED" && <TotalsStrip check={n.totalsCheck} approvable={isApprovable(n.status)} partiesShown={multiParty} />}{/* iptalde toplar düştü; hüküm anlamsız */}
              <NoticesStrip notices={n.notices} /><PartiesCard noteId={n.id} blocks={n.totalsCheck?.blocks} /><TanimaKarti tanima={n.tanima} />
              <NotePeerStrips note={n} />
              {n.varianceReason && <p className="text-xs text-muted-foreground">Fark gerekçesi: {n.varianceReason}</p>}
              <CancelReasonLine note={n} />
              <ProcessGramajPanel groups={gramaj.groups} options={suggestions.data?.processOptions ?? []} choiceGroups={suggestions.data?.processGroups ?? []} picks={gramaj.picks} onPick={gramaj.onPick} />
            </div>
          </div>
          <LinesTable
            note={n}
            suggestions={suggestions.data}
            editable={editable}
            canWrite={hasPermission("gelen-belge:write")}
            selectedId={selected}
            onSelect={setSelected}
            onPatch={(lineId, patch) => line.mutate({ lineId, patch })}
            onDelete={(lineId) => removeLine.mutate(lineId)}
            perDocument={perDoc}
          />
          {editable && (
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <AddLineForm noteId={n.id} defaultBlock={Math.max(1, ...n.lines.map((l) => l.blockNo))} onAdded={() => void invalidate()} />
              <LineImportButton noteId={n.id} onImported={() => void invalidate()} />
            </div>
          )}
        </div>
      </PageBody>
      <CellReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        lines={n.lines}
        // Kırpık satırın kendi sayfasından (E4 scanId); taşımayan satırda yalnız tek taramalı belgede.
        scans={n.scans}
        onSave={(item, patch) => line.mutateAsync({ lineId: item.lineId, patch })}
      />
      <ApproveDialog noteId={n.id} lines={n.lines} perDocument={perDoc && n.perDocument ? { note: n, gate: n.perDocument } : null} processChoices={gramaj.choices} choiceNoun={suggestions.data?.processGroups?.length ? "işlem seçimi" : undefined} retention={retentionFor(n)} open={approveOpen} onOpenChange={setApproveOpen} onDone={() => void invalidate()} />
    </PageShell>
  );
}
