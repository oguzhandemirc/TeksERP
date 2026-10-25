import { useRef, useState } from "react";
import "grapesjs/dist/css/grapes.min.css";
import "./designer.css";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { CmRuler } from "./CmRuler";
import { DesignerSidebar } from "./DesignerSidebar";
import { DesignerToolbar } from "./DesignerToolbar";
import { pageDimensions, type Orientation, type PaperSize } from "./editor/pageCanvas";
import { useDesignerEditor, type DesignerRefs } from "./useDesignerEditor";

interface Props {
  /** Şablon kimliği — kayıt uçları (T1B) gelene dek yalnız başlıkta gösterilir. */
  templateId: string | null;
}

/** Editör yerleşimi (plan §4): solda bloklar · ortada sayfa · sağda Stil/Özellikler/Katmanlar. */
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
  const [paper, setPaper] = useState<PaperSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const dim = pageDimensions(paper, orientation);
  const { editor, fatal, frame } = useDesignerEditor(refs, paper, orientation, dim.widthPx);

  if (fatal) {
    return <EmptyState icon={AlertTriangle} title="Tasarımcı durduruldu" description={fatal} />;
  }

  return (
    <div className="tekserp-designer flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
      <DesignerToolbar
        editor={editor}
        templateId={templateId}
        paper={paper}
        orientation={orientation}
        onPaper={setPaper}
        onOrientation={setOrientation}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-44 shrink-0 flex-col border-r bg-card" aria-label="Bloklar">
          <h3 className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bloklar</h3>
          <div ref={refs.blocks} className="tekserp-designer-blocks min-h-0 flex-1 overflow-y-auto" />
        </aside>
        <div ref={refs.area} className="flex min-w-0 flex-1 flex-col bg-muted/40">
          <CmRuler widthMm={dim.widthMm} left={frame.left} width={frame.width} />
          <div ref={refs.container} className="min-h-0 flex-1" />
        </div>
        <DesignerSidebar refs={refs} />
      </div>
    </div>
  );
}
