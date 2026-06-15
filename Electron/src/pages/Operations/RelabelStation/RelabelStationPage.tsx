import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ScanLine } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { relabelService } from "./service";
import { RelabelSpecForm } from "./RelabelSpecForm";
import { RelabelPrintForCustomer } from "./RelabelPrintForCustomer";
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

  const submit = () => {
    const code = barcode.trim();
    if (code) lookup.mutate(code);
  };

  // Spec kaydedilince bağlamı tazele — yeni renk/kalite + güncel specLocked yansısın.
  const refresh = () => {
    if (ctx?.barcode) lookup.mutate(ctx.barcode);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Yeniden Etiketle"
        description="Barkodu okut → topun spec'ini düzelt ya da farklı müşteri için etiketi yeniden bas."
      />

      <div className="flex items-center gap-2 border-b px-6 py-3">
        <div className="relative max-w-sm flex-1">
          <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Top barkodu okut/yaz → getir"
            className="pl-8"
            autoFocus
          />
        </div>
        <Button size="sm" onClick={submit} disabled={!barcode.trim() || lookup.isPending}>
          {lookup.isPending ? "Getiriliyor…" : "Topu Getir"}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
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
      </div>
    </div>
  );
}
