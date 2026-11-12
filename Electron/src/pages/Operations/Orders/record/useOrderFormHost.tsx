// Sipariş formunun sahibi (yeni + düzenle) — liste ve kayıt sayfası AYNI mutasyonları kullanır (gövde tek yerde).
// Davranış OrdersPage'den aynen taşındı: kk1 deneme token'ı, onayda üretim önizlemesi, sunucu uyarıları interceptor'da.
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { useAttemptToken } from "@/lib/attemptToken";
import { orderService } from "../service";
import { OrderFormDialog } from "../OrderFormDialog";
import { buildCreatePayload, buildUpdatePayload, type CreatePayload, type UpdatePayload } from "../orderPayload";
import { opensProposalOnApprove, useProposalGates } from "../production-proposal/gates";
import { ProductionProposalDialog } from "../production-proposal/ProductionProposalDialog";
import type { Order } from "../types";

const QUERY_KEY = "orders";

export interface OrderFormHost {
  openCreate: () => void;
  openEdit: (order: Order) => void;
  dialogs: ReactNode;
}

export function useOrderFormHost(opts: { onUpdated?: () => void } = {}): OrderFormHost {
  const qc = useQueryClient();
  const pricingEnabled = usePricingEnabled();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [proposalOrder, setProposalOrder] = useState<Order | null>(null);
  const proposalGates = useProposalGates();
  // İdempotency anahtarı — create mantıksal deneme kimliği (kk1.md). Form create modunda her açılışta, başarılı
  // create'te ve kesin 4xx'te yenilenir; belirsiz hatada SABİT kalır. Update yoluna GİRMEZ (PATCH doğal idempotent).
  const createAttempt = useAttemptToken();
  useEffect(() => {
    if (formOpen && !editing) createAttempt.renew();
  }, [formOpen, editing, createAttempt]);

  const createMut = useMutation({
    mutationFn: (payload: CreatePayload) => orderService.create(payload as unknown as Partial<Order>),
    onError: (e) => createAttempt.onFailure(e),
    onSuccess: (r) => {
      createAttempt.onSuccess();
      toast.success("Sipariş oluşturuldu.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setFormOpen(false);
      // SY-M3: ONAYDA_TASLAK — sipariş doğuşta onaylıdır; önizleme kendiliğinden açılır (sessiz yaratma yok).
      if (opensProposalOnApprove(proposalGates.mode, proposalGates.buttonVisible, r.data)) setProposalOrder(r.data);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdatePayload }) => orderService.update(id, payload as unknown as Partial<Order>),
    onSuccess: () => {
      toast.success("Sipariş güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setFormOpen(false);
      setEditing(null);
      opts.onUpdated?.();
    },
  });

  const dialogs = (
    <>
      <OrderFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        order={editing}
        onSubmit={async (v) => {
          if (editing) await updateMut.mutateAsync({ id: editing.id, payload: buildUpdatePayload(v, pricingEnabled, editing) });
          else await createMut.mutateAsync(buildCreatePayload(v, pricingEnabled, createAttempt.token()));
        }}
        isSubmitting={createMut.isPending || updateMut.isPending}
      />
      {proposalOrder && (
        <ProductionProposalDialog open onOpenChange={(o) => !o && setProposalOrder(null)} orderId={proposalOrder.id} orderNumber={proposalOrder.orderNumber} lines={proposalOrder.lines} />
      )}
    </>
  );

  return {
    openCreate: () => {
      setEditing(null);
      setFormOpen(true);
    },
    openEdit: (order) => {
      setEditing(order);
      setFormOpen(true);
    },
    dialogs,
  };
}
