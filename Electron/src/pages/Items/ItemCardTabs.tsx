// Kumaş kartı sekmeleri: "Bilgiler" (form) + "Müşteri Kumaş Adları" + "Müşteri Renk Adları". Yalnız düzenlenen KUMAŞ kartında ve
// `customer-alias:read` varken sekme çizilir; aksi hâlde form bugünkü gibi tek başına durur.
import type { ReactNode } from "react";
import { TabsTrigger } from "@/components/ui/tabs";
import { TabbedDialogBody, TabbedDialogPanel, TabbedDialogTabList, TabbedDialogTabs } from "@/components/ui/tabbed-dialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { itemLifecycleOf } from "@/lib/item-lifecycle";
import type { Item } from "./types";
import { ItemCustomerColorAliasesPanel } from "./ItemCustomerColorAliasesPanel";
import { ItemCustomerItemAliasesPanel } from "./ItemCustomerItemAliasesPanel";
import { YarnWhereSection } from "@/pages/Operations/YarnAtSubcontractor/YarnWhereSection";

interface Props {
  /** Düzenlenen kart; yeni kartta null. */
  item: Item | null | undefined;
  children: ReactNode;
}

export function ItemCardTabs({ item, children }: Props) {
  const { hasPermission } = useRoleAccess();
  // İplik kartında "Nerede?" (depo / fasonda, devere D6c). Maliyet kartı bağlantısı başlık satırında (B11).
  const costLink = item?.itemType === "YARN" ? <YarnWhereSection itemId={item.id} itemType={item.itemType} /> : null;
  // Sabit çerçeveli modalın gövdesi (tabbed-dialog): sekmesizde tek kaydırıcı, sekmelide şerit sabit + panel kayar.
  if (!item || item.itemType !== "FABRIC" || !hasPermission("customer-alias:read")) {
    return <TabbedDialogBody className="space-y-4">{costLink}{children}</TabbedDialogBody>;
  }
  return (
    <TabbedDialogTabs defaultValue="info">
      <TabbedDialogTabList>
        <TabsTrigger value="info">Bilgiler</TabsTrigger>
        <TabsTrigger value="customer-item-aliases">Müşteri Kumaş Adları</TabsTrigger>
        <TabsTrigger value="customer-color-aliases">Müşteri Renk Adları</TabsTrigger>
      </TabbedDialogTabList>
      <TabbedDialogPanel value="info" className="space-y-4">{costLink}{children}</TabbedDialogPanel>
      <TabbedDialogPanel value="customer-item-aliases">
        <ItemCustomerItemAliasesPanel item={{ id: item.id, name: item.name, lifecycle: itemLifecycleOf(item) }} />
      </TabbedDialogPanel>
      <TabbedDialogPanel value="customer-color-aliases">
        <ItemCustomerColorAliasesPanel
          item={{
            id: item.id,
            name: item.name,
            lifecycle: itemLifecycleOf(item),
            allowedColorIds: (item.allowedColors ?? []).map((c) => c.colorId),
          }}
        />
      </TabbedDialogPanel>
    </TabbedDialogTabs>
  );
}
