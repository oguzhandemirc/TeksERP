// Salon koşum pencereleri tek yerden açılır; tezgahlar pencere AÇILDIĞI anın kopyasıdır (canlı tazeleme
// önizlemeyi ve satır işaretlerini sıfırlamasın).
import type { RunActionKey } from "../floorActions";
import type { LiveLoom } from "../types";
import { AssignJobDialog } from "./AssignJobDialog";
import { FinishJobDialog } from "./FinishJobDialog";
import { RevokeRunDialog } from "./RevokeRunDialog";

export interface JobDialogState {
  kind: RunActionKey;
  looms: readonly LiveLoom[];
}

const NONE: readonly LiveLoom[] = [];

export function JobDialogs({ state, online, onClose }: { state: JobDialogState | null; online: boolean; onClose: () => void }) {
  const looms = state?.looms ?? NONE;
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    <>
      <AssignJobDialog
        open={state?.kind === "assign" || state?.kind === "replace"}
        mode={state?.kind === "replace" ? "replace" : "assign"}
        looms={looms}
        online={online}
        onOpenChange={onOpenChange}
      />
      <FinishJobDialog open={state?.kind === "finish"} looms={looms} online={online} onOpenChange={onOpenChange} />
      <RevokeRunDialog open={state?.kind === "revoke"} loom={state?.kind === "revoke" ? (looms[0] ?? null) : null} online={online} onOpenChange={onOpenChange} />
    </>
  );
}
