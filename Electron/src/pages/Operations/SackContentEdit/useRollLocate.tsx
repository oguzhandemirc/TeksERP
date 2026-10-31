// "Bu top nerede?" okutması (Çuvallar ekranı). Belirsiz müşteri kodu → aday modalı; seçim topun
// iç barkoduyla aynı "nerede?", Vazgeç → kart yok (D4-F1c, K12 — sessiz seçim yok).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useCustomerCodeChoice } from "@/components/scanner/useCustomerCodeChoice";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { sackHubService } from "./service";
import type { LocatedRoll } from "./types";

export function useRollLocate(setSearch: (v: string) => void) {
  const [located, setLocated] = useState<LocatedRoll | null>(null);
  const choice = useCustomerCodeChoice();
  const customerCodeLookup = useFeatureFlags().data?.data?.scanCustomerCodeLookupEnabled === true;
  const locate = useMutation({
    mutationFn: ({ code, probe }: { code: string; probe: boolean }) =>
      choice.resolveScan(code, (c) => sackHubService.locateRoll(c, probe)),
    onSuccess: (res) => setLocated(res?.data ?? null),
    onError: () => setLocated(null),
  });

  // Tek giriş: top barkodu → "nerede?" (locate); metin/çuval kodu → aramaya.
  const handleScan = (code: string) => {
    const kind = classifyBarcode(code).kind;
    if (kind === "ROLL") {
      locate.mutate({ code, probe: false });
      setSearch(""); // barkod arama kutusunu kirletmesin
      return;
    }
    setSearch(code);
    // Müşteri barkodu serisizdir (UNKNOWN): ayar açıkken aramaya ek SESSİZ "nerede?" sondası.
    if (kind === "UNKNOWN" && customerCodeLookup) locate.mutate({ code, probe: true });
  };

  return { located, clearLocated: () => setLocated(null), handleScan, busy: locate.isPending, dialog: choice.dialog };
}
