// Ürün penceresi Kaydet akışı (B19): atkı planı → (paylaşılan kart → kopya ya da dur; ortak kart PATCH'lenmez) → atkı çağrısı + ürün gövdesi → onSubmit.
// Yeni üründe deneme kimliği (`clientToken`) pencere açılışında yenilenir; belirsiz hatada yapışır (kk1.md).
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { UseFormReturn } from "react-hook-form";
import { useAttemptToken } from "@/lib/attemptToken";
import { buildWeftBody } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import type { Item, ItemCreatePayload } from "../types";
import type { ItemFormValues } from "../schema";
import { buildItemPayload, fabricDetailPayload, yarnUnitPayload, yarnWastePayload } from "../itemPayload.helper";
import { constructionPayload, drawingInPlanPayload } from "../ItemConstructionPickers";
import { fabricClassPayload, fiberBody, fibersChanged, fibersCreatePayload } from "../fabricClass.payload";
import { cardExtraPayload } from "../cardExtra.payload";
import { itemService } from "../service";
import { planWeftSave, type ItemWeftDraft } from "./useItemWeftDraft";
import { applyWeftPlan } from "./item-save";
import { useWeftShareQuestion } from "./WeftShareQuestion";

interface Args {
  open: boolean;
  form: UseFormReturn<ItemFormValues>;
  initial: Item | null | undefined;
  weft: ItemWeftDraft;
  visible: { construction: boolean; yarnWaste: boolean; kaliteGuvence: boolean };
  onSubmit: (payload: ItemCreatePayload) => void | Promise<void>;
  onInvalidWeft: () => void;
}

export function useItemFormSave({ open, form, initial, weft, visible, onSubmit, onInvalidWeft }: Args) {
  const isEdit = Boolean(initial);
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const share = useWeftShareQuestion(open);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) attempt.renew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const handleSubmit = form.handleSubmit(async (v) => {
    const first = planWeftSave(weft, isEdit, (c) => buildWeftBody(c.seq, c.picksPerCm, c.program, c.rows));
    if (first.kind === "invalid") {
      toast.error(first.message);
      onInvalidWeft();
      return;
    }
    const plan = visible.construction ? await share.resolvePlan(first, weft, initial?.code ?? "") : first;
    if (!plan) return;
    // Atkı bağı plandan; desen kartı form alanından (atkı anahtarını `applyWeftPlan` koyar).
    const base = {
      ...buildItemPayload(v, isEdit, visible.kaliteGuvence),
      ...constructionPayload({ weftSpecId: "", weaveDesignId: v.weaveDesignId }, { weftSpecId: null, weaveDesignId: initial?.weaveDesignId }, visible.construction),
      ...drawingInPlanPayload(v.drawingInPlanId, initial?.drawingInPlanId, visible.construction),
      ...fabricDetailPayload(v, initial),
      ...yarnWastePayload(v, initial, visible.yarnWaste),
      ...yarnUnitPayload(v, initial),
      ...fabricClassPayload(v, initial),
      ...cardExtraPayload(v, initial),
      ...fibersCreatePayload(v, isEdit),
    };
    setSaving(true);
    try {
      // K7: düzenlemede lif bileşimi kendi ucundan (replace), kart gövdesinden ÖNCE — pencere onSubmit'te kapanır.
      if (initial && fibersChanged(v, initial)) await itemService.replaceFibers(initial.id, fiberBody(v));
      const ctx = { visible: visible.construction, itemId: initial?.id ?? null, savedWeftSpecId: initial?.weftSpecId ?? null, clientToken: isEdit ? undefined : attempt.token() };
      await onSubmit(await applyWeftPlan(plan, base, ctx));
      attempt.onSuccess();
      if (plan.kind !== "link" && plan.kind !== "none") void qc.invalidateQueries({ queryKey: ["weft-specs"] });
    } catch (e) {
      attempt.onFailure(e);
    } finally {
      setSaving(false);
    }
  });

  return { handleSubmit, saving, shareQuestion: share.element };
}
