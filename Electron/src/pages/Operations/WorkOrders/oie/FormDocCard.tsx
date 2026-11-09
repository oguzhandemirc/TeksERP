// S16d: klasik iş emri formunun üstünde okutulan belgenin kartı — okuma ilerlemesi, tanıtım şeridi (K30-T), formda kutusu
// olmayan belge alanları (müşteri · parti no · kurşun metresi · not) ve çok parti. Hedef kutuları formun kendisinde dolar.
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TERIM } from "@/lib/terim";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTabsStore } from "@/store/tabs";
import { teachPath } from "@/pages/Operations/GelenBelgeler/paths";
import { ScanReadBanner } from "@/pages/Operations/GelenBelgeler/ScanReadBanner";
import { TeachButton } from "@/pages/Operations/GelenBelgeler/tanit/TeachEntry";
import { DocFields, FromDocBadge } from "./DocFields";
import { docTextHints, type Tanitim } from "./docFormFill";
import { PartyList } from "./PartyList";
import type { FormDocScan } from "./useFormDocScan";

const NO_GRAMAJ: never[] = [];

function TanitimStrip({ scan, tanitim }: { scan: FormDocScan; tanitim: Tanitim }) {
  const { hasPermission } = useRoleAccess();
  const openTab = useTabsStore((s) => s.openTab);
  const can = hasPermission("gelen-belge:template");
  if (!scan.noteId) return null;
  const noteId = scan.noteId;
  if (tanitim.durum === "TANITILDI") {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="wo-doc-tanitildi">
        Belge “{tanitim.sablonAdi}” tipiyle okundu.
        {can && <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => openTab(teachPath(noteId, tanitim.sablonKodu))} data-testid="wo-doc-sablon-guncelle">Tanımı düzenle</Button>}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950/40" data-testid="wo-doc-tanitilmamis">
      {/* Kipten bağımsız: SORMA'da genel tahmin forma dolmaz (kutular boş kalır), diğer kipte tahminle dolar. */}
      <span>Bu belge tanıtılmamış — kutular boş ya da tahmin olabilir; kontrol edin, Tanıt ile bu belge tipini öğretin.</span>
      {can && (
        <Button type="button" size="sm" onClick={() => { scan.awaitTeach(); openTab(teachPath(noteId)); }} data-testid="wo-doc-tanit">
          <Sparkles className="mr-1 h-4 w-4" /> Tanıt
        </Button>
      )}
      {scan.awaitingTeach && <span className="text-xs text-muted-foreground">Tanıtıp kaydedince form kendiliğinden yeniden dolar.</span>}
      {/* Tek seferlik tazeleme: yoklama süresi dolduysa ya da tanıtma başka yerden yapıldıysa. */}
      <Button type="button" size="sm" variant="outline" onClick={scan.reread} data-testid="wo-doc-reread"><RefreshCw className="mr-1 h-4 w-4" /> Yeniden oku</Button>
    </div>
  );
}

export function FormDocCard({ scan, disabled }: { scan: FormDocScan; disabled?: boolean }) {
  const openTab = useTabsStore((s) => s.openTab);
  const n = scan.note;
  if (!scan.noteId) return null;
  const hints = docTextHints(scan.summary);
  return (
    <section className="mx-6 mt-3 flex shrink-0 flex-col gap-3 rounded-lg border border-teal-300 bg-teal-50/40 p-3 dark:border-teal-800 dark:bg-teal-950/20" data-testid="wo-doc-card">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FromDocBadge />
        <span>Belge <b>{n?.noteNo ?? "…"}</b></span>
        {/* Tanıtım bilgisi yoksa (eski sunucu) bugünkü "Bu belgeyi tanıt / Tanımı düzenle" düğmesi. */}
        {n && scan.stage !== "READING" && scan.summary && !scan.summary.tanitim && <TeachButton note={n} go={(p) => openTab(p)} />}
      </div>
      {scan.noteError && <p className="text-sm text-destructive">Belge yüklenemedi.</p>}
      {scan.stage === "READING" || scan.summaryLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="wo-doc-reading">
          <Loader2 className="h-4 w-4 animate-spin" /> Belge okunuyor… Okuma bitince kutular kendiliğinden dolar.
        </p>
      ) : scan.stage === "CLOSED" ? (
        <p className="text-sm text-muted-foreground">Belge artık taslak değil ({n?.noteNo}).</p>
      ) : (
        <>
          {scan.stage === "READ_FAILED" && n && <ScanReadBanner scans={n.scans} lines={n.lines} editable canRequeue onRequeued={scan.reread} />}
          {scan.stage === "NO_SERVICE" && <p className="text-sm text-amber-800 dark:text-amber-300">Bu kurulumda belge okuma servisi yok; değerleri elle girin.</p>}
          {scan.summary?.tanitim && <TanitimStrip scan={scan} tanitim={scan.summary.tanitim} />}
          {(hints.desen || hints.renk) && (
            <p className="text-xs text-muted-foreground" data-testid="wo-doc-hints">
              Belgede yazan{hints.desen ? ` gelen kumaş: “${hints.desen}”` : ""}{hints.renk ? ` gelen renk: “${hints.renk}”` : ""} — hedef için katalogda eşleşmedi, aşağıdan seçin.
            </p>
          )}
          {n && scan.draft && <DocFields note={n} draft={scan.draft} onChange={scan.setDraft} gramajOptions={NO_GRAMAJ} disabled={disabled} />}
          {scan.multiDraft && scan.parties && <PartyList view={scan.parties} value={scan.multiDraft} onChange={scan.setMulti} disabled={disabled} />}
          {scan.approval === "SEPARATE" && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="wo-doc-separate">
              Bu fabrikada belge ayrı onaylanır: kaydet yalnız belge kartındaki değerleri taslağa yazar. Formdaki hedef değerler (kumaş, renk, en, metraj, kg, tarih, kat tipi) taslağa YAZILMAZ; {TERIM.terbiyeIsEmri.tekilKucuk} Gelen Belgeler'deki onaydan sonra açılır.
            </p>
          )}
          {scan.reasons.length > 0 && <ul className="text-xs text-amber-800 dark:text-amber-300" data-testid="wo-doc-reasons">{scan.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </>
      )}
    </section>
  );
}
