import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  importService,
  type ImportApplyResult,
  type ImportPreviewResult,
  type ImportOptions,
  type ImportRowInput,
  type ImportRowResult,
  type ImportTemplateSpec,
} from "@/services/importService";
import {
  applyMapping,
  autoMapColumns,
  missingRequiredOf,
  parseSpreadsheet,
  unmatchedHeadersOf,
  type ColumnMapping,
  type ParsedFile,
} from "@/lib/import/parse";
import { downloadCorrectedFile, downloadErrorReport, downloadTemplate } from "@/lib/import/template";
import { formatRowNos, groupIssues } from "@/lib/import/group-issues";
import {
  applyOverrides,
  countOverrides,
  setOverride,
  type CellOverrides,
} from "@/lib/import/overrides";
import { ColumnMappingStep, isMappingValid } from "./ColumnMappingStep";
import { ImportSpecPreview } from "./ImportSpecPreview";
import { RowIssueCell } from "./RowIssueCell";

// Sunucu tavanıyla hizalı (import-coerce.MAX_IMPORT_ROWS). Panelde de kontrol
// edilir ki kullanıcı 40.000 satırlık bir dosyayı yükleyip 30 sn bekledikten
// sonra hata almasın.
const MAX_ROWS = 10000;

type Step = "file" | "map" | "preview" | "result";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registry'deki varlık anahtarı ("item", "customer", …). */
  entity: string;
  /** İşlem bittiğinde listeyi tazelemek için. */
  onDone?: () => void;
}

/**
 * Toplu içe aktarım sihirbazı — Dosya → Önizleme → Sonuç.
 *
 * ⚠️ ÖNİZLEME HİÇBİR ŞEY YAZMAZ ve "Uygula" önizlemeye GÜVENMEZ: sunucu aynı
 * doğrulamayı sıfırdan koşar. Bu yüzden önizlemeden sonra dosya değiştirilse
 * bile yanlış bir şey yazılamaz.
 */
export function ImportDialog({ open, onOpenChange, entity, onDone }: Props) {
  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  // Ayrıştırılmış dosya BELLEKTE tutulur: kullanıcı eşlemeyi değiştirince
  // satırlar yeniden kurulur (dosyayı tekrar okumaya gerek yok).
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  // Elle düzeltmeler AYRI katman: `rows` saf bir türetim olduğu için doğrudan
  // ona yazmak, kullanıcı eşlemeyi değiştirdiği anda düzeltmeleri yok ederdi.
  const [overrides, setOverrides] = useState<CellOverrides>({});
  // Önizlemenin HANGİ satırlarla alındığı — bayatlık bununla anlaşılır.
  const [previewedRows, setPreviewedRows] = useState<ImportRowInput[] | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [result, setResult] = useState<ImportApplyResult | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "preview" | "apply">(null);
  const [skipErrors, setSkipErrors] = useState(false);
  // Yazma modu — sektörde açık bir seçimdir (NetSuite: Add / Update /
  // Add-or-Update). Olmayınca yanlış anahtarlı bir dosya SESSİZCE mevcut
  // kayıtları güncelleyebilir; "sadece yeni ekle" bunu yapısal olarak keser.
  const [mode, setMode] = useState<ImportOptions["mode"]>("upsert");
  const [onlyProblems, setOnlyProblems] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // İdempotency: AYNI deneme yeniden gönderilirse sunucu ikinci kez YAZMAZ.
  // Deneme başına bir kez üretilir (her tıkta yenilemek korumayı boşa düşürür).
  const attemptToken = useRef<string>(crypto.randomUUID());

  // ⚠️ `rows` STATE DEĞİL TÜRETİMDİR: parsed → applyMapping → applyOverrides.
  // Düzeltme yoksa `applyOverrides` GİRDİ DİZİSİNİ AYNEN döndürür (referans
  // korunur) — bayatlık tespiti (`previewedRows !== rows`) buna dayanıyor.
  const rows = useMemo<ImportRowInput[]>(
    () => (parsed ? applyOverrides(applyMapping(parsed, mapping), overrides) : []),
    [parsed, mapping, overrides],
  );
  const editedCount = useMemo(() => countOverrides(overrides), [overrides]);
  // Satır numarasından GÜNCEL hücrelere erişim — düzenleme kutuları bunu okur.
  const cellsByRow = useMemo(
    () => new Map(rows.map((r) => [r.rowNo, r.cells])),
    [rows],
  );
  // Önizleme alındıktan sonra satırlar değiştiyse ekrandaki sonuç ARTIK DOĞRU DEĞİL.
  const previewStale = preview !== null && previewedRows !== null && previewedRows !== rows;

  const templateQuery = useQuery({
    queryKey: ["import-template", entity],
    queryFn: () => importService.template(entity),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const spec: ImportTemplateSpec | undefined = templateQuery.data?.data;

  useEffect(() => {
    if (!open) return;
    // Her açılışta temiz başla — yarım kalmış bir önizleme yeni dosyaya karışmasın.
    setStep("file");
    setFile(null);
    setParsed(null);
    setMapping([]);
    setOverrides({});
    setPreviewedRows(null);
    setParseWarnings([]);
    setParseErrors([]);
    setPreview(null);
    setResult(null);
    setSkipErrors(false);
    setMode("upsert");
    attemptToken.current = crypto.randomUUID();
    // ⚠️ `entity` de bağımlılıkta: aynı diyalog başka varlıkla açılırsa
    // `rowNo`+sütun anahtarına göre tutulan bir düzeltme, sessizce yanlış
    // varlığın yüküne sızardı.
  }, [open, entity]);

  /** Kaynağı (dosya) tamamen unut — reddedilen dosya eskisini diriltmesin. */
  const resetSource = (): void => {
    setParsed(null);
    setMapping([]);
    setOverrides({});
    setPreview(null);
    setPreviewedRows(null);
  };

  const onPickFile = async (picked: File | null) => {
    if (!picked || !spec) return;
    setFile(picked);
    setBusy("parse");
    setParseWarnings([]);
    setParseErrors([]);
    try {
      const parsed = await parseSpreadsheet(picked);
      if (parsed.rows.length === 0) {
        setParseErrors(["Dosyada veri satırı bulunamadı (ilk satır başlık kabul edilir)."]);
        // ⚠️ `parsed` DA temizlenir: `rows` artık türetim olduğu için eski
        // dosyanın satırları geri gelir ve yeni dosyanın hatası ekrandayken
        // "Önizle" aktif kalırdı.
        resetSource();
        return;
      }
      if (parsed.rows.length > MAX_ROWS) {
        setParseErrors([
          `Dosyada ${parsed.rows.length.toLocaleString("tr-TR")} satır var — tek seferde en fazla ${MAX_ROWS.toLocaleString("tr-TR")} satır aktarılabilir. Dosyayı bölerek yükleyin.`,
        ]);
        resetSource();
        return;
      }
      const auto = autoMapColumns(parsed, spec.columns);
      setParsed(parsed);
      setMapping(auto);
      setOverrides({});
      setPreview(null);
      setPreviewedRows(null);

      const unmatched = unmatchedHeadersOf(parsed, auto);
      const missing = missingRequiredOf(spec.columns, auto);
      // Otomatik eşleme eksik kaldıysa kullanıcıyı EŞLEME adımına al — dosyayı
      // elle düzenletmek yerine burada düzeltsin (sektör standardı). Kendi
      // şablonumuzda bu dal hiç çalışmaz, fazladan tık olmaz.
      if (missing.length > 0 || unmatched.length > 0) {
        setParseWarnings(
          missing.length > 0
            ? [`Zorunlu sütun eşleşmedi: ${missing.map((c) => c.label).join(", ")}`]
            : [`Şablonda karşılığı olmayan ${unmatched.length} sütun: ${unmatched.join(", ")}`],
        );
        setStep("map");
        return;
      }
      setParseWarnings([]);
    } catch (e) {
      setParseErrors([e instanceof Error ? e.message : "Dosya okunamadı."]);
      resetSource();
    } finally {
      setBusy(null);
    }
  };

  // Eşleme değişince `rows` kendiliğinden yeniden türetilir; DÜZELTMELER KORUNUR.
  const onMappingChange = (next: ColumnMapping) => setMapping(next);

  const resetMapping = () => {
    if (!parsed || !spec) return;
    setMapping(autoMapColumns(parsed, spec.columns));
  };

  /** Tek hücreyi düzelt (önizlemedeki satır içi input). */
  const editCell = (rowNo: number, column: string, value: string): void => {
    setOverrides((prev) => setOverride(prev, rowNo, column, value));
  };

  const clearOverrides = (): void => setOverrides({});

  const runPreview = async () => {
    if (rows.length === 0) return;
    setBusy("preview");
    try {
      const res = await importService.preview(entity, rows, { mode, fileName: file?.name });
      setPreview(res.data);
      // Bu önizleme HANGİ satırlarla alındı — sonraki düzenlemeler bayatlatsın.
      setPreviewedRows(rows);
      setStep("preview");
    } catch {
      toast.error("Önizleme alınamadı.");
    } finally {
      setBusy(null);
    }
  };

  const runApply = async () => {
    setBusy("apply");
    try {
      const res = await importService.apply(entity, rows, {
        mode,
        onError: skipErrors ? "skip" : "abort",
        clientToken: attemptToken.current,
        fileName: file?.name,
      });
      setResult(res.data);
      setStep("result");
      onDone?.();
    } catch (e) {
      // Doğrulama 400'ü satır raporunu GÖVDEDE taşır — önizleme tablosunu
      // güncelleyip kullanıcıyı aynı ekranda tutuyoruz (hiçbir şey yazılmadı).
      const details = (e as { response?: { data?: { details?: ImportPreviewResult } } })?.response?.data
        ?.details;
      if (details?.rows) {
        setPreview({
          entity,
          rows: details.rows,
          summary: details.summary,
          unknownColumns: details.unknownColumns ?? [],
        });
        toast.error("Hatalı satırlar var — hiçbir kayıt yazılmadı.");
      } else {
        toast.error("İçe aktarım yapılamadı.");
      }
    } finally {
      setBusy(null);
    }
  };

  const visibleRows = useMemo(() => {
    const list = preview?.rows ?? [];
    return onlyProblems ? list.filter((r) => r.errors.length > 0 || r.warnings.length > 0) : list;
  }, [preview, onlyProblems]);

  const hasErrors = (preview?.summary.error ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {spec ? `${spec.label} — Toplu İçe Aktarım` : "Toplu İçe Aktarım"}
          </DialogTitle>
          <DialogDescription>
            {step === "file" && "Şablonu indirin, doldurun, geri yükleyin. Önizleme adımında hiçbir şey kaydedilmez."}
            {step === "map" && "Dosyandaki sütunları hangi alana yazacağımızı seç."}
            {step === "preview" && "Satır satır ne olacağını gösterir. 'Uygula' demeden hiçbir kayıt değişmez."}
            {step === "result" && "İşlem tamamlandı."}
          </DialogDescription>
        </DialogHeader>

        {templateQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !spec ? (
          <p className="text-sm text-destructive">Şablon bilgisi alınamadı.</p>
        ) : step === "file" ? (
          <FileStep
            spec={spec}
            mode={mode}
            setMode={setMode}
            file={file}
            rowCount={rows.length}
            warnings={parseWarnings}
            errors={parseErrors}
            busy={busy}
            onPick={() => fileInputRef.current?.click()}
          />
        ) : step === "map" ? (
          parsed ? (
            <ColumnMappingStep
              parsed={parsed}
              columns={spec.columns}
              mapping={mapping}
              onChange={onMappingChange}
              onReset={resetMapping}
            />
          ) : null
        ) : step === "preview" ? (
          <PreviewStep
            spec={spec}
            preview={preview}
            cellsByRow={cellsByRow}
            onEdit={editCell}
            editedCount={editedCount}
            onClearOverrides={clearOverrides}
            stale={previewStale}
            onRepreview={() => void runPreview()}
            busy={busy}
            rows={visibleRows}
            onlyProblems={onlyProblems}
            setOnlyProblems={setOnlyProblems}
            skipErrors={skipErrors}
            setSkipErrors={setSkipErrors}
            hasErrors={hasErrors}
            onDownloadErrors={() => void downloadErrorReport(spec, rows, preview?.rows ?? [])}
            onDownloadCorrected={() =>
              void downloadCorrectedFile(spec, rows, new Set(Object.keys(overrides).map(Number)))
            }
          />
        ) : (
          <ResultStep result={result} />
        )}

        {/* Gizli dosya girişi — Electron ve web'de aynı şekilde çalışır (files:open
            IPC'si yok ve gerekmiyor). `value=""` sıfırlaması AYNI dosyanın ikinci
            kez seçilebilmesi için şart. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm,.csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            void onPickFile(f);
          }}
        />

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            {step === "file" && spec && (
              <Button variant="outline" onClick={() => void downloadTemplate(spec)}>
                <FileSpreadsheet className="h-4 w-4" /> Şablonu indir
              </Button>
            )}
            {step === "map" && (
              <Button variant="ghost" onClick={() => setStep("file")} disabled={busy !== null}>
                Geri
              </Button>
            )}
            {step === "preview" && (
              <Button
                variant="ghost"
                onClick={() => setStep(parsed ? "map" : "file")}
                disabled={busy !== null}
              >
                Geri
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Eşleme adımı otomatik açılmasa da her zaman elle açılabilir —
                kullanıcı "bu sütun nereye gitti" sorusunu sorabilmeli. */}
            {step === "file" && parsed && (
              <Button variant="ghost" onClick={() => setStep("map")} disabled={busy !== null}>
                Sütun eşlemesini düzenle
              </Button>
            )}
            {step === "map" && spec && (
              <Button
                onClick={() => setStep("file")}
                disabled={busy !== null || !isMappingValid(spec.columns, mapping)}
              >
                <ArrowRight className="h-4 w-4" /> Devam
              </Button>
            )}
            {step === "file" && (
              <Button onClick={() => void runPreview()} disabled={rows.length === 0 || busy !== null}>
                {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Önizle
              </Button>
            )}
            {step === "preview" && (
              <Button
                onClick={() => void runApply()}
                // ⚠️ BAYATKEN PASİF: düzenlemeler her şeyi düzeltmiş olsa bile
                // kırmızı görünen bir önizlemeye rağmen başarıyla uygulamak,
                // kullanıcıya "önizlemeyi görmezden gel" diye öğretirdi.
                disabled={
                  busy !== null ||
                  previewStale ||
                  (hasErrors && !skipErrors) ||
                  (preview?.summary.create ?? 0) + (preview?.summary.update ?? 0) === 0
                }
                title={previewStale ? "Önce 'Yeniden önizle' deyin" : undefined}
              >
                {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Uygula
              </Button>
            )}
            {step === "result" && <Button onClick={() => onOpenChange(false)}>Kapat</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Adım 1: dosya ------------------------------------------------------------

function FileStep({
  spec,
  mode,
  setMode,
  file,
  rowCount,
  warnings,
  errors,
  busy,
  onPick,
}: {
  spec: ImportTemplateSpec;
  mode: ImportOptions["mode"];
  setMode: (m: ImportOptions["mode"]) => void;
  file: File | null;
  rowCount: number;
  warnings: string[];
  errors: string[];
  busy: string | null;
  onPick: () => void;
}) {
  return (
    <div className="space-y-3">
      <ol className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
        <li>
          <strong>1.</strong> Şablonu indirin (aşağıdaki düğme) — başlıklar, kurallar ve kabul edilen
          değerler dosyanın içindedir.
        </li>
        <li>
          <strong>2.</strong> Doldurun. Eşleşme anahtarı: <strong>{spec.keyColumns.join(" + ")}</strong>.
        </li>
        <li>
          <strong>3.</strong> Dosyayı seçin, önizleyin, uygulayın.
        </li>
      </ol>

      <Button variant="outline" className="w-full justify-center gap-2 py-8" onClick={onPick} disabled={busy !== null}>
        {busy === "parse" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        {file ? `${file.name} — değiştirmek için tıklayın` : "Dosya seçin (.xlsx / .csv)"}
      </Button>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="import-mode">
          Yazma modu
        </label>
        <select
          id="import-mode"
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={mode}
          onChange={(e) => setMode(e.target.value as ImportOptions["mode"])}
        >
          <option value="upsert">Yeni ekle ve mevcutları güncelle (varsayılan)</option>
          <option value="createOnly">Yalnız YENİ ekle — mevcutlara dokunma</option>
          <option value="updateOnly">Yalnız GÜNCELLE — yeni kayıt açma</option>
        </select>
      </div>
      {mode !== "upsert" && (
        <p className="text-xs text-muted-foreground">
          {mode === "createOnly"
            ? "Anahtarı zaten var olan satırlar HATA verir — yanlışlıkla güncellemeyi keser."
            : "Anahtarı bulunamayan satırlar HATA verir — yanlışlıkla yeni kayıt açmayı keser."}
        </p>
      )}

      {rowCount > 0 && (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" />
          {rowCount.toLocaleString("tr-TR")} satır okundu.
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          {w}
        </p>
      ))}
      {errors.map((e) => (
        <p key={e} className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          {e}
        </p>
      ))}

      {/* Şablonun İÇERİĞİ burada — indirip Excel'de açmadan "hangi sütunlar,
          hangileri zorunlu, kabul edilen değerler ne" sorusu cevaplanır. */}
      <details className="rounded-md border p-2">
        <summary className="cursor-pointer text-xs font-medium">
          Şablon içeriği — sütunlar, zorunlular, kabul edilen değerler
        </summary>
        <div className="mt-2">
          <ImportSpecPreview spec={spec} />
        </div>
      </details>
    </div>
  );
}

// --- Adım 2: önizleme ---------------------------------------------------------

/** Sütun anahtarı → şablondaki Türkçe etiket (yoksa null). */
function labelOf(spec: ImportTemplateSpec, key: string): string | null {
  return spec.columns.find((c) => c.key === key)?.label ?? null;
}

/**
 * Diff değerini okunur yazar. Boş/null "—" olur: "" ile null arasındaki fark
 * kullanıcı için değil, sistem içindir ve tabloda gürültü yapar.
 */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map(String).join("; ");
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (typeof v === "object") {
    // Prisma Decimal ve benzeri sarmalayıcılar String()'e düzgün cevap verir.
    const s = String(v);
    return s === "[object Object]" ? "—" : s;
  }
  const s = String(v);
  // ISO tarih → GG.AA.YYYY (kullanıcı zaten öyle yazdı).
  const iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : s;
}

const ACTION_LABEL: Record<ImportRowResult["action"], string> = {
  CREATE: "Yeni",
  UPDATE: "Güncelle",
  SKIP: "Değişiklik yok",
  ERROR: "Hata",
};

const ACTION_CLASS: Record<ImportRowResult["action"], string> = {
  CREATE: "text-success",
  UPDATE: "text-primary",
  SKIP: "text-muted-foreground",
  ERROR: "text-destructive",
};

function PreviewStep({
  spec,
  preview,
  cellsByRow,
  onEdit,
  editedCount,
  onClearOverrides,
  onDownloadCorrected,
  stale,
  onRepreview,
  busy,
  rows,
  onlyProblems,
  setOnlyProblems,
  skipErrors,
  setSkipErrors,
  hasErrors,
  onDownloadErrors,
}: {
  spec: ImportTemplateSpec;
  preview: ImportPreviewResult | null;
  cellsByRow: Map<number, Record<string, string>>;
  onEdit: (rowNo: number, column: string, value: string) => void;
  editedCount: number;
  onClearOverrides: () => void;
  onDownloadCorrected: () => void;
  stale: boolean;
  onRepreview: () => void;
  busy: string | null;
  rows: ImportRowResult[];
  onlyProblems: boolean;
  setOnlyProblems: (v: boolean) => void;
  skipErrors: boolean;
  setSkipErrors: (v: boolean) => void;
  hasErrors: boolean;
  onDownloadErrors: () => void;
}) {
  if (!preview) return null;
  const s = preview.summary;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Toplam" value={s.total} />
        <Stat label="Yeni" value={s.create} className="text-success" />
        <Stat label="Güncelle" value={s.update} className="text-primary" />
        <Stat label="Değişiklik yok" value={s.skip} />
        <Stat label="Hata" value={s.error} className={s.error > 0 ? "text-destructive" : undefined} />
      </div>

      {preview.unknownColumns.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          Yok sayılan sütunlar: {preview.unknownColumns.join(", ")}
        </p>
      )}

      {hasErrors && (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          <p className="flex items-start gap-2">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>
              <strong>{s.error} satırda hata var.</strong> Varsayılan davranış: hiçbir kayıt yazılmaz.
              Hataları düzeltip yeniden yükleyin.
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-3 pl-6">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={skipErrors} onCheckedChange={(v) => setSkipErrors(Boolean(v))} />
              Hatalı satırları ATLA, geçerlileri yaz
            </label>
            <Button size="sm" variant="outline" onClick={onDownloadErrors}>
              <Download className="h-3.5 w-3.5" /> Hatalı satırları indir
            </Button>
          </div>
        </div>
      )}

      {stale && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span className="flex-1">
            Satırlar düzenlendi — aşağıdaki sonuç <strong>artık güncel değil</strong>.
          </span>
          <Button size="sm" onClick={onRepreview} disabled={busy !== null}>
            {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Yeniden önizle
          </Button>
        </div>
      )}

      {editedCount > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            <strong>{editedCount} hücre</strong> elle düzeltildi. Kaynak dosya DEĞİŞMEDİ.
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onClearOverrides}>
            Düzeltmeleri geri al
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={onDownloadCorrected}
            title="Düzeltmelerle birlikte dosyayı indir — kaynağınızı da güncelleyebilirsiniz"
          >
            <Download className="h-3 w-3" /> Düzeltilmiş dosyayı indir
          </Button>
        </p>
      )}

      <IssueSummary rows={preview.rows} />

      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={onlyProblems} onCheckedChange={(v) => setOnlyProblems(Boolean(v))} />
        Yalnız hatalı/uyarılı satırları göster
      </label>

      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="px-2 py-1.5 text-left">Satır</th>
              <th className="px-2 py-1.5 text-left">İşlem</th>
              <th className="px-2 py-1.5 text-left">Kayıt</th>
              <th className="px-2 py-1.5 text-left">Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                  {onlyProblems ? "Hatalı ya da uyarılı satır yok." : "Satır yok."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.rowNo} className="border-t align-top">
                  <td className="px-2 py-1.5 tabular-nums">
                    {r.rowNos && r.rowNos.length > 1
                      ? `${r.rowNos[0]}–${r.rowNos[r.rowNos.length - 1]}`
                      : r.rowNo}
                  </td>
                  <td className={`px-2 py-1.5 font-medium ${ACTION_CLASS[r.action]}`}>
                    {ACTION_LABEL[r.action]}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.label ?? r.key ?? "—"}
                    {r.key && r.label && r.key !== r.label ? (
                      <span className="text-muted-foreground"> ({r.key})</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <RowIssueCell
                      spec={spec}
                      row={r}
                      cells={cellsByRow.get(r.rowNo) ?? {}}
                      onEdit={onEdit}
                    />
                    {r.action === "UPDATE" && r.changes ? (
                      <div className="space-y-0.5 text-muted-foreground">
                        {Object.entries(r.changes).map(([k, ch]) => (
                          <div key={k}>
                            <span className="font-medium">
                              {k === "__children" ? "alt satırlar" : (labelOf(spec, k) ?? k)}
                            </span>
                            {": "}
                            <span className="line-through opacity-70">{fmtValue(ch.from)}</span>
                            {" → "}
                            <span className="text-foreground">{fmtValue(ch.to)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * SORUN ÖZETİ — "200 hatalı satır" yerine "3 farklı sorun".
 *
 * Satır satır liste doğru ama okunmaz: kullanıcı aynı cümleyi 200 kez okuyup
 * TEK bir kök nedeni aramak zorunda kalıyor. Sınıfa göre toplamak, düzeltilecek
 * ŞEYİ gösterir (ör. "12 satırda renk bulunamadı — MAVI, KIRMIZI").
 */
function IssueSummary({ rows }: { rows: ImportRowResult[] }) {
  const groups = useMemo(() => groupIssues(rows), [rows]);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border p-2">
      <p className="text-xs font-medium">
        {groups.length} farklı sorun ({groups.filter((g) => g.kind === "error").length} hata ·{" "}
        {groups.filter((g) => g.kind === "warning").length} uyarı)
      </p>
      <ul className="space-y-1">
        {groups.map((g) => (
          <li key={g.key} className="flex items-start gap-1.5 text-xs">
            {g.kind === "error" ? (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            )}
            <span>
              <strong>{g.rowNos.length} satır</strong> — {g.sample}
              {g.values.length > 1 && (
                <span className="text-muted-foreground"> · Değerler: {g.values.slice(0, 6).join(", ")}
                  {g.values.length > 6 ? ` (+${g.values.length - 6})` : ""}
                </span>
              )}
              <span className="block text-muted-foreground">Satırlar: {formatRowNos(g.rowNos)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className={`text-lg font-semibold tabular-nums ${className ?? ""}`}>
        {value.toLocaleString("tr-TR")}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

// --- Adım 3: sonuç ------------------------------------------------------------

function ResultStep({ result }: { result: ImportApplyResult | null }) {
  if (!result) return null;
  const partial = result.status === "PARTIAL";
  const failed = result.status === "FAILED";
  return (
    <div className="space-y-3">
      <div
        className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
          failed
            ? "border-destructive/40 bg-destructive/10"
            : partial
              ? "border-warning/40 bg-warning/10"
              : "border-success/40 bg-success/10"
        }`}
      >
        {failed ? (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        ) : partial ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        )}
        <div>
          <p className="font-medium">
            {failed
              ? "Hiçbir kayıt yazılamadı."
              : partial
                ? "İşlem YARIDA kesildi."
                : "İçe aktarım tamamlandı."}
          </p>
          <p className="text-muted-foreground">
            {result.created} yeni · {result.updated} güncellendi · {result.skipped} değişiklik yok ·{" "}
            {result.failed} hata ({Math.round(result.durationMs / 100) / 10} sn)
          </p>
          {partial && result.stoppedAtRowNo ? (
            <p className="mt-1">
              Yazma <strong>{result.stoppedAtRowNo}. satırda</strong> durdu — o satır ve sonrasındaki
              kayıtlar YAZILMADI. Dosyayı o satırdan itibaren düzeltip yeniden yükleyin.
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Bu işlem "İçe Aktarım Geçmişi" ekranında kalıcı olarak kayıtlıdır (kim, ne zaman, hangi dosya).
      </p>
    </div>
  );
}
