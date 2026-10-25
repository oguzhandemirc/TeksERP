import { useState } from "react";
import type { Component } from "grapesjs";
import { Button } from "@/components/ui/button";
import type { ContractView } from "../binding/contract";
import { ConditionBuilderModal } from "../modals/ConditionBuilderModal";
import type { PickerScope } from "../modals/FieldPickerModal";
import { Section } from "./Section";

interface Props {
  component: Component;
  contract: ContractView;
  scope: PickerScope;
  internalFields: readonly string[];
  onOpenInternal: (code: string) => void;
  onChange: () => void;
}

/** `data-if` — kalem satırında satır süzgeci, diğer öğelerde göster/gizle. */
export function ConditionSection({ component, contract, scope, internalFields, onOpenInternal, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const current = String(component.getAttributes()["data-if"] ?? "");
  const isRow = !!component.getAttributes()["data-each"];
  return (
    <Section title={isRow ? "Satır koşulu" : "Koşullu göster"} testId="kosul-ozellik">
      <p className="text-xs text-muted-foreground">
        {current ? <code className="break-all font-mono text-foreground">{current}</code> : isRow ? "Bütün satırlar basılır." : "Öğe her zaman basılır."}
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setOpen(true)}>Koşul kur…</Button>
        {current && (
          <Button size="sm" variant="ghost" onClick={() => { component.removeAttributes(["data-if"]); onChange(); }}>Kaldır</Button>
        )}
      </div>
      <ConditionBuilderModal
        open={open}
        onOpenChange={setOpen}
        initial={current}
        contract={contract}
        scope={scope}
        internalFields={internalFields}
        onOpenInternal={onOpenInternal}
        onApply={(v) => { component.addAttributes({ "data-if": v }); onChange(); }}
      />
    </Section>
  );
}
