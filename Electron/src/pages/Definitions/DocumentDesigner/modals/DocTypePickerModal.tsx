import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TemplateContractView } from "@/services/documentTemplateService";
import { docTypeLabel } from "../useDesignerDraft";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contracts: TemplateContractView[];
  current: string;
  onPick: (docType: string) => void;
}

/** Belge türü seçici — veri ağacı, bloklar ve "Belge ayarları" bu türün sözleşmesinden gelir. */
export function DocTypePickerModal({ open, onOpenChange, contracts, current, onPick }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Belge türü seç</DialogTitle>
          <DialogDescription>Tür değişince veri alanları ve belge ayarları o türün sözleşmesinden yüklenir.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {contracts.map((c) => (
            <button
              key={c.docType}
              type="button"
              onClick={() => { onPick(c.docType); onOpenChange(false); }}
              className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm hover:bg-muted ${current === c.docType ? "border-primary" : ""}`}
            >
              <span className="font-medium">{docTypeLabel(c.docType)}</span>
              <span className="text-xs text-muted-foreground">{c.hedef === "ic" ? "İç belge" : "Müşteri belgesi"}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
