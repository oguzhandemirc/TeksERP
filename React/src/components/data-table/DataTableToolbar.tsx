import type { ReactNode } from "react";
import DataTableGlobalSearch from "./DataTableGlobalSearch";
import DataTableColumnFilter, {
  type ColumnFilterConfig,
} from "./DataTableColumnFilter";
import DataTableDateRangeFilter, {
  type DateRange,
} from "./DataTableDateRangeFilter";

interface DataTableToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ColumnFilterConfig[];
  activeFilters: Record<string, string | string[]>;
  onFilterChange: (id: string, value: string | string[]) => void;
  onFilterClear: (id: string) => void;
  onClearAll: () => void;
  dateRangeFilter?: {
    label: string;
    value: DateRange | null;
    onChange: (value: DateRange | null) => void;
  };
  actions?: ReactNode;
  children?: ReactNode;
}

function DataTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  filters,
  activeFilters,
  onFilterChange,
  onFilterClear,
  onClearAll,
  dateRangeFilter,
  actions,
  children,
}: DataTableToolbarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DataTableGlobalSearch
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
        />
        <div className="flex items-center gap-2">
          {actions}
          {children}
        </div>
      </div>

      {filters && filters.length > 0 && (
        <DataTableColumnFilter
          filters={filters}
          activeFilters={activeFilters}
          onFilterChange={onFilterChange}
          onFilterClear={onFilterClear}
          onClearAll={onClearAll}
        />
      )}

      {dateRangeFilter && (
        <DataTableDateRangeFilter
          label={dateRangeFilter.label}
          value={dateRangeFilter.value}
          onChange={dateRangeFilter.onChange}
        />
      )}
    </div>
  );
}

export default DataTableToolbar;
