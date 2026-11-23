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
  /** "Birlikte ekle" kutusuyla aynı satırda solda (müşteride: herkes için set anahtarı). */
  toolbar?: ReactNode;
}

/** Ham + bitmiş top setleri (K1: ayrı set) yan yana ve "ikisine birlikte ekle" kutusu — kompakt düzen 2026-11-24. */
export function OptionSetPair({ drafts, pending, onApply, noDefaultHint, removeDefaultText, footer, toolbar }: Props) {
  const [both, setBoth] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {toolbar}
        <PermissionGate permission="label-template:write">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={both} onCheckedChange={(v) => setBoth(v === true)} aria-label="Ham ve bitmiş sete birlikte ekle" />
            Eklenen şablonu iki sete birlikte ekle
          </label>
        </PermissionGate>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {OPTION_SET_KINDS.map((kind) => (
          <div key={kind} className="space-y-2 rounded-lg border bg-muted/20 p-3">
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
    </div>
  );
}
