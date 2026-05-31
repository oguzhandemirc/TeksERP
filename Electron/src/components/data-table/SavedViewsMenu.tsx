import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Bookmark, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSavedViews } from "@/hooks/useSavedViews";

/**
 * Tablo araç çubuğunda "Görünümler" menüsü — mevcut filtre/sıralama/arama
 * durumunu (URL search string) isimlendirip kaydet, tek tıkla uygula, sil.
 * Tablo anahtarı = sayfa pathname; tercihler backend'e debounce'lu yazılır.
 *
 * Uygulama URL'i değiştirir; FilterBar ve arama kutusu (useDataTable URL→input
 * geri-senkronu sayesinde) anında yansır.
 */
export function SavedViewsMenu() {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { views, saveView, removeView } = useSavedViews(pathname);
  const [name, setName] = useState("");

  const current = searchParams.toString();
  const canSave = current.length > 0 && name.trim().length > 0;

  const apply = (query: string) => setSearchParams(new URLSearchParams(query));

  const handleSave = () => {
    if (!canSave) return;
    saveView(name.trim(), current);
    setName("");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Bookmark className="h-3.5 w-3.5" />
          Görünümler
          {views.length > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1 text-[10px] tabular-nums">
              {views.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Kayıtlı Görünümler</p>

        {views.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Henüz kayıtlı görünüm yok.</p>
        ) : (
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {views.map((v) => {
              const active = v.query === current;
              return (
                <li key={v.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => apply(v.query)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                      active && "text-primary",
                    )}
                  >
                    {active ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Bookmark className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    )}
                    <span className="truncate">{v.name}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeView(v.id)}
                    aria-label="Görünümü sil"
                    title="Görünümü sil"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-2 flex items-center gap-1.5 border-t pt-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder={current ? "Bu görünüme ad ver..." : "Önce filtre/sıralama uygula"}
            disabled={!current}
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8 gap-1 px-2" disabled={!canSave} onClick={handleSave}>
            <Plus className="h-3.5 w-3.5" />
            Kaydet
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
