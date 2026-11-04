// BELGE TİPİ TANITMA (S1b, fabrika cevabı 16/18/38) — okunmuş belge fotoğrafında kelime kutusuna dokun → alan ata → kimlik yazıları →
// tekrar eden bölüm → önizleme → kaydet. K30-T: varsayılan REHBERLİ kip (başlık → alanlar sırayla, otomatik önizleme); serbest kip
// (tablo/bölüm) "Gelişmiş" altında. `?sablon=u-…` = o kullanıcı şablonunu bu belgeyle güncelle (sürümlü; eski belgeler eski sürümde).
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useTabsStore } from "@/store/tabs";
import { useNoteDetail } from "../useNoteDetail";
import { getUserTemplate, USER_TEMPLATES_QUERY_KEY } from "./service";
import { teachableScans } from "./teachScans";
import { teachMarks, toggleWord, type FieldKey } from "./teachDraft";
import { guidedMarks, guidedReduce, type GuidedEvent } from "./guidedTeach";
import { useTeach } from "./useTeach";
import { TeachScan } from "./TeachScan";
import { TeachControls } from "./TeachControls";
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
  const [advanced, setAdvanced] = useState(false);
  // Sayfa değişince işaretleme sıfırlanır (useTeach) — adım/atlandı göstergesi de onunla birlikte başa döner.
  const [nav, setNav] = useState<{ step: number; skipped: FieldKey[] }>({ step: 0, skipped: [] });
  const t = useTeach(code && !existing.data ? null : (scan?.id ?? null), existing.data ?? null, () => navigateActive(`/operations/gelen-belgeler/${id}`), { auto: !advanced });
  const dispatch = (ev: GuidedEvent) => {
    if (!t.state || !t.words.data) return;
    const r = guidedReduce({ ...nav, teach: t.state }, ev, t.words.data.words);
    setNav({ step: r.step, skipped: r.skipped });
    if (r.teach !== t.state) t.setState(() => r.teach);
  };
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
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="teach-no-scan">
            {n.scans.some((s) => s.status === "PENDING" || s.status === "READING") ? "Belge okunuyor… Okuma bitince tanıtma burada açılır." : "Bu belgenin okunmuş fotoğrafı yok; tanıtmak için önce fotoğrafın okunması gerekir."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              {scans.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {scans.map((s, i) => (
                    <Button key={s.id} size="sm" variant={s.id === scan?.id ? "default" : "outline"} onClick={() => { setScanIdx(i); setNav({ step: 0, skipped: [] }); }}>Sayfa {s.pageNo}</Button>
                  ))}
                </div>
              )}
              {t.words.isError && <p className="text-sm text-destructive">Bu sayfanın okunan yazıları alınamadı.</p>}
              {scan && t.state && t.words.data && (
                <TeachScan
                  scanId={scan.id}
                  pageLabel={`Belge sayfa ${scan.pageNo}`}
                  words={t.words.data.words}
                  frame={wordsRectFrame(t.words.data)}
                  state={t.state}
                  marks={advanced ? teachMarks(t.state, t.words.data.words, t.located) : guidedMarks(t.state, t.words.data.words, nav.step, t.located)}
                  onToggle={(i) => (advanced ? t.setState((s) => toggleWord(s, i)) : dispatch({ type: "TAP", i }))}
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {!t.state || !t.words.data ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Okunan yazılar yükleniyor…</p>
              ) : (
                <TeachControls t={t} existing={existing.data ?? null} advanced={advanced} onAdvanced={setAdvanced} nav={nav} dispatch={dispatch} />
              )}
            </div>
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
