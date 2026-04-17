import { cn } from "@/lib/utils";

interface DataTableSkeletonProps {
  columnCount: number;
  rowCount?: number;
  hasToolbar?: boolean;
}

const DataTableSkeleton = ({
  columnCount,
  rowCount = 10,
  hasToolbar = true,
}: DataTableSkeletonProps) => {
  return (
    <div className="space-y-4">
      {hasToolbar && (
        <div className="flex items-center justify-between gap-4">
          <div className="h-10 w-64 animate-pulse rounded-md bg-muted" />
          <div className="flex gap-2">
            <div className="h-10 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-10 w-24 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      )}
      <div className="rounded-md border">
        <div className="border-b">
          <div className="flex h-12">
            {Array.from({ length: columnCount }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex-1 px-4 py-3",
                  i < columnCount - 1 && "border-r",
                )}
              >
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
        {Array.from({ length: rowCount }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className={cn("flex h-14", rowIndex < rowCount - 1 && "border-b")}
          >
            {Array.from({ length: columnCount }).map((_, colIndex) => (
              <div
                key={colIndex}
                className={cn(
                  "flex-1 px-4 py-4",
                  colIndex < columnCount - 1 && "border-r",
                )}
              >
                <div
                  className="h-4 animate-pulse rounded bg-muted"
                  style={{ width: `${50 + Math.random() * 40}%` }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DataTableSkeleton;
