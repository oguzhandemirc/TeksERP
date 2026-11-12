import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchLabels } from "@/lib/search-placeholder";
import { cn } from "@/lib/utils";

/**
 * Araç çubuğu arama kutusu — `DataTableToolbar` kutusunun tek başına hâli (tabloyu kendi
 * başlığında çizen bölümler için). Kutuda kısa "Ara…", neyin arandığı `title`/`aria-label`da.
 */
export function ListSearchBox({
  value,
  onSearchChange,
  searchHint,
  placeholder,
  className,
}: {
  value: string;
  onSearchChange: (value: string) => void;
  searchHint: string;
  placeholder?: string;
  className?: string;
}) {
  const labels = searchLabels(placeholder, searchHint);
  return (
    <div className={cn("relative w-full sm:w-56", className)}>
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={labels.placeholder}
        title={labels.hint}
        aria-label={labels.hint}
        maxLength={100}
        className="h-8 pl-8 text-sm"
      />
    </div>
  );
}
