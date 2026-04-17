import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { customerService } from "@/services/customerService";
import { SlideOverPanel, SlideOverContentLoader } from "@/components/ui/SlideOverPanel";
import { Building2 } from "lucide-react";
import { companyTypeLabels } from "@/types/enums";
import type { CompanyType } from "@/types/enums";

interface CustomerDetailPanelProps {
  customerId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function CustomerDetailPanel({ customerId, isOpen, onClose }: CustomerDetailPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(customerId);

  useEffect(() => {
    if (customerId) setActiveId(customerId);
  }, [customerId]);

  const effectiveId = customerId || activeId;

  const { data, isLoading } = useQuery({
    queryKey: ["customer-detail", effectiveId],
    queryFn: () => customerService.getById(effectiveId!),
    enabled: !!effectiveId,
  });

  const customer = data?.data;

  return (
    <SlideOverPanel
      title={customer ? customer.name : "Cari / Müşteri Detayı"}
      isOpen={isOpen}
      onClose={onClose}
    >
      {isLoading ? (
        <SlideOverContentLoader />
      ) : !customer ? (
        <div className="text-center text-muted-foreground p-6">Müşteri bulunamadı</div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-muted rounded-lg">
              <Building2 className="h-6 w-6 text-foreground" />
            </div>
            <div>
              <div className="font-semibold text-lg">{customer.name}</div>
              <div className="text-sm text-muted-foreground">{customer.code}</div>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-sm font-medium">Genel Bilgiler</div>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <span className="text-muted-foreground">Tür:</span>
              <span className="font-medium">
                {companyTypeLabels[customer.type as CompanyType] ?? customer.type}
              </span>
              <span className="text-muted-foreground">Vergi No:</span>
              <span className="font-medium">{customer.taxNumber || "—"}</span>
              <span className="text-muted-foreground">Durum:</span>
              <span className="font-medium">{customer.isActive ? "Aktif" : "Pasif"}</span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <div>Oluşturulma: {new Date(customer.createdAt).toLocaleString("tr-TR")}</div>
            <div>Son Güncelleme: {new Date(customer.updatedAt).toLocaleString("tr-TR")}</div>
          </div>
        </div>
      )}
    </SlideOverPanel>
  );
}
