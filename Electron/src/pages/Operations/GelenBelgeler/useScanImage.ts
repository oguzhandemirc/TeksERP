// Tarama görüntüsünü yetkili istekle çeker ve nesne adresine çevirir (`<img src>` token taşıyamaz).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScanBlob, INCOMING_DOCUMENT_QUERY_KEY } from "./service";

const isGone = (e: unknown) => (e as { response?: { status?: number } } | null)?.response?.status === 410;

/** K28: `purged` = fotoğraf saklama ayarıyla silindi (künyeden ya da 410 `DOCUMENT_SCAN_PURGED`); metin `SCAN_PURGED_TEXT`. */
export function useScanImage(scanId: string | null, opts?: { purged?: boolean }) {
  const q = useQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "scan-blob", scanId],
    queryFn: () => fetchScanBlob(scanId as string),
    enabled: Boolean(scanId) && !opts?.purged,
    staleTime: Infinity,
    // 410 kalıcıdır: yeniden denemek aynı cevabı verir.
    retry: (n, e) => !isGone(e) && n < 2,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return setUrl(null);
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);
  const purged = Boolean(opts?.purged) || (q.isError && isGone(q.error));
  return {
    url,
    isLoading: q.isLoading && !opts?.purged,
    isError: q.isError && !purged,
    purged,
    isPdf: q.data?.type === "application/pdf",
  };
}
