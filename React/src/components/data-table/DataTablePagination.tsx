import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  selectedCount?: number;
}

const PAGE_SIZE_OPTIONS = [
  { label: "10 / sayfa", value: "10" },
  { label: "20 / sayfa", value: "20" },
  { label: "50 / sayfa", value: "50" },
  { label: "100 / sayfa", value: "100" },
];

const DataTablePagination = ({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  selectedCount,
}: DataTablePaginationProps) => {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-4">
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        {selectedCount !== undefined && selectedCount > 0 && (
          <span>{selectedCount} satır seçili</span>
        )}
        <span>
          {total > 0
            ? `${from}–${to} / toplam ${total}`
            : "Kayıt bulunamadı"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={String(pageSize)}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          options={PAGE_SIZE_OPTIONS}
          className="w-auto"
        />

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(1)}
            disabled={page <= 1}
            aria-label="İlk sayfa"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Önceki sayfa"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="px-3 text-sm font-medium">
            {page} / {totalPages || 1}
          </span>

          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Sonraki sayfa"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
            aria-label="Son sayfa"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DataTablePagination;
