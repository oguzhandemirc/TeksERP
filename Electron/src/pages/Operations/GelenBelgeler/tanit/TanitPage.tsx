// BELGE TİPİ TANITMA (S1b, fabrika cevabı 16/18/38) — okunmuş belge fotoğrafında kelime kutusuna dokun → alan ata → kimlik yazıları →
// tekrar eden bölüm → önizleme → kaydet. `?sablon=u-…` = o kullanıcı şablonunu bu belgeyle güncelle (sürümlü; eski belgeler eski sürümde).
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Eye, Loader2, Save } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useTabsStore } from "@/store/tabs";
import { useNoteDetail } from "../useNoteDetail";
import { getUserTemplate, USER_TEMPLATES_QUERY_KEY } from "./service";
import { teachableScans } from "./teachScans";
import { toggleWord } from "./teachDraft";
import { useTeach } from "./useTeach";
import { TeachPanel } from "./TeachPanel";
import { TeachPreview } from "./TeachPreview";
import { TeachScan } from "./TeachScan";
import { wordsRectFrame } from "../photoRetention";

export function TeachTemplatePage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const code = params.get("sablon");
  const { note } = useNoteDetail(id);
  const existing = useQuery({ queryKey: [...USER_TEMPLATES_QUERY_KEY, code], queryFn: () => getUserTemplate(code as string), enabled: Boolean(code), staleTime: Infinity });
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const scans = teachableScans(note.data?.scans ?? []);
  const [scanIdx, setScanIdx] = useState(0);
  const scan = scans[Math.min(scanIdx, Math.max(0, scans.length - 1))] ?? null;
  const t = useTeach(code && !existing.data ? null : (scan?.id ?? null), existing.data ?? null, () => navigateActive(`/operations/gelen-belgeler/${id}`));
  const n = note.data;
  const title = existing.data ? `Şablonu güncelle — ${existing.data.name}` : "Bu belgeyi tanıt";
  return (
    <PageShell>
      <PageHeader
        title={title}
        statusLine={n ? `Gelen belge ${n.noteNo}${existing.data ? ` · şablon sürümü ${existing.data.version} → ${existing.data.version + 1}` : ""}` : undefined}
        description="Fotoğrafta bir yazıya dokunun ve ne olduğunu seçin; sistem yanındaki basılı etiketi bulup bu belge tipini öğrenir. Sonraki aynı tip belgeler bu şablonla okunur."
        parent={{ label: "Gelen Belge", to: `/operations/gelen-belgeler/${id}` }}
      />
      <PageBody className="min-h-0 p-4 sm:p-6">
        {!n || (code && existing.isLoading) ? (
          <p className="text-sm text-muted-foreground">{note.isError || existing.isError ? "Yüklenemedi." : "Yükleniyor…"}</p>
        ) : scans.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="teach-no-scan">Bu belgenin okunmuş fotoğrafı yok; tanıtmak için önce fotoğrafın okunması gerekir.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              {scans.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {scans.map((s, i) => (
                    <Button key={s.id} size="sm" variant={s.id === scan?.id ? "default" : "outline"} onClick={() => setScanIdx(i)}>Sayfa {s.pageNo}</Button>
                  ))}
                </div>
              )}
              {t.words.isError && <p className="text-sm text-destructive">Bu sayfanın okunan yazıları alınamadı.</p>}
              {scan && t.state && t.words.data && (
                <TeachScan scanId={scan.id} pageLabel={`Belge sayfa ${scan.pageNo}`} words={t.words.data.words} frame={wordsRectFrame(t.words.data)} state={t.state} onToggle={(i) => t.setState((s) => toggleWord(s, i))} />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {!t.state || !t.words.data ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Okunan yazılar yükleniyor…</p>
              ) : (
                <>
                  <TeachPanel state={t.state} words={t.words.data.words} onChange={t.setState} old={existing.data?.template ?? null} />
                  {t.problems.length > 0 && <ul className="text-xs text-amber-800 dark:text-amber-300" data-testid="teach-problems">{t.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                  {t.preview.data && <TeachPreview result={t.preview.data} stale={!t.previewFresh} />}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={t.runPreview} disabled={t.problems.length > 0 || t.preview.isPending} data-testid="teach-preview-run">
                      <Eye className="mr-1 h-4 w-4" /> {t.preview.isPending ? "Önizleniyor…" : "Önizle"}
                    </Button>
                    <Button onClick={() => t.save.mutate()} disabled={!t.canSave} data-testid="teach-save">
                      <Save className="mr-1 h-4 w-4" /> {t.save.isPending ? "Kaydediliyor…" : existing.data ? "Şablonu güncelle" : "Belge tipini kaydet"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
