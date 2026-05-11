import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  actions?: ReactNode;
}

export function DataTableToolbar({ search, onSearchChange, placeholder = "Ara...", actions }: Props) {
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
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}
