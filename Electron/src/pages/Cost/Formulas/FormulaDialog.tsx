// Ek maliyet formülü yaz/değiştir — geniş form (kısa alanlar ızgarada, değişkenler ⓘ ve tıklanır çiplerde).
// İfade yazıldıkça 400 ms durulmuş hâli örnek değerlerle sunucuda hesaplanır (yazmaz); hesap sunucuda, istemcide aritmetik yok.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, FunctionSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/FormField";
import { FieldGrid, FormCard, WideFormDialog } from "@/components/forms/WideFormDialog";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { apiErrorMessage } from "@/services/apiClient";
import type { Currency } from "@/pages/Finance/service";
import { CurrencySelect } from "../shared/CurrencySelect";
import { costFormulaService, type CostFormula, type CostFormulaVariable } from "./service";
import { FORMULA_MAX } from "./schema";

interface Props { onClose: () => void; current: CostFormula | null }

const EXPRESSION_HINT = "Dört işlem (+ − × ÷ ya da * /), parantez ve min(a; b), max(a; b), round(x; hane). Ondalık virgülle yazılabilir (0,05). Sonuç formülün para biriminde METRE BAŞINA tutardır; genel giderden önce maliyete eklenir.";

function VariableChips({ vars, onPick }: { vars: CostFormulaVariable[]; onPick: (name: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {vars.map((v) => (
        <button
          key={v.name}
          type="button"
          disabled={!v.bagli}
          onClick={() => onPick(v.name)}
          title={`${v.label} (${v.unit}) — örnek ${v.sample}${v.bagli ? "" : " · henüz bağlı değil"}`}
          className="rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {v.name}
        </button>
      ))}
    </div>
  );
}

function PreviewLine({ expression }: { expression: string }) {
  const settled = useDebouncedValue(expression.trim(), 400);
  const q = useQuery({
    queryKey: ["cost-formula-preview", settled],
    queryFn: () => costFormulaService.preview(settled),
    enabled: settled.length > 0,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  if (!settled) return <p className="text-sm text-muted-foreground">Formül yazınca örnek değerlerle sonuç burada görünür.</p>;
  if (q.isFetching && !q.data) return <p className="text-sm text-muted-foreground">Hesaplanıyor…</p>;
  if (q.isError) return <p className="text-sm text-destructive">{apiErrorMessage(q.error, "Formül okunamadı.")}</p>;
  if (q.data?.hata) return <p className="text-sm text-destructive">{q.data.hata}</p>;
  return <p className="text-sm">Örnek değerlerle sonuç: <span className="font-semibold tabular-nums">{q.data?.sonuc?.replace(".", ",")}</span> / m</p>;
}

export function FormulaDialog({ onClose, current }: Props) {
  const qc = useQueryClient();
  const vars = useQuery({ queryKey: ["cost-formula-variables"], queryFn: costFormulaService.variables, staleTime: 5 * 60_000 });
  const [code, setCode] = useState(current?.code ?? "");
  const [name, setName] = useState(current?.name ?? "");
  const [expression, setExpression] = useState(current?.expression ?? "");
  const [currency, setCurrency] = useState<Currency>(current?.currency ?? "TRY");
  const [sortOrder, setSortOrder] = useState(String(current?.sortOrder ?? 0));
  const [note, setNote] = useState(current?.note ?? "");
  const exprRef = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = exprRef.current;
    const at = el?.selectionStart ?? expression.length;
    setExpression(`${expression.slice(0, at)}${token}${expression.slice(el?.selectionEnd ?? at)}`);
    requestAnimationFrame(() => el?.focus());
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { code: code.trim(), name: name.trim(), expression: expression.trim(), currency, sortOrder: sortOrder.trim() || "0", note: note.trim() || null };
      return current ? costFormulaService.change(current.id, body) : costFormulaService.create(body);
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Formül kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["cost-formulas"] });
      onClose();
    },
  });
  const canSave = !!code.trim() && !!name.trim() && !!expression.trim() && /^\d{1,3}$/.test(sortOrder) && !save.isPending;
  const varHelp = (vars.data ?? []).map((v) => `${v.name}: ${v.label} (${v.unit})${v.bagli ? "" : " — henüz bağlı değil"}`).join(" · ");
  return (
    <WideFormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={current ? `${current.name} — formülü değiştir` : "Yeni ek maliyet formülü"}
      description="Değişiklik formülün yeni sürümüdür; eski sürüm damgalı kalır ve kayıtlı standart maliyetler yazıldıkları formülle kalır."
      onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" disabled={!canSave}>Kaydet</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormCard title="Formül" icon={FunctionSquare}>
          <FieldGrid cols={4}>
            <FormField label="Ad" htmlFor="cf-name" required>
              <Input id="cf-name" maxLength={FORMULA_MAX.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Pul işçiliği" />
            </FormField>
            <FormField label="Kod" htmlFor="cf-code" required info={current ? "Kod sabittir: değişiklik aynı formülün yeni sürümüdür." : "Harf, rakam, - ve _ (en çok 32)."}>
              <Input id="cf-code" maxLength={FORMULA_MAX.code} disabled={!!current} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </FormField>
            <FormField label="Para birimi" info="Formül sonucu bu para biriminde metre başı tutardır; TL dışı ise hesap günün kuruyla çevirir.">
              <CurrencySelect value={currency} onChange={setCurrency} />
            </FormField>
            <FormField label="Sıra" htmlFor="cf-sort" info="Birden çok formül varsa maliyet dökümünde bu sırayla listelenir (0–999).">
              <Input id="cf-sort" className="text-right tabular-nums" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </FormField>
          </FieldGrid>
          <div className="mt-3 space-y-2">
            <FormField label="İfade" htmlFor="cf-expr" required info={EXPRESSION_HINT}>
              <Textarea id="cf-expr" ref={exprRef} rows={3} maxLength={FORMULA_MAX.expression} className="font-mono" value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="ör. atkiSikligi * 0,02 * usd" />
            </FormField>
            <FormField label="Değişkenler" info={varHelp || "Yükleniyor…"}>
              <VariableChips vars={vars.data ?? []} onPick={insert} />
            </FormField>
            <FormField label="Not" htmlFor="cf-note">
              <Input id="cf-note" maxLength={FORMULA_MAX.note} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </div>
        </FormCard>
        <FormCard title="Önizleme" icon={Calculator}>
          <PreviewLine expression={expression} />
        </FormCard>
      </div>
    </WideFormDialog>
  );
}
