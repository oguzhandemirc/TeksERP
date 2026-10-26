import { lazy, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { Link, UNSAFE_DataRouterContext, useBlocker, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReportExportBar } from "@/pages/Reports/_components/ReportExportBar";
import { customReportApi, useSemanticCatalog, type DefinitionIssue } from "../custom-api";
import type { ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { allowedDimensions } from "../builder-model";
import { BlockPalette } from "./BlockPalette";
import { LayoutCanvas } from "./LayoutCanvas";
import { PrintPreviewDialog } from "./PrintPreviewDialog";
import { buildDefinitionExportSpec } from "./definition-export";
import { useNarrowEditor } from "@/hooks/useMediaQuery";
import { WideScreenNotice } from "@/components/layout/WideScreenNotice";
import { LayoutWorkspace } from "./LayoutWorkspace";
import { addBlock, baseQuery, moveBlock, orderedLayout, shiftBlock } from "./layout-model";
import { useLayoutEditor, VERSION_CONFLICT_MESSAGE } from "./useLayoutEditor";
import { CodeModeTabs } from "../code/CodeModeTabs";
import { useCodeMode } from "../code/useCodeMode";

// CodeMirror yalnız Kod sekmesi açılınca yüklenir (düzen sayfasının kendi parçası küçük kalır).
const CodeTab = lazy(() => import("../code/CodeTab"));
import { analysisBlockIssue } from "../../analysis/analysis-model";

/** Kaydedilmemiş değişiklikle ayrılma uyarısı — yalnız veri yönlendiricisinde (testlerin MemoryRouter'ı değil). */
function LeaveGuard({ when }: { when: () => boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when() && currentLocation.pathname !== nextLocation.pathname);
  return (
    <Dialog open={blocker.state === "blocked"} onOpenChange={(o) => (o ? undefined : blocker.reset?.())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Düzen kaydedilmedi</DialogTitle>
          <DialogDescription>Ayrılırsanız bu sayfadaki değişiklikler kaybolur.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.reset?.()}>Sayfada kal</Button>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>Kaydetmeden çık</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pencere kapanırken/yenilenirken tarayıcının kendi uyarısı. */
function useBeforeUnloadWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

interface AlertsProps {
  loadFailed: boolean;
  readOnly: boolean;
  conflict: boolean;
  issues: DefinitionIssue[];
  previewFailed: boolean;
}

function LayoutAlerts({ loadFailed, readOnly, conflict, issues, previewFailed }: AlertsProps) {
  return (
    <>
      {loadFailed ? <p className="text-sm text-destructive">Rapor bulunamadı ya da görme yetkiniz yok.</p> : null}
      {readOnly ? <p className="mb-3 text-sm text-muted-foreground">Bu raporun düzenini değiştirme yetkiniz yok; önizleyip dışa aktarabilirsiniz.</p> : null}
      {conflict ? (
        <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {VERSION_CONFLICT_MESSAGE}
        </p>
      ) : null}
      {issues.length ? (
        <ul role="alert" className="mb-3 list-disc rounded-md border border-destructive/40 bg-destructive/5 py-2 pl-8 pr-3 text-sm text-destructive">
          {issues.map((h) => (
            <li key={`${h.yol}:${h.mesaj}`}>{h.mesaj}</li>
          ))}
        </ul>
      ) : null}
      {previewFailed ? <p className="mb-3 text-sm text-destructive">Önizleme çalıştırılamadı; son değişikliği geri alıp yeniden deneyin.</p> : null}
    </>
  );
}

interface ActionsProps {
  id: string;
  spec: () => ReportExportSpec | null;
  ready: boolean;
  canSave: boolean;
  busy: boolean;
  onPrint: () => void;
  onSave: () => void;
}

function HeaderActions({ id, spec, ready, canSave, busy, onPrint, onSave }: ActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" asChild className="gap-1.5">
        <Link to={`/reports/ozel/${id}`}>
          <ArrowLeft className="h-4 w-4" /> Rapora dön
        </Link>
      </Button>
      <ReportExportBar buildSpec={spec} disabled={!ready} />
      <Button size="sm" variant="outline" className="gap-1.5" disabled={!ready} onClick={onPrint}>
        <Eye className="h-4 w-4" /> Baskı önizleme
      </Button>
      <Button size="sm" className="gap-1.5" disabled={!canSave} onClick={onSave}>
        <Save className="h-4 w-4" /> {busy ? "Kaydediliyor…" : "Kaydet (yeni sürüm)"}
      </Button>
    </div>
  );
}

/** Özel rapor düzeni — `reports/ozel/:id/duzen`: bölüm ekle/çıkar, sürükleyerek sırala, genişlik, sayfa kesmesi, PDF/Excel. */
export function ReportLayoutPage() {
  const { id = "" } = useParams<{ id: string }>();
  const existing = useQuery({ queryKey: ["custom-report", id], queryFn: () => customReportApi.get(id), retry: false });
  const catalog = useSemanticCatalog();
  const ed = useLayoutEditor(existing.data, (b) => b.bloklar.some((x) => analysisBlockIssue(x, catalog.data) !== null));
  const [selected, setSelected] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const { dirty, leaving } = ed;

  useBeforeUnloadWarning(dirty);

  const draft = ed.draft;
  const items = useMemo(() => (draft ? orderedLayout(draft) : []), [draft]);
  const outcomes = useMemo(() => new Map((ed.preview.data?.bloklar ?? []).map((b) => [b.id, b])), [ed.preview.data]);
  const chartKindOf = (bid: string) => String(draft?.bloklar.find((b) => b.id === bid)?.gorsel ?? "cubuk");
  const base = draft ? baseQuery(draft) : null;
  const cubeOf = (kup: string | undefined) => catalog.data?.find((c) => c.kimlik === kup);
  const defaultDim = base ? (allowedDimensions(cubeOf(base.kup), base.olculer.slice(0, 1)).find((d) => d.tur === "kategori")?.kimlik ?? null) : null;
  const current = items.find((x) => x.block.id === selected) ?? null;
  const spec = () => (ed.preview.data && draft ? buildDefinitionExportSpec(ed.preview.data, draft, chartKindOf) : null);
  // Telefonda sürükle-bırak düzen salt-okunur (UX-3); kayıt/sürüm yolu açılmaz.
  const narrow = useNarrowEditor();
  const editable = Boolean(existing.data?.duzenleyebilir && existing.data.aktifSurum) && !narrow;
  const code = useCodeMode(draft, ed.apply, editable);
  // Analiz bölümünde sayım ölçüsü maruziyetsizse kayıt bekler (neden panelde yazılı; son söz sunucuda).
  const blocker = draft ? draft.bloklar.map((b) => analysisBlockIssue(b, catalog.data)).find((x) => x !== null) ?? null : null;

  const onAdd = (kind: Parameters<typeof addBlock>[1]) => {
    if (!draft) return;
    const next = addBlock(draft, kind, defaultDim);
    if (next && ed.apply(() => next)) setSelected(next.bloklar[next.bloklar.length - 1]!.id);
  };

  return (
    <PageShell>
      <PageHeader
        title={`Düzen: ${existing.data?.ad ?? "…"}`}
        description="Bölümleri tutamaçtan sürükleyerek sıralayın; genişlik ve sayfa kesmesi yalnız görünümü değiştirir, sayılar aynı kalır. Kayıt yeni sürüm açar."
        actions={
          <HeaderActions id={id} spec={spec} ready={Boolean(ed.preview.data)} canSave={editable && ed.dirty && !ed.busy && code.lock === null && blocker === null} busy={ed.busy} onPrint={() => setPrintOpen(true)} onSave={() => void ed.save()} />
        }
      />
      <PageBody className="p-4 sm:p-6">
        {blocker && editable ? <p role="alert" className="mb-3 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">Kaydedilemiyor: {blocker}</p> : null}
        {narrow ? <WideScreenNotice what="Rapor düzeni" className="mx-0 mt-0 mb-3" /> : null}
        <LayoutAlerts loadFailed={existing.isError} readOnly={Boolean(existing.data) && !editable && !narrow} conflict={ed.conflict} issues={ed.issues} previewFailed={ed.preview.isError} />
        {draft ? <CodeModeTabs mode={code.mode} lock={code.lock} onVisual={code.showVisual} onCode={code.showCode} /> : null}
        {draft && code.mode === "code" ? (
          <Suspense fallback={<p className="text-sm text-muted-foreground">Kod düzenleyicisi yükleniyor…</p>}>
            <CodeTab value={code.text} readOnly={!editable} onChange={code.setText} issues={code.issues} cubes={catalog.data ?? []} />
          </Suspense>
        ) : draft ? (
          <LayoutWorkspace
            draft={draft}
            current={current}
            catalog={catalog}
            editable={editable}
            fallbackCube={base?.kup ?? null}
            apply={ed.apply}
            onDeselect={() => setSelected(null)}
            palette={<BlockPalette blockCount={draft.bloklar.length} hasDimension={defaultDim !== null} onAdd={onAdd} />}
            canvas={
              <>
                {ed.preview.data ? <p className="mb-2 text-xs text-muted-foreground">{ed.preview.data.itibariylaMetni} itibarıyla · önizleme</p> : null}
                <LayoutCanvas
                  items={items}
                  outcomes={outcomes}
                  selectedId={selected}
                  chartKindOf={chartKindOf}
                  onSelect={setSelected}
                  onMove={(a, o) => ed.apply((b) => moveBlock(b, a, o))}
                  onShift={(bid, d) => ed.apply((b) => shiftBlock(b, bid, d))}
                />
              </>
            }
          />
        ) : existing.isLoading ? (
          <p className="text-sm text-muted-foreground">Rapor yükleniyor…</p>
        ) : null}
      </PageBody>
      <PrintPreviewDialog open={printOpen} spec={printOpen ? spec() : null} onClose={() => setPrintOpen(false)} />
      {dataRouter ? <LeaveGuard when={() => dirty && !leaving.current} /> : null}
    </PageShell>
  );
}
