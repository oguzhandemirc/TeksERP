import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

/**
 * "Etki önizlemesi yüklenemedi → onay verilemez" bloğu.
 *
 * Kök CLAUDE.md yıkıcı-işlem kuralının doğal sonucu: etkilenen kayıtlar
 * görülmeden onay alınamaz, dolayısıyla önizleme hatası onay düğmesini kilitler.
 * Bu kalıp WorkOrderCancelDialog / WorkOrderCompleteDialog / CancelShipmentDialog
 * içinde üç kez kopyalanmıştı — tek kaynağa alındı.
 */
export function PreviewErrorBlock({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  return (
    <Callout tone="danger" title="Etki önizlemesi yüklenemedi">
      <p>{message}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={onRetry}
        disabled={isRetrying}
      >
        <RefreshCw className={isRetrying ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"} />
        Yeniden Dene
      </Button>
    </Callout>
  );
}
