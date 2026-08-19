import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { foldSearchText } from "@/lib/search-fold";

export interface MultiSelectItem {
  id: string;
  label: string;
  /** Opsiyonel grup başlığı — verilirse renderda gruplanır. */
  group?: string;
  /** İkinci satır küçük gri açıklama. */
  hint?: string;
  /** Sol başta bir renk noktası (örn. hex) */
  swatch?: string | null;
}

interface Props {
  items: MultiSelectItem[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyHint?: string;
  disabled?: boolean;
  className?: string;
  /** Liste sütun sayısı — geniş modallarda 2/3 kullanılabilir. Default 1. */
  columns?: 1 | 2 | 3;
}

const COLUMN_CLASSES: Record<1 | 2 | 3, string> = {
  1: "",
  2: "grid grid-cols-2 gap-x-2",
  3: "grid grid-cols-2 lg:grid-cols-3 gap-x-2",
};

export function MultiSelectCheckboxList({
  items,
  value,
  onChange,
  placeholder = "Ara...",
  emptyHint,
  disabled,
  className,
  columns = 1,
}: Props) {
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const filtered = items.filter((i) => {
      if (!search) return true;
      const q = foldSearchText(search);
      return (
        foldSearchText(i.label).includes(q) ||
        foldSearchText(i.hint ?? "").includes(q) ||
        foldSearchText(i.group ?? "").includes(q)
      );
    });
    const map = new Map<string, MultiSelectItem[]>();
    for (const it of filtered) {
      const key = it.group ?? "";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [items, search]);

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (id: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  const setMany = (ids: string[], on: boolean) => {
    if (disabled) return;
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(Array.from(next));
  };

  const totalVisible = Array.from(grouped.values()).reduce((a, l) => a + l.length, 0);
  // Görünür (aramayla filtrelenmiş) öğelerin id'leri — "Tümünü seç" bunları seçer.
  const visibleIds = useMemo(
    () => Array.from(grouped.values()).flat().map((i) => i.id),
    [grouped],
  );
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  return (
    <div className={cn("flex h-full flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{value.length}</span> / {items.length} seçili
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || visibleIds.length === 0 || allVisibleSelected}
          onClick={() => setMany(visibleIds, true)}
        >
          Tümünü seç
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || value.length === 0}
          onClick={() => onChange([])}
        >
          Temizle
        </Button>
      </div>

      {/* [contain:content]: Chromium, statik iç scroller'ın içerik yüksekliğini üstteki
          dialog'un scrollHeight'ına sızdırıyor → modal boşluğa kayıyordu (kalabalık
          listede "Yeni Renk" scroll hatası). Containment sınırı sızıntıyı keser. */}
      <div className="flex-1 overflow-auto rounded-md border [contain:content]">
        {totalVisible === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {emptyHint ?? "Eşleşen kayıt yok."}
          </div>
        ) : (
          <div className="divide-y">
            {Array.from(grouped.entries()).map(([group, list]) => {
              const ids = list.map((i) => i.id);
              const allChecked = ids.every((id) => selected.has(id));
              const someChecked = ids.some((id) => selected.has(id));

              return (
                <section key={group || "_"}>
                  {group && (
                    <div className="sticky top-0 z-10 flex items-center gap-2 bg-card/90 px-3 py-2 backdrop-blur">
                      <Checkbox
                        checked={allChecked ? true : someChecked ? "indeterminate" : false}
                        onCheckedChange={(c) => setMany(ids, Boolean(c))}
                        disabled={disabled}
                      />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group}
                      </span>
                      <Badge variant="muted" className="font-normal">
                        {ids.length}
                      </Badge>
                    </div>
                  )}
                  <ul className={cn("px-1 py-1", COLUMN_CLASSES[columns])}>
                    {list.map((it) => {
                      const checked = selected.has(it.id);
                      return (
                        <li key={it.id}>
                          <label
                            className={cn(
                              "flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-accent/50",
                              disabled && "cursor-not-allowed opacity-60",
                            )}
                          >
                            <Checkbox
                              className="mt-0.5"
                              checked={checked}
                              onCheckedChange={() => toggle(it.id)}
                              disabled={disabled}
                            />
                            {it.swatch && (
                              <span
                                className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border"
                                style={{ backgroundColor: it.swatch }}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm">{it.label}</div>
                              {it.hint && (
                                <div className="line-clamp-1 text-xs text-muted-foreground">{it.hint}</div>
                              )}
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
