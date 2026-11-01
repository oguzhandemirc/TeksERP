// Cari birleştirme ÖN İZLEME + yazılı onay + uygula (D4-K3e). Aktarılacak HER açık kalem satır satır listelenir
// (yıkıcı işlem kuralı); engel varsa uygula kapalı ve gerekçeler sunucudan olduğu gibi gösterilir. Token MANTIKSAL
// DENEME başına (`useAttemptToken`); 409 STALE'de ön izleme yenilenir, yeni damga ve yeni deneme.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { formatFactory } from "@/lib/factory-time";
import { money, type CariRow } from "../service";
import { invalidateHoldViews } from "../CariHold/invalidateHoldViews";
import { MERGE_CONFIRM_WORD, applyCariMerge, canApply, getMergePreview, termLabels, type CariMergeItem } from "./cariMergeService";

type Currency = CariRow["defaultCurrency"];

interface Props {
  sourceId: string;
  targetId: string;
  onBack: () => void;
  onDone: () => void;
}

/** Aktarılacak HER açık kalem — belge, vade, açık tutar (yıkıcı işlem: arayüz etkilenen her kaydı listeler). */
function MergeItemsTable({ items }: { items: CariMergeItem[] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-2 py-1 text-left">Belge</th>
            <th className="px-2 py-1 text-left">Vade</th>
            <th className="px-2 py-1 text-right">Açık tutar</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={3} className="px-2 py-2 text-muted-foreground">Aktarılacak açık kalem yok (sıfır bakiye) — yalnız hesap birleşir.</td></tr>
          ) : (
            items.map((it, i) => (
              <tr key={`${it.invoiceId ?? "bakiye"}-${it.currency}-${i}`} className="border-t">
                <td className="px-2 py-1">{it.docNo}</td>
                <td className="px-2 py-1">{it.dueDate ? formatFactory(it.dueDate, "dd.MM.yyyy") : "—"}</td>
                <td className="px-2 py-1 text-right">{money(it.signedAmount, it.currency as Currency)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function CariMergePreviewStep({ sourceId, targetId, onBack, onDone }: Props) {
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const attempt = useAttemptToken();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cari-merge", "preview", sourceId, targetId], queryFn: () => getMergePreview(sourceId, targetId) });
  const p = q.data;
  const m = useMutation({
    mutationFn: () => applyCariMerge(p!, attempt.token()),
    onSuccess: (r) => {
      attempt.onSuccess();
      toast.success(r.message ?? "Cari hesaplar birleştirildi.");
      invalidateHoldViews(qc);
      onDone();
    },
    onError: (e) => {
      attempt.onFailure(e);
      setError(apiErrorText(e, "Birleştirme yapılamadı."));
      // Arada kayıt değişti: kullanıcı YENİ listeyi görmeden yazılmaz — ön izleme tazelenir, onay sıfırlanır.
      if ((e as { response?: { status?: number } }).response?.status === 409) {
        setConfirm("");
        void q.refetch();
      }
    },
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Ön izleme hazırlanıyor…</p>;
  if (q.isError || !p) return <p role="alert" className="text-sm text-destructive">{apiErrorText(q.error, "Ön izleme alınamadı.")}</p>;

  return (
    <div className="space-y-4 text-sm">
      <p>
        <span className="font-medium">{p.sourceLabel}</span> hesabının açık kalemleri <span className="font-medium">{p.targetLabel}</span> hesabına
        bugün tarihli virmanla aktarılır; geçmiş hareketler yerinde kalır, kaynak hesap pasife alınır.
      </p>
      {p.alreadyMerged && <p className="rounded-md bg-muted px-3 py-2">Bu hesap zaten bu hedefe birleşmiş.</p>}
      {p.blockers.length > 0 && (
        <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
          <p className="font-medium">Birleştirme yapılamaz:</p>
          <ul className="list-disc pl-5">{p.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {p.balances.length > 0 && (
        <div className="flex flex-wrap gap-3" data-testid="merge-balances">
          {p.balances.map((b) => (
            <span key={b.currency} className="rounded-md border px-2 py-1">
              {b.currency}: kaynak {money(b.source, b.currency as Currency)} → hedef {money(b.target, b.currency as Currency)}
            </span>
          ))}
        </div>
      )}
      <MergeItemsTable items={p.items} />
      {p.draftInvoices > 0 && <p className="text-muted-foreground">{p.draftInvoices} taslak fatura hedef hesaba taşınır.</p>}
      {Object.keys(p.termsToCopy).length > 0 && <p className="text-muted-foreground">Hedefte boş olan terimler kaynaktan taşınır: {termLabels(p.termsToCopy)}.</p>}
      <div className="space-y-1">
        <Label htmlFor="merge-confirm">Onaylamak için {MERGE_CONFIRM_WORD} yazın</Label>
        <Input id="merge-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={p.blockers.length > 0 || p.alreadyMerged} />
      </div>
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onBack}>Geri</Button>
        <Button variant="destructive" disabled={!canApply(p, confirm) || m.isPending} onClick={() => { setError(null); m.mutate(); }}>
          {m.isPending ? "Birleştiriliyor…" : "Birleştir"}
        </Button>
      </div>
    </div>
  );
}
