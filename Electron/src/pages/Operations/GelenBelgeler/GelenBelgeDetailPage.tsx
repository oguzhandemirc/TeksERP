// GELEN BELGE DETAYI — belge inceleme düzeni: solda fotoğraf, sağda "Belge bilgileri" + özetler, üstte TEK "Dikkat" kutusu,
// altta satırlar. Başlıkta yalnız birincil eylem (Onayla / İş emri aç) + "Gözden geçir"; ikinciller "⋯ Diğer" menüsünde.
import { useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ScanSearch } from "lucide-react";
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
import { AddLineSection } from "./AddLineForm";
import { LineImportErrors, useLineImport } from "./LineImportButton";
import { CellReviewDialog } from "./CellReviewDialog";
import { ApproveDialog } from "./ApproveDialog";
import { CancelReasonLine } from "./CancelNoteAction";
import { DetailAttentionBox } from "./DetailAttentionBox";
import { DetailMoreMenu } from "./DetailMoreMenu";
import { buildReviewQueue, lineRect } from "./review-queue";
import { isApprovable, isEditable, isIdentityFixable, isWorkOrderOpenable, NOTE_STATUS_LABEL, NOTE_STATUS_VARIANT } from "./noteStatus";
import { useNoteDetail } from "./useNoteDetail";
import { ProcessGramajPanel } from "./ProcessGramajPanel";
import { useProcessGramaj } from "./processChoices";
import { OpenWorkOrderAction } from "./OpenWorkOrderAction";
import { BatchNoPicker } from "./BatchNoPicker";
import { KursunMetersCard } from "./KursunMetersCard";
import { PartiesCard } from "./PartiesCard";
import { RecognitionRow } from "./TanimaKarti";
import { showsPerDocument } from "./partiMetre";
import type { DeliveryNoteDetail } from "./types";
import { noteCountText } from "./noteLines";
import { useNoteTabTitle } from "./useNoteTabTitle";
import { retentionFor } from "./photoRetention";

const LIST_PATH = "/operations/gelen-belgeler";

/** Başlık sağı: "Gözden geçir (N)" (N>0) + birincil eylem; geri kalan her şey `DetailMoreMenu`de. */
function PrimaryActions({ note, reviewCount, onReview, onApprove }: { note: DeliveryNoteDetail; reviewCount: number; onReview: () => void; onApprove: () => void }) {
  return (
    <>
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
    </>
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
  const lineImport = useLineImport(id, () => void invalidate());
  if (!n) return <DetailLoading failed={note.isError} />;
  const editable = isEditable(n.status) && hasPermission("gelen-belge:write");
  const reviewCount = buildReviewQueue(n.lines).length;
  const sel = n.lines.find((l) => l.id === selected) ?? null;
  const perDoc = showsPerDocument(n);
  const refresh = () => void invalidate();
  return (
    <PageShell>
      <PageHeader
        title={`Gelen Belge ${n.noteNo}`}
        titleExtra={<Badge variant={NOTE_STATUS_VARIANT[n.status]}>{NOTE_STATUS_LABEL[n.status]}</Badge>}
        statusLine={noteCountText(n.lines)}
        parent={{ label: "Gelen Belgeler", to: LIST_PATH }}
        actions={
          <>
            <PrimaryActions note={n} reviewCount={editable ? reviewCount : 0} onReview={() => setReviewOpen(true)} onApprove={() => setApproveOpen(true)} />
            <DetailMoreMenu note={n} listPath={LIST_PATH} lineImport={editable ? lineImport : null} onPagesAdded={refresh} />
          </>
        }
      />
      <PageBody className="min-h-0 p-4 sm:p-6">
        <div className="flex flex-col gap-5">
          <DetailAttentionBox note={n} editable={editable} canRequeue={hasPermission("gelen-belge:write")} canTeach={hasPermission("gelen-belge:template")} onRequeued={refresh} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ScanViewer scans={n.scans} highlight={sel ? lineRect(sel) : null} highlightScanId={sel?.scanId ?? null} selectionKey={sel?.id ?? null} />
            <div className="flex min-w-0 flex-col gap-4">
              <NoteHeaderForm note={n} suggestions={suggestions.data} editable={editable} canFixIdentity={isIdentityFixable(n.status) && hasPermission("gelen-belge:write")} onPatch={(p) => header.mutate(p)} />
              {/* iptalde toplar düştü; hüküm anlamsız. TUTMUYOR hükmü "Dikkat" kutusunda, burada blok ayrıntısı kalır. */}
              {n.status !== "CANCELLED" && <TotalsStrip check={n.totalsCheck} approvable={isApprovable(n.status)} partiesShown={multiParty} verdictInAttention />}
              {perDoc && <BatchNoPicker note={n} editable={editable} onPatch={(p) => header.mutate(p)} />}
              {perDoc && <KursunMetersCard note={n} editable={editable} onPatch={(p) => header.mutateAsync(p)} />}
              <PartiesCard noteId={n.id} blocks={n.totalsCheck?.blocks} />
              <ProcessGramajPanel groups={gramaj.groups} options={suggestions.data?.processOptions ?? []} choiceGroups={suggestions.data?.processGroups ?? []} picks={gramaj.picks} onPick={gramaj.onPick} />
              <RecognitionRow tanima={n.tanima} />
              {n.varianceReason && <p className="truncate text-xs text-muted-foreground" title={n.varianceReason}>Fark gerekçesi: {n.varianceReason}</p>}
              <CancelReasonLine note={n} />
            </div>
          </div>
          <div className="flex flex-col gap-3">
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
            {editable && <AddLineSection noteId={n.id} defaultBlock={Math.max(1, ...n.lines.map((l) => l.blockNo))} onAdded={refresh} />}
            {editable && <LineImportErrors errors={lineImport.errors} />}
          </div>
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
