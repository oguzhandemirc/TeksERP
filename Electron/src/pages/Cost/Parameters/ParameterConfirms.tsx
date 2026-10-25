// Yürürlüğe al / taslağı sil onayları — etkilenen kayıt adıyla; yürürlüğe alma hiçbir eski hesabı değiştirmez.
import type { UseMutationResult } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { ACTIVATE_CONFIRM_TEXT } from "./param-fields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- yalnız mutateAsync/isPending okunur
type M = UseMutationResult<any, unknown, void, unknown>;

interface Props { which: "activate" | "delete" | null; draftVersion?: number; onClose: () => void; activate: M; remove: M }

export function ParameterConfirms({ which, draftVersion, onClose, activate, remove }: Props) {
  const v = draftVersion ?? "";
  return (
    <>
      <ConfirmDialog
        open={which === "activate"}
        onOpenChange={(o) => !o && onClose()}
        title={`Taslak v${v} yürürlüğe alınsın mı?`}
        description={ACTIVATE_CONFIRM_TEXT}
        confirmLabel="Yürürlüğe al"
        isPending={activate.isPending}
        onConfirm={() => activate.mutateAsync().then(onClose)}
      />
      <ConfirmDialog
        open={which === "delete"}
        onOpenChange={(o) => !o && onClose()}
        title={`Taslak v${v} silinsin mi?`}
        description="Yalnız bu taslak silinir (hiç yürürlüğe girmedi). Yürürlükteki set ve hesaplanmış maliyetler etkilenmez."
        confirmLabel="Taslağı sil"
        destructive
        isPending={remove.isPending}
        onConfirm={() => remove.mutateAsync().then(onClose)}
      />
    </>
  );
}
