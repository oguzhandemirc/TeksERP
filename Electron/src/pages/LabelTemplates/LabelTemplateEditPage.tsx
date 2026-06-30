import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  labelKindLabels,
  labelTemplateService,
  type CatalogField,
  type RawCodeMap,
  type TemplateField,
} from "@/services/labelTemplateService";
import { CatalogPanel } from "./CatalogPanel";
import { FieldsPanel } from "./FieldsPanel";
import { LabelPreview } from "./LabelPreview";
import { RawCodePanel } from "./RawCodePanel";

const LIST_PATH = "/definitions/label-templates";

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

  const catalogQ = useQuery({
    queryKey: ["label-template-catalog", template?.kind],
    queryFn: () => labelTemplateService.getCatalog(template!.kind),
    enabled: Boolean(template?.kind),
  });

  const [name, setName] = useState("");
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rawCode, setRawCode] = useState<RawCodeMap>({});

  useEffect(() => {
    if (template) {
      setName(template.name);
      setFields(
        [...template.fields]
          .sort((a, b) => a.order - b.order)
          .map((f, i) => ({ ...f, order: i + 1 })),
      );
      setRawCode(template.rawCode ?? {});
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
      }),
    onSuccess: () => {
      toast.success("Şablon kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["label-templates"] });
      void qc.invalidateQueries({ queryKey: ["label-template", id] });
      navigate(LIST_PATH);
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

  const loading = templateQ.isLoading || catalogQ.isLoading;
  const orderedFields = useMemo(() => fields.map((f, i) => ({ ...f, order: i + 1 })), [fields]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={template ? `Şablon: ${template.name}` : "Şablon Düzenle"}
        description={template ? `${labelKindLabels[template.kind]} — "Alanlar" sekmesinde tasarla ya da "Kod (uzman)" sekmesinde kendi yazıcı kodunu yaz.` : "Yükleniyor…"}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate(LIST_PATH)}
              className="gap-1"
            >
              <ArrowLeft className="h-4 w-4" /> Listeye Dön
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
              <TabsList>
                <TabsTrigger value="fields">Alanlar</TabsTrigger>
                <TabsTrigger value="code">
                  Kod (uzman)
                  {Object.values(rawCode).some((v) => (v ?? "").trim()) && (
                    <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="fields" className="mt-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,500px)_minmax(0,1fr)]">
                  <CatalogPanel available={availableCatalog} onAdd={addField} />
                  <FieldsPanel
                    fields={orderedFields}
                    catalogByKey={catalogByKey}
                    onChange={setFields}
                  />
                  <div className="lg:sticky lg:top-4 lg:self-start">
                    <LabelPreview kind={template.kind} fields={orderedFields} />
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
    </div>
  );
}
