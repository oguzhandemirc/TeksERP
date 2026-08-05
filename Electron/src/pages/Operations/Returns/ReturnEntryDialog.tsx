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
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import {
  returnsService,
  type ReturnLookupResult,
  type SackReturnLookupResult,
} from "./service";
import { ReturnRollCard } from "./ReturnRollCard";
import { ReturnSackCard } from "./ReturnSackCard";

const TEXTAREA_CLS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tabancayla okutularak açıldıysa: bu barkod otomatik sorgulanır. */
  initialBarcode?: string;
}

/**
 * Masaüstünden iade girişi — mobil İade Girişi'nin karşılığı. Kod sorgula →
 * top/çuval + aday siparişler gelir → neden (zorunlu) + sipariş + kalite + not →
 * İade Al. İade rafı (FİRE→hurda vb.) backend'de returnGradingEnabled'a göre belirlenir.
 *
 * İKİ MOD, TEK KUTU (2026-08-05): kutuya top barkodu da çuval kodu da okutulabilir;
 * tür `classifyBarcode` ile prefix'ten çözülür (CV… = çuval). Çuval modunda çuvalın
 * sevk edilmiş topları listelenir, seçilenler TEK nedenle ve TEK irsaliyeyle iade
 * alınır — 20 toplu çuvalı 20 kez okutmak yerine.
 */
export function ReturnEntryDialog({ open, onOpenChange, initialBarcode }: Props) {
  const qc = useQueryClient();
  const gradingEnabled = useReturnGradingEnabled();

  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<ReturnLookupResult | null>(null);
  const [sackResult, setSackResult] = useState<SackReturnLookupResult | null>(null);
  const [selectedRollIds, setSelectedRollIds] = useState<Set<string>>(new Set());
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
    setSackResult(null);
    setSelectedRollIds(new Set());
    setOrderId(null);
    setReasonId(null);
    setReasonText("");
    setNote("");
    setQualityGradeId(null);
  };

  // Yeni sorgu → form alanlarını sıfırla (iki mod da aynı davranış).
  const afterLookup = (candidates: { id: string }[]) => {
    setOrderId(candidates.length === 1 ? candidates[0]!.id : null);
    setReasonId(null);
    setReasonText("");
    setNote("");
    setQualityGradeId(null);
  };

  const lookupMut = useMutation({
    mutationFn: async (raw: string) => {
      // Tür PREFIX'ten çözülür (CV… = çuval). Deneme-yanılma (önce top, olmazsa
      // çuval) yapılmaz: her başarısız deneme interceptor'dan bir hata toast'ı
      // düşürür ve operatör doğru kodu okuttuğu hâlde kırmızı görürdü.
      const { kind, code } = classifyBarcode(raw);
      if (kind === "SACK") {
        const res = await returnsService.lookupSack(code);
        return { mode: "SACK" as const, sack: res.data };
      }
      const res = await returnsService.lookup(raw.trim());
      return { mode: "ROLL" as const, roll: res.data };
    },
    onSuccess: (out) => {
      if (out.mode === "SACK") {
        setResult(null);
        setSackResult(out.sack);
        // Varsayılan TÜMÜ SEÇİLİ — çuvalı komple geri almak yaygın durum.
        setSelectedRollIds(new Set(out.sack.rolls.map((r) => r.id)));
        afterLookup(out.sack.candidateOrders);
        return;
      }
      setSackResult(null);
      setSelectedRollIds(new Set());
      setResult(out.roll);
      afterLookup(out.roll.candidateOrders);
    },
    onError: () => {
      setResult(null);
      setSackResult(null);
      setSelectedRollIds(new Set());
    },
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
        ...(sackResult
          ? { rollIds: [...selectedRollIds] }
          : { rollId: result!.roll.id }),
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
      const n = res.data.rollCount ?? 1;
      toast.success(
        n > 1
          ? `İade alındı — ${n} top ${shelf} eklendi (tek irsaliye).`
          : `İade alındı — top ${shelf} eklendi.`,
      );
      void qc.invalidateQueries({ queryKey: ["returns"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["shipment-detail"] });
      reset();
      onOpenChange(false);
    },
  });

  const roll = result?.roll;
  const hasReason = !!reasonId || reasonText.trim().length > 0;
  const candidates = (sackResult ?? result)?.candidateOrders ?? [];
  const orderOk = candidates.length === 0 || !!orderId;
  const hasTarget = sackResult ? selectedRollIds.size > 0 : !!result;
  const canSubmit = hasTarget && hasReason && orderOk && !createMut.isPending;

  const toggleRoll = (rollId: string) =>
    setSelectedRollIds((prev) => {
      const next = new Set(prev);
      if (next.has(rollId)) next.delete(rollId);
      else next.add(rollId);
      return next;
    });

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
            Sevk edilmiş bir <strong>top barkodu</strong> veya <strong>çuval kodu</strong>{" "}
            sorgulayın; iade alınınca toplar iade rafına (Hazır Depo / kaliteye göre) iner.
            Sevk muhasebesine dokunulmaz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Barkod / çuval kodu sorgula */}
          <FormField label="Top Barkodu veya Çuval Kodu" required>
            <div className="flex gap-2">
              <Input
                autoFocus
                placeholder="Sevk edilmiş top barkodu ya da çuval kodu (CV…)"
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

          {sackResult && (
            <ReturnSackCard
              result={sackResult}
              selected={selectedRollIds}
              onToggle={toggleRoll}
              onToggleAll={(checked) =>
                setSelectedRollIds(checked ? new Set(sackResult.rolls.map((r) => r.id)) : new Set())
              }
            />
          )}

          {((roll && result) || sackResult) && (
            <>
              {roll && result && <ReturnRollCard result={result} />}

              {/* Sipariş atfı */}
              <FormField
                label="Sipariş"
                hint={
                  sackResult
                    ? "Seçilen TÜM toplara uygulanır; yalnız hepsine uyan siparişler listelenir."
                    : undefined
                }
              >
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
                <FormField
                  label="Kalite"
                  hint={
                    sackResult
                      ? "Seçilirse TÜM seçili toplara uygulanır; seçilmezse her top çıktığı kaliteyle döner."
                      : "Seçilmezse top çıktığı kaliteyle döner."
                  }
                >
                  <Select value={qualityGradeId ?? ""} onValueChange={(v) => setQualityGradeId(v || null)}>
                    <SelectTrigger>
                      <SelectValue placeholder={roll ? `Mevcut: ${roll.qualityGrade}` : "Değiştirme"} />
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
