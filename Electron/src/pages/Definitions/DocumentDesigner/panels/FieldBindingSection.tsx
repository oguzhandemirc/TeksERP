import { useEffect, useState } from "react";
import type { Component } from "grapesjs";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { fieldFilter } from "../binding/blockHtml";
import { FIELD_TYPE_LABELS, isFieldLocked, resolveField, sampleText, type ContractField, type ContractView } from "../binding/contract";
import { suggestFilters, validateFilterChain } from "../binding/directives";
import { FieldPickerModal, type PickerScope } from "../modals/FieldPickerModal";
import { Section } from "./Section";

interface Props {
  component: Component;
  contract: ContractView;
  scope: PickerScope;
  internalFields: readonly string[];
  onOpenInternal: (code: string) => void;
  onChange: () => void;
}

/** `data-alan` bağlayan alan seçici ve `data-filtre` önerisi (türden). */
export function FieldBindingSection({ component, contract, scope, internalFields, onOpenInternal, onChange }: Props) {
  const attrs = component.getAttributes();
  const path = String(attrs["data-alan"] ?? "");
  const loop = scope.kind === "row" ? { variable: scope.variable, tableKey: scope.tableKey } : undefined;
  const field = resolveField(contract, path, loop);
  const [picking, setPicking] = useState(false);
  const stored = String(attrs["data-filtre"] ?? "");
  const [filter, setFilter] = useState(stored);
  useEffect(() => setFilter(stored), [component, stored]);
  const filterError = validateFilterChain(filter);

  const applyFilter = (value: string) => {
    setFilter(value);
    if (validateFilterChain(value)) return;
    if (value.trim()) component.addAttributes({ "data-filtre": value.trim() });
    else component.removeAttributes(["data-filtre"]);
    onChange();
  };
  const pick = (p: string, f: ContractField) => {
    const next = fieldFilter(f);
    component.addAttributes({ "data-alan": p });
    if (next) component.addAttributes({ "data-filtre": next });
    else component.removeAttributes(["data-filtre"]);
    component.components(sampleText(f, f.etiket).replace(/</g, "&lt;"));
    setFilter(next);
    onChange();
  };

  return (
    <Section title="Veri alanı">
      <div className="space-y-1 text-xs">
        <div className="font-medium">{field?.etiket ?? "Bağlı alan yok"}</div>
        <div className="font-mono text-muted-foreground">{path || "—"}</div>
        {field && <div className="text-muted-foreground">{FIELD_TYPE_LABELS[field.tur]}{field.birim ? ` · ${field.birim}` : ""}</div>}
      </div>
      {isFieldLocked(field, internalFields) && (
        <Callout tone="warning" title="Kilitli iç alan">Bu iç alan açık değil; basımda hata verir. Alanı yeniden seçip açın.</Callout>
      )}
      <Button size="sm" variant="outline" className="w-full" onClick={() => setPicking(true)}>Alan seç…</Button>
      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor="tasarim-filtre">Biçim (filtre)</label>
        <div className="flex flex-wrap gap-1">
          {field && suggestFilters(field.tur, { ondalik: field.ondalik, birim: field.birim }).map((s) => (
            <Button key={s.value} size="sm" variant={filter === s.value ? "default" : "outline"} className="h-6 px-2 text-[11px]" onClick={() => applyFilter(s.value)}>
              {s.label}
            </Button>
          ))}
        </div>
        <Input id="tasarim-filtre" className="h-8 font-mono text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} onBlur={() => applyFilter(filter)} onKeyDown={(e) => { if (e.key === "Enter") applyFilter(filter); }} />
        {filterError && <p className="text-xs text-destructive">{filterError}</p>}
      </div>
      {picking && (
        <FieldPickerModal open onOpenChange={setPicking} contract={contract} scope={scope} internalFields={internalFields} onOpenInternal={onOpenInternal} onPick={pick} />
      )}
    </Section>
  );
}
