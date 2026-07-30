import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import { loadAllForPicker } from "@/lib/picker-loader";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import type { CloseDisposition, CompletePreviewRoll } from "./service";

/** Dispozisyon seçenekleri — etiket + kısa açıklama (operatör ne seçtiğini bilsin). */
export const DISPOSITION_OPTIONS: {
  value: CloseDisposition;
  label: string;
  hint: string;
}[] = [
  { value: "STOCK", label: "Ham stok", hint: "Kumaş geldiği gibi; yeni iş emrine sokulabilir" },
  { value: "WAREHOUSE", label: "Bitmiş depo", hint: "Satışa/sevke hazır sayılır" },
  { value: "A1_STOCK", label: "2. kalite", hint: "A1 satılabilir stok" },
  { value: "SCRAP", label: "Fire", hint: "Mal vardı, çöpe gitti" },
  { value: "CANCELLED", label: "Hatalı kayıt", hint: "Mal hiç yoktu — fire DEĞİL" },
  { value: "TRANSFER", label: "Yeni iş emrine devret", hint: "Üretim devam iş emrinde sürer" },
];

/** Kalite yalnız bu iki dispozisyonda anlamlı (backend diğerlerinde reddeder). */
const QUALITY_ACTIONS: CloseDisposition[] = ["WAREHOUSE", "A1_STOCK"];

export interface DispositionChoice {
  action: CloseDisposition | null;
  qualityGradeId: string | null;
}

interface Props {
  rolls: CompletePreviewRoll[];
  choices: Record<string, DispositionChoice>;
  onChange: (rollId: string, choice: DispositionChoice) => void;
}

/**
 * Kapanışta istasyonda kalan topların per-top dispozisyon listesi. Her satır bir
 * karar bekler; karar verilmeden kapatma onaylanamaz (dialog buton kilidi).
 */
export function WorkOrderCompleteDispositionList({ rolls, choices, onChange }: Props) {
  const gradesQ = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    staleTime: 5 * 60_000,
  });
  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);

  return (
    <>
      {/* Not satır İÇİNDE değil — satıra girip çıkan metin listeyi kaydırır ve
          kullanıcının imleci altındaki kutu yer değiştirir (yanlış satıra karar
          verilmesine yol açar). Tek yerde, listenin üstünde duruyor. */}
      <p className="text-[10px] text-muted-foreground">
        Depo / 2. kalite seçilen toplarda kalite boş bırakılabilir — top depoda &quot;kalite
        —&quot; olarak durur.
      </p>
      <ul className="space-y-2">
      {rolls.map((r) => {
        const choice = choices[r.id] ?? { action: null, qualityGradeId: null };
        const showQuality = choice.action != null && QUALITY_ACTIONS.includes(choice.action);
        return (
          <li key={r.id} data-testid={`dispo-${r.id}`} className="rounded-md border p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
                {r.colorName && (
                  <Badge variant="muted" className="gap-1 text-[10px]">
                    {r.colorHex && (
                      <span
                        className="h-2 w-2 rounded-full border"
                        style={{ backgroundColor: r.colorHex }}
                      />
                    )}
                    {r.colorName}
                  </Badge>
                )}
                {r.processed && (
                  <Badge variant="outline" className="text-[10px] text-amber-600">
                    işlenmiş
                  </Badge>
                )}
                {r.qualityGrade ? (
                  <Badge variant="muted" className="text-[10px]">
                    {r.qualityGrade}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">kalite —</span>
                )}
              </span>
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                {r.stationName} · <span className="tabular-nums">{formatNumber(r.currentQty, 0)} m</span>
              </span>
            </div>

            {/* SABİT iki kolon: kalite kutusu görünmese de yeri AYRILIR. Koşullu
                ekleme satır yüksekliğini değiştirip alttaki satırları kaydırıyordu —
                iki toplu kapanışta kullanıcı 1. satırı seçtikten sonra 2. satırın
                kutusu imlecin altından kayıyor ve yanlış karar veriliyordu. */}
            <div className="mt-2 grid grid-cols-2 items-center gap-2">
              <div className="min-w-0">
                <Select
                  value={choice.action ?? ""}
                  onValueChange={(v) =>
                    onChange(r.id, {
                      action: v as CloseDisposition,
                      // Aksiyon değişince bayat kalite seçimini düşür.
                      qualityGradeId: QUALITY_ACTIONS.includes(v as CloseDisposition)
                        ? choice.qualityGradeId
                        : null,
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Ne yapılsın?" />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPOSITION_OPTIONS.map((o) => {
                      // Fason dönüşü mal ham stoğa dönemez — seçenek kapalı.
                      const disabled = o.value === "STOCK" && !r.canReturnToStock;
                      return (
                        <SelectItem key={o.value} value={o.value} disabled={disabled}>
                          <span className="flex flex-col">
                            <span>{o.label}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {disabled ? "Fason dönüşü mal ham stoğa dönemez" : o.hint}
                            </span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                {showQuality && (
                  <Select
                    value={choice.qualityGradeId ?? ""}
                    onValueChange={(v) =>
                      onChange(r.id, { action: choice.action, qualityGradeId: v || null })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Kalite (opsiyonel)" />
                    </SelectTrigger>
                    <SelectContent>
                      {grades.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name} ({g.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </li>
        );
      })}
      </ul>
    </>
  );
}
