// Onay kipi (`gelenBelge.entryMode`) — ayar ucundan (gelen-belge:read); onay diyaloğuyla aynı önbellek anahtarı.
import { useQuery } from "@tanstack/react-query";
import { getIncomingDocumentSettings, INCOMING_DOCUMENT_SETTINGS_QUERY_KEY } from "./service";
import { entryModeOf } from "./partiMetre";
import type { DeliveryNoteDetail, EntryMode } from "./types";

export function useEntryMode(): EntryMode {
  const settings = useQuery({ queryKey: INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, queryFn: getIncomingDocumentSettings, staleTime: 60_000 });
  return entryModeOf(settings.data);
}

/** Kartlar yalnız PER_DOCUMENT kipinde VE sunucu alanları gönderiyorsa (eski backend → bugünkü görünüm). */
export function showsPerDocument(mode: EntryMode, n: DeliveryNoteDetail): boolean {
  return mode === "PER_DOCUMENT" && (n.kursunMeters !== undefined || n.batchNoCandidates !== undefined);
}
