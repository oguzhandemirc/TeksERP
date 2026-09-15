// =============================================================================
// FASON DOKUMA — açık diyalogu çizen anahtar (FasonSheet'in alt bileşeni)
// =============================================================================
import type { WeavingOrder } from "../types";
import { FasonDispatchDialog } from "./FasonDispatchDialog";
import { FasonReceiptDialog } from "./FasonReceiptDialog";
import { FasonDispatchCancelDialog, FasonReceiptCancelDialog } from "./FasonCancelDialogs";
import { FasonBeamReturnDialog } from "./FasonBeamReturnDialog";
import { FasonYarnReturnCancelDialog, FasonYarnReturnDialog } from "./FasonYarnReturnDialog";
import type { useFasonMutations } from "./useFasonMutations";
import type { FasonDispatch, FasonReceipt, FasonYarnItem } from "./types";

export type FasonModal =
  | null
  | { kind: "dispatch" }
  | { kind: "receive" }
  | { kind: "cancel-dispatch"; target: FasonDispatch }
  | { kind: "return-beam"; target: FasonDispatch }
  | { kind: "return-yarn"; target: FasonDispatch }
  | { kind: "cancel-yarn-return"; target: FasonDispatch; item: FasonYarnItem }
  | { kind: "cancel-receipt"; target: FasonReceipt };

const swallow = () => undefined;

interface Props {
  order: WeavingOrder;
  modal: FasonModal;
  m: ReturnType<typeof useFasonMutations>;
  failed: { index: number; message: string }[];
  onFailed: (f: { index: number; message: string }[]) => void;
  onClose: () => void;
}

export function FasonModals({ order, modal, m, failed, onFailed, onClose }: Props) {
  if (!modal) return null;
  if (modal.kind === "dispatch") {
    return <FasonDispatchDialog order={order} isPending={m.dispatch.isPending} onClose={onClose} onConfirm={(b) => m.dispatch.mutateAsync(b).then(swallow, swallow)} />;
  }
  if (modal.kind === "receive") {
    return (
      <FasonReceiptDialog
        order={order}
        isPending={m.receive.isPending}
        failed={failed}
        onClose={onClose}
        onConfirm={(b) => m.receive.mutateAsync(b).then((res) => onFailed(res.data.failed), swallow)}
      />
    );
  }
  if (modal.kind === "return-beam") {
    return <FasonBeamReturnDialog target={modal.target} isPending={m.returnBeam.isPending} onClose={onClose} onConfirm={(b) => m.returnBeam.mutateAsync(b).then(swallow, swallow)} />;
  }
  if (modal.kind === "return-yarn") {
    return <FasonYarnReturnDialog target={modal.target} isPending={m.returnYarn.isPending} onClose={onClose} onConfirm={(b) => m.returnYarn.mutateAsync(b).then(swallow, swallow)} />;
  }
  if (modal.kind === "cancel-yarn-return") {
    return <FasonYarnReturnCancelDialog target={modal.target} item={modal.item} isPending={m.cancelYarnReturn.isPending} onClose={onClose} onConfirm={(b) => m.cancelYarnReturn.mutateAsync(b).then(swallow, swallow)} />;
  }
  if (modal.kind === "cancel-dispatch") {
    return (
      <FasonDispatchCancelDialog
        target={modal.target}
        isPending={m.cancelDispatch.isPending}
        onClose={onClose}
        onConfirm={(reason) => m.cancelDispatch.mutateAsync({ id: modal.target.id, reason }).then(swallow, swallow)}
      />
    );
  }
  return (
    <FasonReceiptCancelDialog
      target={modal.target}
      isPending={m.cancelReceipt.isPending}
      onClose={onClose}
      onConfirm={(reason) => m.cancelReceipt.mutateAsync({ id: modal.target.id, reason }).then(swallow, swallow)}
    />
  );
}
