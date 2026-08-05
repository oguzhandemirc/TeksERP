import { useQuery } from "@tanstack/react-query";
import { Hash } from "lucide-react";
import { featureFlagService } from "@/services/featureFlagService";

/**
 * "Şu an: P42 · Sıradaki: P43" göstergesi — kısa parti no bayrağının altında.
 *
 * NEDEN VAR: kısa numara KÖRLEMESİNE sarıyor (numaranın o an canlı bir partide
 * kullanılıp kullanılmadığına bakılmıyor). Fabrikanın FİZİKSEL numaralı plaka
 * setiyle sistemi karşılaştırabileceği tek yüzey burası.
 *
 * ⚠️ "Sıradaki" bir ÖNİZLEMEDİR, rezervasyon DEĞİL — bu satır okunduktan sonra
 * bir parti doğarsa gerçekleşen numara farklı olur. Metin bilerek "ayrılmış"
 * demiyor.
 *
 * Sorgu bayrak kapalıyken de koşar ama uç `enabled:false` + null numaralar döner;
 * o durumda hiçbir şey çizilmez (kapalı rejimde sayaç kavramı yoktur).
 */
export function BatchNumberHint() {
  const q = useQuery({
    queryKey: ["batch-number-state"],
    queryFn: featureFlagService.getBatchNumberState,
    staleTime: 30_000,
  });
  const s = q.data?.data;
  if (!s?.enabled) return null;

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        {s.lastCode ? (
          <>
            Son kullanılan parti no <span className="font-mono font-semibold">{s.lastCode}</span> ·
            sıradaki <span className="font-mono font-semibold">{s.nextCode}</span>
          </>
        ) : (
          <>
            Henüz kısa parti no üretilmedi — ilki{" "}
            <span className="font-mono font-semibold">{s.nextCode}</span> olacak
          </>
        )}
        <span className="ml-1 opacity-70">
          (aralık P{String(s.min).padStart(2, "0")}–P{s.max}; sıradaki tahminidir, ayrılmış değildir)
        </span>
      </span>
    </div>
  );
}
