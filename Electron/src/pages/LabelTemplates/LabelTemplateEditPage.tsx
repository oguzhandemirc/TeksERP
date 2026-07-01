import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Printer, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  labelKindLabels,
  labelTemplateService,
  rawCodeLangLabels,
  type CatalogField,
  type RawCodeLang,
  type RawCodeMap,
  type TemplateField,
} from "@/services/labelTemplateService";
import { CatalogPanel } from "./CatalogPanel";
import { FieldsPanel } from "./FieldsPanel";
import { LabelLayoutControls } from "./LabelLayoutControls";
import { LabelPreview } from "./LabelPreview";
import { RawCodePanel } from "./RawCodePanel";
import { TemplateTestPrintDialog } from "./TemplateTestPrintDialog";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";

export function LabelTemplateEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const templateQ = useQuery({
    queryKey: ["label-template", id],
    queryFn: () => labelTemplateService.getById(id!),
    enabled: Boolean(id),
  });
  const template = templateQ.data?.data;
  // Kaydet/geri → geldiği sarmalanmış "Etiketler → Düzenler" listesine + aynı türe dön
  // (standalone /label-templates yerine — Boyutlar/Düzenler sekmeleri kaybolmasın).
  const backPath = template
    ? `/definitions/labels?tab=templates&kind=${template.kind}`
    : "/definitions/labels?tab=templates";

  const catalogQ = useQuery({
    queryKey: ["label-template-catalog", template?.kind],
    queryFn: () => labelTemplateService.getCatalog(template!.kind),
    enabled: Boolean(template?.kind),
  });

  const [name, setName] = useState("");
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rawCode, setRawCode] = useState<RawCodeMap>({});
  const [lineStepMm, setLineStepMm] = useState<number | null>(null);
  const [qrScale, setQrScale] = useState<number | null>(null);
  const [lengthBanner, setLengthBanner] = useState(false);
  const [testPrintOpen, setTestPrintOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setFields(
        [...template.fields]
          .sort((a, b) => a.order - b.order)
          .map((f, i) => ({ ...f, order: i + 1 })),
      );
      setRawCode(template.rawCode ?? {});
      setLineStepMm(template.lineStepMm ?? null);
      setQrScale(template.qrScale ?? null);
      setLengthBanner(template.lengthBanner ?? false);
    }
  }, [template]);

  const catalog = catalogQ.data?.data?.fields ?? [];
  const usedKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);
  const availableCatalog = catalog.filter((c) => !usedKeys.has(c.key));
  const catalogByKey = useMemo(() => {
    const m = new Map<string, CatalogField>();
    for (const c of catalog) m.set(c.key, c);
    return m;
  }, [catalog]);

  const saveMut = useMutation({
    mutationFn: () =>
      labelTemplateService.update(id!, {
        name: name.trim(),
        fields: fields.map((f, i) => ({ ...f, order: i + 1 })),
        rawCode,
        lineStepMm,
        qrScale,
        lengthBanner,
      }),
    onSuccess: () => {
      // Kaydet sayfada KALIR (geri çıkmaz) — kullanıcı arka arkaya düzenleyip test
      // basabilsin. Sayfadan çıkmak için sol geri-oku kullanılır.
      toast.success("Şablon kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["label-templates"] });
      void qc.invalidateQueries({ queryKey: ["label-template", id] });
    },
  });

  const addField = (cat: CatalogField) => {
    setFields((prev) => [
      ...prev,
      {
        key: cat.key,
        label: cat.defaultLabel,
        order: prev.length + 1,
        isVisible: true,
      },
    ]);
  };

  const doRestoreDefaults = async () => {
    if (!template) return;
    try {
      const def = await labelTemplateService.getDefaults(template.kind);
      setFields(def.fields.map((f, i) => ({ ...f, order: i + 1 })));
      setLineStepMm(def.lineStepMm);
      setQrScale(def.qrScale);
      setLengthBanner(def.lengthBanner);
      setRestoreConfirmOpen(false);
      toast.success("Önerilen varsayılan uygulandı — kaydetmeyi unutma.");
    } catch {
      toast.error("Varsayılan alınamadı.");
    }
  };

  const loading = templateQ.isLoading || catalogQ.isLoading;
  const orderedFields = useMemo(() => fields.map((f, i) => ({ ...f, order: i + 1 })), [fields]);
  // Uzman kod yazılan diller → o dilde baskıda ALANLAR yerine kod kullanılır (uyarı).
  const rawCodeLangs = (Object.keys(rawCode) as RawCodeLang[]).filter((k) => (rawCode[k] ?? "").trim());

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={template ? `Şablon: ${template.name}` : "Şablon Düzenle"}
        description={template ? `${labelKindLabels[template.kind]} — "Alanlar" sekmesinde tasarla ya da "Kod (uzman)" sekmesinde kendi yazıcı kodunu yaz.` : "Yükleniyor…"}
        onBack={() => navigate(backPath)}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || orderedFields.filter((f) => f.isVisible).length === 0}
              onClick={() => setTestPrintOpen(true)}
              className="gap-1"
              title="Şu anki tasarımı örnek veriyle yazıcıya bas (kaydetmeden)"
            >
              <Printer className="h-4 w-4" /> Test Baskısı
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saveMut.isPending || !name.trim() || loading}
              onClick={() => saveMut.mutate()}
              className="gap-1"
            >
              <Save className="h-4 w-4" />
              {saveMut.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <Skeleton className="h-96 w-full" />
        ) : !template ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Şablon bulunamadı.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
              <div className="min-w-[260px] flex-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Şablon Adı
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="örn. Standart Top Etiketi"
                />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="muted">{labelKindLabels[template.kind]}</Badge>
                {template.isDefault && (
                  <Badge variant="outline" className="text-[10px]">
                    Varsayılan
                  </Badge>
                )}
              </div>
            </div>

            <Tabs defaultValue="fields">
              <div className="flex items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="fields">Alanlar</TabsTrigger>
                  <TabsTrigger value="code">
                    Kod (uzman)
                    {Object.values(rawCode).some((v) => (v ?? "").trim()) && (
                      <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    )}
                  </TabsTrigger>
                </TabsList>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setRestoreConfirmOpen(true)}
                  className="h-8 shrink-0 gap-1.5"
                  title="Alanları ve yerleşimi önerilen varsayılana döndür (sağ metraj bandı açık)"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Varsayılana Dön
                </Button>
              </div>

              <TabsContent value="fields" className="mt-4">
                {rawCodeLangs.length > 0 && (
                  <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    ⚠️ <strong>Kod (uzman)</strong> sekmesinde{" "}
                    <strong>{rawCodeLangs.map((l) => rawCodeLangLabels[l]).join(", ")}</strong> için
                    özel kod yazdın. Bu dil(ler)de baskıda aşağıdaki <strong>alanlar KULLANILMAZ</strong> —
                    onun yerine yazdığın kod basılır. Alanların tekrar çalışması için o dildeki kodu
                    "Kod (uzman)" sekmesinden sil.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,500px)_minmax(0,1fr)]">
                  <CatalogPanel available={availableCatalog} onAdd={addField} />
                  <FieldsPanel
                    fields={orderedFields}
                    catalogByKey={catalogByKey}
                    onChange={setFields}
                  />
                  <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
                    <LabelLayoutControls
                      lineStepMm={lineStepMm}
                      qrScale={qrScale}
                      lengthBanner={lengthBanner}
                      onLineStepMm={setLineStepMm}
                      onQrScale={setQrScale}
                      onLengthBanner={setLengthBanner}
                    />
                    <LabelPreview
                      kind={template.kind}
                      fields={orderedFields}
                      lineStepMm={lineStepMm}
                      qrScale={qrScale}
                      lengthBanner={lengthBanner}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="code" className="mt-4">
                <RawCodePanel
                  kind={template.kind}
                  catalog={catalog}
                  rawCode={rawCode}
                  onChange={setRawCode}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {template && (
        <TemplateTestPrintDialog
          open={testPrintOpen}
          onOpenChange={setTestPrintOpen}
          kind={template.kind}
          fields={orderedFields}
          lineStepMm={lineStepMm}
          qrScale={qrScale}
          lengthBanner={lengthBanner}
        />
      )}

      <ConfirmDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title="Varsayılana dön?"
        description="Alanlar ve yerleşim önerilen varsayılana dönecek (sağ dikey metraj bandı açık, dengeli satır aralığı + QR boyutu). Kaydetmediğin sürece geri alınabilir."
        confirmLabel="Varsayılana dön"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={doRestoreDefaults}
      />
    </div>
  );
}
