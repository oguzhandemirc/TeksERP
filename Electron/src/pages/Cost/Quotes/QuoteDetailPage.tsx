// =============================================================================
// TEKLİFLER › TEKLİF DETAYI (MAL-5, plan §5) — `quote:read`. Taslak + `quote:write` → başlık ve kalemler düzenlenir;
// gönderilmiş teklif DEĞİŞMEZ (defter) — değişiklik "Revizyon oluştur"dur. Her sayı sunucudan; panel hesap yapmaz.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { CostQueryError } from "../shared/CostQueryState";
import { quoteNumberLabel } from "./labels";
import type { PendingLine } from "./line-body";
import { QuoteActionsBar } from "./QuoteActionsBar";
import { QuoteDraftHeader } from "./QuoteDraftHeader";
import { QuoteHeaderSummary } from "./QuoteHeaderSummary";
import { QuoteLinesSection } from "./QuoteLinesSection";
import { QuoteStatusBadge } from "./QuoteStatusBadge";
import { quoteService } from "./service";
import { QuoteTimeline } from "./QuoteTimeline";
import { quoteDetailKey } from "./useQuoteMutation";

export function QuoteDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const pending = (useLocation().state as { pendingLine?: PendingLine } | null)?.pendingLine ?? null;
  const { hasPermission } = useRoleAccess();
  const q = useQuery({ queryKey: quoteDetailKey(id), queryFn: () => quoteService.get(id), enabled: Boolean(id) });
  const quote = q.data?.data;
  const editable = quote?.status === "DRAFT" && hasPermission("quote:write");
  return (
    <PageShell>
      <PageHeader
        title={quote ? `Teklif ${quoteNumberLabel(quote)}` : "Teklif"}
        titleExtra={quote ? <QuoteStatusBadge status={quote.status} expired={quote.suresiDoldu} /> : undefined}
        description={quote ? `${quote.customer.name} · ${quote.currency}` : undefined}
        onBack={() => nav("/cost/quotes")}
        parent={{ label: "Teklifler", to: "/cost/quotes" }}
      />
      <PageBody className="space-y-4 p-4 sm:p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError || !quote ? (
          <CostQueryError error={q.error} what="Teklif" onRetry={() => void q.refetch()} />
        ) : (
          <>
            <QuoteActionsBar quote={quote} />
            {editable ? <QuoteDraftHeader key={`${quote.id}:${quote.updatedAt}`} quote={quote} /> : <QuoteHeaderSummary q={quote} />}
            <QuoteLinesSection quote={quote} editable={editable} pending={editable ? pending : null} />
            <QuoteTimeline q={quote} actors={q.data?.aktorler ?? {}} />
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
