// Detay sorgusu + yazma mutasyonları; her yazım detayı ve listeyi tazeler (tek ad alanı `gelen-belge`).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { addLines, deleteLine, getDeliveryNote, getSuggestions, INCOMING_DOCUMENT_QUERY_KEY, updateLine, updateNoteHeader } from "./service";
import type { HeaderPatch, LineInput, LinePatch } from "./types";

export function useNoteDetail(id: string) {
  const qc = useQueryClient();
  const tabActive = useIsTabActive();
  const note = useQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "detail", id],
    queryFn: () => getDeliveryNote(id),
    // Okuma kuyruğundaki sayfa varken detay kendini tazeler (bant "okunuyor"dan sonuca geçsin); pasif sekme yoklamaz.
    refetchInterval: (q) => (tabActive && q.state.data?.scans.some((s) => s.mimeType !== "application/pdf" && (s.status === "PENDING" || s.status === "READING")) ? 5000 : false),
  });
  const suggestions = useQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "eslestirme", id],
    queryFn: () => getSuggestions(id),
    // PARTIAL da: düşen satırın düzeltmesi/yeniden onayı etkin varsayılan ipucunu (E4) bu yanıttan okur.
    enabled: note.data?.status === "DRAFT" || note.data?.status === "PARTIAL",
    staleTime: 60_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
  const header = useMutation({ mutationFn: (p: HeaderPatch) => updateNoteHeader(id, p), onSuccess: invalidate });
  const line = useMutation({
    mutationFn: (v: { lineId: string; patch: LinePatch }) => updateLine(id, v.lineId, v.patch),
    onSuccess: invalidate,
  });
  const removeLine = useMutation({ mutationFn: (lineId: string) => deleteLine(id, lineId), onSuccess: invalidate });
  return { note, suggestions, header, line, removeLine, invalidate };
}

/** Toplu satır yazımı — token çağıranın denemesinden gelir (mutationFn içinde ÜRETİLMEZ). */
export async function postLines(noteId: string, lines: LineInput[], token: string) {
  return addLines(noteId, lines, token);
}
