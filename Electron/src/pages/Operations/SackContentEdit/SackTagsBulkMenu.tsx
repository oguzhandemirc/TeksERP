import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bookmark, Loader2, Minus, Check, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { isDarkHex, sackTagService } from "@/pages/SackTags/service";
import { sackHubService } from "./service";
import {
  buildBulkPayload,
  checkboxView,
  nextIntent,
  summarizeBulkResult,
  tagTriState,
  type TagIntent,
} from "./sackTagBulk";
import type { SackSearchRow } from "./types";

/**
 * TOPLU İZ POPOVER'I — seçili çuvallara tek hamlede iz bırak/kaldır.
 *
 * ⚠️ TEK POPOVER, iki ayrı "Bırak"/"Kaldır" tuşu DEĞİL: operatör aynı seçimde
 * hem ekleyip hem kaldırıyor (yeniden etiketleme tek hamledir) ve uç bunu tek
 * çağrıda kabul ediyor.
 *
 * ⚠️ Kutucuklar ÜÇ DURUMLU (hepsinde / bazısında / hiçbirinde) — gerekçe
 * `sackTagBulk.ts` başlığında; iki durumlu kutucuk "kaldırdım" ile
 * "dokunmadım"ı ayırt ettirmez.
 *
 * ⚠️ Sonuç PARÇALI olabilir (`skipped`) — sevk edilmiş çuval atlanır ve bu
 * SESSİZCE YUTULMAZ, uyarı toast'ıyla söylenir.
 */
export function SackTagsBulkMenu({
  rows,
  onDone,
  compact,
  packingGroupId,
  triggerLabel,
}: {
  rows: SackSearchRow[];
  /** İş bitince çağrılır — çağıran `table.resetRowSelection()` yapar. */
  onDone: () => void;
  /** Satır içi HIZLI İZ tuşu — ikon boyutunda, metinsiz. */
  compact?: boolean;
  /**
   * Grup kapsamı — verilirse iz GRUBUN TÜM havuz çuvallarına uygulanır ve
   * id'leri sunucu çözer. `rows` yalnız kutucukların üç-durumlu görünümünü
   * kurmak için kullanılır (ekrandaki örneklem).
   */
  packingGroupId?: string;
  triggerLabel?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [intents, setIntents] = useState<Record<string, TagIntent>>({});
  const [removeAll, setRemoveAll] = useState(false);

  const q = useQuery({
    queryKey: ["sack-tags", "active"],
    queryFn: () => sackTagService.list(false),
    staleTime: 60_000,
    enabled: open,
  });
  const tags = q.data ?? [];

  const reset = () => {
    setIntents({});
    setRemoveAll(false);
  };

  const sackIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const payload = buildBulkPayload(sackIds, intents, removeAll);

  const apply = useMutation({
    // Grup kapsamında çuval id'lerini SUNUCU çözer — `sackIds` gönderilmez.
    mutationFn: () =>
      sackHubService.bulkTags(
        packingGroupId ? { ...payload!, sackIds: [], packingGroupId } : payload!,
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["sack-search"] });
      const s = summarizeBulkResult(res.data);
      if (s.tone === "warning") toast.warning(s.title, { description: s.description, duration: 8000 });
      else toast.success(s.title);
      setOpen(false);
      reset();
      onDone();
    },
    onError: (err: Error) => toast.error("İz uygulanamadı", { description: err.message }),
  });

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        {compact ? (
          // HIZLI İZ — satır içi ikon tuşu. Katalog sorgusu yalnız popover
          // AÇILINCA koşar (`enabled: open`), yani her satır bir istek atmaz.
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0 opacity-60 hover:opacity-100"
            title="İz bırak / kaldır"
            onClick={(e) => e.stopPropagation()} // satır tıklaması editörü açmasın
          >
            <Bookmark className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            // Grup kapsamında seçim GEREKMEZ — kapsamı sunucu çözer.
            disabled={!packingGroupId && rows.length === 0}
          >
            <Bookmark className="h-4 w-4" /> {triggerLabel ?? `İz (${rows.length})`}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="border-b px-3 py-2">
          <div className="text-sm font-medium">
            {packingGroupId
              ? "Grubun TÜM çuvallarına iz"
              : compact
                ? "Bu çuvala iz"
                : `Seçili ${rows.length} çuvala iz`}
          </div>
          <div className="text-xs text-muted-foreground">
            Kutuya dokundukça: bırak → kaldır → dokunma.
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          {q.isLoading ? (
            <div className="space-y-1 p-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          ) : tags.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Tanımlı etiket yok — Tanımlar › Çuval İzleri ekranından ekleyin.
            </p>
          ) : (
            tags.map((tag) => {
              const state = tagTriState(rows, tag.id);
              const intent = intents[tag.id] ?? "keep";
              const view = checkboxView(state, intent);
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={removeAll}
                  onClick={() =>
                    setIntents((prev) => ({ ...prev, [tag.id]: nextIntent(state, prev[tag.id] ?? "keep") }))
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                    removeAll && "opacity-40",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                      view.checked && "border-primary bg-primary text-primary-foreground",
                      view.indeterminate && "border-primary bg-primary/30",
                    )}
                  >
                    {view.checked && <Check className="size-3" />}
                    {view.indeterminate && <Minus className="size-3" />}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: tag.hex, color: isDarkHex(tag.hex) ? "#fff" : "#000" }}
                  >
                    {tag.name}
                  </span>
                  {/* Niyet ETİKETİ — "kaldırılacak" ile "hiç yok" aynı boş kutuyla
                      çizildiği için, kararın metni olmadan üç durum görünmez olurdu. */}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {intent === "add"
                      ? "bırakılacak"
                      : intent === "remove"
                        ? "kaldırılacak"
                        : state === "all"
                          ? "hepsinde"
                          : state === "some"
                            ? "bazısında"
                            : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t p-1">
          <button
            type="button"
            onClick={() => {
              setRemoveAll((v) => !v);
              // ⚠️ "Tümünü kaldır" açılınca tek tek kaldırmalar DÜŞER: sunucu
              // `removeAll` + `remove` çiftini 400 ile reddeder (niyeti sessizce
              // seçmez). Ekleme niyetleri korunur — "temizle, sonra şunu bırak"
              // meşru bir hamle.
              setIntents((prev) =>
                Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== "remove")),
              );
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
              removeAll && "bg-destructive/10 text-destructive",
            )}
          >
            <Trash2 className="size-4" />
            Tüm etiketleri kaldır
            {removeAll && <Check className="ml-auto size-3.5" />}
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t p-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Vazgeç
          </Button>
          <Button size="sm" disabled={!payload || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Uygula
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
