// Cariler — yan panel (hızlı bakış): kimlik + hesap (para birimi başına) + açık siparişler + iletişim +
// son 5 hareket + hızlı eylemler. Kaynak kapalıysa (izin/modül) o bölüm hiç çizilmez.
import { useNavigate } from "react-router-dom";
import { Building2, Clock, Mail, MapPin, Phone, ReceiptText, User } from "lucide-react";
import { toneForKey } from "@/components/ui/icon-tile";
import { RecordSidePanel } from "@/components/record/RecordSidePanel";
import { RecordActivityList } from "@/components/record/RecordActivityList";
import { RecordAvatar, RecordFacts, RecordSectionTitle, ToneChip } from "@/components/record/RecordBits";
import { partnerRoleLabels } from "@/lib/partnerRoles";
import { ROLE_KEYS, ROLE_TONE, roleOn, type CariRowItem } from "./cari-row";
import { CariActionButtons, useCariActions } from "./CariActions";
import { CariFinanceBlock, CariOrderBlock } from "./CariSummaryBlocks";
import { CariPeriodSummary } from "./CariPeriodSummary";
import { useCariAccess, useCariAccount, useCariMovements, useCariOrderStats, useCustomerRecord } from "./useCariOverview";
import { hareketZamaniCari } from "./cari-time";
import type { Customer } from "@/pages/Customers/types";

interface Props {
  row: CariRowItem;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onOpenFull: (() => void) | null;
  onEdit: () => void;
}

export function CariIdentity({ row, size = "md" }: { row: Pick<CariRowItem, "id" | "name" | "code" | "roles" | "isActive" | "kind">; size?: "md" | "lg" }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <RecordAvatar name={row.name} tone={toneForKey(row.id)} size={size} />
      <div className="min-w-0">
        <p className="line-clamp-2 break-words text-base font-bold leading-tight" title={row.name}>{row.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{row.code}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {ROLE_KEYS.filter((k) => roleOn(row.roles, k)).map((k) => <ToneChip key={k} tone={ROLE_TONE[k]}>{partnerRoleLabels[k]}</ToneChip>)}
          {row.kind === "SUBCONTRACTOR" && <ToneChip tone="rose">Kartsız</ToneChip>}
          {!row.isActive && <ToneChip tone="rose">Pasif</ToneChip>}
        </div>
      </div>
    </div>
  );
}

export function CariSidePanel({ row, onClose, onPrev, onNext, onOpenFull, onEdit }: Props) {
  const navigate = useNavigate();
  const access = useCariAccess();
  const customerId = row.kind === "CUSTOMER" ? row.id : null;
  const detail = useCustomerRecord(customerId);
  const card: Customer | null = row.kind === "CUSTOMER" ? (detail.data ?? row.record) : null;
  const account = useCariAccount(customerId, access.finance);
  const stats = useCariOrderStats(customerId, access.orders && row.roles.isCustomerRole);
  const subcontractorId = row.kind === "SUBCONTRACTOR" ? row.id : (card?.subcontractor?.id ?? null);
  const moves = useCariMovements({ customerId, cariAccountId: account.data?.id ?? null, subcontractorId, access });
  const supplierOnly = row.roles.isSupplierRole && !row.roles.isCustomerRole;
  const { actions, dialogs } = useCariActions({ customerId, isSupplierOnly: supplierOnly, account: account.data, access, onEdit });
  return (
    <RecordSidePanel
      label={`Cari: ${row.name}`}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      onOpenFull={onOpenFull}
      header={<CariIdentity row={row} />}
      footer={<CariActionButtons actions={actions} layout="grid" />}
    >
      {access.finance && customerId && <CariFinanceBlock query={account} compact />}
      {stats.data && <CariOrderBlock stats={stats.data} compact />}
      {customerId && row.roles.isCustomerRole && <CariPeriodSummary customerId={customerId} compact />}
      <section>
        <RecordSectionTitle>İletişim</RecordSectionTitle>
        <RecordFacts
          empty={<p className="text-sm text-muted-foreground">İletişim bilgisi girilmemiş.</p>}
          facts={[
            { key: "contact", label: "Yetkili", icon: User, value: card?.contactName },
            { key: "phone", label: "Telefon", icon: Phone, value: card?.contactPhone ?? row.phone },
            { key: "mail", label: "E-posta", icon: Mail, value: card?.email },
            { key: "city", label: "Adres", icon: MapPin, value: [card?.address, card?.district, card?.city ?? row.city].filter(Boolean).join(", ") },
            { key: "tax", label: "Vergi no", icon: ReceiptText, value: row.taxNumber },
            { key: "office", label: "Vergi dairesi", icon: Building2, value: account.data?.taxOffice },
            { key: "term", label: "Vade", icon: Clock, value: account.data?.paymentTermDays != null ? `${account.data.paymentTermDays} gün` : null },
          ]}
        />
      </section>
      <section>
        <RecordSectionTitle>Son hareketler</RecordSectionTitle>
        <RecordActivityList
          loading={moves.loading}
          error={moves.error}
          onRetry={moves.retry}
          emptyText="Henüz hareket yok."
          items={moves.items.map((m) => ({ ...m, title: m.docNo, when: hareketZamaniCari(m.at), onOpen: m.to ? () => navigate(m.to!) : null }))}
        />
      </section>
      {dialogs}
    </RecordSidePanel>
  );
}
