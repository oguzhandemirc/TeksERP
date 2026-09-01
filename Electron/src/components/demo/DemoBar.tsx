import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDemoModeEnabled } from "@/hooks/usePricingEnabled";
import { demoService } from "@/services/demoService";

/**
 * DEMO YARDIMCI ŞERİDİ — sayfalara giren TEK şey budur.
 *
 * ⚠️ İLK SATIR KAPI (`useDemoModeEnabled`): bayrak kapalıyken bileşen HİÇBİR
 * ŞEY çizmez. Sayfalara `<DemoBar scenario="..." />` koymak, o sayfaya koşullu
 * mantık taşımaz — koşul tek yerde yaşar ve yeni bir sayfaya eklerken
 * "if unuttum" hatası mümkün değildir.
 *
 * ⚠️ Kanca fail-closed (`?? false`): bayrak yüklenene kadar ve sunucuya
 * ulaşılamazsa yardımcı çizilmez. Ters varsayılan, fabrikaya demo düğmesi
 * gösterirdi.
 *
 * ⚠️ Backend kapısı BUNUN YERİNE GEÇMEZ, buna EKLENİR: burada düğmeyi
 * çizmemek yalnız görünürlüktür; adresi bilen biri ucu yine çağırabilirdi.
 * Asıl kapı `requireDemoMode` (403).
 */
export function DemoBar({
  scenario,
  rollId,
  /** Senaryo koştuktan sonra tazelenecek query anahtarları. */
  invalidateKeys = [],
}: {
  scenario: "RELABEL_STALE";
  rollId?: string;
  invalidateKeys?: string[][];
}) {
  const acik = useDemoModeEnabled();
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: () => demoService.relabelStale(rollId),
    onSuccess: (r) => {
      toast.success(r.message ?? "Demo senaryosu uygulandı.");
      for (const k of invalidateKeys) void qc.invalidateQueries({ queryKey: k });
    },
    // ⚠️ onError YOK: `apiClient` interceptor'ı 4xx/5xx için zaten toast basıyor;
    // burada ikinci bir toast atmak MÜKERRER mesaj üretir (Electron CLAUDE.md).
  });

  if (!acik) return null;

  return (
    <div
      data-demo-helper="bar"
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
        Demo
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={m.isPending}
        onClick={() => m.mutate()}
        title="Bir topu 'etiketi basılmış ama sonradan değişmiş' hâle getirir; Yeniden Etiketle akışı denenebilir olur."
      >
        {m.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
        Etiketi bayat bir top hazırla
      </Button>
    </div>
  );
}
