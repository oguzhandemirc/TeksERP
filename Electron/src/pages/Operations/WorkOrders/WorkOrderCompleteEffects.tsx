import { Badge } from "@/components/ui/badge";

interface Props {
  remainingSteps: { stepId: string; stationName: string; stepSequence: number }[];
  /** Dispozisyon uygulanacak top sayısı (0 = istasyonda top yok). */
  dispositionCount: number;
}

/** "Bu kapatma şunları yapacak" — onay öncesi somut etki listesi. */
export function WorkOrderCompleteEffects({ remainingSteps, dispositionCount }: Props) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-1 font-medium">Bu kapatma şunları yapacak:</div>
      <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
        {remainingSteps.length > 0 ? (
          <li>
            <span className="font-medium text-foreground">{remainingSteps.length}</span> kalan adım{" "}
            <Badge variant="muted" className="text-[10px]">
              ATLANDI
            </Badge>{" "}
            olacak ({remainingSteps.map((s) => s.stationName).join(", ")})
          </li>
        ) : (
          <li>Kalan (bekleyen) adım yok — tüm adımlar tamamlanmış/atlanmış.</li>
        )}
        {dispositionCount > 0 && (
          <li>
            <span className="font-medium text-foreground">{dispositionCount}</span> top seçtiğin
            dispozisyona göre istasyondan çıkarılacak
          </li>
        )}
        <li>
          İş emri durumu{" "}
          <Badge variant="muted" className="text-[10px]">
            TAMAMLANDI
          </Badge>{" "}
          olacak
        </li>
        <li>Aktif refakat kartları tamamlandı olarak işaretlenecek</li>
      </ul>
    </div>
  );
}
