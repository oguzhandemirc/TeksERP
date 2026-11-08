// Levent seçici: yalnız READY (boşta, hazır) leventler sunucudan aranır; sahibi seçili müşteri olmayan satır seçilemez.
import { listWarpBeams } from "@/pages/Operations/WarpBeams/service";
import type { WarpBeam } from "@/pages/Operations/WarpBeams/types";
import { OwnedPickerDialog } from "./OwnedPickerDialog";
import { fmtNum } from "./consignmentText";
import type { DraftItem } from "./draft";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ownerCustomerId: string;
  takenKeys: ReadonlySet<string>;
  onPick: (item: DraftItem) => void;
}

export function beamDisabledReason(
  b: WarpBeam,
  ownerCustomerId: string,
  taken: ReadonlySet<string>,
): string | null {
  if (taken.has(`beam:${b.id}`)) return "Belgede zaten var";
  if (!b.ownerCustomerId) return "Bizim levent — emanet değil, sahibine çıkışı olmaz";
  if (b.ownerCustomerId !== ownerCustomerId) return `Sahibi başka müşteri: ${b.ownerCustomer?.name ?? "—"}`;
  return null;
}

export function BeamPicker({ open, onOpenChange, ownerCustomerId, takenKeys, onPick }: Props) {
  return (
    <OwnedPickerDialog<WarpBeam>
      open={open}
      onOpenChange={onOpenChange}
      title="Levent seç"
      description="Hazır (tezgaha takılmamış) leventler. Yalnız seçili müşterinin emaneti seçilebilir."
      queryKey={["warp-beams", "consignment-picker"]}
      fetchPage={async (cursor, search) => {
        const r = await listWarpBeams({
          limit: 50,
          cursor,
          search: search || undefined,
          filters: { status: "READY" },
        });
        return { rows: r.data, nextCursor: r.pagination.nextCursor };
      }}
      renderRow={(b) => (
        <>
          <span className="font-mono font-medium">{b.beamNo}</span>
          <span className="text-xs text-muted-foreground">
            {b.warpSpec.name} · {fmtNum(b.remainingM)} m · {b.ownerCustomer?.name ?? "Bizim"}
          </span>
        </>
      )}
      disabledReason={(b) => beamDisabledReason(b, ownerCustomerId, takenKeys)}
      onPick={(b) => {
        onPick({
          key: `beam:${b.id}`,
          input: { kind: "WARP_BEAM", warpBeamId: b.id },
          label: `Levent ${b.beamNo}`,
          sub: `${b.warpSpec.name} · ${fmtNum(b.remainingM)} m`,
        });
        onOpenChange(false);
      }}
      emptyText="Hazır levent yok."
    />
  );
}
