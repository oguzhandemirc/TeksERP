import type { MouseEvent, ReactNode } from "react";
import { toast } from "sonner";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const DESKTOP_ONLY_MESSAGE = "Bu işlem masaüstü uygulamasından yapılır";

/**
 * MASAÜSTÜ-YALNIZ EYLEM (bulut web paneli K3): etiket (HTML dahil), tartı, cihaz testi.
 *
 * Electron'da çocuk AYNEN çizilir. Webde görünür-soluk kalır (gizlenmez: kullanıcı işlemin
 * VAR olduğunu ve nerede yapıldığını öğrenir); tıklama yakalama aşamasında durdurulur, çocuğun
 * `onClick`i (ve mutasyonu) hiç koşmaz. Çocuk `disabled` YAPILMAZ — disabled düğme tıklama
 * olayı üretmez ve bilgi mesajı çıkmazdı.
 */
export function DesktopOnlyAction({ children }: { children: ReactNode }) {
  if (IS_ELECTRON) return <>{children}</>;
  const block = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toast.info(DESKTOP_ONLY_MESSAGE);
  };
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-disabled="true"
            data-desktop-only=""
            title={DESKTOP_ONLY_MESSAGE}
            onClickCapture={block}
            className="inline-flex cursor-not-allowed opacity-50 [&_*]:cursor-not-allowed"
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{DESKTOP_ONLY_MESSAGE}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
