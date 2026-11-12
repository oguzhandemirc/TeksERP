import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RowMarkEntity } from "@/lib/row-mark-entities";
import { listMyRowMarkIds, ROW_MARK_COLORS, type RowMarkColor } from "@/services/rowMarkService";
import { ROW_MARK_COLOR_META } from "./colors";

/** Hiçbir kayda denk gelmeyen kimlik: işaretli kayıt yokken liste BOŞ döner (süzgeç düşmez). */
const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";
export type RowMarkFilterValue = RowMarkColor | "ANY" | null;

/**
 * "İşaretliler" süzgeci — kişinin işaretli kimlikleri `/mine`dan gelir, liste ucuna `filter[id]` olarak
 * gider (süzme SUNUCUDA). Yalnız `filter[id]`yi destekleyen listede kullan (bkz. filtre-liste.md).
 */
export function useRowMarkFilter(entity: RowMarkEntity) {
  const [value, setValue] = useState<RowMarkFilterValue>(null);
  const q = useQuery({
    queryKey: ["row-marks", "mine", entity, value],
    queryFn: () => listMyRowMarkIds(entity, value === "ANY" ? null : value),
    enabled: value !== null,
  });
  const filters = useMemo<Record<string, string> | undefined>(() => {
    if (value === null) return undefined;
    const ids = q.data?.recordIds ?? [];
    return { id: ids.length ? ids.join(",") : NO_MATCH_ID };
  }, [value, q.data]);
  return { value, setValue, filters, ready: value === null || q.isSuccess, truncated: q.data?.hasMore ?? false };
}

interface Props {
  value: RowMarkFilterValue;
  onChange: (v: RowMarkFilterValue) => void;
  truncated?: boolean;
}

/** Araç çubuğu çipleri: "İşaretliler" (hepsi) + beş renk; seçili çipe yeniden basmak süzgeci kaldırır. */
export function RowMarkFilter({ value, onChange, truncated }: Props) {
  const toggle = (v: Exclude<RowMarkFilterValue, null>) => onChange(value === v ? null : v);
  return (
    <div role="group" aria-label="İşaretliler süzgeci" className="flex items-center gap-1">
      <button
        type="button"
        aria-pressed={value === "ANY"}
        onClick={() => toggle("ANY")}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs motion-safe:transition-colors",
          value === "ANY" ? "border-primary bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-accent",
        )}
      >
        <Bookmark className="h-3.5 w-3.5" /> İşaretliler
      </button>
      {ROW_MARK_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={value === c}
          aria-label={`İşaretliler: ${ROW_MARK_COLOR_META[c].label}`}
          title={ROW_MARK_COLOR_META[c].label}
          onClick={() => toggle(c)}
          className={cn(
            "h-5 w-5 rounded-full border-2 motion-safe:transition-transform",
            ROW_MARK_COLOR_META[c].swatch,
            value === c ? "border-foreground motion-safe:scale-110" : "border-transparent opacity-70 hover:opacity-100",
          )}
        />
      ))}
      {truncated ? <span className="text-xs text-muted-foreground">ilk 200 kayıt</span> : null}
    </div>
  );
}
