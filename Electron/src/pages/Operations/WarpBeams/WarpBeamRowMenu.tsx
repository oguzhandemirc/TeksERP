import { Pencil, Trash2, Disc3, Ban, Cable, Unplug, Scissors, SlidersHorizontal, Flag, Trash, Undo2 } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { PermissionGate } from "@/components/PermissionGate";
import { undoMenuEnabled } from "./tezgah/beam-undo";
import { isLiveBeam, type WarpBeam } from "./types";
import type { BeamActionKind } from "./usePageActions";

interface Props {
  row: WarpBeam;
  /** Faz 3 menüsü yalnız `devere.mountTracking` açıkken çizilir — kapalıyken sıfır fark. */
  mountTracking: boolean;
  onEdit: (r: WarpBeam) => void;
  onDelete: (r: WarpBeam) => void;
  onWind: (r: WarpBeam) => void;
  onCancel: (r: WarpBeam) => void;
  onBeamAction: (kind: BeamActionKind, r: WarpBeam) => void;
}

/** Satır menüsü — plan/sar/sil + tak/sök/tüket/düzelt/bitir `warpbeam:write`; sarım iptali · hurda · geri alma AYRI yetenek `warpbeam:cancel`. */
export function WarpBeamRowMenu({ row, mountTracking, onEdit, onDelete, onWind, onCancel, onBeamAction }: Props) {
  const planned = row.status === "PLANNED";
  const ready = row.status === "READY";
  const mounted = row.status === "MOUNTED";
  const live = isLiveBeam(row.status);
  const act = (k: BeamActionKind) => () => onBeamAction(k, row);
  return (
    <>
      <PermissionGate permission="warpbeam:write">
        <ContextMenuItem disabled={!planned} onSelect={() => onEdit(row)}>
          <Pencil /> Planı düzenle
        </ContextMenuItem>
        <ContextMenuItem disabled={!planned} onSelect={() => onWind(row)}>
          <Disc3 /> Sar (WOUND)
        </ContextMenuItem>
        <ContextMenuItem disabled={!planned} onSelect={() => onDelete(row)}>
          <Trash2 /> Taslağı sil
        </ContextMenuItem>
        {mountTracking && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!ready} onSelect={act("mount")}>
              <Cable /> Tezgaha tak
            </ContextMenuItem>
            <ContextMenuItem disabled={!mounted} onSelect={act("dismount")}>
              <Unplug /> Tezgahtan sök
            </ContextMenuItem>
            <ContextMenuItem disabled={!live} onSelect={act("consume")}>
              <Scissors /> Tüketim yaz
            </ContextMenuItem>
            <ContextMenuItem disabled={!live} onSelect={act("adjust")}>
              <SlidersHorizontal /> Kalanı düzelt
            </ContextMenuItem>
            <ContextMenuItem disabled={!live} onSelect={act("exhaust")}>
              <Flag /> Bitir (levent dibi)
            </ContextMenuItem>
          </>
        )}
      </PermissionGate>
      <PermissionGate permission="warpbeam:cancel">
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!ready} onSelect={() => onCancel(row)}>
          <Ban /> Sarımı iptal et
        </ContextMenuItem>
        {mountTracking && (
          <>
            <ContextMenuItem disabled={!live} onSelect={act("scrap")}>
              <Trash /> Hurdaya ayır
            </ContextMenuItem>
            <ContextMenuItem disabled={!undoMenuEnabled(row.status)} onSelect={act("undo")}>
              <Undo2 /> Tezgah kaydını geri al
            </ContextMenuItem>
          </>
        )}
      </PermissionGate>
    </>
  );
}
