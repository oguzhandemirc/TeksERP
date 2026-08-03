// =============================================================================
// Etiket Stüdyosu — koşullu basım (showIf) bölümü
// =============================================================================
// Saha ihtiyacı: "kalite YALNIZ 2. kalitede yazsın" — 1. kalite topun etiketinde
// kalite satırı hiç görünmesin (ya da tersi). Koşul HER eleman tipinde çalışır:
// veri alanı kadar sabit metin ("2. KALİTE" damgası) veya çerçeve de koşullanır.
//
// Kullanıcı kaliteyi ADIYLA seçer, şablona KOD yazılır (`QualityGrade.code` =
// `Roll.qualityGrade` snapshot'ı). Katalogdan düşmüş kod da listelenir (işaretli +
// "katalogda yok") — sessizce kaybolup ölü koşul bırakmasın.

import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { LabelElement } from "@/types/label-canvas";
import { useQualityGrades } from "./useQualityGrades";
import { editMode, editValue, type ConditionEdit, type ConditionMode as Mode } from "./condition-edit";

const MODE_LABELS: Record<Mode, string> = {
  always: "Her zaman bas",
  in: "Yalnız seçili kalitelerde bas",
  notIn: "Seçili kaliteler DIŞINDA bas",
};

export function ConditionSection({ element: el, onChange }: {
  element: LabelElement;
  onChange: (patch: Partial<LabelElement>) => void;
}) {
  const { grades, isLoading } = useQualityGrades();
  const cond = el.showIf;
  // Mod seçildi ama daha hiç kalite işaretlenmedi → koşul YALNIZ panelde bekler.
  // Elemana yazılsaydı `values: []` ile geçersiz koşul doğar, canlı önizleme 400
  // döner ve kullanıcı hiçbir şey yapmadan kırmızı görürdü (bkz. condition-edit.ts).
  // Eleman değişince sıfırlanır: PropertiesPanel bu bileşeni `key={el.id}` ile kurar.
  const [pending, setPending] = useState<Mode | null>(null);
  const mode: Mode = cond?.op ?? pending ?? "always";
  const selected = useMemo(() => new Set(cond?.values ?? []), [cond]);

  const apply = (edit: ConditionEdit) => {
    setPending(edit.pending);
    // null = elemana dokunma; undefined = koşulu kaldır (JSON'da anahtar düşer).
    if (edit.showIf !== null) onChange({ showIf: edit.showIf } as Partial<LabelElement>);
  };

  // Katalog + koşulda geçen ama katalogda olmayan kodlar (silinmiş derece).
  const rows = useMemo(() => {
    const known = grades.map((g) => ({ code: g.code, name: g.name, isActive: g.isActive, orphan: false }));
    const codes = new Set(known.map((r) => r.code));
    const orphans = [...selected]
      .filter((c) => !codes.has(c))
      .map((c) => ({ code: c, name: c, isActive: true, orphan: true }));
    return [...known, ...orphans];
  }, [grades, selected]);

  const setMode = (next: Mode) => apply(editMode(cond, next));
  const toggle = (code: string, on: boolean) => apply(editValue(cond, mode, code, on));

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2">
      <Label className="text-[10px] font-semibold text-muted-foreground">Koşullu basım (kalite)</Label>
      <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <SelectItem key={m} value={m} className="text-xs">{MODE_LABELS[m]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {mode !== "always" && (
        <>
          <div className="space-y-1">
            {isLoading && <p className="text-[10px] text-muted-foreground">Kaliteler yükleniyor…</p>}
            {rows.map((r) => (
              <label key={r.code} className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={selected.has(r.code)}
                  onCheckedChange={(v) => toggle(r.code, v === true)}
                />
                <span className={r.isActive ? undefined : "text-muted-foreground"}>{r.name}</span>
                <span className="font-mono text-[9px] text-muted-foreground">({r.code})</span>
                {r.orphan && <span className="text-[9px] text-amber-600">katalogda yok</span>}
                {!r.isActive && !r.orphan && <span className="text-[9px] text-muted-foreground">pasif</span>}
              </label>
            ))}
          </div>
          {selected.size === 0 && (
            <p className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              En az bir kalite seçin — seçim boşken koşul kaydedilmez (eleman her zaman basılır).
            </p>
          )}
          <p className="text-[10px] leading-snug text-muted-foreground">
            Kalite kodu topun üstüne YAZILDIĞI ANDAKİ koddur. Kalitesi belirlenmemiş
            topta (fason dönüşü / açık kumaş) koşullu eleman <strong>basılmaz</strong>.
            Etkisini görmek için önizlemedeki "Örnek kalite" seçimini değiştirin.
          </p>
        </>
      )}
    </div>
  );
}
