// =============================================================================
// Etiket Stüdyosu — cihaz parkı ↔ varyant eşleşme uyarısı (proaktif, client-side)
// =============================================================================
// "Sıfır hata" akışının panel ayağı: baskı ANINDA eşleşmeyen medya birincil
// varyanta düşer (bloklanmaz) — kullanıcı bunu baskıda değil BURADA görsün.
// Aktif LABEL_PRINTER cihazlarının MEDYA boyutu (labelWidthMm/labelHeightMm —
// artık doğrudan cihazda) varyant listesine ±1mm toleransla karşılaştırılır;
// ek endpoint gerekmez (cihaz parkı zaten API'de, "Boyutlar" kataloğu emekli).

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { loadAllForPicker } from "@/lib/picker-loader";
import { peripheralService } from "@/pages/PeripheralDevices/service";
import type { LabelTemplateVariant } from "@/services/labelTemplateService";

const TOL_MM = 1.0;

interface Props {
  variants: LabelTemplateVariant[];
}

export function VariantMismatchBanner({ variants }: Props) {
  const peripheralsQ = useQuery({
    queryKey: ["peripherals", "picker"],
    queryFn: () => loadAllForPicker(peripheralService).then((r) => r.data),
    staleTime: 60_000,
  });

  if (!variants.length || !peripheralsQ.data) return null;

  const near = (a: number, b: number) => Math.abs(a - b) <= TOL_MM;

  const mismatched: string[] = [];
  for (const d of peripheralsQ.data) {
    if (d.kind !== "LABEL_PRINTER" || !d.isActive) continue;
    if (d.labelWidthMm == null || d.labelHeightMm == null) continue;
    const w = d.labelWidthMm;
    const h = d.labelHeightMm;
    const ok = variants.some((v) => near(v.widthMm, w) && near(v.heightMm, h));
    if (!ok) mismatched.push(`${d.name} (${w}×${h}mm)`);
  }
  if (mismatched.length === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Şu yazıcıların medya boyutu için varyant yok:{" "}
        <strong>{mismatched.slice(0, 4).join(", ")}{mismatched.length > 4 ? ` +${mismatched.length - 4}` : ""}</strong>.
        Bu cihazlarda birincil varyant basılır (taşan kısmı yazıcı kırpar). "Yeni boyut" ile
        o ölçüye varyant ekleyip elle teyit edin.
      </span>
    </div>
  );
}
