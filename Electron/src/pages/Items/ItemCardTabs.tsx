// Kumaş kartı sekmeleri: "Bilgiler" (form) + "Müşteri Kumaş Adları" + "Müşteri Renk Adları". Yalnız düzenlenen KUMAŞ kartında ve
// `customer-alias:read` varken sekme çizilir; aksi hâlde form bugünkü gibi tek başına durur.
// Alt çubuk (`footer`) sekmelerin DIŞINDA çizilir: her sekmede görünür (B18/4); "Bilgiler" paneli `forceMount` — başka
// sekmedeyken de form DOM'da kalır, alt çubuktaki Kaydet (`form={id}`) onu gönderebilir.
import { useState, type ReactNode } from "react";
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
  /** Alt düğme çubuğu — etkin sekmeye göre (ör. "anında kaydedilir" notu yalnız liste sekmelerinde). */
  footer?: (activeTab: string) => ReactNode;
}

export function ItemCardTabs({ item, children, footer = () => null }: Props) {
  const { hasPermission } = useRoleAccess();
  const [tab, setTab] = useState("info");
  // İplik kartında "Nerede?" (depo / fasonda, devere D6c). Maliyet kartı bağlantısı başlık satırında (B11).
  const costLink = item?.itemType === "YARN" ? <YarnWhereSection itemId={item.id} itemType={item.itemType} /> : null;
  // Sabit çerçeveli modalın gövdesi (tabbed-dialog): sekmesizde tek kaydırıcı, sekmelide şerit sabit + panel kayar.
  if (!item || item.itemType !== "FABRIC" || !hasPermission("customer-alias:read")) {
    return (
      <>
        <TabbedDialogBody className="space-y-4">{costLink}{children}</TabbedDialogBody>
        {footer("info")}
      </>
    );
  }
  return (
    <>
      <TabbedDialogTabs value={tab} onValueChange={setTab}>
        <TabbedDialogTabList>
          <TabsTrigger value="info">Bilgiler</TabsTrigger>
          <TabsTrigger value="customer-item-aliases">Müşteri Kumaş Adları</TabsTrigger>
          <TabsTrigger value="customer-color-aliases">Müşteri Renk Adları</TabsTrigger>
        </TabbedDialogTabList>
        <TabbedDialogPanel value="info" forceMount className="space-y-4">{costLink}{children}</TabbedDialogPanel>
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
      {footer(tab)}
    </>
  );
}
