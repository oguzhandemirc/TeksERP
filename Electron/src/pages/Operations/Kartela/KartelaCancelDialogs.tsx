// Kartela sevki / kabulü iptali — gerekçeli (≥3 karakter, backend `cancelSchema`). Kabul iptali yıkıcıdır:
// önce `cancel-preview` ile geri alınacak HER kartela ve engel sebebi listelenir; engel varsa onay kapalı.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { toastServerSuccess } from "@/lib/serverNotes";
import { kartelaService, type KartelaReceiptCancelPreview } from "./service";
import { blockedSwatchCardNumbers, refreshKartelaLists } from "./kartelaActions";
import { useSingleFlight } from "./useSingleFlight";

const MIN_REASON = 3;

function ReasonField({ value, onChange, disabled, placeholder }: { value: string; onChange: (v: string) => void; disabled: boolean; placeholder: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">İptal sebebi * (en az {MIN_REASON} karakter)</span>
      <Textarea rows={2} maxLength={500} value={value} disabled={disabled} placeholder={placeholder}
        aria-label="İptal sebebi" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

interface DispatchProps {
  dispatch: { id: string; dispatchNo: string; itemCount: number } | null;
  onOpenChange: (open: boolean) => void;
}

export function CancelDispatchDialog({ dispatch, onOpenChange }: DispatchProps) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const once = useSingleFlight();
  useEffect(() => setReason(""), [dispatch?.id]);
  const mut = useMutation({
    mutationFn: (v: { id: string; reason: string }) => kartelaService.cancelDispatch(v.id, v.reason),
    onSuccess: (res) => {
      toastServerSuccess(res, "Kartela sevki iptal edildi");
      refreshKartelaLists(qc);
      onOpenChange(false);
    },
    // onError YOK: 409 (kabul yapılmış / top taşınmış) mesajını apiClient basar.
  });
  const pending = mut.isPending;
  const ok = reason.trim().length >= MIN_REASON && !pending;
  return (
    <Dialog open={dispatch !== null} onOpenChange={(o) => (o || !pending) && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sevki İptal Et {dispatch ? `· ${dispatch.dispatchNo}` : ""}</DialogTitle>
          <DialogDescription>
            {dispatch ? `${dispatch.itemCount} top kartela firmasından depoya geri döner.` : ""} Sevk belgesi silinmez, iptal olarak kalır.
          </DialogDescription>
        </DialogHeader>
        <ReasonField value={reason} onChange={setReason} disabled={pending} placeholder="Örn. yanlış firma seçildi" />
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok} onClick={() => dispatch && once((done) => mut.mutate({ id: dispatch.id, reason: reason.trim() }, { onSettled: done }))}>
            {pending ? "İptal ediliyor…" : "Sevki İptal Et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReceiptProps {
  receiptId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function CancelReceiptDialog({ receiptId, onOpenChange }: ReceiptProps) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const once = useSingleFlight();
  useEffect(() => {
    setReason("");
    setBlocked(null);
  }, [receiptId]);
  const preview = useQuery({
    queryKey: ["kartela", "receipt-cancel-preview", receiptId],
    queryFn: () => kartelaService.getReceiptCancelPreview(receiptId!).then((r) => r.data),
    enabled: receiptId !== null,
    staleTime: 0,
  });
  const mut = useMutation({
    mutationFn: (v: { id: string; reason: string }) => kartelaService.cancelReceipt(v.id, v.reason),
    onSuccess: (res) => {
      toastServerSuccess(res, "Kartela kabulü iptal edildi");
      refreshKartelaLists(qc);
      onOpenChange(false);
    },
    // Mesaj toast'ı apiClient'ta; burada yalnız engelleyen kartelalar listelenir ve önizleme tazelenir.
    onError: (err) => {
      setBlocked(blockedSwatchCardNumbers(err));
      void preview.refetch();
    },
  });
  const pending = mut.isPending;
  const p = preview.data;
  const ok = Boolean(p?.cancellable) && reason.trim().length >= MIN_REASON && !pending && !preview.isFetching;
  return (
    <Dialog open={receiptId !== null} onOpenChange={(o) => (o || !pending) && onOpenChange(o)}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Kabulü İptal Et {p ? `· ${p.receiptNo}` : ""}</DialogTitle>
          <DialogDescription>
            Aşağıdaki kartelaların hepsi geri alınır (İptal), tüketilen toplar yeniden "Kartelada" olur. Kabul belgesi silinmez.
          </DialogDescription>
        </DialogHeader>
        {blocked && (
          <Callout tone="danger">
            Şu kartelalar sevkiyatta/çuvalda olduğu için iptal yapılamadı: <strong>{blocked.join(", ")}</strong>. Önce sevkiyattan/çuvaldan çıkarın.
          </Callout>
        )}
        <PreviewList preview={p ?? null} loading={preview.isLoading} hideWarning={blocked !== null} />
        <ReasonField value={reason} onChange={setReason} disabled={pending || !p?.cancellable} placeholder="Örn. yanlış kabul edildi" />
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok} onClick={() => receiptId && once((done) => mut.mutate({ id: receiptId, reason: reason.trim() }, { onSettled: done }))}>
            {pending ? "İptal ediliyor…" : `Kabulü İptal Et${p ? ` (${p.swatches.length} kartela)` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Etkilenen her kartela — engelliler kırmızı sebepleriyle; engel varsa üstte uyarı. */
// `hideWarning`: 409 sonrası kırmızı uyarı aynı şeyi söylüyor — ikinci (sarı) uyarı çizilmez.
function PreviewList({ preview, loading, hideWarning }: { preview: KartelaReceiptCancelPreview | null; loading: boolean; hideWarning: boolean }) {
  if (loading || !preview) return <Skeleton className="h-32 w-full" />;
  const blockedCount = preview.swatches.filter((s) => !s.safeToCancel).length;
  // Engelliler başa: uzun kabulde engel sebebi listenin dibinde kaybolmasın.
  const rows = [...preview.swatches].sort((a, b) => Number(a.safeToCancel) - Number(b.safeToCancel));
  return (
    <>
      {blockedCount > 0 && !hideWarning && (
        <Callout tone="warning">
          {blockedCount} kartela sevkiyatta/çuvalda — kabul iptal edilemez. Önce bu kartelaları sevkiyattan/çuvaldan çıkarın.
        </Callout>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border" data-testid="iptal-onizleme">
        {preview.swatches.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Bu kabulde geri alınacak canlı kartela yok.</p>
        ) : rows.map((s) => (
          <div key={s.id} className={`flex items-center gap-3 border-b px-3 py-1.5 text-sm last:border-0 ${s.safeToCancel ? "" : "bg-destructive/5"}`}>
            <span className="w-36 font-mono text-xs">{s.cardNumber}</span>
            <span className="min-w-0 flex-1 truncate">{s.item.name}</span>
            {s.safeToCancel ? (
              <span className="text-xs text-muted-foreground">Geri alınacak</span>
            ) : (
              <span className="text-xs font-medium text-destructive">{s.blockingReasons.join(" · ")}</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
