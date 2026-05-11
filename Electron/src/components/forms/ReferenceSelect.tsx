import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CrudService } from "@/services/crudService";

const NULL_SENTINEL = "__none__";
const PAGE_SIZE = 50;
const DEBOUNCE_MS = 200;

interface Props<T extends { id: string }> {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  service: CrudService<T>;
  queryKey: string;
  getLabel: (item: T) => string;
  placeholder?: string;
  nullable?: boolean;
  noneLabel?: string;
  /** Backend filter'larına eklenir. Örn: { isDerived: "true" }. */
  extraFilters?: Record<string, string>;
  disabled?: boolean;
}

export function ReferenceSelect<T extends { id: string }>({
  value,
  onChange,
  service,
  queryKey,
  getLabel,
  placeholder = "Seç...",
  nullable,
  noneLabel = "— (yok)",
  extraFilters,
  disabled,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [labelCache, setLabelCache] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!open) setSearchInput("");
  }, [open]);

  const listQuery = useQuery({
    queryKey: [queryKey, "ref-select", debouncedSearch, extraFilters],
    queryFn: () =>
      service.getAll({
        page: 1,
        pageSize: PAGE_SIZE,
        sortBy: "name",
        sortOrder: "asc",
        search: debouncedSearch || undefined,
        filters: { isActive: "true", ...extraFilters },
      }),
    staleTime: 30_000,
  });

  const items = listQuery.data?.data ?? [];
  const needsSelectedFetch = !!value && !labelCache.has(value);

  const selectedQuery = useQuery({
    queryKey: [queryKey, "ref-select-by-id", value],
    queryFn: () => service.getById(value as string),
    enabled: needsSelectedFetch,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const fromList = listQuery.data?.data ?? [];
    const fromSelected = selectedQuery.data?.data;
    if (fromList.length === 0 && !fromSelected) return;
    setLabelCache((prev) => {
      const next = new Map(prev);
      let changed = false;
      const upsert = (item: T) => {
        const label = getLabel(item);
        if (next.get(item.id) !== label) {
          next.set(item.id, label);
          changed = true;
        }
      };
      for (const item of fromList) upsert(item);
      if (fromSelected) upsert(fromSelected);
      return changed ? next : prev;
    });
  }, [listQuery.data?.data, selectedQuery.data?.data, getLabel]);

  const selectedLabel = value ? labelCache.get(value) : undefined;
  const triggerText =
    selectedLabel ??
    (needsSelectedFetch && selectedQuery.isLoading ? "Yükleniyor..." : placeholder);

  const showEmpty =
    !listQuery.isLoading && items.length === 0 && !(nullable && debouncedSearch.length === 0);

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selectedLabel && "text-muted-foreground",
          )}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="pointer-events-auto w-[--radix-popover-trigger-width] p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Ara (kod, isim, vergi no)..."
            value={searchInput}
            onValueChange={setSearchInput}
          />
          <CommandList>
            {showEmpty && (
              <CommandEmpty>
                {listQuery.isFetching ? "Aranıyor..." : "Sonuç yok."}
              </CommandEmpty>
            )}
            <CommandGroup>
              {nullable && debouncedSearch.length === 0 && (
                <CommandItem
                  value={NULL_SENTINEL}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value == null ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {noneLabel}
                </CommandItem>
              )}
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={(currentValue) => {
                    onChange(currentValue);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === item.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{getLabel(item)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
