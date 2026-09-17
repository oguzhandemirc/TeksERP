// =============================================================================
// TEDARİKÇİ SEÇİCİ — "bu müşteriden İLK KEZ alacağım" kapısı (kullanıcı kararı 2026-09-17 03:25)
// =============================================================================
// Tedarikçi kipi müşteri-only kartı listelemez; gerçek ihtiyaç bu şeritten geçer: bağlantı → aynı
// modal yalnız müşteri kartlarıyla → satır → onay → `PATCH /customers/:id {isSupplierRole:true}` (rol modeli:
// ROL EKLENİR, `type` yazılmaz — sunucu türetir) → seçim forma.
// `customer:write` yoksa bağlantı HİÇ çizilmez (kart tipi değiştirmek cari yazma yetkisidir). Hata:
// apiClient tek toast; seçim yazılmaz, modal açık kalır. Audit normal yazma yolundan (BaseController).
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { customerService } from "@/pages/Customers/service";
import { partnerRoleLabels } from "@/lib/partnerRoles";
import { ConfirmDialog } from "./ConfirmDialog";
import type { SupplierParty } from "./supplierParty";
import type { SupplierPickerRow } from "./supplierPicker";

export const CONVERT_LINK_TEXT = "Müşteri kartını tedarikçi de yap…";
export const CONVERT_BACK_TEXT = "Tedarikçi listesine dön";
export const CONVERT_CONFIRM_TITLE = "Kart tipi değişecek";
export const convertConfirmText = (name: string) => `${name} kartına ${partnerRoleLabels.supplier} rolü eklenecek.`;

/** Kapı: kart tipini değiştirmek `customer:write` ister — yoksa dönüştürme akışı yüzeyde yoktur. */
export function useCanConvertCustomer(): boolean {
  return useRoleAccess().hasPermission("customer:write");
}

export function ConvertCustomerLink({ onClick }: { onClick: () => void }) {
  return (
    <p className="text-xs text-muted-foreground">
      Bu müşteriden ilk kez mi alacaksınız?{" "}
      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onClick}>
        {CONVERT_LINK_TEXT}
      </button>
    </p>
  );
}

export function ConvertBackLink({ onClick }: { onClick: () => void }) {
  return (
    <p className="text-xs text-muted-foreground">
      Yalnız müşteri kartları listeleniyor; seçilen karta <b>{partnerRoleLabels.supplier}</b> rolü eklenir ve tedarikçi olarak seçilir.{" "}
      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onClick}>
        ← {CONVERT_BACK_TEXT}
      </button>
    </p>
  );
}

interface ConfirmProps {
  row: SupplierPickerRow | null;
  onCancel: () => void;
  /** Tip BOTH'a yazıldı — seçici bu kartı seçer ve kapanır. */
  onConverted: (party: SupplierParty) => void;
}

export function ConvertCustomerConfirm({ row, onCancel, onConverted }: ConfirmProps) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (id: string) => customerService.update(id, { isSupplierRole: true }),
    onSuccess: (res, id) => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["supplier-picker"] });
      void qc.invalidateQueries({ queryKey: ["supplier-select"] });
      toast.success(`${res.data?.name ?? "Kart"} artık ${partnerRoleLabels.supplier} rolü de taşıyor`);
      onConverted({ kind: "CUSTOMER", id });
    },
  });
  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={CONVERT_CONFIRM_TITLE}
      description={row ? convertConfirmText(row.name) : undefined}
      confirmLabel="Dönüştür ve seç"
      isPending={mut.isPending}
      onConfirm={async () => {
        if (!row) return;
        try {
          await mut.mutateAsync(row.id);
        } finally {
          onCancel();
        }
      }}
    />
  );
}
