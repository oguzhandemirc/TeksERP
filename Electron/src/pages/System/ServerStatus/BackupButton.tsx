import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DatabaseBackup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import apiClient from "@/services/apiClient";

/**
 * "Şimdi yedek al" — backend yedeği başlatır ve hemen döner; pg_dump ayrı bir child
 * process'te koşar (backend bloklanmaz). Sonuç Yedekler ekranındaki "son yedek
 * denemesi" kutusunda görünür. BACKUP_DIR tanımsızsa backend 400 + açıklama döner
 * (interceptor toast'lar) — geliştirme ortamında beklenen davranış.
 */
export function BackupButton() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean; message: string }>(
        "/api/admin/backup",
        {},
        { suppressErrorToast: true },
      );
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(data.message);
      setOpen(false);
      // Birkaç dk sonra "son yedek" güncellenir; panel zaten 5sn'de bir tazeler.
      void qc.invalidateQueries({ queryKey: ["server-health"] });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Yedek başlatılamadı.";
      toast.error(msg);
      setOpen(false);
    },
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <DatabaseBackup className="mr-2 h-4 w-4" />
        Şimdi yedek al
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Şimdi yedek al"
        description="Veritabanının tam yedeği alınır, bütünlüğü doğrulanır ve offsite kopyası atılır. İşlem birkaç dakika sürebilir ve sistemi bir miktar yavaşlatabilir — yoğun saatlerde değil, mümkünse mesai dışında almanız önerilir."
        confirmLabel="Yedeği başlat"
        onConfirm={() => mutation.mutate()}
        isPending={mutation.isPending}
      />
    </>
  );
}
