// =============================================================================
// Faz 3 diyalog anahtarı — sayfa `dialog.kind`e göre TEK diyalog çizer (koşullu mount: taze token)
// =============================================================================
import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiResponse } from "@/types/api";
import { warpBeamService } from "../service";
import type { WarpBeam } from "../types";
import type { BeamActionKind } from "../usePageActions";
import { AdjustDialog, ExhaustDialog } from "./AdjustExhaustDialogs";
import { ConsumeDialog, DismountDialog } from "./DismountConsumeDialogs";
import { MountDialog } from "./MountDialog";
import { ScrapDialog, UndoDialog } from "./ScrapUndoDialogs";

type Act = UseMutationResult<ApiResponse<WarpBeam>, unknown, { run: () => Promise<ApiResponse<WarpBeam>>; fallback: string }>;

interface Props {
  kind: BeamActionKind;
  target: WarpBeam;
  act: Act;
  onClose: () => void;
}

export function BeamActionDialogs({ kind, target, act, onClose }: Props) {
  const id = target.id;
  const go = (run: () => Promise<ApiResponse<WarpBeam>>, fallback: string) => act.mutate({ run, fallback });
  const common = { target, isPending: act.isPending, onClose };
  switch (kind) {
    case "mount":
      return <MountDialog {...common} onConfirm={(b) => go(() => warpBeamService.mount(id, b), "Takıldı.")} />;
    case "dismount":
      return <DismountDialog {...common} onConfirm={(b) => go(() => warpBeamService.dismount(id, b), "Söküldü.")} />;
    case "consume":
      return <ConsumeDialog {...common} onConfirm={(b) => go(() => warpBeamService.consume(id, b), "Tüketim yazıldı.")} />;
    case "adjust":
      return <AdjustDialog {...common} onConfirm={(b) => go(() => warpBeamService.adjust(id, b), "Kalan düzeltildi.")} />;
    case "exhaust":
      return <ExhaustDialog {...common} onConfirm={(b) => go(() => warpBeamService.exhaust(id, b), "Levent bitti.")} />;
    case "scrap":
      return <ScrapDialog {...common} onConfirm={(code, reason) => go(() => warpBeamService.scrap(id, code, reason), "Hurdaya ayrıldı.")} />;
    case "undo":
      return <UndoDialog {...common} onConfirm={(pick, reason) => go(() => (pick.kind === "status" ? warpBeamService.cancelEvent(id, pick.eventId, reason) : warpBeamService.cancelConsumed(id, pick.eventId, reason)), "Geri alındı.")} />;
  }
}
