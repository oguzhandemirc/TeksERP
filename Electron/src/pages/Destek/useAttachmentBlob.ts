// Ek içeriği (§5.10) → `blob:` adresi. Adres bileşen yaşadığı sürece durur; blob değişince ya da bileşen
// kalkınca `URL.revokeObjectURL` ile bırakılır (bellek sızıntısı yok).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { destekService } from "./service";

/** Ek içeriği değişmez; aynı oturumda yeniden indirilmez. */
const CONTENT_STALE_MS = 30 * 60 * 1000;

export function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function useAttachmentContent(id: string, variant: "original" | "thumb", enabled: boolean) {
  const q = useQuery({
    queryKey: ["destek-ek-icerik", id, variant],
    queryFn: () => destekService.attachmentContent(id, variant),
    enabled,
    staleTime: CONTENT_STALE_MS,
    gcTime: CONTENT_STALE_MS,
    retry: false,
  });
  return { url: useObjectUrl(q.data), error: q.error, loading: q.isLoading };
}

/** PDF ve diğer görsel olmayan ek: baytları alıp gerçek adıyla kaydettirir (Electron kaydetme penceresi açar). */
export async function downloadAttachment(id: string, name: string): Promise<void> {
  const blob = await destekService.attachmentContent(id, "original");
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
