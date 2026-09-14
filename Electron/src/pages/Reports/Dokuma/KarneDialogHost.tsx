// =============================================================================
// KARNE DİYALOG SUNUCUSU — mutasyonları diyaloglara bağlar (sayfa 80-satır tavanı için ayrı)
// =============================================================================
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TermsDialog, UnsealDialog } from "./KarneDialogs";
import type { KarneDialogState } from "./KarnePage";
import type { ShiftStatRow } from "./service";
import { useKarneMutations } from "./useKarneMutations";

function SealConfirm({ target, isPending, onClose, onConfirm }: { target: ShiftStatRow; isPending: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Karne mühürlensin mi? — {target.machine.name} · {target.shiftInstance.shiftDefinition.name}</DialogTitle>
          <DialogDescription>
            Mühür bu karnenin terimlerini RESMİ rakam yapar: oranlar donar, duruş kırılımı yeni kuşak olarak deftere yazılır, bu vardiyanın duruşları artık değiştirilemez (409). Geç gelen düzeltme için mühür açılır (ayrı yetki).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button disabled={isPending} onClick={onConfirm}>Mühürle</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KarneDialogs({ dialog, onClose }: { dialog: Exclude<KarneDialogState, null | { kind: "ledger" }>; onClose: () => void }) {
  const m = useKarneMutations(onClose);
  const id = dialog.target.statId;
  if (id === null) return null;
  if (dialog.kind === "correct") {
    return <TermsDialog target={dialog.target} isPending={m.isPending} onClose={onClose} onConfirm={(body) => m.correct.mutate({ id, body })} />;
  }
  if (dialog.kind === "seal") {
    return <SealConfirm target={dialog.target} isPending={m.isPending} onClose={onClose} onConfirm={() => m.seal.mutate(id)} />;
  }
  return <UnsealDialog target={dialog.target} isPending={m.isPending} onClose={onClose} onConfirm={(reason) => m.unseal.mutate({ id, reason })} />;
}
