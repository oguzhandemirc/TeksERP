// [Uygula] onayı — iplik kartının denyesini sunucunun önerisine çeker. Gövde raporun GÜNCEL kart denyesini
// `expectedDenier` olarak taşır: kart arada değiştiyse sunucu 409 `DENIER_CHANGED` der, rapor yenilenir.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { apiErrorText } from "@/lib/api-error";
import { formatDisplay } from "@/lib/format";
import { toastServerSuccess } from "@/lib/serverNotes";
import { denierErrorCode, denyeSapmaApi, type DenierRow } from "./denyeSapma";

const den = (v: string | null) => (v === null ? "boş" : formatDisplay(Number(v), 2));

export function DenyeUygulaDialog({ row, onClose, onApplied }: { row: DenierRow; onClose: () => void; onApplied: () => void }) {
  const [conflict, setConflict] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => denyeSapmaApi.apply({ yarnItemId: row.yarnItemId, expectedDenier: row.cardDenier, newDenier: row.suggestedDenier! }),
    onSuccess: (res) => {
      toastServerSuccess(res, "İplik kartı denyesi güncellendi.");
      onApplied();
      onClose();
    },
    onError: (e) => {
      // Kart arada değişti: sunucunun cümlesi kalır, rapor tazelenir — kullanıcı yeni öneriyi görüp yeniden karar verir.
      if (denierErrorCode(e) === "DENIER_CHANGED") onApplied();
      setConflict(apiErrorText(e, "Denye güncellenemedi."));
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.name || row.code} — denye {den(row.cardDenier)} → {den(row.suggestedDenier)} olsun mu?</DialogTitle>
          <DialogDescription>
            Öneri {row.beamCount} tartılı leventten geliyor. Onaylarsanız yalnız iplik kartı değişir; geçmiş sarımlar ve hesapları olduğu gibi kalır.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
          <dt className="text-muted-foreground">Kart denyesi (şu an)</dt><dd className="text-right tabular-nums">{den(row.cardDenier)}</dd>
          <dt className="text-muted-foreground">Tartıdan bulunan</dt><dd className="text-right tabular-nums">{den(row.weighedDenier)}</dd>
          <dt className="text-muted-foreground">Nominal / tartı neti</dt>
          <dd className="text-right tabular-nums">{formatDisplay(Number(row.nominalKg), 1)} / {formatDisplay(Number(row.weighedNetKg), 1)} kg</dd>
        </dl>
        <p className="text-xs text-muted-foreground">Nem ya da büküm de tartıyı değiştirir; fark iplikten geliyorsa uygulayın.</p>
        {conflict ? <Callout tone="danger">{conflict}</Callout> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{conflict ? "Kapat" : "Vazgeç"}</Button>
          {conflict ? null : (
            <Button disabled={save.isPending || !row.suggestedDenier} onClick={() => save.mutate()}>
              {save.isPending ? "Uygulanıyor…" : "Kartı güncelle"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
