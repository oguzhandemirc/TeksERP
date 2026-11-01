// Cari kart "Barkod serisi" sekmesi (D4-F2; DALGA4 §7.4) — müşteri başına tek seri: biçim + önizleme + kaydet.
// Kod Tambur çıkışında doğar (`label.customerCodeAt=TAMBUR_OUTPUT`); görünür biçim değişimi eski kodlara dokunmaz.
// Yazma düğmeleri `customer:write` yoksa ÇİZİLMEZ; alanlar pasif kalır (bugünkü biçim görünsün).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import {
  createBarcodeSeries,
  formDirty,
  formFromSeries,
  getBarcodeSeries,
  previewBarcodeSeries,
  updateBarcodeSeries,
  visibleFormatDiffers,
  type BarcodeSeriesForm,
} from "./barcodeSeriesService";
import { BarcodeSeriesFields } from "./BarcodeSeriesFields";

export function CustomerBarcodeSeriesPanel({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("customer:write");
  const attempt = useAttemptToken();
  const queryKey = ["customer-barcode-series", customerId];
  const q = useQuery({ queryKey, queryFn: () => getBarcodeSeries(customerId) });
  const [form, setForm] = useState<BarcodeSeriesForm>(formFromSeries(null));
  const [preview, setPreview] = useState<{ codes: string[]; collides: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const series = q.data?.series ?? null;
  useEffect(() => {
    if (q.data) setForm(formFromSeries(q.data.series));
  }, [q.data]);

  const set = <K extends keyof BarcodeSeriesForm>(k: K, v: BarcodeSeriesForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setPreview(null);
    setNotice(null);
  };

  const previewM = useMutation({ mutationFn: () => previewBarcodeSeries(customerId, form), onSuccess: setPreview });
  const saveM = useMutation({
    mutationFn: () => (series ? updateBarcodeSeries(customerId, form, series.updatedAt) : createBarcodeSeries(customerId, form, attempt.token())),
    onSuccess: (r) => {
      attempt.onSuccess();
      setNotice(r.message ?? "Kaydedildi");
      setPreview(null);
      void qc.invalidateQueries({ queryKey });
    },
    onError: (e) => attempt.onFailure(e),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (q.isError || !q.data) return <Callout tone="danger">{apiErrorText(q.error, "Barkod serisi okunamadı.")}</Callout>;

  const visibleChange = series != null && visibleFormatDiffers(series, form);
  const disabled = !canWrite || saveM.isPending;

  return (
    <div className="space-y-4 text-sm">
      {series ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border p-3">
          <span>
            Sıradaki kod: <span className="font-mono font-medium">{q.data.nextCode ?? "—"}</span>
          </span>
          <span className="text-muted-foreground">{series.isActive ? "Seri etkin" : "Seri pasif — Tambur çıkışında kod doğmaz"}</span>
        </div>
      ) : (
        <Callout tone="info">Bu müşterinin barkod serisi yok. Seri tanımlanınca Tambur çıkışında depoya inen her topa müşterinin kodu verilir.</Callout>
      )}

      <BarcodeSeriesFields form={form} set={set} disabled={disabled} showActive={series != null} />

      {visibleChange && (
        <Callout tone="warning">Biçim değişiyor: verilmiş kodlar DEĞİŞMEZ, yeni kodlar yeni biçimden başlar.</Callout>
      )}

      {preview && (
        <div className="rounded-md border p-3">
          <span className="text-muted-foreground">Önizleme: </span>
          <span className="font-mono">{preview.codes.join(" · ")}</span>
          {preview.collides && <p className="mt-1 text-destructive">Bu kod bizim barkod biçimimizle çakışıyor — başka bir ön ek seçin.</p>}
        </div>
      )}
      {(previewM.isError || saveM.isError) && (
        <Callout tone="danger">{apiErrorText(saveM.error ?? previewM.error, "İşlem yapılamadı.")}</Callout>
      )}
      {notice && <Callout tone="success">{notice}</Callout>}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!form.prefix.trim() || previewM.isPending} onClick={() => previewM.mutate()}>
            Önizle
          </Button>
          <Button type="button" size="sm" disabled={!form.prefix.trim() || !formDirty(series, form) || saveM.isPending} onClick={() => saveM.mutate()}>
            {series ? "Kaydet" : "Seriyi tanımla"}
          </Button>
        </div>
      )}
    </div>
  );
}
