// Kumaş kartı sekmeleri: "Bilgiler" (form) + "Müşteri Renk Adları". Yalnız düzenlenen KUMAŞ kartında ve
// `customer-alias:read` varken sekme çizilir; aksi hâlde form bugünkü gibi tek başına durur.
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { itemLifecycleOf } from "@/lib/item-lifecycle";
import type { Item } from "./types";
import { ItemCustomerColorAliasesPanel } from "./ItemCustomerColorAliasesPanel";
import { ItemCostLink } from "./ItemCostLink";
import { YarnWhereSection } from "@/pages/Operations/YarnAtSubcontractor/YarnWhereSection";

interface Props {
  /** Düzenlenen kart; yeni kartta null. */
  item: Item | null | undefined;
  children: ReactNode;
}

export function ItemCardTabs({ item, children }: Props) {
  const { hasPermission } = useRoleAccess();
  // İplik kartında "Nerede?" (depo / fasonda, devere D6c) — kumaş kartında hiçbir şey çizmez.
  const costLink = item ? (
    <>
      <ItemCostLink itemId={item.id} itemType={item.itemType} />
      {item.itemType === "YARN" && <YarnWhereSection itemId={item.id} itemType={item.itemType} />}
    </>
  ) : null;
  if (!item || item.itemType !== "FABRIC" || !hasPermission("customer-alias:read")) return <>{costLink}{children}</>;
  return (
    <Tabs defaultValue="info">
      {costLink}
      <TabsList>
        <TabsTrigger value="info">Bilgiler</TabsTrigger>
        <TabsTrigger value="customer-color-aliases">Müşteri Renk Adları</TabsTrigger>
      </TabsList>
      <TabsContent value="info">{children}</TabsContent>
      <TabsContent value="customer-color-aliases">
        <ItemCustomerColorAliasesPanel
          item={{
            id: item.id,
            name: item.name,
            lifecycle: itemLifecycleOf(item),
            allowedColorIds: (item.allowedColors ?? []).map((c) => c.colorId),
          }}
        />
      </TabsContent>
    </Tabs>
  );
}
