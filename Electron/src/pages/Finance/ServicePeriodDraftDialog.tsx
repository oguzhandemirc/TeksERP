// H8 — Dönem sonu hizmet faturası: müşteri + dönem → sunucu önizlemesi (iş, metre, tutar, uyarılar) → taslak.
// Hesap yalnız SUNUCUDA; panel önizlemeyi gösterir, oluştur aynı cari + dönemi gönderir (token deneme başına).
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { getCariByCustomer, money } from "./service";
import { createServicePeriodDraft, previewServicePeriodDraft, type ServicePeriodPreview } from "./servicePeriodApi";
import { canCreateServicePeriodDraft, defaultServicePeriod, isValidServicePeriod, recentServicePeriods, servicePeriodLabel } from "./servicePeriodDraft";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (invoiceId: string) => void;
}

export function ServicePeriodDraftDialog({ open, onOpenChange, onCreated }: Props) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [period, setPeriod] = useState(defaultServicePeriod());
  const attempt = useAttemptToken();
  useEffect(() => {
    if (!open) attempt.renew();
  }, [open, attempt]);
  // Cari ya da dönem değişimi yeni MANTIKSAL denemedir: yapışkan token taşınmaz (CLIENT_TOKEN_COLLISION olmasın).
  useEffect(() => {
    attempt.renew();
  }, [customerId, period, attempt]);

  const cariQ = useQuery({
    queryKey: ["finance", "cari-by-customer", customerId],
    queryFn: () => getCariByCustomer(customerId as string),
    enabled: open && !!customerId,
  });
  const cariId = cariQ.data?.id ?? null;
  const validPeriod = isValidServicePeriod(period);
  const previewQ = useQuery({
    queryKey: ["finance", "service-period-preview", cariId, period],
    queryFn: () => previewServicePeriodDraft(cariId as string, period),
    enabled: open && !!cariId && validPeriod,
    retry: false,
  });
  const preview = previewQ.data;

  const create = useMutation({
    mutationFn: () => createServicePeriodDraft({ cariId: cariId as string, period, clientToken: attempt.token() }),
    onSuccess: (res) => {
      attempt.onSuccess();
      toast.success(res.message ?? `${res.data.docNo} taslağı oluşturuldu.`);
      onOpenChange(false);
      onCreated(res.data.id);
    },
    // Hata toast'ını apiClient basar; önizleme tazelenir (iş başka yoldan faturalanmış olabilir).
    onError: (e) => {
      attempt.onFailure(e);
      void previewQ.refetch();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dönem sonu hizmet faturası</DialogTitle>
          <DialogDescription>
            Seçilen ayda sevk edilen emanet toplara yapılan ve henüz faturalanmamış işler tek taslakta toplanır.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Müşteri</Label>
            <CustomerPickerField value={customerId} onChange={setCustomerId} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="service-period">Dönem</Label>
            <PeriodSelect value={period} onChange={setPeriod} />
          </div>
        </div>

        <div className="min-h-[8rem] rounded-md border p-3 text-sm" aria-live="polite">
          {!customerId ? (
            <p className="text-muted-foreground">Önizleme için müşteri seçin.</p>
          ) : cariQ.isLoading || previewQ.isLoading ? (
            <p className="text-muted-foreground">Önizleme hazırlanıyor…</p>
          ) : !cariId ? (
            <p className="text-muted-foreground">Bu müşterinin cari hesabı yok — faturalanacak iş de yoktur.</p>
          ) : previewQ.isError ? (
            <p className="text-destructive">{apiErrorText(previewQ.error, "Önizleme okunamadı.")}</p>
          ) : preview ? (
            <PreviewBody preview={preview} />
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!canCreateServicePeriodDraft(preview) || create.isPending} onClick={() => create.mutate()}>
            <FileText className="mr-1 h-4 w-4" />
            {create.isPending ? "Oluşturuluyor…" : "Taslağı oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ preview }: { preview: ServicePeriodPreview }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span><b>{servicePeriodLabel(preview.period)}</b></span>
        <span>{preview.shipmentCount} sevkiyat</span>
        <span>{preview.workCount} iş</span>
        <span>{Number(preview.totalMeters).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} m</span>
        <span>Ara toplam (KDV hariç): <b>{money(preview.subtotal, preview.currency)}</b></span>
      </div>
      {preview.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="py-1 pr-2">Hizmet</th><th className="py-1 pr-2 text-right">Miktar</th><th className="py-1 pr-2 text-right whitespace-nowrap">Birim fiyat</th><th className="py-1 text-right">Tutar</th></tr>
            </thead>
            <tbody>
              {preview.lines.map((l) => (
                <tr key={`${l.itemId}:${l.unitPrice}`} className="border-t">
                  <td className="py-1 pr-2">{l.description}</td>
                  <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{Number(l.qty).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} {l.unit}</td>
                  <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice, preview.currency)}</td>
                  <td className="py-1 text-right tabular-nums whitespace-nowrap">{money(l.amount, preview.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview.alreadyBilledWorkCount > 0 && (
        <p className="text-muted-foreground">{preview.alreadyBilledWorkCount} iş zaten bir faturada (sevk ya da önceki dönem taslağı) — tekrar alınmaz.</p>
      )}
      {preview.workCount === 0 && preview.warnings.length === 0 && (
        <p className="text-muted-foreground">Bu dönemde faturalanacak hizmet işi yok.</p>
      )}
      {preview.warnings.length > 0 && (
        <ul className="space-y-1 text-amber-700 dark:text-amber-400">
          {preview.warnings.map((w) => (
            <li key={w} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PeriodSelect({ value, onChange }: { value: string; onChange: (period: string) => void }) {
  return (
    <select id="service-period" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Dönem (ay)">
      {recentServicePeriods().map((p) => <option key={p} value={p}>{servicePeriodLabel(p)}</option>)}
    </select>
  );
}
