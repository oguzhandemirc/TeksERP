// Okutma noktasının ortak sarmalayıcısı (D4-F1c): okut → 409 CUSTOMER_CODE_AMBIGUOUS → aday modalı →
// seçilen topun İÇ barkoduyla AYNI işlem. Vazgeç → null (işlem yok). Tekil kodda modal açılmaz.
import { useCallback, useEffect, useRef, useState } from "react";
import { readAmbiguousCustomerCode, type AmbiguousCustomerCode, type CustomerCodeCandidate } from "@/lib/customer-code-choice";
import { CustomerCodeCandidateDialog } from "./CustomerCodeCandidateDialog";

export function useCustomerCodeChoice() {
  const [notice, setNotice] = useState<AmbiguousCustomerCode | null>(null);
  const settle = useRef<((c: CustomerCodeCandidate | null) => void) | null>(null);

  const close = useCallback((picked: CustomerCodeCandidate | null) => {
    setNotice(null);
    const fn = settle.current;
    settle.current = null;
    fn?.(picked);
  }, []);

  // Modal açıkken ekran kalkarsa bekleyen seçim null'la kapanır (işlem yok, söz asılı kalmaz).
  useEffect(() => () => settle.current?.(null), []);

  /** `run(code)` okutmayı yürütür; belirsizlikte kullanıcıya sorar, seçimde `run(iç barkod)` ile tekrarlar. */
  const resolveScan = useCallback(async <T,>(code: string, run: (code: string) => Promise<T>): Promise<T | null> => {
    try {
      return await run(code);
    } catch (error) {
      const ambiguous = readAmbiguousCustomerCode(error);
      if (!ambiguous) throw error;
      settle.current?.(null);
      const picked = await new Promise<CustomerCodeCandidate | null>((resolve) => {
        settle.current = resolve;
        setNotice(ambiguous);
      });
      if (!picked?.barcode) return null;
      return run(picked.barcode);
    }
  }, []);

  const dialog = <CustomerCodeCandidateDialog notice={notice} onPick={(c) => close(c)} onCancel={() => close(null)} />;
  return { resolveScan, dialog };
}
