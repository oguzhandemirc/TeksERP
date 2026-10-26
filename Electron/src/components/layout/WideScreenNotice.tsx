import { MonitorSmartphone } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

/**
 * Dar ekran uyarısı — sürükle-bırak/tuval düzenleyicileri telefonda düzenlenmez (UX-3 kabulü:
 * "salt-okunur + geniş ekranda düzenleyin"). Metin tek yerde; ekranlar yalnız neyin kapandığını söyler.
 */
export function WideScreenNotice({ what, className }: { what: string; className?: string }) {
  return (
    <Callout tone="info" icon={MonitorSmartphone} title="Geniş ekranda düzenleyin" className={cn("m-4", className)}>
      {what} dar ekranda salt-okunurdur. Düzenlemek için bilgisayarda ya da yatay tablette açın.
    </Callout>
  );
}
