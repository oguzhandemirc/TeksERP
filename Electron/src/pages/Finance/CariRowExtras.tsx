// Cari Hesaplar satırı ekleri (D4-I3): durum rozetleri (Pasif + Kilitli) ve Kilit düğmesi — CariPage satır sınırında kalsın.
import { useState } from "react";
import { GitMerge, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { CariHoldBadge } from "./CariHold/CariHoldBadge";
import { CariMergeDialog } from "./CariMerge/CariMergeDialog";
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

/** D4-K3e: "Başka cariyle birleştir" — izinsizde ÇİZİLMEZ (`finance:cari-merge`, SoD). */
export function CariMergeButton({ onClick }: { onClick: () => void }) {
  return (
    <PermissionGate permission="finance:cari-merge">
      <Button variant="ghost" size="sm" onClick={onClick} title="Başka cariyle birleştir">
        <GitMerge className="mr-1 h-4 w-4" />
        Birleştir
      </Button>
    </PermissionGate>
  );
}


/** Satır eylemleri: Kilit + Birleştir (birleştirme modalı kendi durumunu taşır — koşullu mount, her açılış taze). */
export function CariRowActions({ row, onHold }: { row: CariRow; onHold: () => void }) {
  const [merging, setMerging] = useState(false);
  return (
    <>
      <CariHoldButton onClick={onHold} />
      <CariMergeButton onClick={() => setMerging(true)} />
      {merging && <CariMergeDialog cariId={row.id} cariName={row.name} onClose={() => setMerging(false)} />}
    </>
  );
}
