// Cari Hesaplar satırından açılan Kilit diyaloğu (D4-I3) — cari kartının Kilit sekmesiyle AYNI panel.
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CariHoldPanel } from "./CariHoldPanel";

interface Props {
  cariId: string;
  cariName: string;
  onClose: () => void;
}

export function CariHoldDialog({ cariId, cariName, onClose }: Props) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cari kilidi — {cariName}</DialogTitle>
          <DialogDescription>Kilit yeni iş kabulünü, sevki ya da fatura onayını durdurur; veri erişimi açık kalır.</DialogDescription>
        </DialogHeader>
        <CariHoldPanel target={{ cariId }} cariName={cariName} />
      </DialogContent>
    </Dialog>
  );
}
