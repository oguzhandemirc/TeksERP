// Tezgâh Yükü — "hangi tezgâh ne zamana kadar dolu?" (salt okuma, Seyitoğlu 3. bölüm L2). Sayılar sunucudan
// (`/api/weaving-orders/loom-load`); ekran hesap yapmaz, yalnız biçimler ve bilinmeyenin nedenini söyler.
import { useQuery } from "@tanstack/react-query";
import { Info, RefreshCw, Spool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { loomLoadService } from "./service";
import { assumptionText, summaryText } from "./loom-load-text";
import { LoomCard, UnassignedSection } from "./LoomLoadParts";

export const LOOM_LOAD_QUERY_KEY = ["weaving-orders", "loom-load"] as const;

export function LoomLoadPage() {
  const q = useQuery({ queryKey: LOOM_LOAD_QUERY_KEY, queryFn: () => loomLoadService.get() });
  const d = q.data;
  return (
    <PageShell className="overflow-hidden">
      <PageHeader
        title="Tezgâh Yükü"
        actions={
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={q.isFetching} onClick={() => void q.refetch()} aria-label="Yenile">
            <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} /> <span className="hidden lg:inline">Yenile</span>
          </Button>
        }
      />
      {d && (
        <div className="space-y-1 border-b bg-muted/20 px-4 py-2 text-sm">
          <p className="font-medium" data-testid="loom-load-summary">{summaryText(d)} · {fmtFactoryDateTime(d.generatedAt)} itibarıyla</p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="loom-load-assumption">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {assumptionText(d.assumption)}
          </p>
        </div>
      )}
      <PageBody className="p-4">
        {q.isError ? (
          <EmptyState icon={Spool} title="Tezgâh yükü okunamadı" description="Bağlantıyı kontrol edip yeniden deneyin." action={<Button size="sm" variant="outline" onClick={() => void q.refetch()}>Yeniden dene</Button>} />
        ) : !d ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : d.looms.length === 0 && d.unassigned.length === 0 ? (
          <EmptyState icon={Spool} title="Tanımlı dokuma tezgâhı yok" description="Tezgâhlar Tanımlar › Üretim İstasyonları ekranından eklenir." />
        ) : (
          <div className="mx-auto flex max-w-7xl flex-col gap-6">
            {d.looms.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {d.looms.map((l) => <LoomCard key={l.machineId} loom={l} />)}
              </div>
            )}
            <UnassignedSection jobs={d.unassigned} />
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
