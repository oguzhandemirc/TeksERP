// Levent seçici: sahibin READY leventleri aday ucundan (sahip süzgeci + engel sunucuda); belgede olan seçilemez.
import { CandidatePickerDialog } from "./CandidatePickerDialog";
import { blockedReasonText, fmtNum } from "./consignmentText";
import type { DraftItem } from "./draft";
import type { ConsignmentBeamCandidate } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ownerCustomerId: string;
  takenKeys: ReadonlySet<string>;
  onPick: (item: DraftItem) => void;
}

export function beamDisabledReason(b: ConsignmentBeamCandidate, taken: ReadonlySet<string>): string | null {
  if (taken.has(`beam:${b.warpBeamId}`)) return "Belgede zaten var";
  return blockedReasonText(b.blockedReason);
}

export function BeamPicker({ open, onOpenChange, ownerCustomerId, takenKeys, onPick }: Props) {
  return (
    <CandidatePickerDialog<ConsignmentBeamCandidate>
      open={open}
      onOpenChange={onOpenChange}
      title="Levent seç"
      description="Seçili müşterinin hazır (tezgaha takılmamış) emanet leventleri."
      ownerCustomerId={ownerCustomerId}
      pick={(d) => ({ rows: d.beams, truncated: d.truncated.beams, moduleOn: d.modules.devere })}
      rowKey={(b) => b.warpBeamId}
      renderRow={(b) => (
        <>
          <span className="font-mono font-medium">{b.beamNo}</span>
          <span className="text-xs text-muted-foreground">
            {b.warpSpecName ?? "—"} · {fmtNum(b.remainingM)} m
          </span>
        </>
      )}
      disabledReason={(b) => beamDisabledReason(b, takenKeys)}
      onPick={(b) => {
        onPick({
          key: `beam:${b.warpBeamId}`,
          input: { kind: "WARP_BEAM", warpBeamId: b.warpBeamId },
          label: `Levent ${b.beamNo}`,
          sub: `${b.warpSpecName ?? "—"} · ${fmtNum(b.remainingM)} m`,
        });
        onOpenChange(false);
      }}
      emptyText="Bu müşterinin hazır emanet leventi yok."
    />
  );
}
