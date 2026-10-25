import type { Editor } from "grapesjs";
import { MousePointerClick } from "lucide-react";
import { parseLoop } from "../binding/directives";
import type { PickerScope } from "../modals/FieldPickerModal";
import type { DesignerDraft } from "../useDesignerDraft";
import { closestItemTable, closestLoop, insideTotalBox, useSelectedComponent } from "../useSelectedComponent";
import { ConditionSection } from "./ConditionSection";
import { FieldBindingSection } from "./FieldBindingSection";
import { Section } from "./Section";
import { TableBindingSection } from "./TableBindingSection";

/** Özellikler sekmesinin bağlama bölümü: seçili öğenin yönergeleri (alan, tablo, koşul). */
export function BindingPanel({ editor, draft }: { editor: Editor | null; draft: DesignerDraft }) {
  const { component } = useSelectedComponent(editor);
  const contract = draft.contract;
  if (!component || !contract) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
        <MousePointerClick className="h-4 w-4" />
        {contract ? "Bağlamak için kanvasta bir öğe seçin." : "Belge türünün veri sözleşmesi yükleniyor…"}
      </div>
    );
  }
  const attrs = component.getAttributes();
  const loopComp = closestLoop(component);
  const loop = parseLoop(loopComp ? String(loopComp.getAttributes()["data-each"]) : null);
  const scope: PickerScope = insideTotalBox(component) ? { kind: "totals" } : loop ? { kind: "row", ...loop } : { kind: "all" };
  const table = closestItemTable(component);
  const common = { contract, internalFields: draft.internalFields, onOpenInternal: draft.openInternal, onChange: draft.touch };
  const isWrapper = component.is("wrapper");

  return (
    <div data-testid="baglama-paneli">
      {attrs["data-alan"] !== undefined && <FieldBindingSection component={component} scope={scope} {...common} />}
      {attrs["data-bag-src"] !== undefined && (
        <Section title="Logo">
          <p className="text-xs text-muted-foreground">Görsel basımda <code className="font-mono">{String(attrs["data-bag-src"])}</code> alanından gelir (firma kaydındaki logo).</p>
        </Section>
      )}
      {table && <TableBindingSection table={table} {...common} />}
      {!isWrapper && <ConditionSection component={component} scope={scope} {...common} />}
      {isWrapper && <p className="px-3 py-3 text-xs text-muted-foreground">Sayfa gövdesine koşul/döngü konamaz; içindeki bir öğeyi seçin.</p>}
    </div>
  );
}
