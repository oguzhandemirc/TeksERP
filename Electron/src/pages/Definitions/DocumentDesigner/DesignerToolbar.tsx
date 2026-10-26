import type { Editor } from "grapesjs";
import { Eraser, FileText, FileType2, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ORIENTATION_LABELS, PAPER_SIZES, type Orientation, type PaperSize } from "./editor/pageCanvas";
import type { ContractView } from "./binding/contract";
import { buildSampleDocument } from "./editor/sampleDocument";

interface Props {
  editor: Editor | null;
  templateId: string | null;
  docTypeLabel: string;
  onDocType: () => void;
  dirty: boolean;
  paper: PaperSize;
  orientation: Orientation;
  onPaper: (p: PaperSize) => void;
  onOrientation: (o: Orientation) => void;
  contract: ContractView | null;
  settings: Readonly<Record<string, unknown>>;
  internalFields: readonly string[];
}

/** Üst şerit: belge türü, taslak rozeti, kâğıt + yön, geri al/yinele, örnek belge, temizle. Kayıt/önizleme T4–T5'te. */
export function DesignerToolbar({ editor, templateId, docTypeLabel, onDocType, dirty, paper, orientation, onPaper, onOrientation, contract, settings, internalFields }: Props) {
  const loadSample = () => {
    if (!editor) return;
    const sample = buildSampleDocument(contract, settings, internalFields);
    editor.setComponents(sample.html);
    editor.setStyle(sample.css);
  };
  const clear = () => {
    if (!editor) return;
    editor.setComponents("");
    editor.setStyle("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
      {!templateId && <span className="mr-1 text-xs text-muted-foreground">Karalama · kaydedilmez</span>}
      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onDocType} disabled={!!templateId}
        title={templateId ? "Kayıtlı şablonun belge türü değişmez" : "Belge türünü değiştir"}>
        <FileType2 className="mr-1.5 h-3.5 w-3.5" /> Belge türü: {docTypeLabel}
      </Button>
      {dirty && (
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" data-testid="taslak-rozeti">
          Taslak · kaydedilince yeni sürüm
        </span>
      )}
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
