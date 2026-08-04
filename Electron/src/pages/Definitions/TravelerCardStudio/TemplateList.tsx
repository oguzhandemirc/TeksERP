import { Check, FileCode2, LayoutTemplate, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TravelerTemplate } from "./types";

const MODE_META = {
  BUILTIN: { icon: Check, label: "Yerleşik" },
  SECTIONS: { icon: LayoutTemplate, label: "Stüdyo" },
  RAW_HTML: { icon: FileCode2, label: "Uzman" },
} as const;

/**
 * Şablon listesi. En üstte HER ZAMAN "Yerleşik Kart" satırı durur — bu bir
 * şablon DEĞİL, "hiç şablon kullanma" seçeneğidir (varsayılanı kaldırır).
 * Görünür bir satır olması bilinçli: kullanıcının yerleşiğe dönüş yolu her
 * zaman gözünün önünde olmalı, menü altında değil.
 */
export function TemplateList({
  templates,
  selectedId,
  onSelect,
  onNew,
  onSetDefault,
  onClearDefault,
  onDelete,
  busy,
}: {
  templates: TravelerTemplate[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  onSetDefault: (id: string) => void;
  onClearDefault: () => void;
  onDelete: (t: TravelerTemplate) => void;
  busy?: boolean;
}) {
  const anyDefault = templates.some((t) => t.isDefault);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Şablonlar
        </span>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1" disabled={busy} onClick={onNew}>
          <Plus className="h-3.5 w-3.5" /> Yeni
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pr-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "w-full rounded-md border p-2 text-left hover:bg-muted/50",
            selectedId === null && "border-primary bg-primary/5",
          )}
        >
          <div className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">Yerleşik Kart</span>
            {!anyDefault && (
              <Badge variant="secondary" className="ml-auto px-1 py-0 text-[9px]">
                kullanımda
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Hiç şablon kullanma — kart bugünkü yerleşimiyle basılır.
          </p>
        </button>

        {templates.map((t) => {
          const Icon = MODE_META[t.mode].icon;
          return (
            <div
              key={t.id}
              className={cn(
                "rounded-md border p-2",
                selectedId === t.id && "border-primary bg-primary/5",
              )}
            >
              <button type="button" onClick={() => onSelect(t.id)} className="w-full text-left">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  {t.isDefault && (
                    <Badge className="ml-auto shrink-0 px-1 py-0 text-[9px]">varsayılan</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {MODE_META[t.mode].label}
                  {!t.isActive && " · pasif"}
                </p>
              </button>
              {selectedId === t.id && (
                <div className="mt-2 flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 flex-1 gap-1 text-[11px]"
                    disabled={busy || t.isDefault}
                    onClick={() => onSetDefault(t.id)}
                  >
                    <Star className="h-3 w-3" /> Varsayılan yap
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 text-[11px] text-destructive"
                    disabled={busy}
                    onClick={() => onDelete(t)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {anyDefault && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 text-[11px] text-muted-foreground"
          disabled={busy}
          onClick={onClearDefault}
        >
          Yerleşiğe dön (varsayılanı kaldır)
        </Button>
      )}
    </div>
  );
}
