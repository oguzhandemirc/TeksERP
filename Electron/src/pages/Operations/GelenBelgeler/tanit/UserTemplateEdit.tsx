// Belge tipini fotoğrafsız düzenle (Belge Tipleri): ad · kimlik yazıları · alan kaldır · barkoddan al · çok parti kuralı → PATCH `/tanim`.
// Birleşim SUNUCUDA (kural 114); gövde yalnız değişen parçayı + `expectedVersion` taşır. 409 (araya giren kayıt / sıfırlanmış tip)
// diyalogda "yenileyin" olarak kalır; hata toast'ını apiClient basar (ikinci toast yok).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatFactory } from "@/lib/factory-time";
import { errorCode } from "../approveFlow";
import { getIncomingDocumentSettings, INCOMING_DOCUMENT_QUERY_KEY, INCOMING_DOCUMENT_SETTINGS_QUERY_KEY } from "../service";
import { editUserTemplate, getUserTemplate, USER_TEMPLATES_QUERY_KEY } from "./service";
import { buildEditBody, draftOf, editProblem, factoryChoiceLabel, multiPartyLabel, templateFieldRows, type TemplateEditDraft } from "./templateRules";
import type { MultiPartyRule, UserTemplateDetail } from "./types";

export const MAX_IDENTIFIERS = 30;
const CONFLICT_CODES = new Set(["USER_TEMPLATE_VERSION_CHANGED", "USER_TEMPLATE_INACTIVE"]);

function KeywordList({ keywords, onChange }: { keywords: string[]; onChange: (k: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const full = keywords.length >= MAX_IDENTIFIERS;
  const add = () => {
    const t = draft.trim();
    if (t.length >= 2 && !keywords.includes(t) && !full) onChange([...keywords, t]);
    setDraft("");
  };
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">Kimlik yazıları (bu tip belgede hep aynı olan yazılar)</span>
      <div className="flex flex-wrap gap-1.5" data-testid="user-template-keywords">
        {keywords.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-sm">
            {k}
            <Button type="button" size="icon" variant="ghost" className="h-5 w-5" aria-label={`${k} kimlik yazısını çıkar`} onClick={() => onChange(keywords.filter((x) => x !== k))}>
              <X className="h-3 w-3" />
            </Button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={draft} maxLength={60} disabled={full} placeholder={full ? `En çok ${MAX_IDENTIFIERS} kimlik yazısı` : "Yeni kimlik yazısı"} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button type="button" variant="outline" onClick={add} disabled={full}>Ekle</Button>
      </div>
    </div>
  );
}

function FieldDropList({ detail, drop, onChange, barcode, onBarcode }: { detail: UserTemplateDetail; drop: string[]; onChange: (d: string[]) => void; barcode: string[]; onBarcode: (b: string[]) => void }) {
  const rows = templateFieldRows(detail.template);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">Alanlar (belgedeki yazı → iş emri karşılığı)</span>
      <ul className="divide-y rounded-md border" data-testid="user-template-fields">
        {rows.map((r) => {
          const gone = drop.includes(r.key);
          return (
            <li key={r.key} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm">
              <span className={gone ? "text-muted-foreground line-through" : ""}>
                <b className="font-medium">{r.woLabel}</b>
                {r.label !== r.woLabel && <span className="text-muted-foreground"> ← {r.label}</span>}
              </span>
              <label className="ml-auto flex shrink-0 items-center gap-1.5 text-xs" title="Fotoğraftaki barkod bu alanın biçimine uyuyorsa okunan yazının yerine barkod değeri kullanılır">
                <Checkbox checked={!gone && barcode.includes(r.key)} disabled={gone} onCheckedChange={(v) => onBarcode(v ? [...barcode, r.key] : barcode.filter((k) => k !== r.key))} aria-label={`${r.woLabel} alanını barkoddan al`} data-testid={`user-template-barcode-${r.key}`} />
                Barkoddan al
              </label>
              <label className="flex shrink-0 items-center gap-1.5 text-xs">
                <Checkbox checked={gone} onCheckedChange={(v) => onChange(v ? [...drop, r.key] : drop.filter((k) => k !== r.key))} aria-label={`${r.woLabel} alanını kaldır`} />
                Kaldır
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const RULE_CHOICES: ReadonlyArray<MultiPartyRule | null> = [null, "PER_PARTY", "SINGLE"];

export function MultiPartyChoice({ value, factory, onChange }: { value: MultiPartyRule | null; factory: MultiPartyRule | undefined; onChange: (v: MultiPartyRule | null) => void }) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">Birden çok parti gelirse</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Birden çok parti gelirse">
        {RULE_CHOICES.map((c) => (
          <Button key={c ?? "FACTORY"} type="button" size="sm" role="radio" aria-checked={value === c} variant={value === c ? "default" : "outline"} onClick={() => onChange(c)}>
            {c ? multiPartyLabel(c) : factoryChoiceLabel(factory)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ConflictLine({ code, onReload }: { code: string; onReload: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="user-template-conflict">
      {code === "USER_TEMPLATE_INACTIVE" ? "Bu belge tipi sıfırlanmış; düzenlemek için önce geri alın." : "Başka biri değiştirdi; yenileyip yeniden deneyin."}
      <Button type="button" size="sm" variant="outline" onClick={onReload}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Yenile</Button>
    </div>
  );
}

function EditBody({ detail, onDone, onReload }: { detail: UserTemplateDetail; onDone: () => void; onReload: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TemplateEditDraft>(() => draftOf(detail));
  const factory = useQuery({ queryKey: INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, queryFn: getIncomingDocumentSettings, staleTime: 60_000 });
  const set = (p: Partial<TemplateEditDraft>) => setDraft((d) => ({ ...d, ...p }));
  const body = buildEditBody(detail, draft);
  const problem = editProblem(draft, templateFieldRows(detail.template).length);
  const save = useMutation({
    mutationFn: () => editUserTemplate(detail.code, body!),
    onSuccess: (v) => {
      toast.success(`"${v.name}" kaydedildi (sürüm ${v.version}).`);
      if (v.warnings.length) toast.warning(v.warnings.join(" "));
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      onDone();
    },
  });
  const conflict = errorCode(save.error);
  return (
    <>
      <div className="max-h-[60vh] space-y-4 overflow-auto pr-1 text-sm">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Ad</span>
          <Input value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} data-testid="user-template-name" />
        </label>
        <KeywordList keywords={draft.keywords} onChange={(keywords) => set({ keywords })} />
        <FieldDropList detail={detail} drop={draft.drop} onChange={(drop) => set({ drop })} barcode={draft.barcode} onBarcode={(barcode) => set({ barcode })} />
        <MultiPartyChoice value={draft.multiParty} factory={factory.data?.multiPartyWorkOrder} onChange={(multiParty) => set({ multiParty })} />
        <p className="text-xs text-muted-foreground">Alan yerini değiştirmek ya da yeni alan eklemek için kartta "Fotoğrafla yeniden işaretle". Kod ({detail.code}) değişmez.</p>
        <div className="text-xs text-muted-foreground" data-testid="user-template-versions">
          Sürümler: {detail.versions.map((v) => `${v.version} (${formatFactory(v.createdAt, "dd.MM.yyyy HH:mm")})`).join(" · ")}
        </div>
        {conflict && CONFLICT_CODES.has(conflict) && <ConflictLine code={conflict} onReload={onReload} />}
      </div>
      <DialogFooter className="items-center gap-2">
        {(problem ?? (!body ? "Değişiklik yok." : null)) && <span className="mr-auto text-xs text-muted-foreground" data-testid="user-template-hint">{problem ?? "Değişiklik yok."}</span>}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !body || !!problem} data-testid="user-template-save">
          {save.isPending ? "Kaydediliyor…" : "Kaydet (yeni sürüm)"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** `compact`: tablo satırı sonundaki ikon düğme (Belge Tipleri listesi); test kimliği `-row` ekiyle ayrışır. */
export function UserTemplateEditButton({ code, name, compact = false }: { code: string; name: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({ queryKey: [...USER_TEMPLATES_QUERY_KEY, code, "duzenle"], queryFn: () => getUserTemplate(code), enabled: open, staleTime: 0 });
  return (
    <>
      {compact ? (
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpen(true)} title="Düzenle" aria-label={`${name} düzenle`} data-testid={`user-template-edit-${code}-row`}>
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`user-template-edit-${code}`}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> Düzenle
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Belge tipini düzenle — {name}</DialogTitle>
            <DialogDescription>Kayıt yeni sürüm açar; daha önce okunan belgeler okundukları sürümde kalır.</DialogDescription>
          </DialogHeader>
          {detail.data ? (
            <EditBody key={detail.data.version} detail={detail.data} onDone={() => setOpen(false)} onReload={() => void detail.refetch()} />
          ) : (
            <p className="text-sm text-muted-foreground">{detail.isError ? "Yüklenemedi." : "Yükleniyor…"}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
