import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * "N iade" rozeti — sevkiyat listelerinde (operasyon + muhasebe) ORTAK.
 *
 * Neden ortak: sevk rakamları BRÜT'tür (kök CLAUDE.md 2026-08-02) — listedeki metraj
 * ve top adedi iade sonrası DÜŞMEZ. Bu rozet, farkın nerede olduğunu söyleyen tek
 * işarettir; iki ekranda farklı görünmesi ya da birinde hiç olmaması, muhasebecinin
 * iade faturası kesilecek sevki kaçırmasına yol açar (2026-08-02 denetim bulgusu:
 * muhasebe ekranında `_count.returns` payload'da vardı ama hiç basılmıyordu).
 */
export function ReturnsBadge({ count }: { count: number }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <Badge
      variant="outline"
      className="gap-0.5 border-amber-500/40 px-1 py-0 text-[10px] font-normal text-amber-600"
      title="Bu sevkiyattan sonra iade alınan top sayısı — yukarıdaki rakamlardan DÜŞÜLMEMİŞTİR (detayda dökümü var)"
    >
      <Undo2 className="h-3 w-3" /> {count} iade
    </Badge>
  );
}
