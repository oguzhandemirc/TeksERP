import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { hasOpenForm } from "@/lib/acik-form";

/**
 * Elle kurulum düğmelerinin ("Yeniden başlat", şeridin "Şimdi kur") ORTAK kapısı: açık/yazılmış form varsa
 * kurulum önce onay ister (program yeniden başlar, form kaybolur); yoksa hemen kurar. Karar `acik-form` kaydından.
 */
export function useGuardedInstall(install: () => void): { request: () => void; confirmDialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const request = () => {
    if (hasOpenForm()) setOpen(true);
    else install();
  };
  const confirmDialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Açık formunuz var"
      description="Kurulum için program yeniden başlatılacak; kaydedilmemiş bilgiler kaybolur. Önce formu kaydedip kapatın ya da yine de kurun."
      confirmLabel="Yine de kur"
      cancelLabel="Vazgeç"
      destructive
      onConfirm={() => {
        setOpen(false);
        install();
      }}
    />
  );
  return { request, confirmDialog };
}
