// =============================================================================
// BORDRO İPTALİ — YIKICI İŞLEM ONAYI (belge-only ve hareketli bordro)
// =============================================================================
// Önce iptal ÖNİZLEMESİ okunur (backend, iptalin kapısıyla aynı yoldan): bordro çek hareketi
// taşımıyorsa iptal yalnız belgeyi VOID eder (bugünkü akış). Taşıyorsa (K3) etkilenen HER kıymet
// listelenir; kullanıcı geri alınacakları tek tek seçer, sebep zorunludur. Geri alınamayan kalem
// (tahsil edilmiş, başka bordroyla ciro edilmiş…) seçilemez ve NEDENİ yazılır. Bütün canlı
// kalemler seçilirse bordro da iptal olur; alt kümede bordro ve imzalı belge olduğu gibi kalır.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/PermissionGate";
import { officialDocCancelSummary } from "../officialDocs";
import { money, type Currency } from "../service";
import { STATUS_LABEL } from "./labels";
import {
  cancelSelectionBlockReason,
  cancelWillCloseNote,
  MOVED_LABEL,
  reversibleIds,
  rowIssuesError,
  type CancelPreviewItem,
  type RowIssue,
} from "./chequeNoteMovement";
import { cancelChequeDeliveryNote, getDeliveryNoteCancelPreview, type DeliveryNoteRow } from "./service";

interface Props {
  note: DeliveryNoteRow;
  onClose: () => void;
}

const dt = (iso: string): string => new Date(iso).toLocaleDateString("tr-TR");

export function DeliveryNoteCancelPanel({ note, onClose }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [issues, setIssues] = useState<RowIssue[] | null>(null);
  const pq = useQuery({
    queryKey: ["finance", "cheque-delivery-notes", note.id, "cancel-preview"],
    queryFn: () => getDeliveryNoteCancelPreview(note.id),
  });
  const moving = pq.data?.hasMovements === true;

  const cancelM = useMutation({
    mutationFn: () =>
      cancelChequeDeliveryNote(note.id, reason.trim() || undefined, moving ? [...selected] : undefined),
    onSuccess: (r) => {
      toast.success(r.message ?? "Teslim bordrosu iptal edildi.");
      void qc.invalidateQueries({ queryKey: ["finance"] });
      void qc.invalidateQueries({ queryKey: ["printed-doc"] });
      onClose();
    },
    onError: (e) => setIssues(rowIssuesError(e)?.rows ?? null),
  });

  if (pq.isLoading) return <p className="text-sm text-muted-foreground">İptal önizlemesi hazırlanıyor…</p>;
  if (pq.isError || !pq.data) return <PreviewError onClose={onClose} onRetry={() => void pq.refetch()} />;

  const items = pq.data.items;
  const selectable = new Set(reversibleIds(items));
  const blocked = moving ? cancelSelectionBlockReason(selected, reason) : null;
  const closes = moving && cancelWillCloseNote(items, selected);
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      {moving ? (
        <>
          <p>
            <strong>{note.docNo}</strong> çek hareketi taşıyor: iptal, seçtiğiniz kıymetlerin hareketini ters kayıtla
            geri alır. {closes ? "Bütün kıymetler seçili — bordro da iptal edilecek." : "Seçilmeyenler ve bordronun imzalı belgesi olduğu gibi kalır."}
          </p>
          <CancelItemsTable items={items} selectable={selectable} selected={selected} onToggle={toggle} />
        </>
      ) : (
        <p>{officialDocCancelSummary(note.docNo, `${note._count.items} kıymet · ${dt(note.deliveryDate)}`)}</p>
      )}

      {issues && issues.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-xs text-destructive">
          {issues.map((x) => (
            <li key={x.chequeId}>
              <strong>{x.docNo}</strong> — {x.reason}
            </li>
          ))}
        </ul>
      )}

      <Textarea
        className="mt-2"
        rows={2}
        maxLength={300}
        placeholder={moving ? "Sebep (zorunlu — ters kayıtta ve denetimde görünür)" : "İptal sebebi (opsiyonel — belgede ve denetim kaydında görünür)"}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {blocked && <p className="mt-1 text-xs text-muted-foreground">{blocked}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Vazgeç
        </Button>
        <PermissionGate allOf={moving ? ["finance:write", "finance:cheque"] : ["finance:write"]}>
          <Button variant="destructive" size="sm" disabled={cancelM.isPending || blocked !== null} onClick={() => cancelM.mutate()}>
            {cancelM.isPending ? "İşleniyor…" : moving ? `Seçilenleri Geri Al (${selected.size})` : "Bordroyu İptal Et"}
          </Button>
        </PermissionGate>
      </div>
    </div>
  );
}

function PreviewError({ onClose, onRetry }: { onClose: () => void; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="text-destructive">İptal önizlemesi okunamadı — iptal bu durumda yapılmaz.</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Kapat</Button>
        <Button variant="outline" size="sm" onClick={onRetry}>Tekrar dene</Button>
      </div>
    </div>
  );
}

/** Etkilenen HER kıymet — geri alınamayanın kutusu kapalıdır ve nedeni yazılır. */
function CancelItemsTable(p: {
  items: CancelPreviewItem[];
  selectable: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="mt-2 max-h-56 overflow-auto rounded border bg-background">
      <table className="w-full text-xs">
        <tbody>
          {p.items.map((i) => (
            <tr key={i.chequeId} className="border-t first:border-t-0">
              <td className="px-2 py-1">
                <input
                  type="checkbox"
                  aria-label={`${i.docNo} geri al`}
                  disabled={!p.selectable.has(i.chequeId)}
                  checked={p.selected.has(i.chequeId)}
                  onChange={() => p.onToggle(i.chequeId)}
                />
              </td>
              <td className="px-2 py-1 font-medium">{i.docNo}</td>
              <td className="px-2 py-1 text-right">{money(Number(i.amount), i.currency as Currency)}</td>
              <td className="px-2 py-1">{STATUS_LABEL[i.status]}</td>
              <td className="px-2 py-1 text-muted-foreground">
                {i.reversed
                  ? "Geri alındı"
                  : i.reversible
                    ? `Geri alınır (${i.action ? MOVED_LABEL[i.action] : ""})`
                    : (i.reason ?? "Bu bordroyla hareket etmedi")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
