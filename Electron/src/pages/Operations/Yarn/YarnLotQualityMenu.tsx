// Lot satırı kalite menüsü — `quality:write`; Serbest bırak / Bekletmeye al TEK TIK, Bloke et onay + not ister.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreHorizontal, ShieldCheck, PauseCircle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PermissionGate } from "@/components/PermissionGate";
import { setYarnLotQuality, type YarnLotRow } from "./service";
import { lotQualityOf, qualityNeedsConfirm, qualityTargets, YARN_LOT_QUALITY, YARN_LOT_QUALITY_ACTION, type YarnLotQualityStatus } from "./yarnLotQuality";

const ICON: Record<YarnLotQualityStatus, typeof ShieldCheck> = { RELEASED: ShieldCheck, ON_HOLD: PauseCircle, BLOCKED: Ban };

export function YarnLotQualityMenu({ row, onDone }: { row: YarnLotRow; onDone: () => void }) {
  const [blocking, setBlocking] = useState(false);
  const m = useMutation({
    mutationFn: (p: { status: YarnLotQualityStatus; note?: string | null }) => setYarnLotQuality(row.id, p),
    onSuccess: (res, p) => {
      toast.success(res.message ?? `"${row.lotNo}" lotu: ${YARN_LOT_QUALITY[p.status].label}`);
      setBlocking(false);
      onDone();
    },
  });
  const pick = (target: YarnLotQualityStatus) => (qualityNeedsConfirm(target) ? setBlocking(true) : m.mutate({ status: target }));
  return (
    <PermissionGate permission="quality:write">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Kalite işlemleri (${row.lotNo})`} disabled={m.isPending}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {qualityTargets(lotQualityOf(row)).map((t) => {
            const Icon = ICON[t];
            return (
              <DropdownMenuItem key={t} onSelect={() => pick(t)} className={t === "BLOCKED" ? "text-destructive" : undefined}>
                <Icon className="mr-2 h-4 w-4" /> {YARN_LOT_QUALITY_ACTION[t]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {blocking && <BlockDialog lotNo={row.lotNo} isPending={m.isPending} onClose={() => setBlocking(false)} onConfirm={(note) => m.mutate({ status: "BLOCKED", note: note || null })} />}
    </PermissionGate>
  );
}

/** Bloke: geri dönüşü var ama malı kullanımdan düşürür — sebep notu + onay. */
function BlockDialog({ lotNo, isPending, onClose, onConfirm }: { lotNo: string; isPending: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lotu bloke et — {lotNo}</DialogTitle>
          <DialogDescription>Bloke lot çıkış ve sarımda seçilemez; bakiyesi durur. Sebebi yazın — lot satırında görünür. Serbest bırakınca kalkar.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Sebep (ör. mukavemet düşük, laboratuvar raporu 18/09)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Bloke sebebi" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button variant="destructive" onClick={() => onConfirm(note.trim())} disabled={isPending} data-testid="lot-bloke-onay">Bloke et</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
