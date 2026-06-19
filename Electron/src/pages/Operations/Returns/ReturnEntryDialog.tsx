import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, AlertTriangle, PackageSearch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { loadAllForPicker } from "@/lib/picker-loader";
import { useReturnGradingEnabled } from "@/hooks/usePricingEnabled";
import { returnReasonService } from "@/pages/ReturnReasons/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { returnsService, type ReturnLookupResult } from "./service";
import { ReturnRollCard } from "./ReturnRollCard";

const TEXTAREA_CLS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tabancayla okutularak açıldıysa: bu barkod otomatik sorgulanır. */
  initialBarcode?: string;
}

/**
 * Masaüstünden iade girişi — mobil İade Girişi'nin karşılığı. Barkod sorgula →
 * top + aday siparişler gelir → neden (zorunlu) + sipariş + kalite + not → İade Al.
 * İade rafı (FİRE→hurda vb.) backend'de returnGradingEnabled'a göre belirlenir.
 */
export function ReturnEntryDialog({ open, onOpenChange, initialBarcode }: Props) {
  const qc = useQueryClient();
  const gradingEnabled = useReturnGradingEnabled();

  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<ReturnLookupResult | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [note, setNote] = useState("");
  const [qualityGradeId, setQualityGradeId] = useState<string | null>(null);

  const reasonsQ = useQuery({
    queryKey: ["return-reasons", "picker"],
    queryFn: () => loadAllForPicker(returnReasonService, { sortBy: "sortOrder" }),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const reasons = useMemo(
    () => (reasonsQ.data?.data ?? []).filter((r) => r.isActive),
    [reasonsQ.data?.data],
  );

  const gradesQ = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    enabled: open && gradingEnabled,
    staleTime: 5 * 60_000,
  });
  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);

  const reset = () => {
    setBarcode("");
    setResult(null);
    setOrderId(null);
    setReasonId(null);
    setReasonText("");
    setNote("");
    setQualityGradeId(null);
  };

  const lookupMut = useMutation({
    mutationFn: (code: string) => returnsService.lookup(code.trim()),
    onSuccess: (res) => {
      const data = res.data;
      setResult(data);
      const single = data.candidateOrders.length === 1 ? data.candidateOrders[0] : null;
      setOrderId(single ? single.id : null);
      setReasonId(null);
      setReasonText("");
      setNote("");
      setQualityGradeId(null);
    },
    onError: () => setResult(null),
  });

  // Tabancayla okutularak açıldıysa barkodu bir kez otomatik sorgula.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      seededRef.current = null;
      return;
    }
    if (initialBarcode && seededRef.current !== initialBarcode) {
      seededRef.current = initialBarcode;
      setBarcode(initialBarcode);
      lookupMut.mutate(initialBarcode);
    }
    // lookupMut kararlı değil; yalnız open+initialBarcode değişiminde tetikle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialBarcode]);

  const createMut = useMutation({
    mutationFn: () =>
      returnsService.create({
        rollId: result!.roll.id,
        orderId,
        reasonId,
        reasonText: reasonText.trim() || null,
        note: note.trim() || null,
        qualityGradeId: gradingEnabled ? qualityGradeId : null,
      }),
    onSuccess: (res) => {
      const shelf =
        res.data.appliedStatus === "SCRAP"
          ? "hurdaya"
          : res.data.appliedStatus === "A1_STOCK"
            ? "2. kalite stoğa"
            : "Hazır Depo'ya";
      toast.success(`İade alındı — top ${shelf} eklendi.`);
      void qc.invalidateQueries({ queryKey: ["returns"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      reset();
      onOpenChange(false);
    },
  });

  const roll = result?.roll;
  const hasReason = !!reasonId || reasonText.trim().length > 0;
  const candidates = result?.candidateOrders ?? [];
  const orderOk = candidates.length === 0 || !!orderId;
  const canSubmit = !!result && hasReason && orderOk && !createMut.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>İade Girişi</DialogTitle>
          <DialogDescription>
            Sevk edilmiş bir topun barkodunu sorgulayın; iade alınınca top doğrudan iade
            rafına (Hazır Depo / kaliteye göre) iner. Sevk muhasebesine dokunulmaz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Barkod sorgula */}
          <FormField label="Top Barkodu" required>
            <div className="flex gap-2">
              <Input
                autoFocus
                placeholder="Sevk edilmiş top barkodu..."
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && barcode.trim()) {
                    e.preventDefault();
                    lookupMut.mutate(barcode);
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!barcode.trim() || lookupMut.isPending}
                onClick={() => lookupMut.mutate(barcode)}
              >
                {lookupMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PackageSearch className="h-4 w-4" />
                )}
                <span className="ml-1">Sorgula</span>
              </Button>
            </div>
          </FormField>

          {roll && result && (
            <>
              <ReturnRollCard result={result} />

              {/* Sipariş atfı */}
              <FormField label="Sipariş">
                {candidates.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Bu sevkiyatta uyan sipariş yok — iade siparişe bağlanmadan kaydedilecek.
                  </div>
                ) : (
                  <Select value={orderId ?? ""} onValueChange={setOrderId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sipariş seçin..." />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.orderNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              {/* İade nedeni — en az biri zorunlu */}
              <FormField
                label="İade Nedeni"
                required
                hint={!hasReason ? "Katalogdan seçin VEYA açıklama yazın." : undefined}
              >
                <Select value={reasonId ?? ""} onValueChange={(v) => setReasonId(v || null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Neden seçin..." />
                  </SelectTrigger>
                  <SelectContent>
                    {reasons.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <textarea
                  className={`mt-2 ${TEXTAREA_CLS}`}
                  rows={2}
                  placeholder="Açıklama (katalog seçmediysen yaz)"
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                />
              </FormField>

              {gradingEnabled && (
                <FormField label="Kalite" hint="Seçilmezse top çıktığı kaliteyle döner.">
                  <Select value={qualityGradeId ?? ""} onValueChange={(v) => setQualityGradeId(v || null)}>
                    <SelectTrigger>
                      <SelectValue placeholder={`Mevcut: ${roll.qualityGrade}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {grades.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name} ({g.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}

              <FormField label="Not">
                <textarea
                  className={TEXTAREA_CLS}
                  rows={2}
                  placeholder="Teslim alan notu (opsiyonel)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </FormField>
            </>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => createMut.mutate()}>
            {createMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            İade Al
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
