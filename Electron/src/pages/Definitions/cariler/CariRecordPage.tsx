// =============================================================================
// CARİ — TAM KAYIT SAYFASI (`definitions/cariler/:id`, 2026-11-12)
// =============================================================================
// Kimlik şeridi + eylemler (izin/modül kapılı) + sayı kartları (hazır ve dolu olanlar) + sekmeler.
// Sekme yalnız kapısı açık VE verisi varsa görünür (`cari-record-tabs`); etkin sekme URL'de `?sekme=`.
// Yalnız müşteri kartının sayfası var; bağsız eski fason profili listede yan panelle kalır.
// =============================================================================
import { CariPeriodSummary } from "./CariPeriodSummary";
import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toneForKey } from "@/components/ui/icon-tile";
import { Button } from "@/components/ui/button";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RecordPageShell } from "@/components/record/RecordPageShell";
import { RecordAvatar, RecordEmpty, ToneChip } from "@/components/record/RecordBits";
import { partnerRoleLabels } from "@/lib/partnerRoles";
import { useTabsStore } from "@/store/tabs";
import { useRouteAccess } from "@/hooks/useRouteAccess";
import { UserX } from "lucide-react";
import type { Customer } from "@/pages/Customers/types";
import { CARI_LIST_PATH, cariRecordPath, customerRow, ROLE_KEYS, ROLE_TONE, roleOn } from "./cari-row";
import { useCariAccess, useCariAccount, useCariMovements, useCariOrderStats, useCustomerRecord } from "./useCariOverview";
import { CariActionButtons, useCariActions } from "./CariActions";
import { useCariEditing } from "./CariEditDialogs";
import { CARI_TAB_PARAM, useCariRecordTabs, type CariTabKey } from "./cari-record-tabs";
import { cariStatCards, CariGeneralTab } from "./CariRecordParts";
import { CariOrdersTab, CariPricesTab, CariShipmentsTab } from "./CariCommerceTabs";
import { CariLedgerTab } from "./CariLedgerTab";
import { CariDocumentsTab } from "./CariDocumentsTab";
import { CariFasonTab, CariHistoryTab, CariPurchasesTab } from "./CariOtherTabs";

const PARENT = { label: "Cariler", to: CARI_LIST_PATH };

/** Sekme çubuğunda carinin adı (ShipmentDetailPage emsali). */
function useCariTabTitle(id: string, name: string | undefined) {
  useEffect(() => {
    if (!name) return;
    const tab = useTabsStore.getState().tabs.find((t) => t.path.split("?")[0] === cariRecordPath(id));
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, name);
  }, [id, name]);
}

export function CariRecordPage() {
  const { id = "" } = useParams();
  const q = useCustomerRecord(id);
  useCariTabTitle(id, q.data?.name);
  if (q.isLoading) return <CariRecordMessage text="Yükleniyor…" />;
  if (q.isError || !q.data) {
    return <CariRecordMessage text={q.isError ? "Cari kartı alınamadı ya da bulunamadı." : "Cari kartı bulunamadı."} action={q.isError ? <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Tekrar dene</Button> : null} />;
  }
  return <CariRecordView card={q.data} />;
}

function CariRecordView({ card }: { card: Customer }) {
  const [params, setParams] = useSearchParams();
  const access = useCariAccess();
  const { canGo } = useRouteAccess();
  const row = customerRow(card);
  const editing = useCariEditing();
  const account = useCariAccount(card.id, access.finance);
  const stats = useCariOrderStats(card.id, access.orders && row.roles.isCustomerRole);
  const subcontractorId = card.subcontractor?.id ?? null;
  const moves = useCariMovements({ customerId: card.id, cariAccountId: account.data?.id ?? null, subcontractorId, access, limit: 10 });
  const supplierOnly = row.roles.isSupplierRole && !row.roles.isCustomerRole;
  const { actions, dialogs } = useCariActions({ customerId: card.id, isSupplierOnly: supplierOnly, account: account.data, access, onEdit: () => editing.openEdit({ kind: "CUSTOMER", record: card }) });
  const { tabs } = useCariRecordTabs({ customerId: card.id, roles: row.roles, access, hasAccount: Boolean(account.data), subcontractorId });
  const active = (tabs.some((t) => t.key === params.get(CARI_TAB_PARAM)) ? params.get(CARI_TAB_PARAM) : "genel") as CariTabKey;
  const setTab = (k: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (k === "genel") next.delete(CARI_TAB_PARAM);
      else next.set(CARI_TAB_PARAM, k);
      return next;
    }, { replace: true });

  const content: Record<CariTabKey, () => React.ReactNode> = {
    genel: () => (
      <div className="space-y-4">
        {row.roles.isCustomerRole && <CariPeriodSummary customerId={card.id} />}
        <CariGeneralTab card={card} account={account.data} moves={moves} />
      </div>
    ),
    siparisler: () => <CariOrdersTab customerId={card.id} />,
    sevkiyatlar: () => <CariShipmentsTab customerId={card.id} />,
    hesap: () => account.data && <CariLedgerTab account={account.data} />,
    fiyatlar: () => <CariPricesTab customerId={card.id} />,
    fason: () => subcontractorId && <CariFasonTab subcontractorId={subcontractorId} canOpenWorkOrder={canGo({ to: "/operations/work-orders/x", izin: ["workorder:read"] })} />,
    alislar: () => <CariPurchasesTab supplierId={card.id} showOrders={access.purchases} showReceipts={access.receipts} />,
    belgeler: () => <CariDocumentsTab customerId={card.id} />,
    gecmis: () => <CariHistoryTab customerId={card.id} />,
  };

  return (
    <>
      <RecordPageShell
        parent={PARENT}
        title={card.name}
        avatar={<RecordAvatar name={card.name} tone={toneForKey(card.id)} size="lg" />}
        badges={
          <span data-record-badges="" className="flex flex-nowrap items-center gap-1">
            {ROLE_KEYS.filter((k) => roleOn(row.roles, k)).map((k) => <ToneChip key={k} tone={ROLE_TONE[k]} className="whitespace-nowrap">{partnerRoleLabels[k]}</ToneChip>)}
            {!card.isActive && <ToneChip tone="rose" className="whitespace-nowrap">Pasif</ToneChip>}
            {account.data?.hold && <ToneChip tone="rose" className="whitespace-nowrap" title={account.data.hold.reasonLabel}>Kilitli</ToneChip>}
          </span>
        }
        subtitle={<span className="truncate">{[card.code, card.city, card.contactPhone].filter(Boolean).join(" · ")}</span>}
        actions={<CariActionButtons actions={actions} layout="row" />}
        stats={cariStatCards({ account: account.data, stats: stats.data })}
        tabs={tabs}
        activeTab={active}
        onTabChange={setTab}
      >
        {content[active]()}
      </RecordPageShell>
      {dialogs}
      {editing.dialogs}
    </>
  );
}

function CariRecordMessage({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <PageShell>
      <PageBody className="p-6">
        <RecordEmpty icon={UserX} text={text} action={action} />
      </PageBody>
    </PageShell>
  );
}
