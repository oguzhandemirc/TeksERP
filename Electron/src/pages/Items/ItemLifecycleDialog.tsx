// =============================================================================
// KULLANIMDAN KALDIR — ürün kartı yaşam döngüsü diyaloğu (URUN-YASAM-DONGUSU.md §8)
// =============================================================================
// Önizleme canlı kayıtları tek tek listeler; seçenekler kartın durumundan: Aktif kartta
// "Tükenene kadar" (varsayılan) · "Pasif" (yalnız canlı kayıt 0 iken) — Tükenene kadar kartta
// "Pasif" · "Aktif'e döndür". Benzer adlı aktif kart yalnız BİLGİDİR (birleştirme ayrı ekran).
// =============================================================================
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PreviewErrorBlock } from "@/components/forms/PreviewErrorBlock";
import { LiveReferencesList } from "@/components/LiveReferencesList";
import { apiErrorMessage } from "@/services/apiClient";
import { toastServerSuccess } from "@/lib/serverNotes";
import {
  ITEM_LIFECYCLE_LABEL,
  defaultLifecycleChoice,
  itemLifecycleOf,
  lifecycleChoices,
  type ItemLifecycleStatus,
  type LifecycleChoice,
} from "@/lib/item-lifecycle";
import { itemService } from "./service";
import type { Item } from "./types";

interface Props {
  item: Item;
  onClose: () => void;
}

function ChoiceList(props: { choices: LifecycleChoice[]; value: ItemLifecycleStatus | null; onChange: (to: ItemLifecycleStatus) => void }) {
  return (
    <fieldset className="space-y-2" aria-label="Yeni durum">
      {props.choices.map((c) => (
        <label key={c.to} className={`flex gap-2 rounded border p-2 text-sm ${c.blockedBy ? "opacity-60" : "cursor-pointer"}`}>
          <input type="radio" name="lifecycle-to" checked={props.value === c.to} disabled={c.blockedBy !== null} onChange={() => props.onChange(c.to)} />
          <span>
            <span className="font-medium">{c.label}</span>
            <span className="block text-xs text-muted-foreground">{c.blockedBy ?? c.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function ItemLifecycleDialog({ item, onClose }: Props) {
  const qc = useQueryClient();
  const current = itemLifecycleOf(item);
  const preview = useQuery({
    queryKey: ["items", "lifecycle-preview", item.id],
    queryFn: () => itemService.lifecyclePreview(item.id, "ARCHIVED"),
  });
  const p = preview.data?.data;
  const choices = p ? lifecycleChoices(current, p.liveTotal) : [];
  const [to, setTo] = useState<ItemLifecycleStatus | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (p && to === null) setTo(defaultLifecycleChoice(lifecycleChoices(current, p.liveTotal)));
  }, [p, to, current]);

  const mut = useMutation({
    mutationFn: (target: ItemLifecycleStatus) => itemService.transitionLifecycle(item.id, target, reason.trim() || null),
    onSuccess: (res) => {
      toastServerSuccess(res, "Kartın durumu değişti");
      void qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
    onError: () => {
      // Hata tek kanaldan (apiClient): arşiv 409'u kayıt listesiyle diyalogda. Önizlemeden sonra
      // kayıt doğmuş olabilir — önizleme tazelenir, kullanıcı yeniden seçer.
      setTo(null);
      void preview.refetch();
    },
  });
  const selected = choices.find((c) => c.to === to);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Kullanımdan kaldır — {item.name}</DialogTitle>
          <DialogDescription>
            Kart şu an <strong>{ITEM_LIFECYCLE_LABEL[current]}</strong>. Geçmiş kayıtlar hiçbir seçenekte değişmez.
          </DialogDescription>
        </DialogHeader>
        {preview.isError ? (
          <PreviewErrorBlock message={apiErrorMessage(preview.error)} onRetry={() => void preview.refetch()} isRetrying={preview.isFetching} />
        ) : !p ? (
          <p className="text-sm text-muted-foreground">Bağlı kayıtlar yükleniyor…</p>
        ) : (
          <div className="space-y-3">
            <ChoiceList choices={choices} value={to} onChange={setTo} />
            <LiveReferencesList references={p.references} />
            {p.similarActive.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Bu kart aslında {p.similarActive.map((s) => `"${s.name}"`).join(", ")} kartının kopyasıysa Birleştir kullanın
                (listede iki satırı işaretleyin).
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="item-lifecycle-reason">Gerekçe (isteğe bağlı)</Label>
              <Textarea id="item-lifecycle-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Vazgeç
          </Button>
          <Button
            variant={to === "ARCHIVED" ? "destructive" : "default"}
            disabled={!selected || selected.blockedBy !== null || mut.isPending}
            onClick={() => to && mut.mutate(to)}
          >
            {selected?.action ?? "Seçenek seçin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
