import { Pencil, Trash2, Disc3, Ban } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { PermissionGate } from "@/components/PermissionGate";
import type { WarpBeam } from "./types";

interface Props {
  row: WarpBeam;
  onEdit: (r: WarpBeam) => void;
  onDelete: (r: WarpBeam) => void;
  onWind: (r: WarpBeam) => void;
  onCancel: (r: WarpBeam) => void;
}

/** Satır menüsü — plan/sar/sil `warpbeam:write`; sarım iptali AYRI yetenek `warpbeam:cancel`. */
export function WarpBeamRowMenu({ row, onEdit, onDelete, onWind, onCancel }: Props) {
  const planned = row.status === "PLANNED";
  const ready = row.status === "READY";
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
      </PermissionGate>
      <PermissionGate permission="warpbeam:cancel">
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!ready} onSelect={() => onCancel(row)}>
          <Ban /> Sarımı iptal et
        </ContextMenuItem>
      </PermissionGate>
    </>
  );
}
