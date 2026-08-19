import { useState } from "react";
import { CrudPage } from "@/components/layout/CrudPage";
import { Checkbox } from "@/components/ui/checkbox";
import { itemColumns } from "./columns";
import { itemService } from "./service";
import { ItemFormDialog } from "./ItemFormDialog";
import type { Item } from "./types";

export function ItemsPage() {
  // Saha (KK1) tarafından açılıp onay bekleyen desenleri süz.
  const [pendingOnly, setPendingOnly] = useState(false);
  return (
    <CrudPage<Item>
      title="Kumaşlar"
      description="Kumaş kataloğu — izinli renk ve özellik listesi opsiyoneldir."
      entityName="Kumaş"
      mergeEntity="item"
      importEntity="item"
      queryKey="items"
      service={itemService}
      columns={itemColumns}
      writePermission="item:write"
      searchPlaceholder="Kod veya ad ara..."
      extraFilters={pendingOnly ? { pendingReview: "true" } : undefined}
      filterBar={
        <label className="flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border bg-background px-3 text-xs">
          <Checkbox
            checked={pendingOnly}
            onCheckedChange={(c) => setPendingOnly(Boolean(c))}
          />
          Onay bekleyenler
        </label>
      }
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <ItemFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(payload) => onSubmit(payload as unknown as Partial<Item>)}
        />
      )}
    />
  );
}
