import { useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  queryKey: string | string[];
  /** Ana key ile BİRLİKTE invalidate edilecek ek query key'ler. Detay
   *  sayfalarında ana veri + ayrı çocuk query'leri (ör. dallar) tek tuşta
   *  tazelenmeli — yoksa buton yarım yeniler (ana veri döner, çocuk query
   *  staleTime nedeniyle eski kalır). */
  extraKeys?: (string | string[])[];
  label?: string;
  className?: string;
  /** Yenileme tamamlandığında gösterilecek toast mesajı. Varsayılan: "Liste yenilendi" */
  successMessage?: string;
  /** Toast gösterimi devre dışı bırak (nadir durumlar için) */
  silent?: boolean;
}

const MIN_SPIN_MS = 600;
const SUCCESS_FLASH_MS = 900;

export function RefreshButton({
  queryKey,
  extraKeys,
  label = "Yenile",
  className,
  successMessage = "Liste yenilendi",
  silent,
}: Props) {
  const qc = useQueryClient();
  const key = Array.isArray(queryKey) ? queryKey : [queryKey];
  const fetching = useIsFetching({ queryKey: key });

  const [active, setActive] = useState(false);
  const [justDone, setJustDone] = useState(false);

  const isSpinning = active || fetching > 0;

  const handleClick = async () => {
    if (isSpinning) return;
    setActive(true);
    setJustDone(false);
    const startedAt = Date.now();
    try {
      const keys = [key, ...(extraKeys ?? []).map((k) => (Array.isArray(k) ? k : [k]))];
      await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = MIN_SPIN_MS - elapsed;
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      setActive(false);
      setJustDone(true);
      if (!silent) toast.success(successMessage, { duration: 1600 });
      setTimeout(() => setJustDone(false), SUCCESS_FLASH_MS);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "gap-1.5 transition-colors",
        justDone && "border-success/40 bg-success/10 text-success",
        className,
      )}
      disabled={isSpinning}
      onClick={handleClick}
      aria-live="polite"
    >
      {justDone ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <RefreshCw className={cn("h-3.5 w-3.5 transition-transform", isSpinning && "animate-spin")} />
      )}
      {isSpinning ? "Yenileniyor..." : justDone ? "Güncellendi" : label}
    </Button>
  );
}
