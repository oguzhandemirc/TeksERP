import { useState } from "react";
import { Palette, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTabsStore } from "@/store/tabs";
import { useAppearance } from "@/lib/theme/use-appearance";
import { AppearanceControls } from "./AppearanceControls";

/** Üst çubuk "Görünüm" — hızlı seçimler; bütün eksenler ve önizleme Ayarlar › Görünüm'de. */
export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { resetAppearance, isDefault } = useAppearance();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Görünüm" title="Görünüm">
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <AppearanceControls variant="quick" />
        <div className="flex items-center justify-between gap-2 border-t border-card-border pt-3">
          <Button variant="ghost" size="sm" onClick={resetAppearance} disabled={isDefault}>
            <RotateCcw className="h-3.5 w-3.5" />
            Varsayılana dön
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              navigateActive("/settings");
            }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Tüm ayarlar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
