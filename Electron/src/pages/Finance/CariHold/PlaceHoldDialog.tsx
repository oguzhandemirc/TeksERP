// Cari kilidi KOY diyaloğu (D4-I3) — kapsam ön seçimi `finance.cariHold.defaultScope` ayarından; token MANTIKSAL
// DENEME başına (`useAttemptToken`: belirsiz hatada yapışır, kesin 4xx'te yenilenir). Koşullu mount: her açılış yeni deneme.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useAttemptToken } from "@/lib/attemptToken";
import { apiErrorText } from "@/lib/api-error";
import { CARI_HOLD_REASON_OPTIONS, CARI_HOLD_SCOPE_OPTIONS, placeCariHold, scopesFromSetting, type CariHoldReasonCode, type CariHoldScope } from "./cariHoldService";

interface Props {
  cariId: string;
  cariName: string;
  onClose: () => void;
}

export function PlaceHoldDialog({ cariId, cariName, onClose }: Props) {
  const flags = useFeatureFlags();
  const preset = flags.data?.data?.financeCariHoldDefaultScope;
  const [scopes, setScopes] = useState<CariHoldScope[] | null>(null);
  const [reasonCode, setReasonCode] = useState<CariHoldReasonCode>("BORC");
  const [reasonText, setReasonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const attempt = useAttemptToken();
  const qc = useQueryClient();
  // Ayar yüklenene dek kullanıcı dokunmadıysa ön seçim ayardan (bayatlamasın diye türetilir, kopyalanmaz).
  const selected = scopes ?? scopesFromSetting(preset);

  const toggle = (s: CariHoldScope) => setScopes(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]);

  const m = useMutation({
    mutationFn: () => placeCariHold(cariId, { scopes: selected, reasonCode, reasonText }, attempt.token()),
    onSuccess: (r) => {
      attempt.onSuccess();
      toast.success(r.message ?? "Cari kilitlendi.");
      void qc.invalidateQueries({ queryKey: ["finance"] });
      void qc.invalidateQueries({ queryKey: ["cari-hold"] });
      onClose();
    },
    onError: (e) => {
      attempt.onFailure(e);
      setError(apiErrorText(e, "Kilit konamadı."));
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cariyi kilitle</DialogTitle>
          <DialogDescription>{cariName} — seçilen işlemler kilit açılana dek durur.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">Neler dursun?</legend>
            {CARI_HOLD_SCOPE_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} aria-label={o.label} />
                <span>
                  {o.label}
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mb-1 font-medium">Sebep</legend>
            <div className="flex flex-wrap gap-3">
              {CARI_HOLD_REASON_OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-1.5">
                  <input type="radio" name="hold-reason" checked={reasonCode === o.value} onChange={() => setReasonCode(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="hold-note">Açıklama (isteğe bağlı)</Label>
            <Textarea id="hold-note" maxLength={300} value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={selected.length === 0 || m.isPending} onClick={() => { setError(null); m.mutate(); }}>
            {m.isPending ? "Kilitleniyor…" : "Kilitle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
