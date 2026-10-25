import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { customReportApi, useReportCategories, useSemanticCatalog } from "./custom-api";
import { EMPTY_BUILDER, fromBody, toBody, type BuilderState } from "./builder-model";
import { useBuilderSave } from "./useBuilderSave";
import { BuilderWizard } from "./BuilderWizard";
import { BuilderMetaCard } from "./BuilderMetaCard";
import { DefinitionResultView } from "./DefinitionResultView";

/** Özel rapor oluşturucusu — `reports/ozel/yeni` ve `reports/ozel/:id/duzenle`. */
export function CustomReportBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const existing = useQuery({ queryKey: ["custom-report", id], queryFn: () => customReportApi.get(id!), enabled: Boolean(id) });
  const catalog = useSemanticCatalog();
  const categories = useReportCategories();
  const [state, setState] = useState<BuilderState>(EMPTY_BUILDER);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [unsupported, setUnsupported] = useState(false);
  const ops = useBuilderSave(existing.data ?? null);

  useEffect(() => {
    if (!existing.data) return;
    const parsed = fromBody(existing.data.govde);
    setUnsupported(parsed === null);
    if (parsed) setState({ ...parsed, title: existing.data.ad });
    setCategoryId(existing.data.kategori.id);
  }, [existing.data]);

  const body = useMemo(() => toBody(state), [state]);
  const update = (next: BuilderState) => {
    setState(next);
    ops.clearPreview();
  };
  const title = id ? `Düzenle: ${existing.data?.ad ?? "…"}` : "Yeni özel rapor";

  return (
    <PageShell>
      <PageHeader title={title} description="Konu, ölçü ve kırılımı seçin; önizleyip kaydedin. Kayıt yeni bir sürüm açar, eskisi değişmez." />
      <PageBody className="p-4 sm:p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          {unsupported ? (
            <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
              Bu rapor oluşturucunun kuramayacağı bölümler içeriyor; buradan kaydetmek gövdeyi oluşturucunun biçimiyle değiştirir.
            </p>
          ) : null}
          {catalog.isError ? <p className="text-sm text-destructive">Ölçü kataloğu okunamadı.</p> : null}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <BuilderWizard state={state} cubes={catalog.data ?? []} onChange={update} />
            </div>
            <BuilderMetaCard
              state={state}
              categories={categories.data ?? []}
              categoryId={categoryId}
              issues={ops.issues}
              busy={ops.busy}
              onTitle={(t) => update({ ...state, title: t })}
              onCategory={setCategoryId}
              onPreview={() => void ops.runPreview(body)}
              onSave={() => void ops.save(body, { ad: state.title.trim() || "Adsız rapor", ...(categoryId ? { kategoriId: categoryId } : {}) })}
            />
          </div>
          {ops.preview ? (
            <section aria-label="Önizleme" className="rounded-lg border p-4">
              <h2 className="mb-3 text-sm font-semibold">Önizleme</h2>
              <DefinitionResultView result={ops.preview} chartKindOf={() => state.view} />
            </section>
          ) : null}
        </div>
      </PageBody>
    </PageShell>
  );
}
