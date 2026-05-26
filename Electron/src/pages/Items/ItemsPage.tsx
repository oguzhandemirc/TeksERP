import { CrudPage } from "@/components/layout/CrudPage";
import { itemColumns } from "./columns";
import { itemService } from "./service";
import { ItemFormDialog } from "./ItemFormDialog";
import type { Item } from "./types";

export function ItemsPage() {
  return (
    <CrudPage<Item>
      title="Ürünler"
      description="Ürün kataloğu — izinli renk ve özellik listesi opsiyoneldir."
      entityName="Ürün"
      queryKey="items"
      service={itemService}
      columns={itemColumns}
      writePermission="item:write"
      searchPlaceholder="Kod veya ad ara..."
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
