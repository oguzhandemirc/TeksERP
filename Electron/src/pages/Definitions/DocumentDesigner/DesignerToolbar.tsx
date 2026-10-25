import type { Editor } from "grapesjs";
import { Eraser, FileText, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ORIENTATION_LABELS, PAPER_SIZES, type Orientation, type PaperSize } from "./editor/pageCanvas";
import { SAMPLE_DOCUMENT_CSS, SAMPLE_DOCUMENT_HTML } from "./editor/sampleDocument";

interface Props {
  editor: Editor | null;
  templateId: string | null;
  paper: PaperSize;
  orientation: Orientation;
  onPaper: (p: PaperSize) => void;
  onOrientation: (o: Orientation) => void;
}

/** Üst şerit: kâğıt + yön, geri al/yinele, örnek belge, temizle. Kayıt/önizleme T4–T5'te eklenir. */
export function DesignerToolbar({ editor, templateId, paper, orientation, onPaper, onOrientation }: Props) {
  const loadSample = () => {
    if (!editor) return;
    editor.setComponents(SAMPLE_DOCUMENT_HTML);
    editor.setStyle(SAMPLE_DOCUMENT_CSS);
  };
  const clear = () => {
    if (!editor) return;
    editor.setComponents("");
    editor.setStyle("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
      <span className="mr-1 text-xs text-muted-foreground">
        {templateId ? `Şablon ${templateId.slice(0, 8)}` : "Yeni şablon · kaydedilmedi"}
      </span>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Kâğıt
        <Select value={paper} onValueChange={(v) => onPaper(v as PaperSize)}>
          <SelectTrigger className="h-8 w-24 text-xs" aria-label="Kâğıt boyu">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PAPER_SIZES) as PaperSize[]).map((k) => (
              <SelectItem key={k} value={k}>{PAPER_SIZES[k].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Sayfa yönü">
        {(Object.keys(ORIENTATION_LABELS) as Orientation[]).map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={orientation === o}
            onClick={() => onOrientation(o)}
            className={cn("px-3 py-1.5 text-xs", orientation === o ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {ORIENTATION_LABELS[o]}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" variant="ghost" title="Geri al" aria-label="Geri al" disabled={!editor} onClick={() => editor?.UndoManager.undo()}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" title="Yinele" aria-label="Yinele" disabled={!editor} onClick={() => editor?.UndoManager.redo()}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" disabled={!editor} onClick={loadSample}>
          <FileText className="mr-1.5 h-4 w-4" /> Örnek belge yükle
        </Button>
        <Button size="sm" variant="outline" disabled={!editor} onClick={clear}>
          <Eraser className="mr-1.5 h-4 w-4" /> Temizle
        </Button>
      </div>
    </div>
  );
}
