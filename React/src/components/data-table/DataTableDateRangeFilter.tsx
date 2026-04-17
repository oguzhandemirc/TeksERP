import { Calendar, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { tr } from "date-fns/locale";

interface DateRange {
  from: string;
  to: string;
}

interface DataTableDateRangeFilterProps {
  label: string;
  value: DateRange | null;
  onChange: (value: DateRange | null) => void;
}

const DataTableDateRangeFilter = ({
  label,
  value,
  onChange,
}: DataTableDateRangeFilterProps) => {
  const formatDisplay = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd MMM yyyy", { locale: tr });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
      <Input
        type="date"
        value={value?.from ?? ""}
        onChange={(e) =>
          onChange(
            e.target.value
              ? { from: e.target.value, to: value?.to ?? "" }
              : null,
          )
        }
        className="w-auto"
        aria-label={`${label} başlangıç`}
      />
      <span className="text-muted-foreground text-sm">—</span>
      <Input
        type="date"
        value={value?.to ?? ""}
        onChange={(e) =>
          onChange(
            e.target.value
              ? { from: value?.from ?? "", to: e.target.value }
              : null,
          )
        }
        className="w-auto"
        aria-label={`${label} bitiş`}
      />
      {value && (value.from || value.to) && (
        <Badge variant="outline" className="gap-1 shrink-0">
          {value.from && formatDisplay(value.from)}
          {value.from && value.to && " – "}
          {value.to && formatDisplay(value.to)}
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 p-0"
            onClick={() => onChange(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      )}
    </div>
  );
};

export type { DateRange };
export default DataTableDateRangeFilter;
