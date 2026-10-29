// Tarama görüntüsünü yetkili istekle çeker ve nesne adresine çevirir (`<img src>` token taşıyamaz).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScanBlob, INCOMING_DOCUMENT_QUERY_KEY } from "./service";

export function useScanImage(scanId: string | null) {
  const q = useQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "scan-blob", scanId],
    queryFn: () => fetchScanBlob(scanId as string),
    enabled: Boolean(scanId),
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return setUrl(null);
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);
  return { url, isLoading: q.isLoading, isError: q.isError, isPdf: q.data?.type === "application/pdf" };
}
