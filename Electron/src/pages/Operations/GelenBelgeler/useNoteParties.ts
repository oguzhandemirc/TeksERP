// Partiler görünümü (`GET /irsaliyeler/:id/partiler`) — Partiler kartı, parti no kartı ve "İE aç" kapısı AYNI sorguyu paylaşır.
import { useQuery } from "@tanstack/react-query";
import { getNoteParties, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import type { NotePartiesView } from "./partiesTypes";

export function useNoteParties(noteId: string) {
  return useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "partiler", noteId], queryFn: () => getNoteParties(noteId), retry: false, enabled: !!noteId });
}

/** Kart çizilir mi: iki ya da daha çok parti (sunucu `multi`). */
export function isMultiParty(v: NotePartiesView | undefined): boolean {
  return !!v?.multi && v.parties.length >= 2;
}

/** İE'si açık sayılan durumlar: iptal ve devredilen (toplar başka İE'de) sayılmaz. */
const DEAD_WO = new Set(["CANCELLED", "SUPERSEDED"]);

/**
 * "İE aç" kapanır mı: her partinin canlı bağlı İE'si varsa açılacak parti kalmamıştır. Bağ bilgisi yoksa (eski sunucu,
 * satır başına kip — özet satırı yok) düğme bugünkü gibi açık kalır.
 */
export function allPartiesHaveWorkOrder(v: NotePartiesView | undefined): boolean {
  if (!v || v.parties.length === 0) return false;
  return v.parties.every((p) => (p.workOrders ?? []).some((w) => !DEAD_WO.has(w.status)));
}
