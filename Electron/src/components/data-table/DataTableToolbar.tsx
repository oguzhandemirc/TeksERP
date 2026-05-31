import type { ReactNode } from "react";
import { Search } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { SavedViewsMenu } from "./SavedViewsMenu";
import { DataTableTools } from "./DataTableTools";

interface Props<T> {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  actions?: ReactNode;
  /** Verilirse "Sütunlar & CSV" araç menüsü gösterilir. */
  table?: Table<T>;
  exportName?: string;
}

export function DataTableToolbar<T>({
  search,
  onSearchChange,
  placeholder = "Ara...",
  actions,
  table,
  exportName,
}: Props<T>) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b">
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {table ? <DataTableTools table={table} exportName={exportName} /> : null}
        <SavedViewsMenu />
        {actions}
      </div>
    </div>
  );
}
