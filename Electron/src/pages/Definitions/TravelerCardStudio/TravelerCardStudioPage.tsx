import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { TravelerCardPreview } from "../DocumentTemplates/TravelerCardPreview";
import { travelerTemplateService } from "./service";
import { TemplateList } from "./TemplateList";
import { SectionList } from "./SectionList";
import { RawHtmlEditor } from "./RawHtmlEditor";
import { useStudioDraft } from "./useStudioDraft";
import type { TravelerTemplate } from "./types";

const QK = ["traveler-templates"];

/**
 * Refakat Kartı Şablon Stüdyosu — üç kademeli kişiselleştirmenin 2. ve 3.
 * kademesi (1. kademe = hiç dokunmamak, soldaki "Yerleşik Kart" satırı).
 *
 * Yerleşim: solda şablon listesi, ortada düzenleyici (Bölümler | HTML sekmesi),
 * sağda canlı önizleme. Önizleme GERÇEK BASKI YOLUNU kullanır (backend
 * `renderTravelerCard` dağıtıcısı) → önizleme = çıktı, ikinci bir renderer yok.
 */
export function TravelerCardStudioPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<TravelerTemplate | null>(null);

  const listQ = useQuery({ queryKey: QK, queryFn: travelerTemplateService.list });
  const templates = useMemo(() => listQ.data ?? [], [listQ.data]);
  const selected = useMemo(
    () => (creating ? null : templates.find((t) => t.id === selectedId) ?? null),
    [templates, selectedId, creating],
  );
  const { draft, patch, sections, isEnabled, setSections, toggleSection, dirty } =
    useStudioDraft(selected);

  const invalidate = () => void qc.invalidateQueries({ queryKey: QK });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: draft.name,
        mode: draft.mode,
        config: draft.config,
        html: draft.mode === "RAW_HTML" ? draft.html : null,
      };
      return selected
        ? travelerTemplateService.update(selected.id, payload)
        : travelerTemplateService.create(payload);
    },
    onSuccess: (row) => {
      toast.success(selected ? "Şablon güncellendi." : "Şablon oluşturuldu.");
      setCreating(false);
      setSelectedId(row.id);
      invalidate();
    },
  });

  const defaultMut = useMutation({
    mutationFn: (id: string) => travelerTemplateService.setDefault(id),
    onSuccess: () => {
      toast.success("Varsayılan şablon güncellendi.");
      invalidate();
    },
  });
  const clearDefaultMut = useMutation({
    mutationFn: () => travelerTemplateService.clearDefault(),
    onSuccess: () => {
      toast.success("Yerleşik karta dönüldü.");
      invalidate();
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => travelerTemplateService.remove(id),
    onSuccess: () => {
      toast.success("Şablon silindi.");
      setToDelete(null);
      setSelectedId(null);
      invalidate();
    },
  });

  const busy =
    saveMut.isPending || defaultMut.isPending || clearDefaultMut.isPending || deleteMut.isPending;
  const editing = creating || Boolean(selected);
  const canSave = editing && draft.name.trim().length > 0 && dirty && !busy;

  return (
    <PageShell>
      <PageHeader
        title="Refakat Kartı Şablonları"
        description="Bölümleri sırala, aç-kapa; ya da uzman modunda kartın tüm HTML'ini kendin yaz. Önizleme gerçek baskı çıktısıdır."
      />
      <PageBody className="p-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)_minmax(0,520px)]">
          <div className="h-[76vh] rounded-md border bg-card p-3">
            <TemplateList
              templates={templates}
              selectedId={creating ? "__new__" : selectedId}
              busy={busy}
              onSelect={(id) => {
                setCreating(false);
                setSelectedId(id);
              }}
              onNew={() => {
                setCreating(true);
                setSelectedId(null);
              }}
              onSetDefault={(id) => defaultMut.mutate(id)}
              onClearDefault={() => clearDefaultMut.mutate()}
              onDelete={(t) => setToDelete(t)}
            />
          </div>

          <div className="flex h-[76vh] min-h-0 flex-col rounded-md border bg-card p-3">
            {listQ.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : !editing ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <div className="text-sm font-medium">Yerleşik kart kullanılıyor</div>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Kart bugünkü yerleşimiyle basılıyor. Bölümleri sıralamak ya da kendi HTML'ini
                  yazmak için soldan bir şablon seçin veya <strong>Yeni</strong> ile oluşturun.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex shrink-0 items-center gap-2">
                  <Input
                    value={draft.name}
                    disabled={busy}
                    placeholder="Şablon adı (örn. Boyahane Kartı)"
                    onChange={(e) => patch({ name: e.target.value })}
                    className="h-8 flex-1"
                  />
                  <Button type="button" size="sm" className="h-8 gap-1" disabled={!canSave} onClick={() => saveMut.mutate()}>
                    <Save className="h-3.5 w-3.5" /> Kaydet
                  </Button>
                </div>

                <Tabs
                  value={draft.mode === "RAW_HTML" ? "html" : "sections"}
                  onValueChange={(v) => patch({ mode: v === "html" ? "RAW_HTML" : "SECTIONS" })}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <TabsList className="mb-3 shrink-0 self-start">
                    <TabsTrigger value="sections">Bölümler</TabsTrigger>
                    <TabsTrigger value="html">HTML (uzman)</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sections" className="min-h-0 flex-1 overflow-auto">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Sürükleyerek sırala, anahtarla aç-kapa. Kapatılan bölüm kartta hiç basılmaz.
                    </p>
                    <SectionList
                      sections={sections}
                      isEnabled={isEnabled}
                      onReorder={setSections}
                      onToggle={toggleSection}
                      disabled={busy}
                    />
                  </TabsContent>

                  <TabsContent value="html" className="flex min-h-0 flex-1 flex-col">
                    <p className="mb-2 shrink-0 text-xs text-muted-foreground">
                      Kartın tamamı bu HTML'den basılır — yerleşik stil yüklenmez. Sağdaki
                      alanlara tıklayarak veri gömün.
                    </p>
                    <RawHtmlEditor
                      value={draft.html}
                      onChange={(html) => patch({ html })}
                      disabled={busy}
                    />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>

          <div className="xl:sticky xl:top-4 xl:self-start">
            <TravelerCardPreview
              config={draft.config}
              template={
                editing ? { mode: draft.mode, html: draft.html, name: draft.name } : undefined
              }
            />
          </div>
        </div>
      </PageBody>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Şablonu sil"
        description={
          toDelete
            ? `"${toDelete.name}" silinecek. Bu şablonla BASILMIŞ kartlar etkilenmez — şablon karta dondurulduğu için aynen yeniden basılabilirler.${
                toDelete.isDefault ? " Bu şablon varsayılandı; silinince kart yerleşik yerleşime döner." : ""
              }`
            : ""
        }
        confirmLabel="Sil"
        destructive
        isPending={deleteMut.isPending}
        onConfirm={() => {
          if (toDelete) deleteMut.mutate(toDelete.id);
        }}
      />
    </PageShell>
  );
}
