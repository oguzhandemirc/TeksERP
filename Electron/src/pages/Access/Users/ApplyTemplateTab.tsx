import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { permissionTemplateService } from "@/services/permissionTemplateService";
import { adminUserService } from "@/services/adminUserService";
import { cn } from "@/lib/utils";

interface Props {
  userId: string;
}

type Mode = "merge" | "replace";

export function ApplyTemplateTab({ userId }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("merge");

  const templates = useQuery({
    queryKey: ["permission-templates"],
    queryFn: permissionTemplateService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const mutation = useMutation({
    mutationFn: ({ tid, m }: { tid: string; m: Mode }) =>
      adminUserService.applyTemplate(userId, tid, m),
    onSuccess: () => {
      toast.success(mode === "replace" ? "Yetkiler şablonla değiştirildi." : "Şablon eklendi.");
      void qc.invalidateQueries({ queryKey: ["admin-user-permissions", userId] });
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      setSelected(null);
    },
  });

  if (templates.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const list = templates.data?.data ?? [];

  if (list.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Tanımlı yetki şablonu yok.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Şablon seç
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              className={cn(
                "text-left transition-colors",
                selected === t.id ? "ring-2 ring-ring" : "",
              )}
            >
              <Card className="p-3 hover:border-foreground/20">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                    <Layers className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.name}</span>
                      <Badge variant="muted" className="font-normal">
                        {t.permissions.length} yetki
                      </Badge>
                    </div>
                    {t.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {t.description}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Uygulama biçimi
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("merge")}
            className={cn(
              "flex-1 rounded-md border p-3 text-left transition-colors",
              mode === "merge" ? "border-primary bg-accent/50" : "hover:bg-accent/30",
            )}
          >
            <div className="text-sm font-medium">Ekle (merge)</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Mevcut yetkiler korunur, eksik olanlar eklenir.
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("replace")}
            className={cn(
              "flex-1 rounded-md border p-3 text-left transition-colors",
              mode === "replace"
                ? "border-destructive/40 bg-destructive/10"
                : "hover:bg-accent/30",
            )}
          >
            <div className="text-sm font-medium">Değiştir (replace)</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Mevcut yetkiler tamamen silinir, sadece şablondaki kalır.
            </div>
          </button>
        </div>
      </div>

      <div className="flex justify-end border-t pt-3">
        <Button
          type="button"
          size="sm"
          disabled={!selected || mutation.isPending}
          onClick={() => selected && mutation.mutate({ tid: selected, m: mode })}
        >
          {mutation.isPending ? "Uygulanıyor..." : "Şablonu Uygula"}
        </Button>
      </div>
    </div>
  );
}
