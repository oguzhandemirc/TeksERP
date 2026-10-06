import { create } from "zustand";
import type { UpdateStatus } from "@/types/server-update";

export interface ApprovalPromptInfo {
  surum: string;
  kuruluSurum: string;
  ozet: string | null;
  zorunlu: boolean;
  pgGuncellemesi: boolean;
}

/**
 * Onay istemi açılsın mı? Kapı `eylemler.hemen` (onay ucunun kapısıyla AYNI yüklem — backend `approvalActions`) +
 * sürüm bekleyen adayın kendisi + henüz verilmiş onay yok. Panel ayrı bir karar üretmez.
 */
export function approvalPrompt(s: UpdateStatus | undefined): ApprovalPromptInfo | null {
  if (!s) return null;
  const e = s.eylemler;
  const b = s.bekleyen;
  if (!e.hemen || !e.hedefSurum || !b || s.onay !== null) return null;
  if (b.surum !== e.hedefSurum || b.surum === s.kuruluSurum || b.karar !== "ONAY_BEKLIYOR") return null;
  return { surum: b.surum, kuruluSurum: s.kuruluSurum, ozet: b.ozet, zorunlu: b.zorunlu, pgGuncellemesi: b.pgGuncellemesi };
}

/** "Sonra" yalnız bu panel oturumu için sürümü susturur (bellekte; yeniden açılışta istem döner). Karar backend'e yazılmaz. */
export const useApprovalPromptStore = create<{ dismissed: string[]; dismiss: (surum: string) => void }>((set) => ({
  dismissed: [],
  dismiss: (surum) => set((st) => (st.dismissed.includes(surum) ? st : { dismissed: [...st.dismissed, surum] })),
}));
