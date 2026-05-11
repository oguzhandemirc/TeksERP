import { useState, useEffect } from "react";
import { HexColorPicker } from "react-colorful";
import { Pipette, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Önerilen palet — chip olarak görünür. */
  presets?: string[];
  /** Boş bırakılabilir — true ise "Temizle" butonu çıkar. */
  clearable?: boolean;
  className?: string;
}

const DEFAULT_PRESETS = [
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#f59e0b", // amber-500
  "#eab308", // yellow-500
  "#84cc16", // lime-500
  "#22c55e", // green-500
  "#10b981", // emerald-500
  "#14b8a6", // teal-500
  "#06b6d4", // cyan-500
  "#0ea5e9", // sky-500
  "#3b82f6", // blue-500
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#a855f7", // purple-500
  "#d946ef", // fuchsia-500
  "#ec4899", // pink-500
  "#f43f5e", // rose-500
  "#64748b", // slate-500
  "#374151", // gray-700
  "#000000",
];

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalize(v: string): string {
  if (!v) return "";
  const t = v.trim();
  if (!t) return "";
  return t.startsWith("#") ? t.toLowerCase() : `#${t.toLowerCase()}`;
}

export function ColorPickerInput({
  value,
  onChange,
  placeholder = "#1d4ed8",
  presets = DEFAULT_PRESETS,
  clearable = true,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? "");

  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  const isValid = text === "" || HEX_RE.test(text);
  const swatch = isValid && text ? normalize(text) : null;

  const commit = (next: string) => {
    setText(next);
    if (next === "" || HEX_RE.test(next)) {
      onChange(normalize(next));
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex-1">
        <Input
          value={text}
          onChange={(e) => commit(e.target.value)}
          placeholder={placeholder}
          className={cn("pr-8 font-mono text-xs", !isValid && "border-destructive")}
        />
        {clearable && text && (
          <button
            type="button"
            onClick={() => commit("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Temizle"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="relative h-9 w-9 shrink-0 overflow-hidden p-0"
            aria-label="Renk paletinden seç"
          >
            {swatch ? (
              <span className="block h-full w-full" style={{ backgroundColor: swatch }} />
            ) : (
              <Pipette className="h-3.5 w-3.5" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
          <div className="space-y-3">
            <HexColorPicker
              color={swatch ?? "#1d4ed8"}
              onChange={(c) => commit(c)}
              style={{ width: 200, height: 160 }}
            />
            <Input
              value={text}
              onChange={(e) => commit(e.target.value)}
              placeholder={placeholder}
              className="font-mono text-xs"
            />
            <div>
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Hızlı seçim
              </div>
              <div className="grid grid-cols-10 gap-1">
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    title={p}
                    onClick={() => commit(p)}
                    className={cn(
                      "h-5 w-5 rounded border transition-transform hover:scale-110",
                      normalize(text) === p.toLowerCase() && "ring-2 ring-ring ring-offset-1",
                    )}
                    style={{ backgroundColor: p }}
                  />
                ))}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
