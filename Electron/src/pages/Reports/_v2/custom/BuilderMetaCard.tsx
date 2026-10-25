import { useState } from "react";
import { AlertCircle, Eye, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ParamPickerDialog } from "../ParamPickerDialog";
import type { Category, DefinitionIssue } from "./custom-api";
import { stepReady, type BuilderState } from "./builder-model";

interface Props {
  state: BuilderState;
  categories: readonly Category[];
  categoryId: string | undefined;
  issues: readonly DefinitionIssue[];
  busy: boolean;
  onTitle: (title: string) => void;
  onCategory: (id: string) => void;
  onPreview: () => void;
  onSave: () => void;
}

/** Ad, kategori, sunucunun doğrulama mesajları ve önizle/kaydet düğmeleri. */
export function BuilderMetaCard({ state, categories, categoryId, issues, busy, onTitle, onCategory, onPreview, onSave }: Props) {
  const [picking, setPicking] = useState(false);
  const ready = stepReady(state, 0) && stepReady(state, 1);
  const active = categories.filter((c) => c.aktif);
  const category = active.find((c) => c.id === categoryId);
  return (
    <aside className="flex flex-col gap-3 rounded-lg border p-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Raporun adı
        <Input value={state.title} maxLength={150} placeholder="Örn. Müşteriye göre aylık sevk" onChange={(e) => onTitle(e.target.value)} />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Kategori</span>
        <Button type="button" variant="outline" className="justify-start" onClick={() => setPicking(true)}>
          {category?.ad ?? "Kayıtlı raporlar"}
        </Button>
      </div>
      {issues.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" aria-label="Doğrulama hataları">
          {issues.map((i) => (
            <li key={`${i.yol}:${i.mesaj}`} className="flex gap-1.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {i.mesaj}
                {i.oneri ? ` Şunu mu demek istediniz: ${i.oneri}?` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="flex-1 gap-1.5" disabled={!ready || busy} onClick={onPreview}>
          <Eye className="h-4 w-4" /> Önizle
        </Button>
        <Button type="button" className="flex-1 gap-1.5" disabled={!ready || busy} onClick={onSave}>
          <Save className="h-4 w-4" /> Kaydet
        </Button>
      </div>
      {!ready ? <p className="text-xs text-muted-foreground">Kaydetmek için önce küp ve en az bir ölçü seçin.</p> : null}
      <ParamPickerDialog
        open={picking}
        title="Kategori seçin"
        multiple={false}
        allowAll={false}
        options={active.map((c) => ({ deger: c.id, etiket: c.ustId ? `${active.find((p) => p.id === c.ustId)?.ad ?? ""} › ${c.ad}` : c.ad }))}
        selected={categoryId ? [categoryId] : []}
        onApply={([v]) => v && onCategory(v)}
        onClose={() => setPicking(false)}
      />
    </aside>
  );
}
