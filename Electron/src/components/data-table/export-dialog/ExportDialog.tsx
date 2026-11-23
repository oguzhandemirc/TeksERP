import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoPopover } from "@/components/ui/info-popover";
import {
  UnknownExportColumnError,
  assertKnownColumns,
  defaultColumnSelection,
  orderByCatalog,
  restoreColumnSelection,
  type ExportColumnOption,
  type ExportFormat,
  type ExportScope,
} from "@/lib/export-columns";
import { useExportDialogPrefs } from "./useExportDialogPrefs";
import { ChoiceGroup, Section } from "./parts";

export interface ExportDialogChoice {
  format: ExportFormat;
  /** Seçili sütun id'leri, ekrandaki sırayla (katalogla doğrulanmış). */
  columns: string[];
  scope: ExportScope;
  detail?: string;
}

export interface ExportScopeOption {
  key: ExportScope;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface ExportDetailOption {
  key: string;
  label: string;
  hint?: string;
}

const FORMAT_LABEL: Record<ExportFormat, string> = { xlsx: "Excel", pdf: "PDF", csv: "CSV" };

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Başlık ⓘ baloncuğu — ne indirildiğini anlatır (içerik akışına açıklama kutusu konmaz). */
  info?: ReactNode;
  /** Sütun kataloğu; ayrıntı düzeyine göre değişiyorsa fonksiyon. Boş katalog = sütun bölümü çizilmez. */
  catalog: ExportColumnOption[] | ((detail: string | undefined) => ExportColumnOption[]);
  formats?: ExportFormat[];
  scopes?: ExportScopeOption[];
  defaultScope?: ExportScope;
  details?: ExportDetailOption[];
  /** Hatırlanan seçimin anahtarı (`prefs.exportDialog`); yoksa hatırlama seçeneği çizilmez. */
  prefKey?: string;
  /** Ek filtreler (ör. kategori seçimi) — sol sütunda "Filtreler" altında. */
  filters?: ReactNode;
  /** Ekranın ek çıktıları (ör. "Excel (stok kalemi bazında)…") — altta ayrı satır. */
  extras?: ReactNode;
  /** Çalışırken düğme metni (ör. "1200 / ~3000 indiriliyor…"). */
  busyLabel?: string;
  /** Filtre seçimi eksikse false (düğme pasif). */
  canRun?: boolean;
  /** true/void → diyalog kapanır; false → açık kalır (iptal/boş). */
  onRun: (choice: ExportDialogChoice) => Promise<boolean | void>;
}

/**
 * Ortak çıktı diyaloğu: biçim · kapsam · (ayrıntı düzeyi) · sütunlar. Sütun listesi ekranda gizli olanları da taşır
 * (işaretsiz gelir, açılabilir); dosyadaki sıra ekrandaki sıradır. Üç biçim aynı satır kümesinden ve aynı sütun
 * tarifinden üretilir — yalnız sunuş farklıdır.
 */
export function ExportDialog(props: ExportDialogProps) {
  const { open, onOpenChange, details, scopes, prefKey } = props;
  const formats = props.formats ?? ["xlsx", "pdf", "csv"];
  const { saved, save, ready } = useExportDialogPrefs(prefKey);
  const [format, setFormat] = useState<ExportFormat>(formats[0]!);
  const [detail, setDetail] = useState<string | undefined>(details?.[0]?.key);
  const [scope, setScope] = useState<ExportScope>(props.defaultScope ?? scopes?.[0]?.key ?? "all");
  const [columns, setColumns] = useState<string[]>([]);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  const catalogOf = props.catalog;
  const catalog = useMemo(
    () => (typeof catalogOf === "function" ? catalogOf(detail) : catalogOf),
    [catalogOf, detail],
  );

  // Açılışta: hatırlanan seçim varsa o, yoksa ekrandaki sütunlar. Kapsam her açılışta çağıranın varsayılanı.
  useEffect(() => {
    if (!open) return;
    const d = details?.some((x) => x.key === saved?.detail) ? saved!.detail : details?.[0]?.key;
    setDetail(d);
    setFormat(saved?.format && formats.includes(saved.format) ? saved.format : formats[0]!);
    setScope(props.defaultScope ?? scopes?.find((s) => !s.disabled)?.key ?? "all");
    setRemember(Boolean(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız açılışta ve kayıt gelince tohumlanır
  }, [open, saved]);

  // Katalog (ayrıntı düzeyi) değişince sütun seçimi o kataloğa göre yeniden kurulur. İmza üzerinden: çağıran
  // kataloğu her render'da yeni dizi olarak verebilir; dizi kimliğine bağlansa kullanıcının seçimi her render'da silinirdi.
  const catalogSig = catalog.map((c) => `${c.id}:${c.visible ? 1 : 0}`).join("|");
  useEffect(() => {
    if (!open) return;
    setColumns(restoreColumnSelection(catalog, saved?.columns) ?? defaultColumnSelection(catalog));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- imza katalogun içeriğidir
  }, [open, catalogSig, saved]);

  const toggle = (id: string, on: boolean) =>
    setColumns((cur) => orderByCatalog(catalog, on ? [...cur, id] : cur.filter((c) => c !== id)));
  const scopeOk = !scopes || scopes.some((s) => s.key === scope && !s.disabled);
  const needsColumns = catalog.length > 0;
  const canRun = !busy && scopeOk && (!needsColumns || columns.length > 0) && props.canRun !== false;

  const submit = async () => {
    try {
      if (needsColumns) assertKnownColumns(catalog, columns);
    } catch (e) {
      toast.error(e instanceof UnknownExportColumnError ? e.message : "Sütun seçimi geçersiz.");
      return;
    }
    if (prefKey && ready) save(remember ? { columns, format, detail } : null);
    setBusy(true);
    try {
      const ok = await props.onRun({ format, columns, scope, detail });
      if (ok !== false) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {props.title}
            {props.info && <InfoPopover desc={props.info} label="Bu çıktı ne içerir" />}
          </DialogTitle>
          <DialogDescription className="sr-only">Biçim, kapsam ve sütunları seçin.</DialogDescription>
        </DialogHeader>

        <div className={needsColumns ? "grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" : "space-y-4"}>
          <div className="space-y-4">
            <Section title="Biçim">
              <ChoiceGroup
                label="Biçim"
                value={format}
                onChange={(v) => setFormat(v as ExportFormat)}
                options={formats.map((f) => ({ key: f, label: FORMAT_LABEL[f] }))}
              />
            </Section>
            {details && details.length > 1 && (
              <Section title="Ayrıntı düzeyi">
                <ChoiceGroup label="Ayrıntı düzeyi" value={detail ?? ""} onChange={setDetail} options={details} column />
              </Section>
            )}
            {scopes && scopes.length > 0 && (
              <Section title="Kapsam">
                <ChoiceGroup
                  label="Kapsam"
                  value={scope}
                  onChange={(v) => setScope(v as ExportScope)}
                  column
                  options={scopes.map((s) => ({
                    key: s.key,
                    label: s.count === undefined ? s.label : `${s.label} (${s.count})`,
                    disabled: s.disabled,
                  }))}
                />
              </Section>
            )}
            {props.filters && <Section title="Filtreler">{props.filters}</Section>}
          </div>

          {needsColumns && (
            <Section
              title={`Sütunlar (${columns.length}/${catalog.length})`}
              action={
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setColumns(defaultColumnSelection(catalog))}>
                    Ekrandakiler
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setColumns(catalog.map((c) => c.id))}>
                    Tümü
                  </Button>
                </div>
              }
            >
              <ul className="max-h-80 space-y-0.5 overflow-y-auto rounded-md border bg-card p-1" aria-label="Sütunlar">
                {catalog.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                      <Checkbox checked={columns.includes(c.id)} onCheckedChange={(v) => toggle(c.id, Boolean(v))} aria-label={c.label} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {!c.visible && <span className="shrink-0 text-[11px] text-muted-foreground">ekranda gizli</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {props.extras && <div className="flex flex-wrap items-center gap-2 border-t pt-3">{props.extras}</div>}

        <DialogFooter className="items-center sm:justify-between">
          {prefKey && ready ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(Boolean(v))} />
              Seçimi hatırla
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button disabled={!canRun} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {busy ? props.busyLabel ?? "Hazırlanıyor…" : `${FORMAT_LABEL[format]} indir`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
