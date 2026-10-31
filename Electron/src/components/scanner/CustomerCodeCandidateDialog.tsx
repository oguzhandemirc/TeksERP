// =============================================================================
// BELİRSİZ MÜŞTERİ KODU — aday seçim modalı (D4-F1c; tablet emsali D4-F4)
// =============================================================================
// İki müşteride aynı kod okutulunca açılır; satır = müşteri · top no · metre · durum.
// Seçim işlemi topun İÇ barkoduyla sürdürür; Vazgeç işlem yapmaz. Sessiz seçim yok (K12).
// =============================================================================
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNumber } from "@/lib/format";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import type { AmbiguousCustomerCode, CustomerCodeCandidate } from "@/lib/customer-code-choice";

interface Props {
  notice: AmbiguousCustomerCode | null;
  onPick: (candidate: CustomerCodeCandidate) => void;
  onCancel: () => void;
}

function statusText(status: string | undefined): string {
  if (!status) return "—";
  return rollStatusLabels[status as RollStatus] ?? status;
}

export function CustomerCodeCandidateDialog({ notice, onPick, onCancel }: Props) {
  return (
    <Dialog open={notice !== null} onOpenChange={(o) => !o && onCancel()}>
      {/* İlk adaya otomatik odak YOK: arkadan gelen okuyucu Enter'ı ilk adayı sessizce seçmesin (K12). */}
      <DialogContent className="max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{`"${notice?.scannedCode ?? ""}" birden çok müşteride — hangi top?`}</DialogTitle>
          <DialogDescription>
            Bu müşteri kodu birden çok topta kayıtlı. İşleme devam etmek için doğru topu seçin ya da topun kendi barkodunu okutun.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border" aria-label="Aday toplar">
          {(notice?.candidates ?? []).map((c) => (
            <li key={c.rollId}>
              <button
                type="button"
                disabled={!c.barcode}
                onClick={() => onPick(c)}
                data-testid={`customer-code-candidate-${c.rollId}`}
                className="grid w-full grid-cols-1 gap-1 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:grid-cols-[2fr_1.5fr_1fr_1fr] sm:items-center"
              >
                <span className="font-medium">{c.customerName}</span>
                {c.barcode ? <span className="font-mono">{c.barcode}</span> : <span className="text-muted-foreground">Barkodsuz top — top listesinden açın</span>}
                <span className="tabular-nums">{formatNumber(c.currentQty)} m</span>
                <span className="text-muted-foreground">{statusText(c.status)}</span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Vazgeç</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
