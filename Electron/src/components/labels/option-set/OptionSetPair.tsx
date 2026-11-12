import { useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/PermissionGate";
import { labelKindLabels } from "@/services/labelTemplateService";
import { OPTION_SET_KINDS, type OptionSetKind } from "@/services/labelTemplateOptionService";
import { LabelOptionSetEditor } from "./LabelOptionSetEditor";
import { addTargets, type OptionSetDrafts } from "./labelOptionSet";
import type { OptionSetChange } from "./useOptionSets";

interface Props {
  drafts: OptionSetDrafts;
  pending: boolean;
  onApply: (changes: OptionSetChange[]) => void;
  noDefaultHint: (kind: OptionSetKind) => ReactNode;
  removeDefaultText: string;
  /** Her bağlam editörünün altına (müşteride: herkes için set önizlemesi). */
  footer?: (kind: OptionSetKind) => ReactNode;
}

/** Ham + bitmiş top setleri (K1: ayrı set) ve "ikisine birlikte ekle" kutusu. */
export function OptionSetPair({ drafts, pending, onApply, noDefaultHint, removeDefaultText, footer }: Props) {
  const [both, setBoth] = useState(false);
  return (
    <div className="space-y-4">
      <PermissionGate permission="label-template:write">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={both} onCheckedChange={(v) => setBoth(v === true)} aria-label="Ham ve bitmiş sete birlikte ekle" />
          Eklenen şablonu ham ve bitmiş top setlerinin ikisine birlikte ekle
        </label>
      </PermissionGate>
      {OPTION_SET_KINDS.map((kind) => (
        <div key={kind} className="space-y-2">
          <LabelOptionSetEditor
            testId={`option-set-${kind}`}
            title={labelKindLabels[kind]}
            draft={drafts[kind]}
            disabled={pending}
            onChange={(draft) => onApply([{ kind, draft }])}
            onAdd={(entry) => onApply(addTargets(drafts, kind, both, entry))}
            noDefaultHint={noDefaultHint(kind)}
            removeDefaultText={removeDefaultText}
          />
          {footer?.(kind)}
        </div>
      ))}
    </div>
  );
}
