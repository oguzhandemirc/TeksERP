// Cari Hesaplar satırı ekleri (D4-I3): durum rozetleri (Pasif + Kilitli) ve Kilit düğmesi — CariPage satır sınırında kalsın.
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CariHoldBadge } from "./CariHold/CariHoldBadge";
import type { CariRow } from "./service";

export { CariHoldDialog } from "./CariHold/CariHoldDialog";

export function CariStatusBadges({ row }: { row: CariRow }) {
  return (
    <>
      {/* Pasifleştirme buradan yapılabildiği için görünür de olmalı: rozetsiz satır "kaydettim ama hiçbir şey
          değişmedi" hissi verir ve pasif cari yeni fatura/tahsilatı REDDEDER. */}
      {!row.isActive && (
        <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">
          Pasif
        </Badge>
      )}
      {/* Kilit rozeti: sebep etiketi sunucudan (`hold.reasonLabel`). */}
      <CariHoldBadge view={row.hold ? { held: true, holdText: `Cari kilitli — ${row.hold.reasonLabel}` } : null} />
    </>
  );
}

export function CariHoldButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <Lock className="mr-1 h-4 w-4" />
      Kilit
    </Button>
  );
}
