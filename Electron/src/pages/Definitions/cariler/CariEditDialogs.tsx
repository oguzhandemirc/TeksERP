// Cari düzenleme/oluşturma — SAHİPLERİNİN form diyalogları ve payload eşlemesi (buildCustomerPayload /
// buildSubcontractorPayload) aynen; liste, yan panel ve kayıt sayfası bu tek kancayı paylaşır (kopya eşleme yok).
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateDestinationLock } from "@/pages/Operations/SackContentEdit/destinationDefault";
import { useCustomerFinanceAccess } from "@/pages/Customers/CustomerFinanceSection";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { CustomerFormDialog } from "@/pages/Customers/CustomerFormDialog";
import { SubcontractorFormDialog } from "@/pages/Subcontractors/SubcontractorFormDialog";
import { buildCustomerPayload } from "@/pages/Customers/CustomersPage";
import { buildSubcontractorPayload } from "@/pages/Subcontractors/SubcontractorsPage";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { CariRowItem } from "./cari-row";

export interface CariEditing {
  openCreate: () => void;
  openEdit: (row: Pick<CariRowItem, "kind" | "record"> | { kind: "CUSTOMER"; record: Customer }) => void;
  dialogs: ReactNode;
}

function useCariMutations(onCustomerDone: () => void, onSubDone: () => void) {
  const qc = useQueryClient();
  const createCustomerM = useMutation({
    mutationFn: (payload: Partial<Customer>) => customerService.create(payload),
    onSuccess: () => {
      toast.success("Kart oluşturuldu.");
      onCustomerDone();
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
  const updateCustomerM = useMutation({
    mutationFn: (vars: { id: string; payload: Partial<Customer> }) => customerService.update(vars.id, vars.payload),
    onSuccess: () => {
      toast.success("Kart güncellendi.");
      onCustomerDone();
      void qc.invalidateQueries({ queryKey: ["customers"] });
      invalidateDestinationLock(qc);
    },
  });
  const updateSubM = useMutation({
    mutationFn: (vars: { id: string; payload: Partial<Subcontractor> }) => subcontractorService.update(vars.id, vars.payload),
    onSuccess: () => {
      toast.success("Kart güncellendi.");
      onSubDone();
      void qc.invalidateQueries({ queryKey: ["subcontractors"] });
    },
  });
  return { createCustomerM, updateCustomerM, updateSubM };
}

export function useCariEditing(): CariEditing {
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [editSub, setEditSub] = useState<Subcontractor | null>(null);
  // Rol modeli: TEK giriş "Yeni cari" — fason profili kartın "Fason iş yapar" kutusuyla doğar.
  const [createOpen, setCreateOpen] = useState(false);
  const financeAccess = useCustomerFinanceAccess();
  const closeCustomer = () => {
    setEditCustomer(null);
    setCreateOpen(false);
  };
  const { createCustomerM, updateCustomerM, updateSubM } = useCariMutations(closeCustomer, () => setEditSub(null));

  const dialogs = (
    <>
      <CustomerFormDialog
        open={Boolean(editCustomer) || createOpen}
        onOpenChange={(v) => {
          if (!v) closeCustomer();
        }}
        initial={editCustomer}
        isSubmitting={updateCustomerM.isPending || createCustomerM.isPending}
        onSubmit={(values) => {
          if (editCustomer) updateCustomerM.mutate({ id: editCustomer.id, payload: buildCustomerPayload(values, editCustomer, financeAccess) as Partial<Customer> });
          else createCustomerM.mutate(buildCustomerPayload(values, null, financeAccess) as Partial<Customer>);
        }}
      />
      <SubcontractorFormDialog
        open={Boolean(editSub)}
        onOpenChange={(v) => {
          if (!v) setEditSub(null);
        }}
        initial={editSub}
        isSubmitting={updateSubM.isPending}
        onSubmit={(values) => {
          if (editSub) updateSubM.mutate({ id: editSub.id, payload: buildSubcontractorPayload(values, editSub) as unknown as Partial<Subcontractor> });
        }}
      />
    </>
  );
  return {
    openCreate: () => setCreateOpen(true),
    openEdit: (row) => (row.kind === "CUSTOMER" ? setEditCustomer(row.record as Customer) : setEditSub(row.record as Subcontractor)),
    dialogs,
  };
}
