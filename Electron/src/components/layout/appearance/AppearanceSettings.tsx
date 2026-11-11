import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppearance } from "@/lib/theme/use-appearance";
import { AppearanceControls } from "../AppearanceControls";
import { AppearancePreview } from "./AppearancePreview";

/** Ayarlar › Görünüm — solda bütün eksenler, sağda canlı önizleme, altta "Varsayılana dön". */
export function AppearanceSettings() {
  const { appearance, resetAppearance, isDefault } = useAppearance();
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <AppearanceControls variant="full" />
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Önizleme</p>
        <AppearancePreview appearance={appearance} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Hesabına kaydedilir; başka bilgisayarda da aynı görünümü bulursun.</p>
          <Button variant="outline" size="sm" onClick={resetAppearance} disabled={isDefault}>
            <RotateCcw className="h-3.5 w-3.5" />
            Varsayılana dön
          </Button>
        </div>
      </div>
    </div>
  );
}
