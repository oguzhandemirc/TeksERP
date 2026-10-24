// Ertele açılır menüsü — zil satırı ve Bildirimler sayfası aynı seçenekleri kullanır.
// Süren vardiya yoksa "Vardiya sonu" PASİF + açıklama; sunucu yine `VARDIYA_YOK` ile korur (yarış anı).
import { useState } from "react";
import { AlarmClock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentShiftEnd } from "@/lib/bildirim/hooks";
import type { SnoozeDuration } from "@/lib/bildirim/types";

const SNOOZE_OPTIONS: Array<{ sure: SnoozeDuration; etiket: string }> = [
  { sure: "1s", etiket: "1 saat" },
  { sure: "yarin-sabah", etiket: "Yarın 08:00" },
  { sure: "shift-sonu", etiket: "Vardiya sonu" },
];

export function SnoozeMenu({ onSec, disabled }: { onSec: (s: SnoozeDuration) => void; disabled?: boolean }) {
  const [acik, setAcik] = useState(false);
  const vardiyaBitis = useCurrentShiftEnd(acik);
  const vardiyaYok = vardiyaBitis === null;
  return (
    <DropdownMenu open={acik} onOpenChange={setAcik}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={disabled} aria-label="Ertele">
          <AlarmClock className="h-3.5 w-3.5" />
          Ertele
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {SNOOZE_OPTIONS.map((s) => {
          const pasif = s.sure === "shift-sonu" && vardiyaYok;
          return (
            <DropdownMenuItem key={s.sure} disabled={pasif} onSelect={() => onSec(s.sure)} className="flex-col items-start gap-0">
              <span>{s.etiket}</span>
              {pasif && <span className="text-[11px] text-muted-foreground">Süren vardiya yok</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
