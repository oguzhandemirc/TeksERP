// =============================================================================
// LEVENT ETİKETİ (LabelKind WARP_BEAM) — barkod = `WarpBeam.beamNo`; tablette TAK/KK1 okutur
// =============================================================================
import { LoomLabelPrintDialog } from "@/components/labels/LoomLabelPrintDialog";
import type { WarpBeam } from "./types";

/** İptal edilmiş levent sahada dolaşmaz — etiketi de basılmaz (menüde pasif). */
export function isBeamLabelPrintable(b: Pick<WarpBeam, "status">): boolean {
  return b.status !== "CANCELLED";
}

export function BeamLabelPrintDialog({ beam, onClose }: { beam: WarpBeam; onClose: () => void }) {
  return (
    <LoomLabelPrintDialog
      target="warp-beams"
      subject={{ id: beam.id, label: beam.physicalBeamNo ? `${beam.beamNo} · gövde ${beam.physicalBeamNo}` : beam.beamNo }}
      title="Levent etiketi bas"
      description="Etiket levente yapıştırılır; tablette tezgaha takarken okutulur. Şablon Etiket Stüdyosu'nda 'Levent' türünden gelir."
      onOpenChange={(o) => !o && onClose()}
    />
  );
}
