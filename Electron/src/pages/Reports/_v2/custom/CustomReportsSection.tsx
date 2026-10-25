import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, FilePlus2, FileBarChart, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { foldedIncludes } from "@/lib/search-fold";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { REPORT_BUILDER_PERMISSION, useCustomReportList, type DefinitionSummary } from "./custom-api";

const VISIBILITY_TEXT: Record<DefinitionSummary["gorunurluk"], string> = { OZEL: "Yalnız ben", PAYLASIMLI: "Paylaşıldı", HERKES: "Herkese açık" };

function CustomReportCard({ d, mine }: { d: DefinitionSummary; mine: boolean }) {
  return (
    <Link to={`/reports/ozel/${d.id}`} className="group flex items-start justify-between gap-2 rounded-lg border bg-card p-3 hover:border-primary/50 hover:bg-muted/40">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{d.ad}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{d.kategori.ad}</span>
          <span aria-hidden>·</span>
          <span>{mine ? VISIBILITY_TEXT[d.gorunurluk] : `Paylaşan: ${d.sahip?.ad ?? "—"}`}</span>
          {d.bozuk ? (
            <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[11px]">
              <AlertTriangle className="h-3 w-3" /> Bozuk
            </Badge>
          ) : null}
        </span>
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </Link>
  );
}

function CardGrid({ items, mine }: { items: readonly DefinitionSummary[]; mine: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((d) => (
        <CustomReportCard key={d.id} d={d} mine={mine} />
      ))}
    </div>
  );
}

/** Rapor Merkezi "Özel raporlarım" — kendi raporlarım + benimle paylaşılanlar; arama Merkez'in aramasıdır. */
export function CustomReportsSection({ term }: { term: string }) {
  const { hasPermission } = useRoleAccess();
  const canBuild = hasPermission(REPORT_BUILDER_PERMISSION);
  const mine = useCustomReportList("benim", true);
  const shared = useCustomReportList("paylasilan", true);
  const match = (d: DefinitionSummary) => !term || foldedIncludes(d.ad, term);
  const mineItems = (mine.data?.items ?? []).filter(match);
  const sharedItems = (shared.data?.items ?? []).filter(match);
  const loading = mine.isLoading || shared.isLoading;
  const failed = mine.isError || shared.isError;
  // Oluşturamayan ve görecek raporu olmayan kullanıcıya boş bölüm çizilmez.
  if (!canBuild && !loading && !failed && mineItems.length === 0 && sharedItems.length === 0) return null;

  return (
    <section aria-label="Özel raporlarım" className="rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <FileBarChart className="h-4 w-4" /> Özel raporlarım <span className="font-normal text-muted-foreground">({mineItems.length + sharedItems.length})</span>
        </h2>
        {canBuild ? (
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/reports/ozel/yeni">
              <FilePlus2 className="h-4 w-4" /> Yeni özel rapor
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {loading ? <p className="text-sm text-muted-foreground">Özel raporlar yükleniyor…</p> : null}
        {failed ? <p className="text-sm text-destructive">Özel raporlar okunamadı; sayfayı yenileyin.</p> : null}
        {!loading && !failed && mineItems.length === 0 && sharedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {term ? `“${term}” ile eşleşen özel rapor yok.` : "Henüz özel raporunuz yok. Ölçü ve kırılım seçerek kendi raporunuzu kurabilirsiniz."}
          </p>
        ) : null}
        {mineItems.length > 0 ? <CardGrid items={mineItems} mine /> : null}
        {sharedItems.length > 0 ? (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Benimle paylaşılanlar
            </h3>
            <CardGrid items={sharedItems} mine={false} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
