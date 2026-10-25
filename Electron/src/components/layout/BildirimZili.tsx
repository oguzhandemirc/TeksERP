// =============================================================================
// BİLDİRİM ZİLİ — kişisel gelen kutusu (plan §6.1)
// =============================================================================
// Rozet = sunucunun okunmamış BİLDİRİM sayısı (`/ozet`, ALARM hariç), 99+; açık alarmlar "Alarmlar" sekmesinde. Akış içeriksizdir: zil gelince özet ve
// liste REST'ten okunur (`useNotificationBell`). Tezgah alarmı hapı (`LoomAlarmBell`) AYRI kalır; Etkinlik
// sayaçsızdır. FAIL-CLOSED: bayrak kapalı ya da eski backend (`/ozet` 404) → hiçbir şey çizilmez.
// =============================================================================
import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { handleArrowKeys } from "@/components/bildirim/NotificationRow";
import { BellPanel } from "@/components/bildirim/BellPanel";
import { badgeText } from "@/lib/bildirim/format";
import { useNotificationBell } from "@/lib/bildirim/hooks";

export function BildirimZili() {
  const zil = useNotificationBell();
  const [acik, setAcik] = useState(false);

  if (!zil.bayrak || !zil.hazir || !zil.destek || !zil.enabled) return null;

  const sayi = zil.okunmamis;
  const etiket = sayi > 0 ? `${sayi} okunmamış bildirim` : "Bildirimler: okunmamış yok";

  return (
    <Popover open={acik} onOpenChange={setAcik}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={etiket} title={etiket}>
          <Bell className="h-4 w-4" />
          {sayi > 0 && (
            <span
              data-testid="bildirim-rozet"
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            >
              {badgeText(sayi)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(420px,calc(100vw-1rem))] p-0" onKeyDown={handleArrowKeys}>
        <BellPanel okunmamis={sayi} alarmAcik={zil.alarmAcik} onKapat={() => setAcik(false)} />
      </PopoverContent>
    </Popover>
  );
}
