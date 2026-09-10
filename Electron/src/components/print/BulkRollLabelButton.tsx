// =============================================================================
// TOPLU TOP ETİKETİ — düğme + önizleme (ORTAK bileşen)
// =============================================================================
// Kaynağı: `AccountingDispatch/DispatchReceiptDialog` içindeki toplu etiket
// bloğu (2026-08). Mal Kabul de aynı işi isteyince blok KOPYALANMADI, buraya
// ÇIKARILDI — kopya olsaydı iki yerde ayrı ayrı bakım gerekirdi ve asıl risk
// şu: `directEnabled` (seri/COM yazıcı) dallanması yalnız birinde güncellenip
// diğerinde eskir, sonra "bir ekranda diyalogsuz basıyor, diğerinde tarayıcı
// diyaloğu açıyor" diye açıklanamaz bir fark doğar.
//
// ⚠️ ETİKET BASMAK ZORUNLU DEĞİLDİR: barkod topun DB kimliğidir ve mal kabulde
// kendiliğinden doğar; kâğıda basmak tamamen isteğe bağlıdır. Bu düğme bir
// KOLAYLIKTIR — hiçbir akış "etiketi basılmamış top" diye engellemez.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Tags } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { printHtmlString } from "@/lib/print";
import { labelService } from "@/services/labelService";
import { useLabelPrinter } from "@/hooks/useLabelPrinter";

interface Props {
  /** Etiketi basılacak topların id'leri (iptal edilmişler ÇAĞIRAN tarafında elenir). */
  rollIds: string[];
  /** Düğme metni — bağlama göre ("Etiketleri Bas" / "Toplu Etiket"). */
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  /** Kontrollü mod: verilirse DÜĞME ÇİZİLMEZ, açılışı çağıran sürer (menü kalemi
   *  gibi kendisi kapanan tetikleyicilerden açmak için — düğme menünün içinde
   *  kalsaydı menü kapanırken önizleme de sökülürdü). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BulkRollLabelButton({
  rollIds,
  label = "Toplu Etiket",
  variant = "outline",
  size = "sm",
  className,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  // Yapılandırılmış seri/COM yazıcı varsa toplu etiket TEK native job'la,
  // tarayıcı diyaloğu olmadan basılır.
  const { directEnabled, printRollsBulk, peripheralId } = useLabelPrinter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => (controlled ? onOpenChange?.(o) : setUncontrolledOpen(o));

  // Önizleme: İLK topun aktif-dil WYSIWYG'i. peripheralId ile çözülür ki
  // önizleme bu PC'ye seçili yazıcının diliyle BİREBİR aynı olsun.
  const previewQ = useQuery({
    queryKey: ["bulk-label-preview", rollIds[0], peripheralId],
    queryFn: () => labelService.getRollPreview(rollIds[0]!, undefined, peripheralId),
    enabled: open && rollIds.length > 0,
    staleTime: 0,
  });
  const lp = previewQ.data;

  const printMut = useMutation({
    mutationFn: async () => {
      if (rollIds.length === 0) throw new Error("Basılacak top yok");
      if (directEnabled) {
        const r = await printRollsBulk(rollIds);
        if (!r.ok) throw new Error(r.error ?? "Yazıcıya gönderilemedi");
        return null;
      }
      const bulkHtml = await labelService.getBulkRollLabelsHtml(rollIds);
      await printHtmlString(bulkHtml);
      return null;
    },
    onSuccess: () => {
      if (directEnabled) toast.success("Etiketler yazıcıya gönderildi.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      {!controlled && (
        <Button
          variant={variant}
          size={size}
          className={className}
          disabled={rollIds.length === 0}
          onClick={() => setOpen(true)}
          title={rollIds.length === 0 ? "Basılacak top yok" : `${rollIds.length} top etiketi`}
        >
          <Tags className="mr-1 h-4 w-4" />
          {label} ({rollIds.length})
        </Button>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Toplu Etiket — {rollIds.length} top</DialogTitle>
          </DialogHeader>
          {lp && (
            <div className="text-[11px] text-muted-foreground">
              Aktif dil: <strong>{lp.language}</strong> · ilk top gösteriliyor ({rollIds.length} top basılacak)
            </div>
          )}
          {previewQ.isLoading ? (
            <Skeleton className="h-[440px] w-full" />
          ) : lp?.mode === "text" ? (
            <pre className="h-[440px] w-full overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/20 p-3 font-mono text-[11px]">
              {lp.content}
            </pre>
          ) : (
            <iframe
              title="Toplu etiket önizleme"
              srcDoc={lp?.content ?? ""}
              sandbox="allow-same-origin allow-modals"
              className="h-[440px] w-full rounded border bg-white"
            />
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              İptal
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={printMut.isPending || rollIds.length === 0}
              onClick={() => {
                printMut.mutate();
                setOpen(false);
              }}
            >
              <Printer className="h-4 w-4" />
              {printMut.isPending ? "Basılıyor…" : `${rollIds.length} etiketi bas`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
