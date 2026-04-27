import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Printer,
  RefreshCw,
  XCircle,
  Ticket,
  History,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { travelerCardService } from "@/services/travelerCardService";
import {
  travelerCardStatusLabels,
  scanTypeLabels,
  type TravelerCardStatus,
  type ScanType,
} from "@/types/enums";
import type { TravelerCard } from "@/types/models";
import TravelerCardPrintDialog from "./TravelerCardPrintDialog";

interface Props {
  workOrderId: string;
  canPrint: boolean;
}

const statusColor: Record<TravelerCardStatus, string> = {
  ACTIVE:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  REPRINTED:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  VOIDED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  COMPLETED:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

export default function TravelerCardSection({
  workOrderId,
  canPrint,
}: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [printCard, setPrintCard] = useState<TravelerCard | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["traveler-history", workOrderId],
    queryFn: () => travelerCardService.getHistory(workOrderId),
  });

  const cards = (data?.data ?? []) as TravelerCard[];
  const activeCard = cards.find((c) => c.status === "ACTIVE");

  const printMutation = useMutation({
    mutationFn: () => travelerCardService.print(workOrderId),
    onSuccess: (res) => {
      toast.success(res.message ?? "Refakat kartı basıldı");
      qc.invalidateQueries({ queryKey: ["traveler-history", workOrderId] });
      qc.invalidateQueries({ queryKey: ["workorder-detail", workOrderId] });
      if (res.data) setPrintCard(res.data);
    },
  });

  const reprintMutation = useMutation({
    mutationFn: (reason: string) =>
      travelerCardService.reprint(workOrderId, reason),
    onSuccess: (res) => {
      toast.success(res.message ?? "Yeniden basıldı");
      qc.invalidateQueries({ queryKey: ["traveler-history", workOrderId] });
      qc.invalidateQueries({ queryKey: ["workorder-detail", workOrderId] });
      if (res.data) setPrintCard(res.data);
    },
  });

  const voidMutation = useMutation({
    mutationFn: (args: { cardId: string; reason: string }) =>
      travelerCardService.voidCard(args.cardId, args.reason),
    onSuccess: (res) => {
      toast.success(res.message ?? "İptal edildi");
      qc.invalidateQueries({ queryKey: ["traveler-history", workOrderId] });
      qc.invalidateQueries({ queryKey: ["workorder-detail", workOrderId] });
    },
  });

  const handleReprint = () => {
    const reason = prompt(
      "Yeniden basım gerekçesi (örn: Kart yırtıldı, barkod okunmuyor)",
    );
    if (reason && reason.trim().length >= 3) {
      reprintMutation.mutate(reason.trim());
    } else if (reason !== null) {
      toast.error("Gerekçe en az 3 karakter olmalı");
    }
  };

  const handleVoid = (cardId: string) => {
    const reason = prompt("İptal gerekçesi");
    if (reason && reason.trim().length >= 3) {
      voidMutation.mutate({ cardId, reason: reason.trim() });
    } else if (reason !== null) {
      toast.error("Gerekçe en az 3 karakter olmalı");
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ticket className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            Refakat Kartları ({cards.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {activeCard ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPrintCard(activeCard)}
              >
                <Printer className="h-3.5 w-3.5" />
                Yazdır
              </Button>
              {canPrint && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReprint}
                  isLoading={reprintMutation.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Yeniden Bas
                </Button>
              )}
            </>
          ) : (
            canPrint && (
              <Button
                size="sm"
                onClick={() => printMutation.mutate()}
                isLoading={printMutation.isPending}
              >
                <Printer className="h-3.5 w-3.5" />
                İlk Basım
              </Button>
            )
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="h-16 bg-muted animate-pulse rounded" />
      ) : cards.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          Henüz refakat kartı basılmadı.
        </p>
      ) : (
        <div className="space-y-2">
          {cards.map((card) => {
            const isOpen = expanded === card.id;
            return (
              <div key={card.id} className="rounded border">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : card.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-medium">
                        {card.cardNumber}
                      </span>
                      <Badge
                        variant="secondary"
                        className={statusColor[card.status]}
                      >
                        {travelerCardStatusLabels[card.status]}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        v{card.version}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(card.printedAt).toLocaleString("tr-TR")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      {card.barcode}
                    </div>
                  </div>
                  {card.status === "ACTIVE" && canPrint && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVoid(card.id);
                      }}
                      className="p-1 rounded hover:bg-destructive/10"
                      title="Kartı iptal et"
                    >
                      <XCircle className="h-4 w-4 text-destructive" />
                    </button>
                  )}
                </button>
                {isOpen && (
                  <div className="border-t px-3 py-2 space-y-1 bg-muted/20">
                    {card.voidReason && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">
                          İptal Gerekçesi:
                        </span>{" "}
                        <span className="font-medium">{card.voidReason}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <History className="h-3 w-3" />
                      Tarama Geçmişi ({card.scans?.length ?? 0})
                    </div>
                    {!card.scans || card.scans.length === 0 ? (
                      <p className="text-xs text-muted-foreground pl-4">
                        Henüz tarama kaydı yok.
                      </p>
                    ) : (
                      <div className="space-y-2 pl-4">
                        {card.scans.map((scan) => (
                          <div key={scan.id} className="space-y-0.5">
                            <div className="text-xs flex items-center gap-2 py-0.5">
                              <span className="text-muted-foreground tabular-nums">
                                {new Date(scan.scannedAt).toLocaleString(
                                  "tr-TR",
                                )}
                              </span>
                              <span className="text-muted-foreground">·</span>
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0"
                              >
                                {scanTypeLabels[scan.scanType as ScanType] ??
                                  scan.scanType}
                              </Badge>
                              <span className="font-medium truncate">
                                {scan.station?.code} - {scan.station?.name}
                              </span>
                              {scan.scannedBy && (
                                <span className="text-muted-foreground ml-auto">
                                  {scan.scannedBy.fullName}
                                </span>
                              )}
                            </div>
                            {scan.notes && (
                              <div className="ml-2 text-xs italic text-muted-foreground border-l-2 border-muted pl-2">
                                &ldquo;{scan.notes}&rdquo;
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {printCard && (
        <TravelerCardPrintDialog
          card={printCard}
          open={!!printCard}
          onOpenChange={(o) => !o && setPrintCard(null)}
        />
      )}
    </div>
  );
}
