import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppearanceControls } from "./AppearanceControls";

/** Topbar "Görünüm" menüsü — paylaşılan AppearanceControls'u popover'da gösterir. */
export function AppearanceMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Görünüm" title="Görünüm">
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <AppearanceControls />
      </PopoverContent>
    </Popover>
  );
}
