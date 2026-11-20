import { ArrowUpRight, Crop, EyeOff, Highlighter, Pen, Redo2, Square, Trash2, Type, Undo2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Tool } from "./model";
import { COLORS, WIDTHS, type Annotator } from "./useAnnotator";

const TOOLS: { tool: Tool; label: string; icon: LucideIcon }[] = [
  { tool: "pen", label: "Kalem", icon: Pen },
  { tool: "arrow", label: "Ok", icon: ArrowUpRight },
  { tool: "rect", label: "Dikdörtgen", icon: Square },
  { tool: "highlight", label: "Vurgulayıcı", icon: Highlighter },
  { tool: "text", label: "Metin", icon: Type },
  { tool: "redact", label: "Karart (gizle)", icon: EyeOff },
  { tool: "crop", label: "Kırp", icon: Crop },
];

const COLOR_NAMES: Record<string, string> = {
  "#ef4444": "Kırmızı",
  "#f59e0b": "Sarı",
  "#2563eb": "Mavi",
  "#111111": "Siyah",
};

const WIDTH_NAMES = ["İnce", "Orta", "Kalın"];

export function AnnotateToolbar({ a }: { a: Annotator }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Çizim araçları">
      {TOOLS.map(({ tool, label, icon: Icon }) => (
        <Button
          key={tool}
          type="button"
          size="icon"
          variant={a.tool === tool ? "default" : "outline"}
          aria-label={label}
          aria-pressed={a.tool === tool}
          title={label}
          onClick={() => a.setTool(tool)}
        >
          <Icon className="h-4 w-4" />
        </Button>
      ))}
      <span className="mx-1 h-6 w-px bg-border" aria-hidden />
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Renk: ${COLOR_NAMES[c]}`}
          aria-pressed={a.color === c}
          title={COLOR_NAMES[c]}
          onClick={() => a.setColor(c)}
          className={cn(
            "h-7 w-7 rounded-full border-2 transition-transform",
            a.color === c ? "scale-110 border-foreground" : "border-transparent",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      <span className="mx-1 h-6 w-px bg-border" aria-hidden />
      {WIDTHS.map((w, i) => (
        <Button
          key={w}
          type="button"
          size="sm"
          variant={a.width === w ? "secondary" : "ghost"}
          aria-pressed={a.width === w}
          onClick={() => a.setWidth(w)}
        >
          {WIDTH_NAMES[i]}
        </Button>
      ))}
      <span className="mx-1 h-6 w-px bg-border" aria-hidden />
      <Button type="button" size="icon" variant="ghost" aria-label="Geri al" title="Geri al (Ctrl+Z)" disabled={!a.canUndo} onClick={a.undo}>
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" aria-label="Yinele" title="Yinele (Ctrl+Y)" disabled={!a.canRedo} onClick={a.redo}>
        <Redo2 className="h-4 w-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" aria-label="Temizle" title="Hepsini temizle" onClick={a.clear}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
