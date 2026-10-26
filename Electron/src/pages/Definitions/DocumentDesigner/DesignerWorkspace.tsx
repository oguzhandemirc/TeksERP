import { useEffect, useRef, useState } from "react";
import "grapesjs/dist/css/grapes.min.css";
import "./designer.css";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { regionPreview, toCanvasPaper } from "./binding/pageSettings";
import { DesignerCenter } from "./DesignerCenter";
import { DesignerSidebar, type SidebarTab } from "./DesignerSidebar";
import { DesignerToolbar } from "./DesignerToolbar";
import { registerDocumentBlocks } from "./editor/documentBlocks";
import type { PageRegionKind } from "./editor/documentComponents";
import { pageDimensions } from "./editor/pageCanvas";
import { DocTypePickerModal } from "./modals/DocTypePickerModal";
import { BindingPanel } from "./panels/BindingPanel";
import { DataTreePanel } from "./panels/DataTreePanel";
import { DocumentSettingsPanel } from "./panels/DocumentSettingsPanel";
import { PageSettingsPanel } from "./panels/PageSettingsPanel";
import { TemplateBar } from "./templates/TemplateBar";
import { useTemplateAccess } from "./templates/useTemplateAccess";
import { useTemplateDocument } from "./templates/useTemplateDocument";
import { docTypeLabel, useDesignerDraft } from "./useDesignerDraft";
import { useDesignerEditor, type DesignerRefs } from "./useDesignerEditor";

interface Props {
  /** Kayıtlı şablon (son sürümü yüklenir, kayıt yeni sürüm açar); null = karalama (kayıtsız). */
  templateId: string | null;
}

/** Editör yerleşimi (plan §4): solda bloklar · ortada sayfa · sağda Stil/Özellikler/Veri/Sayfa/Belge ayarları/Katmanlar. */
export default function DesignerWorkspace({ templateId }: Props) {
  const refs: DesignerRefs = {
    container: useRef<HTMLDivElement>(null),
    area: useRef<HTMLDivElement>(null),
    blocks: useRef<HTMLDivElement>(null),
    styles: useRef<HTMLDivElement>(null),
    selectors: useRef<HTMLDivElement>(null),
    layers: useRef<HTMLDivElement>(null),
    traits: useRef<HTMLDivElement>(null),
  };
  const draft = useDesignerDraft();
  const [tab, setTab] = useState<SidebarTab>("style");
  const [pickingType, setPickingType] = useState(false);
  const ps = draft.pageSettings;
  const { paper, orientation } = toCanvasPaper(ps);
  const dim = pageDimensions(paper, orientation);
  const onRegion = (kind: PageRegionKind) => {
    if (kind === "sayfa-no" && ps.sayfaNo.konum === "yok" && !ps.altBilgi.sag) draft.setPageSettings({ ...ps, sayfaNo: { ...ps.sayfaNo, konum: "alt-sag" } });
    setTab("page");
  };
  const { editor, fatal, frame } = useDesignerEditor(
    refs,
    { paper, orientation, pageWidthPx: dim.widthPx, margins: ps.kenar, regions: regionPreview(ps) },
    onRegion,
  );

  const access = useTemplateAccess();
  const doc = useTemplateDocument(templateId, editor, draft);

  useEffect(() => {
    if (!editor) return;
    registerDocumentBlocks(editor, { contract: draft.contract, settings: draft.settings, internalFields: draft.internalFields });
  }, [editor, draft.contract, draft.settings, draft.internalFields]);

  useEffect(() => {
    if (!editor) return;
    const onChange = () => draft.touch();
    editor.on("component:add component:remove", onChange);
    return () => {
      editor.off("component:add component:remove", onChange);
    };
  }, [editor, draft]);

  if (fatal) {
    return <EmptyState icon={AlertTriangle} title="Tasarımcı durduruldu" description={fatal} />;
  }

  return (
    <div className="tekserp-designer flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
      {templateId && <TemplateBar editor={editor} draft={draft} doc={doc} access={access} />}
      <DesignerToolbar
        editor={editor}
        templateId={templateId}
        docTypeLabel={docTypeLabel(draft.docType)}
        onDocType={() => setPickingType(true)}
        dirty={draft.dirty}
        paper={paper}
        orientation={orientation}
        onPaper={(p) => draft.setPageSettings({ ...ps, kagit: p })}
        onOrientation={(o) => draft.setPageSettings({ ...ps, yon: o === "landscape" ? "yatay" : "dikey" })}
        contract={draft.contract}
        settings={draft.settings}
        internalFields={draft.internalFields}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-44 shrink-0 flex-col border-r bg-card" aria-label="Bloklar">
          <h3 className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bloklar</h3>
          <div ref={refs.blocks} className="tekserp-designer-blocks min-h-0 flex-1 overflow-y-auto" />
        </aside>
        <DesignerCenter refs={refs} editor={editor} draft={draft} widthMm={dim.widthMm} frame={frame} />
        <DesignerSidebar refs={refs} tab={tab} onTab={setTab} binding={<BindingPanel editor={editor} draft={draft} />}
          panels={{
            data: <DataTreePanel editor={editor} draft={draft} />,
            page: <PageSettingsPanel value={ps} onChange={draft.setPageSettings} />,
            settings: <DocumentSettingsPanel draft={draft} />,
          }}
        />
      </div>
      <DocTypePickerModal open={pickingType} onOpenChange={setPickingType} contracts={draft.contracts} current={draft.docType} onPick={draft.setDocType} />
    </div>
  );
}
