// Mükerrer kart birleştirmesinde iki kartın da cari hesabı varsa birleşen kartın hesabı o kartta kalır (backend
// KEEP_ON_SOURCE); bu bileşen hesabı listeler ve "Şimdi cari hesapları birleştir" ile K3e cari birleştirme
// diyaloğunu açar. Cari birleştirme izni (`finance:cari-merge`, SoD) yoksa yalnız kimin yapacağını söyler.
import { useState } from "react";
import { GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermissionGate } from "@/components/PermissionGate";
import { CariMergeDialog } from "@/pages/Finance/CariMerge/CariMergeDialog";
import type { MergeFollowUp } from "@/services/mergeService";

const balanceText = (f: MergeFollowUp): string =>
  f.balances.length > 0 ? f.balances.map((b) => `${b.balance} ${b.currency}`).join(" · ") : "bakiye yok";

/** Önizlemede: birleştirmeden sonra ne yapılacağını söyler (her etkilenen hesap listelenir). */
export function MergeCariFollowUpNote({ followUps }: { followUps: MergeFollowUp[] }) {
  if (followUps.length === 0) return null;
  return (
    <Callout tone="info" title="Birleştirmeden sonra cari hesaplar da birleştirilmeli">
      <p className="mb-1">
        İki kartın da cari hesabı var. Aşağıdaki hesap kaybolmaz; bakiyesi ve hareketleri aynen kalır.
        Birleştirmeden sonra açılan pencereden kalan kartın hesabına aktarabilirsiniz.
      </p>
      <ul className="list-disc pl-5">
        {followUps.map((f) => (
          <li key={f.cariId}>
            {f.label} — {balanceText(f)}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/** Birleştirme SONRASI: hesap başına "Şimdi cari hesapları birleştir". */
export function MergeCariFollowUpDialog({
  followUps,
  onClose,
}: {
  followUps: MergeFollowUp[];
  onClose: () => void;
}) {
  const [active, setActive] = useState<MergeFollowUp | null>(null);
  if (active)
    return <CariMergeDialog cariId={active.cariId} cariName={active.label} onClose={() => setActive(null)} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Kartlar birleşti — cari hesaplar ayrı duruyor</DialogTitle>
          <DialogDescription>
            Birleşen kartın cari hesabı korunuyor. Tek hesapta toplamak için cari birleştirmeyi yapın.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border text-sm">
          {followUps.map((f) => (
            <li
              key={f.cariId}
              className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">{f.label}</p>
                <p className="text-xs text-muted-foreground">{balanceText(f)}</p>
              </div>
              <PermissionGate
                permission="finance:cari-merge"
                fallback={
                  <span className="text-xs text-muted-foreground">
                    Cari birleştirmeyi muhasebe yetkilisi yapar (Finans → Cari Hesaplar → Birleştir).
                  </span>
                }
              >
                <Button size="sm" onClick={() => setActive(f)}>
                  <GitMerge className="mr-1 h-4 w-4" />
                  Şimdi cari hesapları birleştir
                </Button>
              </PermissionGate>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Sonra
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
