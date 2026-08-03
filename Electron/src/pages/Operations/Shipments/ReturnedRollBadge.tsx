import { Undo2 } from "lucide-react";
import { formatDate } from "@/lib/format";

/**
 * "İADE" rozeti — çuval içeriğinde, sevk edildikten SONRA iade alınmış topun
 * yanında durur.
 *
 * NEDEN SATIR SİLİNMİYOR DA İŞARETLENİYOR: "hangi çuvalda ne gitti" sevk ANININ
 * sorusudur; iade sonradan olan AYRI bir olaydır ve çıkış belgesini geriye dönük
 * değiştiremez (kök CLAUDE.md 2026-08-02 brüt kuralı + sevk irsaliyesi/iade
 * irsaliyesi ayrımı). Satırı listeden düşürmek, sevkiyatın kendi belgesiyle
 * çelişmesi demekti — saha vakası SVK0308260001: irsaliye 4 top derken ekran
 * "0 top · 0 m" diyordu.
 *
 * METRAJ ÜSTÜ ÇİZİLİ DEĞİL (bilinçli): üstü çizgi "bu sayı geçersiz" der. Oysa o
 * metraj brüt toplama DAHİLDİR ve irsaliyede duruyor. Geçersiz değil, geri gelmiş.
 */
export function ReturnedRollBadge({
  returnedAt,
  reasonName,
}: {
  returnedAt: string;
  reasonName?: string | null;
}) {
  return (
    <span
      className="mr-1 inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px align-middle text-[9px] font-semibold uppercase leading-none text-amber-700 dark:text-amber-400"
      title={
        reasonName
          ? `${formatDate(returnedAt)} tarihinde iade alındı — ${reasonName}`
          : `${formatDate(returnedAt)} tarihinde iade alındı`
      }
    >
      <Undo2 className="h-2.5 w-2.5" />
      İade
    </span>
  );
}
