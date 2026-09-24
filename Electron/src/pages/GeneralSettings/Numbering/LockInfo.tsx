import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Uzun kilit cümlesi satırı taşırmasın diye ⓘ arkasında durur; üstüne gelince
 * açılır. Cümle erişilebilir ad olarak da taşınır (ekran okuyucu + test).
 */
export function LockInfo({ text }: { text: string }) {
  if (!text) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={text}
            className="inline-flex shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-normal leading-snug">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
