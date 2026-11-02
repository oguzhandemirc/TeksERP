// İş emri açılınca refakat kartını otomatik bas (K9; üretim ayarı `refakatAutoPrint`, varsayılan kapalı = bugünkü).
// Baskı yolu TravelerCardPrintDialog ile aynı: backend HTML'i → `printTracked` → yalnız kâğıt çıkınca `print-event`.
import { printTracked } from "@/lib/print";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { workOrderService } from "../service";

/** Ayar okuması; eski backend alanı göndermez → false (bugünkü davranış). */
export function useRefakatAutoPrint(): boolean {
  const q = useFeatureFlags();
  return (q.data?.data as { refakatAutoPrint?: boolean } | undefined)?.refakatAutoPrint === true;
}

export type AutoPrintOutcome = "PRINTED" | "CANCELLED" | "NO_CARD" | "FAILED";

/** Kart yoksa/okunamazsa sessiz düşmez: sonuç döner, çağıran tek satır bilgi yazar. */
export async function printRefakatCard(workOrderId: string): Promise<AutoPrintOutcome> {
  try {
    const cards = (await workOrderService.getTravelerCardHistory(workOrderId)).data ?? [];
    const card = cards.find((c) => c.status === "ACTIVE") ?? null;
    if (!card) return "NO_CARD";
    const html = await workOrderService.getTravelerCardHtml(card.id);
    const out = await printTracked({ subject: { kind: "REFAKAT_KARTI", table: "traveler_cards", id: card.id }, html, workEndpoint: true });
    if (!out.proceed) return "CANCELLED";
    await workOrderService.recordTravelerCardPrint(card.id, out.printJob).catch(() => undefined);
    return "PRINTED";
  } catch {
    return "FAILED";
  }
}

export const AUTO_PRINT_TEXT: Record<AutoPrintOutcome, string> = {
  PRINTED: "Refakat kartı yazdırıldı.",
  CANCELLED: "Refakat kartı yazdırılmadı (iptal edildi) — iş emri detayından basabilirsiniz.",
  NO_CARD: "Refakat kartı bulunamadı — iş emri detayından basın.",
  FAILED: "Refakat kartı yazdırılamadı — iş emri detayından basın.",
};
