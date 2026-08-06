import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, Plus, Replace } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { permissionTemplateService } from "@/services/permissionTemplateService";
import { cn } from "@/lib/utils";

type Mode = "merge" | "replace";

interface Props {
  onApply: (permissionIds: string[], mode: Mode) => void;
  disabled?: boolean;
}

/** Yetkiler gridinin sağındaki şablon listesi — tıklanınca seçimi (kaydetmeden) günceller. */
export function TemplateApplyPanel({ onApply, disabled }: Props) {
  const [mode, setMode] = useState<Mode>("merge");

  const templates = useQuery({
    queryKey: ["permission-templates"],
    queryFn: permissionTemplateService.list,
    staleTime: 5 * 60 * 1000,
  });

  // Pasif rol = "bu paketi kullanmıyoruz" kararı; uygulama listesinde durmamalı.
  // Backend de pasif şablonun uygulanmasını 400 ile reddeder — iki katman aynı
  // şeyi söyler, liste "uygulanabilir" göstermez.
  const list = (templates.data?.data ?? []).filter((t) => t.isActive);

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 rounded-md border">
      <div className="shrink-0 space-y-2 border-b p-2.5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Şablon Uygula
        </div>
        <div className="flex gap-1 rounded-md border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setMode("merge")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-sm py-1.5 text-xs font-medium transition-colors",
              mode === "merge"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            <Plus className="h-3.5 w-3.5" /> Ekle
          </button>
          <button
            type="button"
            onClick={() => setMode("replace")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-sm py-1.5 text-xs font-medium transition-colors",
              mode === "replace"
                ? "bg-destructive text-destructive-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            <Replace className="h-3.5 w-3.5" /> Değiştir
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
        {templates.isLoading ? (
          <div className="space-y-2 pt-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex h-24 items-center justify-center px-2 text-center text-xs text-muted-foreground">
            Tanımlı yetki şablonu yok.
          </div>
        ) : (
          <div className="space-y-1.5 pt-2">
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                onClick={() => onApply(t.permissions.map((p) => p.permissionId), mode)}
                className="w-full rounded-md border p-2 text-left transition-colors hover:border-foreground/20 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Layers className="h-3 w-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{t.name}</span>
                      <Badge variant="muted" className="shrink-0 font-normal">
                        {t.permissions.length}
                      </Badge>
                    </div>
                    {t.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {t.description}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
