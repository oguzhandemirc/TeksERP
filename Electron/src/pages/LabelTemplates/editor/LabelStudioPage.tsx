// =============================================================================
// Etiket Stüdyosu — kanvas editör kabuğu (varyant sekmeleri + palet + tuval +
// özellikler + backend WYSIWYG önizleme). Eski akış editörünün (FieldsPanel)
// yerini alır; rawCode uzman modu AYNEN durur.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Printer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LabelKind, labelKindLabels, labelTemplateService, type RawCodeMap,
} from "@/services/labelTemplateService";
import { RawCodePanel } from "../RawCodePanel";
import { TemplateTestPrintDialog } from "../TemplateTestPrintDialog";
import { useEditorState } from "./useEditorState";
import { useCanvasLint } from "./useCanvasLint";
import { CanvasStage } from "./CanvasStage";
import { ElementPalette } from "./ElementPalette";
import { PropertiesPanel } from "./PropertiesPanel";
import { VariantTabs } from "./VariantTabs";
import { VariantMismatchBanner } from "./VariantMismatchBanner";
import { CanvasPreview } from "./CanvasPreview";
import { DEFAULT_ZOOM, makeElement } from "./canvas-model";
import type { LabelElementType } from "@/types/label-canvas";

export function LabelStudioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const templateQ = useQuery({
    queryKey: ["label-template", id],
    queryFn: () => labelTemplateService.getById(id!),
    enabled: Boolean(id),
  });
  const template = templateQ.data?.data;

  const variantsQ = useQuery({
    queryKey: ["label-template-variants", id],
    queryFn: () => labelTemplateService.listVariants(id!),
    enabled: Boolean(id),
  });
  const variants = useMemo(() => variantsQ.data ?? [], [variantsQ.data]);

  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const activeVariant = variants.find((v) => v.id === activeVariantId) ?? null;

  const [name, setName] = useState("");
  const [rawCode, setRawCode] = useState<RawCodeMap>({});
  // Önizleme bağlamı: mock verinin sözlüğü (havuz şablonu her bağlamda basılabilir).
  const [previewKind, setPreviewKind] = useState<LabelKind>(LabelKind.ROLL_FINISHED);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [testPrintOpen, setTestPrintOpen] = useState(false);

  const state = useEditorState();
  const canvas = {
    widthMm: activeVariant?.widthMm ?? 100,
    heightMm: activeVariant?.heightMm ?? 60,
  };
  const lint = useCanvasLint(state.elements, canvas);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setRawCode(template.rawCode ?? {});
      if (template.kind) setPreviewKind(template.kind);
    }
  }, [template]);

  // Varyantlar gelince: birincil (yoksa ilk) seçilir; aktif varyant değişince tuval yüklenir.
  useEffect(() => {
    if (variants.length > 0 && !variants.some((v) => v.id === activeVariantId)) {
      const pick = variants.find((v) => v.isPrimary) ?? variants[0];
      if (pick) setActiveVariantId(pick.id);
    }
  }, [variants, activeVariantId]);
  useEffect(() => {
    state.loadLayout(activeVariant?.elements ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız varyant kimliği değişince yükle
  }, [activeVariant?.id]);

  const catalogQ = useQuery({
    queryKey: ["label-unified-catalog"],
    queryFn: () => labelTemplateService.unifiedCatalog(),
    staleTime: 5 * 60_000,
  });
  const catalog = useMemo(() => catalogQ.data ?? [], [catalogQ.data]);
  const flowCatalogQ = useQuery({
    queryKey: ["label-template-catalog", previewKind],
    queryFn: () => labelTemplateService.getCatalog(previewKind),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      await labelTemplateService.update(id!, { name: name.trim(), rawCode });
      if (activeVariant) {
        await labelTemplateService.updateVariant(activeVariant.id, { elements: state.layout });
      }
    },
    onSuccess: () => {
      toast.success("Şablon kaydedildi.");
      state.markSaved();
      void qc.invalidateQueries({ queryKey: ["label-templates"] });
      void qc.invalidateQueries({ queryKey: ["label-template", id] });
      void qc.invalidateQueries({ queryKey: ["label-template-variants", id] });
    },
  });

  const addStructural = (type: Exclude<LabelElementType, "field">) =>
    state.addElement(makeElement(type, { x: 5, y: 5 }));

  const selected =
    state.selectedIds.length === 1
      ? state.elements.find((e) => e.id === state.selectedIds[0]) ?? null
      : null;
  const errors = lint.filter((i) => i.level === "error");
  const loading = templateQ.isLoading || variantsQ.isLoading;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={template ? `Etiket Stüdyosu: ${template.name}` : "Etiket Stüdyosu"}
        description="Serbest kanvas tasarım — çıktı 4 dile (PPLA/PPLB/ZPL/HTML) otomatik derlenir; önizleme = baskı."
        onBack={() => navigate("/definitions/labels?tab=templates")}
        actions={
          <>
            <Button type="button" variant="outline" size="sm" disabled={loading || !activeVariant}
              onClick={() => setTestPrintOpen(true)} className="gap-1"
              title="Şu anki tasarımı örnek veriyle yazıcıya bas (kaydetmeden)">
              <Printer className="h-4 w-4" /> Test Baskısı
            </Button>
            <Button type="button" size="sm" className="gap-1"
              disabled={saveMut.isPending || !name.trim() || loading || errors.length > 0}
              title={errors[0]?.message}
              onClick={() => saveMut.mutate()}>
              <Save className="h-4 w-4" /> {saveMut.isPending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 xl:overflow-hidden">
        {loading ? (
          <Skeleton className="h-96 w-full" />
        ) : !template ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Şablon bulunamadı.
          </div>
        ) : (
          <>
            {/* Üst şerit (sabit): varyant sekmeleri + uyumsuzluk uyarısı + dirty */}
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <VariantTabs templateId={template.id} variants={variants}
                  activeId={activeVariantId} onSelect={setActiveVariantId} dirty={state.dirty} />
                {state.dirty && <Badge variant="outline" className="text-[10px] text-amber-600">Kaydedilmedi</Badge>}
              </div>
              <VariantMismatchBanner variants={variants} />
            </div>

            <Tabs defaultValue="design" className="flex flex-col xl:min-h-0 xl:flex-1">
              <TabsList className="shrink-0">
                <TabsTrigger value="design">Tasarım</TabsTrigger>
                <TabsTrigger value="code">
                  Kod (uzman)
                  {Object.values(rawCode).some((v) => (v ?? "").trim()) && (
                    <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="design" className="mt-3 xl:min-h-0 xl:flex-1">
                {!activeVariant ? (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Bu şablonun boyut varyantı yok — eski akış düzeninde basılıyor.
                    Kanvasla tasarlamak için yukarıdan <strong>"Yeni boyut"</strong> ekleyin.
                  </div>
                ) : (
                  // 3 kolon — her biri xl'de kendi içinde kaydırılır (sayfa kaymaz).
                  <div className="grid grid-cols-1 gap-3 xl:h-full xl:grid-cols-[260px_minmax(0,1fr)_360px]">
                    {/* SOL: şablon adı + önizleme bağlamı + eleman paleti */}
                    <div className="space-y-3 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Şablon Adı</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground" title="Önizlemede kullanılan örnek verinin bağlamı">
                          Önizleme bağlamı
                        </label>
                        <Select value={previewKind} onValueChange={(v) => setPreviewKind(v as LabelKind)}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(labelKindLabels) as LabelKind[]).map((k) => (
                              <SelectItem key={k} value={k} className="text-xs">{labelKindLabels[k]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="border-t pt-3">
                        <ElementPalette
                          onAddField={(f) => state.addElement(makeElement("field", { x: 5, y: 5 }, { bind: f.key, label: f.defaultLabel }))}
                          onAddStructural={addStructural}
                        />
                      </div>
                    </div>

                    {/* ORTA: kanvas */}
                    <div className="xl:min-h-0 xl:overflow-y-auto">
                      <CanvasStage canvas={canvas} state={state} zoom={zoom} onZoom={setZoom} lint={lint} />
                    </div>

                    {/* SAĞ: önizleme + seçili eleman özellikleri + lint */}
                    <div className="space-y-3 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
                      <CanvasPreview kind={previewKind} widthMm={canvas.widthMm} heightMm={canvas.heightMm} layout={state.layout} />
                      <PropertiesPanel element={selected} catalog={catalog}
                        multiCount={state.selectedIds.length}
                        onChange={(patch) => selected && state.updateElement(selected.id, patch)}
                        onRemove={() => selected && state.removeElement(selected.id)} />
                      {lint.length > 0 && (
                        <ul className="space-y-1 rounded-md border p-2 text-[10px]">
                          {lint.map((i, idx) => (
                            <li key={idx} className={
                              i.level === "error" ? "text-destructive" :
                              i.level === "warn" ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
                            }>• {i.message}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="code" className="mt-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                <RawCodePanel kind={previewKind} catalog={flowCatalogQ.data?.data?.fields ?? []}
                  rawCode={rawCode} onChange={setRawCode} />
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Bir dil için kod doluysa o dilde KANVAS DA basılmaz — kod her şeyi ezer. "Kaydet" raw kodu da yazar.
                </p>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <TemplateTestPrintDialog
        open={testPrintOpen}
        onOpenChange={setTestPrintOpen}
        fetchNative={(o) =>
          labelTemplateService.canvasPreview({
            kind: previewKind, widthMm: canvas.widthMm, heightMm: canvas.heightMm, elements: state.layout,
            peripheralId: o?.peripheralId,
          })
        }
      />
    </div>
  );
}
