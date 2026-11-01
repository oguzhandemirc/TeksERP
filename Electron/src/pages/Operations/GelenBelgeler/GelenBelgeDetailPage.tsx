// GELEN BELGE DETAYI — fotoğraf + satır vurgusu, başlık eşleme, toplam şeridi, satırlar, kılavuzlu hücre girişi, onay.
import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Factory, ScanSearch } from "lucide-react";
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
import { LinesTable } from "./LinesTable";
import { AddLineForm } from "./AddLineForm";
import { LineImportButton } from "./LineImportButton";
import { CellReviewDialog } from "./CellReviewDialog";
import { ApproveDialog } from "./ApproveDialog";
import { ScanReadBanner } from "./ScanReadBanner";
import { AddPagesAction } from "./AddPagesAction";
import { buildReviewQueue, lineRect } from "./review-queue";
import { isApprovable, isEditable, isWorkOrderOpenable, NOTE_STATUS_LABEL, NOTE_STATUS_VARIANT, SOURCE_LABEL } from "./noteStatus";
import { useNoteDetail } from "./useNoteDetail";
import { ProcessGramajPanel } from "./ProcessGramajPanel";
import { useProcessGramaj } from "./processChoices";
import { WorkOrderFromNoteDialog } from "./WorkOrderFromNoteDialog";
import type { DeliveryNoteDetail } from "./types";
import { TERIM } from "@/lib/terim";

const LIST_PATH = "/operations/gelen-belgeler";

interface DetailActionsProps {
  note: DeliveryNoteDetail;
  reviewCount: number;
  addPages: ReactNode;
  onReview: () => void;
  onApprove: () => void;
}

function DetailActions({ note, reviewCount, addPages, onReview, onApprove }: DetailActionsProps) {
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {addPages}
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
      {/* Belgeden iş emri (D4-D2): topları doğmuş belgede; desen grubu başına mevcut quick-start. */}
      {isWorkOrderOpenable(note.status) && (
        <PermissionGate permission="workorder:write">
          <Button variant="outline" onClick={() => setWorkOrderOpen(true)} data-testid="note-open-work-order">
            <Factory className="mr-1 h-4 w-4" />
            {TERIM.terbiyeIsEmri.tekil} aç
          </Button>
          {workOrderOpen && <WorkOrderFromNoteDialog noteId={note.id} open onOpenChange={setWorkOrderOpen} />}
        </PermissionGate>
      )}
    </div>
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
  if (!n) {
    return (
      <PageShell>
        <PageHeader title="Gelen Belge" parent={{ label: "Gelen Belgeler", to: LIST_PATH }} />
        <PageBody className="p-6 text-sm text-muted-foreground">{note.isError ? "Belge yüklenemedi." : "Yükleniyor…"}</PageBody>
      </PageShell>
    );
  }
  const editable = isEditable(n.status) && hasPermission("gelen-belge:write");
  const reviewCount = buildReviewQueue(n.lines).length;
  const sel = n.lines.find((l) => l.id === selected) ?? null;
  const maxBlock = Math.max(1, ...n.lines.map((l) => l.blockNo));
  return (
    <PageShell>
      <PageHeader
        title={`Gelen Belge ${n.noteNo}`}
        titleExtra={<Badge variant={NOTE_STATUS_VARIANT[n.status]}>{NOTE_STATUS_LABEL[n.status]}</Badge>}
        description={`Kaynak: ${SOURCE_LABEL[n.sourceKind]} · ${n.lines.length} satır`}
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
          <ScanReadBanner scans={n.scans} canRequeue={hasPermission("gelen-belge:write")} onRequeued={() => void invalidate()} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ScanViewer scans={n.scans} highlight={sel ? lineRect(sel) : null} highlightScanId={sel?.scanId ?? null} selectionKey={sel?.id ?? null} />
            <div className="flex min-w-0 flex-col gap-4">
              <NoteHeaderForm note={n} suggestions={suggestions.data} editable={editable} onPatch={(p) => header.mutate(p)} />
              <TotalsStrip note={n} />
              {n.varianceReason && <p className="text-xs text-muted-foreground">Fark gerekçesi: {n.varianceReason}</p>}
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
          />
          {editable && (
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <AddLineForm noteId={n.id} defaultBlock={maxBlock} onAdded={() => void invalidate()} />
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
      <ApproveDialog noteId={n.id} lines={n.lines} processChoices={gramaj.choices} choiceNoun={suggestions.data?.processGroups?.length ? "işlem seçimi" : undefined} open={approveOpen} onOpenChange={setApproveOpen} onDone={() => void invalidate()} />
    </PageShell>
  );
}
