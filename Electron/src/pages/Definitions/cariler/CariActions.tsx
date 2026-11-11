// Cari hızlı eylemleri — izni/modülü kapalı olan eylem HİÇ çizilmez. Ekstre ve tahsilat MEVCUT diyaloglarla
// açılır (StatementDialog, PaymentFormDialog taraf hazır); siparişler listesine müşteri süzgeciyle gidilir.
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ListOrdered, Pencil, Wallet, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useCustomerFinanceAccess } from "@/pages/Customers/CustomerFinanceSection";
import { StatementDialog } from "@/pages/Finance/StatementDialog";
import { PaymentFormDialog } from "@/pages/Finance/PaymentFormDialog";
import type { CariRow } from "@/pages/Finance/service";
import type { CariSourceKey } from "./cari-sources";

export interface CariAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

interface Args {
  customerId: string | null;
  isSupplierOnly: boolean;
  account: CariRow | null | undefined;
  access: Record<CariSourceKey, boolean>;
  onEdit: (() => void) | null;
}

/** Görünür eylemler + açtıkları diyaloglar. */
export function useCariActions({ customerId, isSupplierOnly, account, access, onEdit }: Args): { actions: CariAction[]; dialogs: ReactNode } {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fin = useCustomerFinanceAccess();
  const { hasPermission } = useRoleAccess();
  const [statementOpen, setStatementOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const actions: CariAction[] = [];
  if (customerId && access.orders) actions.push({ key: "orders", label: "Siparişleri", icon: ListOrdered, onClick: () => navigate(`/operations/orders?filter[customerId]=${customerId}`) });
  if (customerId && account && fin.canWrite) actions.push({ key: "payment", label: isSupplierOnly ? "Ödeme yap" : "Tahsilat al", icon: Wallet, onClick: () => setPaymentOpen(true) });
  if (account && access.finance) actions.push({ key: "statement", label: "Ekstre", icon: FileText, onClick: () => setStatementOpen(true) });
  if (onEdit && hasPermission("customer:write")) actions.push({ key: "edit", label: "Düzenle", icon: Pencil, onClick: onEdit });
  const dialogs = (
    <>
      {statementOpen && account && <StatementDialog cari={account} open onOpenChange={() => setStatementOpen(false)} />}
      {customerId && (
        <PaymentFormDialog
          open={paymentOpen}
          direction={isSupplierOnly ? "OUT" : "IN"}
          presetCustomerId={customerId}
          onOpenChange={setPaymentOpen}
          onCreated={() => void qc.invalidateQueries({ queryKey: ["finance"] })}
        />
      )}
    </>
  );
  return { actions, dialogs };
}

/** Eylem düğmeleri — panel altlığında ızgara, sayfa başlığında satır. */
export function CariActionButtons({ actions, layout }: { actions: CariAction[]; layout: "grid" | "row" }) {
  if (actions.length === 0) return null;
  return (
    <div className={layout === "grid" ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-2"}>
      {actions.map((a, i) => (
        <Button key={a.key} size="sm" variant={layout === "row" && i === 0 ? "default" : "outline"} onClick={a.onClick} className="justify-start">
          <a.icon className="h-4 w-4" /> {a.label}
        </Button>
      ))}
    </div>
  );
}
