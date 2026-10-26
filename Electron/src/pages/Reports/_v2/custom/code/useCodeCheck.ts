// =============================================================================
// Kod modu — yerel sözdizimi + gecikmeli sunucu doğrulaması + görsele dönüş KİLİDİ
// =============================================================================
// Şema/semantik hükmü yalnız `POST /api/rapor-tanimlari/dogrula`dan gelir (istemci şemayı kopyalamaz).
// Kilit fail-closed: doğrulama bu metin için henüz dönmediyse ya da ulaşılamadıysa görsele geçilmez.
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customReportApi, type DefinitionIssue } from "../custom-api";
import { VALIDATE_DELAY_MS } from "../data/useDataPanel";
import { parseDefinitionText, type ParsedText } from "./definition-text";

export type CodeLock =
  | { kind: "syntax"; message: string }
  | { kind: "issues"; message: string }
  | { kind: "pending"; message: string }
  | { kind: "unavailable"; message: string };

export interface ServerVerdict {
  /** Hüküm bu metin için mi (gecikme dolmuş ve cevap gelmiş)? */
  fresh: boolean;
  failed: boolean;
  issues: readonly DefinitionIssue[];
}

/** Kilit kararı (saf): metin taslakla aynıysa kilit yok; aksi hâlde yerel parse + TAZE ve TEMİZ sunucu hükmü şart. */
export function codeLock(parsed: ParsedText, verdict: ServerVerdict, unchanged: boolean): CodeLock | null {
  if (unchanged) return null;
  if (!parsed.ok) return { kind: "syntax", message: "Önce hataları düzeltin: JSON sözdizimi hatalı." };
  if (verdict.failed) return { kind: "unavailable", message: "Önce hataları düzeltin: sunucu doğrulaması yapılamadı, yeniden deneyin." };
  if (!verdict.fresh) return { kind: "pending", message: "Doğrulanıyor…" };
  if (verdict.issues.length) return { kind: "issues", message: `Önce hataları düzeltin: ${verdict.issues.length} sorun var.` };
  return null;
}

/** Metin değişince 500 ms sonra `dogrula`; cevap yalnız aynı metne aitse "taze" sayılır. */
export function useCodeCheck(text: string, enabled: boolean) {
  const parsed = useMemo(() => parseDefinitionText(text), [text]);
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !parsed.ok) return;
    const t = setTimeout(() => setSettled(text), VALIDATE_DELAY_MS);
    return () => clearTimeout(t);
  }, [text, enabled, parsed.ok]);
  const query = useQuery({
    queryKey: ["custom-report-code-validate", settled],
    queryFn: () => customReportApi.validate(JSON.parse(settled!) as unknown),
    enabled: enabled && settled !== null,
    retry: false,
    staleTime: 60_000,
  });
  const current = settled === text && parsed.ok;
  const verdict: ServerVerdict = {
    fresh: current && query.isSuccess && !query.isFetching,
    failed: current && query.isError,
    issues: current && query.data ? query.data.hatalar : [],
  };
  return { parsed, verdict };
}
