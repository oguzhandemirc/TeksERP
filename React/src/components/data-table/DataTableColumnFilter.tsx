import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface FilterOption {
  label: string;
  value: string;
}

export interface ColumnFilterConfig {
  id: string;
  label: string;
  type: "text" | "select" | "multi-select";
  options?: FilterOption[];
}

interface DataTableColumnFilterProps {
  filters: ColumnFilterConfig[];
  activeFilters: Record<string, string | string[]>;
  onFilterChange: (id: string, value: string | string[]) => void;
  onFilterClear: (id: string) => void;
  onClearAll: () => void;
}

const DataTableColumnFilter = ({
  filters,
  activeFilters,
  onFilterChange,
  onFilterClear,
  onClearAll,
}: DataTableColumnFilterProps) => {
  const hasActiveFilters = Object.keys(activeFilters).some((key) => {
    const val = activeFilters[key];
    return val && (Array.isArray(val) ? val.length > 0 : val !== "");
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => {
          if (filter.type === "select" && filter.options) {
            return (
              <Select
                key={filter.id}
                value={(activeFilters[filter.id] as string) ?? ""}
                onChange={(e) => onFilterChange(filter.id, e.target.value)}
                options={filter.options}
                placeholder={filter.label}
                className="w-auto min-w-[140px]"
              />
            );
          }

          if (filter.type === "multi-select" && filter.options) {
            const currentValues = Array.isArray(activeFilters[filter.id])
              ? (activeFilters[filter.id] as string[])
              : [];

            return (
              <div key={filter.id} className="flex flex-wrap items-center gap-1">
                <Select
                  value=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val && !currentValues.includes(val)) {
                      onFilterChange(filter.id, [...currentValues, val]);
                    }
                  }}
                  options={filter.options.filter(
                    (o) => !currentValues.includes(o.value),
                  )}
                  placeholder={filter.label}
                  className="w-auto min-w-[140px]"
                />
                {currentValues.map((v) => (
                  <Badge key={v} variant="secondary" className="gap-1">
                    {filter.options?.find((o) => o.value === v)?.label ?? v}
                    <button
                      type="button"
                      onClick={() =>
                        onFilterChange(
                          filter.id,
                          currentValues.filter((cv) => cv !== v),
                        )
                      }
                      className="cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            );
          }

          return (
            <Input
              key={filter.id}
              value={(activeFilters[filter.id] as string) ?? ""}
              onChange={(e) => onFilterChange(filter.id, e.target.value)}
              placeholder={filter.label}
              className="w-auto min-w-[140px] max-w-[200px]"
            />
          );
        })}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClearAll}>
            <X className="h-4 w-4 mr-1" />
            Temizle
          </Button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(activeFilters).map(([key, val]) => {
            if (!val || (Array.isArray(val) && val.length === 0)) return null;
            const filterConfig = filters.find((f) => f.id === key);
            const displayValue = Array.isArray(val)
              ? val
                  .map(
                    (v) =>
                      filterConfig?.options?.find((o) => o.value === v)
                        ?.label ?? v,
                  )
                  .join(", ")
              : filterConfig?.options?.find((o) => o.value === val)?.label ??
                val;

            return (
              <Badge key={key} variant="outline" className="gap-1">
                <span className="text-muted-foreground">
                  {filterConfig?.label}:
                </span>
                {displayValue}
                <button
                  type="button"
                  onClick={() => onFilterClear(key)}
                  className="cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DataTableColumnFilter;
