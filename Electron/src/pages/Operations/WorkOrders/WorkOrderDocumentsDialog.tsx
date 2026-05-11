import { Printer, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DocumentOption {
  key: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  onClick: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Refakat kartı yazdırma seçeneği — modalda buton olarak gösterilir. */
  onPrintTravelerCard: () => void;
}

export function WorkOrderDocumentsDialog({ open, onOpenChange, onPrintTravelerCard }: Props) {
  // Buraya ileride yeni belgeler eklenir (Manifest, Sevk İrsaliyesi, vb.).
  const options: DocumentOption[] = [
    {
      key: "traveler-card",
      label: "Refakat Kartını Yazdır",
      description: "Üretim sahasında topla birlikte dolaşan barkodlu kart.",
      icon: Printer,
      onClick: onPrintTravelerCard,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Belgeler</DialogTitle>
          <DialogDescription>
            İş emrinden çıkarılabilecek belgeler.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={opt.onClick}
                className="flex w-full items-start gap-3 rounded-md border bg-background p-3 text-left hover:bg-muted/50"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium">{opt.label}</div>
                  {opt.description && (
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
