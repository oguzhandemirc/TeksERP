// "Etiketi düzenle" kipi: solda canlı önizleme (kaydetmeden, POST …/preview), sağda form —
// bir seferlik şablon, şablonun bağladığı her alan, müşteri (kayıtlı cari / stok / serbest ad).
// Kaydet basmaz; "Kaydet ve bas" kaydedip çağırana basım için döner. Kayıt yalnız gösterimdir.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Package, Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  rollLabelEditService,
  type RollLabelCustomerChoice,
  type RollLabelEditDraft,
  type RollLabelEditView,
  type LabelPreviewResult,
} from "@/services/rollLabelEditService";
import { LabelPreviewZoom } from "./LabelPreviewZoom";
import { RollLabelEditFieldRow } from "./RollLabelEditFieldRow";

interface Props {
  rollId: string;
  peripheralId?: string;
  confirmScrap: boolean;
  canSave: boolean;
  canPrint: boolean;
  onCancel: () => void;
  /** Kayıt bitti; `print` true ise çağıran basar (kayıtlı hâli backend çözer). */
  onSaved: (print: boolean) => void;
}

export function RollLabelEditPanel(props: Props) {
  const formQ = useQuery({
    queryKey: ["roll-label-edit-form", props.rollId, props.peripheralId ?? null],
    queryFn: () => rollLabelEditService.getEditForm(props.rollId, props.peripheralId),
    staleTime: 0,
  });
  if (formQ.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (formQ.isError || !formQ.data) {
    return <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">Düzenleme formu alınamadı.</div>;
  }
  // Form yeniden yüklenince (kayıt sonrası) taslak sıfırlansın: anahtar sürüm belirtecidir.
  return <EditBody key={formQ.data.labelEditedAt ?? "ilk"} view={formQ.data} {...props} />;
}

function EditBody({ view, rollId, peripheralId, confirmScrap, canSave, canPrint, onCancel, onSaved }: Props & { view: RollLabelEditView }) {
  const [templateChoice, setTemplateChoice] = useState(view.templateId ?? "");
  const [fields, setFields] = useState<Record<string, string | null>>({});
  const [customer, setCustomer] = useState<RollLabelCustomerChoice | undefined>();
  const [customerLabel, setCustomerLabel] = useState(view.customerName);
  const readOnly = Boolean(view.locked) || !canSave;

  const draft: RollLabelEditDraft = useMemo(
    () => ({
      ...(templateChoice !== (view.templateId ?? "") ? { templateId: templateChoice || null } : {}),
      fields,
      ...(customer ? { customer } : {}),
    }),
    [templateChoice, fields, customer, view.templateId],
  );
  const dirty = draft.templateId !== undefined || Object.keys(fields).length > 0 || customer !== undefined;
  const debounced = useDebouncedValue(draft, 350);

  const previewQ = useQuery({
    queryKey: ["roll-label-draft-preview", rollId, peripheralId ?? null, confirmScrap, debounced],
    queryFn: () => rollLabelEditService.previewDraft(rollId, debounced, { confirmScrap, peripheralId }),
    placeholderData: (prev) => prev,
    staleTime: 0,
  });

  const setField = (key: string, v: string | null | undefined) =>
    setFields((cur) => {
      const next = { ...cur };
      if (v === undefined) delete next[key];
      else next[key] = v;
      return next;
    });

  const saveMut = useSaveLabelEdit(rollId, draft, view.labelEditedAt, onSaved);

  return (
    <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <div className="min-w-0">
        <DraftPreview q={previewQ} />
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        {view.locked && (
          <div className="flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
            <Lock className="h-3.5 w-3.5" /> {view.locked.reason}
          </div>
        )}
        <TemplateSelect view={view} value={templateChoice} disabled={readOnly} onChange={setTemplateChoice} />

        <CustomerSection
          view={view}
          customer={customer}
          label={customerLabel}
          disabled={readOnly}
          onPick={(id, name) => {
            setCustomer({ customerId: id });
            setCustomerLabel(name);
            // Kayıtlı cari seçildi → elle yazılmış ad kalkar (cari adı basılsın).
            setField("customerName", view.fields.find((f) => f.key === "customerName")?.overridden ? null : undefined);
          }}
          onStock={() => setCustomer({ stock: true })}
        />

        <FieldList view={view} templateChoice={templateChoice} fields={fields} disabled={readOnly} onChange={setField} />

        <EditActions
          onCancel={onCancel}
          saveDisabled={readOnly || saveMut.isPending}
          printDisabled={readOnly || saveMut.isPending || !view.barcode}
          canPrint={canPrint}
          onSave={(print) => saveMut.mutate(print)}
        />
        {dirty && <p className="text-right text-[10px] text-amber-700 dark:text-amber-400">Kaydedilmemiş değişiklik var.</p>}
      </div>
    </div>
  );
}

function DraftPreview({ q }: { q: UseQueryResult<LabelPreviewResult> }) {
  return (
    <>
        {q.isError ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">Önizleme alınamadı: {(q.error as Error).message}</div>
        ) : !q.data ? (
          <Skeleton className="h-[560px] w-full" />
        ) : q.data.mode === "text" ? (
          <pre className="h-[560px] overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/20 p-3 font-mono text-[11px]">{q.data.content}</pre>
        ) : (
          <LabelPreviewZoom content={q.data.content} title="Düzenlenen etiket" />
        )}
    </>
  );
}

function TemplateSelect({ view, value, disabled, onChange }: { view: RollLabelEditView; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const chainName = view.templates.find((t) => t.id === view.chainTemplateId)?.name ?? "bağlam varsayılanı";
  return (
        <div className="space-y-1">
          <label htmlFor="label-edit-template" className="text-xs font-medium">Şablon (yalnız bu top için)</label>
          <select
            id="label-edit-template"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Varsayılan — {chainName}</option>
            {view.templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">Müşteri/cihaz şablon atamaları değişmez.</p>
        </div>

  );
}

function CustomerSection(p: {
  view: RollLabelEditView;
  customer: RollLabelCustomerChoice | undefined;
  label: string | null;
  disabled: boolean;
  onPick: (id: string, name: string | null) => void;
  onStock: () => void;
}) {
  const { view, customer, disabled, onPick, onStock } = p;
  const customerText = customer && "stock" in customer ? "Stok (müşterisiz)" : (p.label ?? "Müşteri yok");
  return (
        <div className="space-y-1 rounded-md border px-2 py-1.5">
          <div className="text-xs font-medium">Müşteri (kayıtlı)</div>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <EntityPickerModal<Customer>
                value={customer && "customerId" in customer ? customer.customerId : view.customerId}
                onChange={(id, c) => id && onPick(id, c?.name ?? null)}
                service={customerService}
                queryKey="customers"
                getLabel={(c) => `${c.code} — ${c.name}`}
                placeholder={customerText}
                disabled={disabled}
                triggerClassName="h-8 text-sm"
              />
            </div>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" disabled={disabled} onClick={onStock}>
              <Package className="h-3.5 w-3.5" /> Stok
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Listede yoksa aşağıdaki “Müşteri” alanına elle yazın; cariye kaydedilmez.</p>
        </div>
  );
}

function useSaveLabelEdit(rollId: string, draft: RollLabelEditDraft, editedAt: string | null, onSaved: (print: boolean) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (print: boolean) => rollLabelEditService.save(rollId, draft, editedAt).then((r) => ({ r, print })),
    onSuccess: ({ r, print }) => {
      toast.success(r.changed ? "Etiket kaydedildi — sonraki basımlar bu hâliyle çıkar." : "Etiket zaten bu hâlde.");
      for (const k of ["label-roll", "label-roll-preview", "roll-label-edit-form", "relabel-context"]) {
        void qc.invalidateQueries({ queryKey: [k, rollId] });
      }
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      onSaved(print);
    },
    // Bayat sürüm (409 LABEL_EDIT_STALE) — mesajı apiClient gösterir; form tazelenir.
    onError: () => void qc.invalidateQueries({ queryKey: ["roll-label-edit-form", rollId] }),
  });
}

function EditActions(p: { onCancel: () => void; saveDisabled: boolean; printDisabled: boolean; canPrint: boolean; onSave: (print: boolean) => void }) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
      <Button type="button" size="sm" variant="destructive" onClick={p.onCancel}>Vazgeç</Button>
      <div className="ml-auto flex gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1" disabled={p.saveDisabled} onClick={() => p.onSave(false)}>
          <Save className="h-3.5 w-3.5" /> Kaydet
        </Button>
        {p.canPrint && (
          <Button type="button" size="sm" className="gap-1" disabled={p.printDisabled} onClick={() => p.onSave(true)}>
            <Printer className="h-3.5 w-3.5" /> Kaydet ve bas
          </Button>
        )}
      </div>
    </div>
  );
}

function FieldList(p: {
  view: RollLabelEditView;
  templateChoice: string;
  fields: Record<string, string | null>;
  disabled: boolean;
  onChange: (key: string, v: string | null | undefined) => void;
}) {
  const { view, fields } = p;
  const [showAll, setShowAll] = useState(false);
  // Seçili (yoksa zincirin) şablonunun bağladığı alanlar; değişmiş alan her zaman görünür kalır.
  const activeTemplate = view.templates.find((t) => t.id === (p.templateChoice || view.chainTemplateId));
  const visible = useMemo(() => {
    const bound = new Set(activeTemplate?.boundKeys ?? []);
    if (showAll || bound.size === 0) return view.fields;
    return view.fields.filter((f) => bound.has(f.key) || f.key in fields);
  }, [activeTemplate, showAll, view.fields, fields]);
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Etiketteki alanlar</span>
        <button type="button" className="text-[11px] text-primary underline-offset-2 hover:underline" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Yalnız şablondakiler" : "Tüm alanları göster"}
        </button>
      </div>
      <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-1" data-testid="label-edit-fields">
        {visible.map((f) => (
          <RollLabelEditFieldRow key={f.key} field={f} draft={fields[f.key]} disabled={p.disabled} onChange={(v) => p.onChange(f.key, v)} />
        ))}
      </div>
    </>
  );
}
