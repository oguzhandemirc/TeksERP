// Ürün kartı sekmeleri: "Genel" (form) + kumaş yapısı (Çözgü · Atkı · Desen — B19 tek pencere) + "Müşteri adları"
// (kumaş adı + renk adı iki bölüm, K8). Yapı sekmeleri KUMAŞ + modül/izin varken (`extraTabs`), müşteri adları düzenlenen
// KUMAŞ kartında `customer-alias:read` varken çizilir; hiçbiri yoksa form bugünkü gibi tek başına durur.
// Alt çubuk (`footer`) sekmelerin DIŞINDA çizilir: her sekmede görünür (B18/4); "Genel" paneli `forceMount` — başka
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

export interface ItemExtraTab { value: string; label: string; content: ReactNode }
/** Anında kaydeden (formdan bağımsız) sekmeler — alt çubuk notu bunlarda. */
export const INSTANT_SAVE_TABS = new Set(["customer-aliases"]);

interface Props {
  /** Düzenlenen kart; yeni kartta null. */
  item: Item | null | undefined;
  children: ReactNode;
  /** Alt düğme çubuğu — etkin sekmeye göre (ör. "anında kaydedilir" notu yalnız liste sekmelerinde). */
  footer?: (activeTab: string) => ReactNode;
  /** Kumaş yapısı sekmeleri (Genel'den sonra). */
  extraTabs?: ItemExtraTab[];
  /** Denetimli sekme (doğrulama hatasında ilgili sekmeye geçmek için); verilmezse iç durum. */
  tab?: string;
  onTabChange?: (tab: string) => void;
}

export function ItemCardTabs({ item, children, footer = () => null, extraTabs = [], tab: tabProp, onTabChange }: Props) {
  const { hasPermission } = useRoleAccess();
  const [innerTab, setInnerTab] = useState("info");
  const tab = tabProp ?? innerTab;
  const setTab = onTabChange ?? setInnerTab;
  // İplik kartında stok durumu (depo / fasonda, devere D6c) formun ALTINDA (K5). Maliyet kartı bağlantısı başlık satırında (B11).
  const stock = item?.itemType === "YARN" ? <YarnWhereSection itemId={item.id} itemType={item.itemType} /> : null;
  const aliasTabs = !!item && item.itemType === "FABRIC" && hasPermission("customer-alias:read");
  // Sabit çerçeveli modalın gövdesi (tabbed-dialog): sekmesizde tek kaydırıcı, sekmelide şerit sabit + panel kayar.
  if (!aliasTabs && extraTabs.length === 0) {
    return (
      <>
        <TabbedDialogBody className="space-y-4">{children}{stock}</TabbedDialogBody>
        {footer("info")}
      </>
    );
  }
  return (
    <>
      <TabbedDialogTabs value={tab} onValueChange={setTab}>
        <TabbedDialogTabList>
          <TabsTrigger value="info">Genel</TabsTrigger>
          {extraTabs.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
          {aliasTabs && <TabsTrigger value="customer-aliases">Müşteri adları</TabsTrigger>}
        </TabbedDialogTabList>
        <TabbedDialogPanel value="info" forceMount className="space-y-4">{children}{stock}</TabbedDialogPanel>
        {extraTabs.map((t) => <TabbedDialogPanel key={t.value} value={t.value} className="space-y-4">{t.content}</TabbedDialogPanel>)}
        {aliasTabs && item && (
          <TabbedDialogPanel value="customer-aliases" className="space-y-6">
            <AliasSection title="Kumaş adları">
              <ItemCustomerItemAliasesPanel item={{ id: item.id, name: item.name, lifecycle: itemLifecycleOf(item) }} />
            </AliasSection>
            <AliasSection title="Renk adları">
              <ItemCustomerColorAliasesPanel
                item={{
                  id: item.id,
                  name: item.name,
                  lifecycle: itemLifecycleOf(item),
                  allowedColorIds: (item.allowedColors ?? []).map((c) => c.colorId),
                }}
              />
            </AliasSection>
          </TabbedDialogPanel>
        )}
      </TabbedDialogTabs>
      {footer(tab)}
    </>
  );
}

function AliasSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
