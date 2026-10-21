// =============================================================================
// TEZGAH ETİKETİ (LabelKind MACHINE) — barkod = `Machine.code`; KK1 okutur, top tezgaha bağlanır
// =============================================================================
// Yalnız AKTİF DOKUMA tezgahında sunulur (backend de dokuma dışı 400 `MACHINE_NOT_LOOM`,
// pasif 409 `MACHINE_INACTIVE` döner — düğme reddedilecek isteği hiç doğurmaz).
// =============================================================================
import { useState } from "react";
import { Tag } from "lucide-react";
import { StationKind } from "@/types/enums";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { LoomLabelPrintDialog } from "@/components/labels/LoomLabelPrintDialog";
import type { Machine } from "./types";

/** Düğme yüklemi — istasyon türü satırın istasyonundan (verilmezse makinenin gömülü istasyonundan). */
export function isLoomLabelPrintable(m: Machine, stationKind: StationKind | undefined = m.station?.kind): boolean {
  return m.isActive !== false && stationKind === StationKind.WEAVING;
}

export function MachineLabelPrintDialog({ machine, onOpenChange }: { machine: Machine | null; onOpenChange: (open: boolean) => void }) {
  return (
    <LoomLabelPrintDialog
      target="machines"
      subject={machine ? { id: machine.id, label: `${machine.code} · ${machine.name}` } : null}
      title="Tezgah etiketi bas"
      description="Etiket tezgaha asılır; KK1 masasında okutulunca top bu tezgahtan doğar. Şablon Etiket Stüdyosu'nda 'Tezgah' türünden gelir."
      onOpenChange={onOpenChange}
    />
  );
}

/** Makineler listesi hücresi — kendi diyalog durumunu yönetir; dokuma dışı satırda boş. */
export function MachineLabelCell({ machine }: { machine: Machine }) {
  const [open, setOpen] = useState(false);
  const { hasPermission } = useRoleAccess();
  if (!hasPermission("label:print") || !isLoomLabelPrintable(machine)) return null;
  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)} title="Tezgah etiketi bas (KK1 okutur)">
        <Tag className="h-3.5 w-3.5" /> Etiket
      </Button>
      {open && <MachineLabelPrintDialog machine={machine} onOpenChange={(o) => setOpen(o)} />}
    </>
  );
}
