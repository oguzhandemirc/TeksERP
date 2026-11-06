// Sekme başlığı belge no'sunu taşır (ShipmentDetailPage emsali): birkaç belge açıkken sekmeler hep "Gelen Belgeler" görünüyordu.
import { useEffect } from "react";
import { useTabsStore } from "@/store/tabs";
import { isMultiParty, useNoteParties } from "./useNoteParties";

/** Detay sayfasının kabuk kancası: sekme başlığı + çok parti hükmü (toplam şeridi blok kartlarını Partiler kartına bırakır). */
export function useNoteTabTitle(id: string, noteNo: string | undefined): boolean {
  useEffect(() => {
    if (!id || !noteNo) return;
    const tab = useTabsStore.getState().tabs.find((t) => t.path === `/operations/gelen-belgeler/${id}`);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, noteNo);
  }, [id, noteNo]);
  return isMultiParty(useNoteParties(id).data);
}
