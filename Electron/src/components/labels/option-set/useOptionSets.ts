import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  OPTION_SET_KINDS,
  isEndpointMissing,
  type CustomerLabelOptionSetBody,
  type LabelOptionSetResponse,
  type OptionSetKind,
} from "@/services/labelTemplateOptionService";
import {
  EMPTY_DRAFT,
  draftFromResponse,
  optionSetStatus,
  toPutBody,
  type OptionSetDraft,
  type OptionSetDrafts,
} from "./labelOptionSet";

export interface OptionSetChange {
  kind: OptionSetKind;
  draft: OptionSetDraft;
  /** Yalnız müşteri seti: "Herkes için seti de göster" anahtarı aynı PUT'la yazılır. */
  showGlobalTemplates?: boolean;
}

interface Args<R extends LabelOptionSetResponse> {
  queryKey: readonly unknown[];
  load: (kind: OptionSetKind) => Promise<R>;
  save: (body: CustomerLabelOptionSetBody) => Promise<void>;
  /** Varsayılanı da yazdığımız için eski tek-seçim ekranlarının önbelleği tazelenir. */
  alsoInvalidate?: ReadonlyArray<readonly unknown[]>;
}

/**
 * Ham + bitmiş setlerin sunucu durumu ve tek-adımda kayıt. Her eylem tam setin PUT'udur
 * (replace); taslak tutulmaz → form penceresinde "kaydedilmemiş set" kalmaz.
 * onError YOK: apiClient 4xx mesajını zaten basar (EL-17).
 */
export function useOptionSets<R extends LabelOptionSetResponse>({ queryKey, load, save, alsoInvalidate }: Args<R>) {
  const qc = useQueryClient();
  const results = useQueries({
    queries: OPTION_SET_KINDS.map((kind) => ({
      queryKey: [...queryKey, kind],
      queryFn: () => load(kind),
    })),
  });

  const status = optionSetStatus(results, isEndpointMissing);
  const responses = {} as Record<OptionSetKind, R | undefined>;
  const drafts = {} as OptionSetDrafts;
  OPTION_SET_KINDS.forEach((kind, i) => {
    const data = results[i]?.data;
    responses[kind] = data;
    drafts[kind] = data ? draftFromResponse(data) : EMPTY_DRAFT;
  });

  const mut = useMutation({
    mutationFn: async (changes: OptionSetChange[]) => {
      // Sıralı: "ikisine birlikte ekle"de ilk set reddedilirse ikincisi yazılmaz.
      for (const c of changes) await save(toPutBody(c.kind, c.draft, c.showGlobalTemplates));
    },
    onSuccess: () => toast.success("Etiket seti kaydedildi."),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...queryKey] });
      for (const k of alsoInvalidate ?? []) void qc.invalidateQueries({ queryKey: [...k] });
    },
  });

  return {
    status,
    responses,
    drafts,
    pending: mut.isPending,
    apply: (changes: OptionSetChange[]) => (changes.length ? mut.mutateAsync(changes) : Promise.resolve()),
  };
}
