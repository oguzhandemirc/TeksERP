// Cari Kartını Düzenle sekmeleri — sabit boyutlu sekmeli modal (TabbedDialog, kural 2026-11-24): şerit sabit, yalnız
// etkin panel kayar. "Bilgiler" paneli `forceMount`: form durumu sekme değişince kaybolmaz, alt çubuktaki Kaydet
// her sekmeden Bilgiler formunu gönderir. Diğer sekmeler kendi içlerinde anında yazar.
import type { ReactNode } from "react";
import { TabbedDialogPanel, TabbedDialogTabList, TabbedDialogTabs } from "@/components/ui/tabbed-dialog";
import { TabsTrigger } from "@/components/ui/tabs";
import { useCustomerBranchesEnabled, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { CariHoldPanel } from "@/pages/Finance/CariHold/CariHoldPanel";
import { useCustomerFinanceAccess } from "./CustomerFinanceSection";
import { CustomerBranchesPanel } from "./CustomerBranchesPanel";
import { CustomerItemAliasesPanel } from "./CustomerItemAliasesPanel";
import { CustomerColorAliasesPanel } from "./CustomerColorAliasesPanel";
import { SupplierItemCodesPanel } from "./SupplierItemCodesPanel";
import { CustomerBarcodeSeriesPanel } from "./BarcodeSeries/CustomerBarcodeSeriesPanel";
import { CustomerSummaryTab } from "./summary/CustomerSummaryTab";
import { CustomerLabelTemplatesTab } from "./CustomerLabelTemplatesTab";
import type { Customer } from "./types";

interface Props {
  customer: Customer;
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** Bilgiler sekmesinin formu (çağıran kurar; Kaydet alt çubukta). */
  infoPanel: ReactNode;
  destination: "DOMESTIC" | "EXPORT" | null | undefined;
}

export function CustomerEditTabs({ customer, activeTab, onTabChange, infoPanel, destination }: Props) {
  // customers.branchesEnabled kapalıyken şube sekmesi gizlenir; mevcut şube verisi korunur.
  const branchesEnabled = useCustomerBranchesEnabled();
  const financeAccess = useCustomerFinanceAccess();
  const { hasPermission } = useRoleAccess();
  const flags = useFeatureFlags().data?.data;
  // D4-F2: müşteri barkod serisi uçları emanet modül kapısının arkasında — izinsiz/kapalıda sorgu atılmaz.
  const seriesVisible = (flags?.emanetEnabled ?? false) && hasPermission("customer:read");
  // Seyitoğlu d5: tedarikçi kalem kodları — mal kabul uçları ticaret kapısının ve mal kabul izninin arkasında.
  const itemCodesVisible = customer.isSupplierRole && (flags?.ticaretEnabled ?? false) && (hasPermission("goods-receipt:read") || hasPermission("goods-receipt:write"));
  const tabs: Array<{ value: string; label: string; body: ReactNode } | false> = [
    { value: "summary", label: "Özet", body: <CustomerSummaryTab customerId={customer.id} /> },
    branchesEnabled && { value: "branches", label: "Şubeler", body: <CustomerBranchesPanel customerId={customer.id} customerDestination={destination ?? null} /> },
    { value: "item-aliases", label: "Müşterideki Kumaş Adları", body: <CustomerItemAliasesPanel customerId={customer.id} /> },
    { value: "color-aliases", label: "Müşterideki Renk Adları", body: <CustomerColorAliasesPanel customerId={customer.id} /> },
    itemCodesVisible && { value: "supplier-item-codes", label: "Tedarikçi Kalem Kodları", body: <SupplierItemCodesPanel supplierId={customer.id} /> },
    { value: "label-templates", label: "Etiket Şablonları", body: <CustomerLabelTemplatesTab customer={customer} /> },
    financeAccess.canSeeHold && { value: "cari-hold", label: "Kilit", body: <CariHoldPanel target={{ customerId: customer.id }} cariName={customer.name} /> },
    seriesVisible && { value: "barcode-series", label: "Barkod serisi", body: <CustomerBarcodeSeriesPanel customerId={customer.id} /> },
  ];
  const shown = tabs.filter((t): t is Exclude<typeof t, false> => Boolean(t));
  return (
    <TabbedDialogTabs value={activeTab} onValueChange={onTabChange}>
      <TabbedDialogTabList className="h-auto flex-wrap" data-testid="customer-form-tabs">
        <TabsTrigger value="info">Bilgiler</TabsTrigger>
        {shown.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
      </TabbedDialogTabList>
      <TabbedDialogPanel value="info" forceMount className="bg-muted/40 py-5">{infoPanel}</TabbedDialogPanel>
      {shown.map((t) => <TabbedDialogPanel key={t.value} value={t.value}>{t.body}</TabbedDialogPanel>)}
    </TabbedDialogTabs>
  );
}
