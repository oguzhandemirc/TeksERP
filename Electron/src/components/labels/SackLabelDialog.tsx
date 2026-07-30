import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useLabelPrinter } from "@/hooks/useLabelPrinter";
import { labelService } from "@/services/labelService";

/**
 * Çuval etiketi önizleme + baskı — `RollLabelDialog`'un çuval karşılığı.
 *
 * Barkod/QR = `Sack.sackNo` (Sack'te ayrı barcode kolonu YOK, "tek kod" kuralı).
 * İki baskı yolu: bu PC'ye seri/COM yazıcı yapılandırılmışsa DİYALOGSUZ native
 * gönderim; yoksa iframe.print() yedeği.
 *
 * FAIL-CLOSED: SACK şablonu (Bağlam Varsayılanı / cihaz rotası) atanmamışsa
 * backend 400 döner ve mesaj operatöre ne yapacağını söyler — roll etiketine
 * SAPMAZ. O mesaj burada olduğu gibi gösterilir.
 */
export function SackLabelDialog({
  sack,
  onOpenChange,
}: {
  /** null → kapalı. */
  sack: { id: string; sackNo: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = sack !== null;
  const { hasPermission } = useRoleAccess();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { directEnabled, printSack, peripheralId } = useLabelPrinter();
  const [sending, setSending] = useState(false);

  // Önizleme = baskı: HTML bu PC'ye seçili yazıcının şablon/format çözümüyle gelir.
  const htmlQuery = useQuery({
    queryKey: ["sack-label-html", sack?.id, peripheralId],
    queryFn: () => labelService.getSackHtml(sack!.id, peripheralId),
    enabled: open,
    staleTime: 0,
    retry: false, // 400 "şablon tanımlı değil" → tekrar denemek anlamsız
  });

  const handlePrint = async () => {
    if (!sack) return;
    if (directEnabled) {
      if (sending) return; // çift-tık koruması — seri gönderim ~1sn sürebilir
      setSending(true);
      try {
        const r = await printSack(sack.id);
        if (r.ok) {
          await labelService.recordSackPrintEvent(sack.id).catch(() => {
            /* audit best-effort — baskı gerçekleşti, iz hatası akışı düşürmez */
          });
          toast.success(`${sack.sackNo} etiketi basıldı.`);
        } else {
          toast.error(r.error ?? "Yazıcıya gönderilemedi");
        }
      } finally {
        setSending(false);
      }
      return;
    }
    iframeRef.current?.contentWindow?.print();
    await labelService.recordSackPrintEvent(sack.id).catch(() => {});
    toast.success(`${sack.sackNo} etiketi basıldı.`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Çuval Etiketi — {sack?.sackNo}</DialogTitle>
          <DialogDescription>
            Barkod ve karekod çuval numarasını taşır; okutulunca bu çuval bulunur.
            Bas tuşuna basınca etiket olduğu gibi yazıcıya gider.
          </DialogDescription>
        </DialogHeader>

        <PermissionGate
          permission="label:read"
          fallback={
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Etiket görüntüleme yetkisi yok.
            </div>
          }
        >
          {htmlQuery.isLoading ? (
            <Skeleton className="h-[520px] w-full" />
          ) : htmlQuery.isError ? (
            // Backend'in yönlendirmeli mesajı ("Çuval etiket şablonu tanımlı
            // değil — Tanımlar → …") olduğu gibi görünsün.
            <div className="rounded-md border border-dashed border-destructive/50 p-6 text-center text-sm text-destructive">
              {(htmlQuery.error as Error).message}
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              title="Çuval etiketi"
              srcDoc={htmlQuery.data ?? ""}
              sandbox="allow-same-origin allow-modals"
              className="h-[520px] w-full rounded border bg-white"
            />
          )}

          <DialogFooter>
            {hasPermission("label:print") && (
              <Button
                type="button"
                size="sm"
                disabled={htmlQuery.isLoading || htmlQuery.isError || sending}
                onClick={handlePrint}
                className="gap-1"
              >
                <Printer className="h-3.5 w-3.5" /> Bas
              </Button>
            )}
          </DialogFooter>
        </PermissionGate>
      </DialogContent>
    </Dialog>
  );
}
