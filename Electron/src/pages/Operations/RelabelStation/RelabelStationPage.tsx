import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { ScanField } from "@/components/scanner/ScanField";
import { useScanSeed } from "@/hooks/useScanSeed";
import { relabelService } from "./service";
import { RelabelSpecForm } from "./RelabelSpecForm";
import { RelabelPrintForCustomer } from "@/components/labels/PrintForCustomerCard";
import { EmptyState, LastLabelBanner, RollContextHeader } from "./RollContextHeader";
import type { RelabelContext } from "./types";

/**
 * Yeniden-Etiketleme istasyonu — barkod okut → topu getir → spec'i düzelt
 * (renk/kalite/en/özellik) veya farklı müşteri (A→B) için etiketi yeniden bas.
 * Scan deseni SackSearch ile aynı (PC okuyucu klavye-wedge + elle giriş).
 */
export function RelabelStationPage() {
  const [barcode, setBarcode] = useState("");
  const [ctx, setCtx] = useState<RelabelContext | null>(null);

  // 404 toast'ı apiClient interceptor'dan gelir; onError sadece paneli temizler.
  const lookup = useMutation({
    mutationFn: (code: string) => relabelService.getContext(code),
    onSuccess: (res) => setCtx(res.data ?? null),
    onError: () => setCtx(null),
  });

  // Spec kaydedilince bağlamı tazele — yeni renk/kalite + güncel specLocked yansısın.
  const refresh = () => {
    if (ctx?.barcode) lookup.mutate(ctx.barcode);
  };

  // "Her yerde okut" → bu sekmeye yönlendirme: kodu otomatik getir.
  useScanSeed("scanCode", (code) => {
    setBarcode(code);
    lookup.mutate(code);
  });

  return (
    <PageShell>
      <PageHeader
        title="Yeniden Etiketle"
      />

      <ScanField
        className="border-b px-6 py-3"
        value={barcode}
        onChange={setBarcode}
        onScan={(code) => lookup.mutate(code)}
        placeholder="Top barkodu okut/yaz → getir"
        autoFocus
        expectPrefix="ROLL"
        submitLabel="Topu Getir"
        busy={lookup.isPending}
        busyLabel="Getiriliyor…"
      />

      <PageBody className="p-6">
        {!ctx ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            <RollContextHeader
              ctx={ctx}
              onClear={() => {
                setCtx(null);
                setBarcode("");
              }}
            />
            <LastLabelBanner snap={ctx.lastLabelSnapshot} />
            <div className="grid gap-4 lg:grid-cols-2">
              <RelabelSpecForm key={ctx.id} ctx={ctx} onSaved={refresh} />
              <RelabelPrintForCustomer key={ctx.id} ctx={ctx} onPrinted={refresh} />
            </div>
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
