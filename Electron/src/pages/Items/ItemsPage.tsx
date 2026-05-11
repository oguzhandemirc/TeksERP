import { useState } from "react";
import { CrudPage } from "@/components/layout/CrudPage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { itemColumns } from "./columns";
import { itemService } from "./service";
import { ItemFormDialog } from "./ItemFormDialog";
import type { Item } from "./types";

type DerivedFilter = "all" | "ham" | "final";

export function ItemsPage() {
  const [derived, setDerived] = useState<DerivedFilter>("all");

  const extraFilters: Record<string, string> | undefined =
    derived === "all" ? undefined : { isDerived: derived === "final" ? "true" : "false" };

  return (
    <CrudPage<Item>
      title="Ürünler"
      description="Ham → stok girişi; Final → müşteri siparişi."
      entityName="Ürün"
      queryKey="items"
      service={itemService}
      columns={itemColumns}
      writePermission="item:write"
      searchPlaceholder="Kod veya ad ara..."
      extraFilters={extraFilters}
      filterBar={
        <Select value={derived} onValueChange={(v) => setDerived(v as DerivedFilter)}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tümü</SelectItem>
            <SelectItem value="ham">Sadece Ham</SelectItem>
            <SelectItem value="final">Sadece Final</SelectItem>
          </SelectContent>
        </Select>
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
