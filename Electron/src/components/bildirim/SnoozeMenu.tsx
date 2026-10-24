// Ertele açılır menüsü — zil satırı ve Bildirimler sayfası aynı seçenekleri kullanır.
// "Vardiya sonu" sunucuda çözülür; süren vardiya yoksa sunucu `VARDIYA_YOK` der ve tost bunu söyler.
import { AlarmClock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SnoozeDuration } from "@/lib/bildirim/types";

const SNOOZE_OPTIONS: Array<{ sure: SnoozeDuration; etiket: string }> = [
  { sure: "1s", etiket: "1 saat" },
  { sure: "yarin-sabah", etiket: "Yarın 08:00" },
  { sure: "shift-sonu", etiket: "Vardiya sonu" },
];

export function SnoozeMenu({ onSec, disabled }: { onSec: (s: SnoozeDuration) => void; disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={disabled} aria-label="Ertele">
          <AlarmClock className="h-3.5 w-3.5" />
          Ertele
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {SNOOZE_OPTIONS.map((s) => (
          <DropdownMenuItem key={s.sure} onSelect={() => onSec(s.sure)}>
            {s.etiket}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
