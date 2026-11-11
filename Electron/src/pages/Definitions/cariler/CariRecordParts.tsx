// Cari kayıt sayfası parçaları: sayı kartları (yalnız hazır ve dolu olanlar; para birimi başına satır, asla
// toplanmaz) ve Genel sekmesi (kart bilgileri + son 10 hareket). Termin/gecikme sayacı YOK (kullanıcı kararı).
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Building2, ClipboardList, Clock, Coins, Mail, MapPin, Phone, ReceiptText, Ruler, ShieldAlert, User, Wallet } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { RecordActivityList } from "@/components/record/RecordActivityList";
import { RecordFacts } from "@/components/record/RecordBits";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { money, type CariRow } from "@/pages/Finance/service";
import type { OrderStats } from "@/pages/Operations/Orders/service";
import type { Customer } from "@/pages/Customers/types";
import { balanceLines, overdueLines, SIDE_LABEL } from "./cari-finance";
import { metre } from "./cari-movements";
import { openOrderCount } from "./CariSummaryBlocks";
import { hareketZamaniCari } from "./cari-time";
import type { CariMovement } from "./cari-sources";

/** Birim başına alt alta satırlar (tek kart, birimler ayrı). */
function PerCurrency({ lines }: { lines: { currency: string; text: string; danger?: boolean }[] }) {
  return (
    <span className="flex flex-col">
      {lines.map((l) => (
        <span key={l.currency} className={cn("truncate", l.danger && "text-destructive")}>{l.text}</span>
      ))}
    </span>
  );
}

/** Sayı kartları — veri yoksa ya da sıfırsa kart çizilmez (boş kart gösterilmez). */
export function cariStatCards({ account, stats }: { account: CariRow | null | undefined; stats: OrderStats | null | undefined }): ReactNode[] {
  const cards: ReactNode[] = [];
  if (account) {
    const lines = balanceLines(account);
    const single = lines.length === 1 ? lines[0]! : null;
    cards.push(
      <StatCard
        key="balance"
        label="Bakiye"
        icon={Wallet}
        tone="violet"
        value={<PerCurrency lines={lines.map((l) => ({ currency: l.currency, text: l.text, danger: l.side === "payable" }))} />}
        hint={single ? SIDE_LABEL[single.side] : "Para birimleri ayrı tutulur"}
      />,
    );
    const overdue = overdueLines(account);
    if (overdue.length > 0) cards.push(<StatCard key="overdue" label="Vadesi geçmiş" icon={AlertTriangle} tone="rose" value={<PerCurrency lines={overdue.map((o) => ({ ...o, danger: true }))} />} />);
  }
  if (stats) {
    const open = openOrderCount(stats);
    if (open > 0) cards.push(<StatCard key="open" label="Açık sipariş" icon={ClipboardList} tone="blue" value={`${formatNumber(open, 0)} sipariş`} hint={`Kalan ${metre(stats.totalOpenQty) ?? "0 m"}`} />);
    if (stats.totalCount > 0 && stats.totalOrderedQty > 0) {
      cards.push(<StatCard key="ordered" label="Sipariş metresi" icon={Ruler} tone="teal" value={metre(stats.totalOrderedQty) ?? "—"} hint={`Sevk edilen ${metre(stats.totalShippedQty) ?? "0 m"} · ${formatNumber(stats.totalCount, 0)} sipariş`} />);
    }
  }
  return cards;
}

export function CariGeneralTab({ card, account, moves }: { card: Customer; account: CariRow | null | undefined; moves: { items: CariMovement[]; loading: boolean; error: boolean; retry: () => void } }) {
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <SectionCard title="Kart bilgileri">
        <RecordFacts
          empty={<p className="text-sm text-muted-foreground">Kart bilgisi girilmemiş.</p>}
          facts={[
            { key: "contact", label: "Yetkili", icon: User, value: card.contactName },
            { key: "phone", label: "Telefon", icon: Phone, value: card.contactPhone },
            { key: "mail", label: "E-posta", icon: Mail, value: card.email },
            { key: "addr", label: "Adres", icon: MapPin, value: [card.address, card.district, card.city].filter(Boolean).join(", ") },
            { key: "tax", label: "Vergi no", icon: ReceiptText, value: card.taxNumber },
            { key: "office", label: "Vergi dairesi", icon: Building2, value: account?.taxOffice },
            { key: "term", label: "Vade", icon: Clock, value: account?.paymentTermDays != null ? `${account.paymentTermDays} gün` : null },
            { key: "cur", label: "Para birimi", icon: Coins, value: account?.defaultCurrency },
            { key: "risk", label: "Risk limiti", icon: ShieldAlert, value: account?.riskLimit != null && account.riskLimit > 0 ? money(account.riskLimit, account.defaultCurrency) : null },
            { key: "hold", label: "Kilit", icon: ShieldAlert, value: account?.hold ? <span className="text-destructive">{account.hold.reasonLabel}</span> : null },
          ]}
        />
      </SectionCard>
      <SectionCard title="Son hareketler" description="Sipariş · sevk · tahsilat/ödeme · fason">
        <RecordActivityList
          loading={moves.loading}
          error={moves.error}
          onRetry={moves.retry}
          emptyText="Henüz hareket yok."
          items={moves.items.map((m) => ({ ...m, title: m.docNo, when: hareketZamaniCari(m.at), onOpen: m.to ? () => navigate(m.to!) : null }))}
        />
      </SectionCard>
    </div>
  );
}
