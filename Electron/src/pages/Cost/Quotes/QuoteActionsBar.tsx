// Detay eylemleri — görünenler `quoteActions` tablosundan (durum + izin). Geçişler sunucuda (claim; 409 → Türkçe +
// ekran yeniden okunur). Revizyon yeni DRAFT sürümü doğurur (`clientToken`) ve ekran ona geçer.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAttemptToken } from "@/lib/attemptToken";
import { ConvertDialog } from "./ConvertDialog";
import { ACTION_LABEL, quoteActions, type QuoteAction } from "./quote-actions";
import { ReasonDialog } from "./ReasonDialog";
import { quoteService } from "./service";
import type { QuoteDetail } from "./quote-types";
import { useQuoteMutation } from "./useQuoteMutation";

type Modal = "reject" | "cancel" | "convert" | null;

export function QuoteActionsBar({ quote }: { quote: QuoteDetail }) {
  const nav = useNavigate();
  const { hasPermission } = useRoleAccess();
  const attempt = useAttemptToken();
  const [modal, setModal] = useState<Modal>(null);
  const actions = quoteActions(quote.status, { expired: quote.suresiDoldu, can: hasPermission });
  const simple = useQuoteMutation({
    quoteId: quote.id,
    exclusive: true,
    fn: (v: { t: "send" | "accept" | "unaccept" | "reject" | "cancel"; reason?: string }) => quoteService.transition(quote.id, v.t, v.reason ? { reason: v.reason } : {}),
    onDone: () => setModal(null),
  });
  const revise = useQuoteMutation({
    quoteId: quote.id,
    exclusive: true,
    fn: () => quoteService.revise(quote.id, attempt.token()),
    onDone: (r) => {
      attempt.onSuccess();
      void nav(`/cost/quotes/${r.data.id}`);
    },
    onFail: (e) => attempt.onFailure(e),
  });
  const busy = simple.isPending || revise.isPending;
  const run = (a: QuoteAction) => {
    if (a === "reject" || a === "cancel" || a === "convert") setModal(a);
    else if (a === "revise") revise.mutate();
    else simple.mutate({ t: a });
  };
  return (
    <div className="space-y-2">
      {quote.suresiDoldu && (
        <p className="rounded-md border border-warning/50 bg-warning/5 p-2 text-sm" role="note" data-testid="expired-note">
          Geçerlilik doldu — teklif kabul edilemez. Revizyon oluşturup yeni geçerlilikle gönderin.
        </p>
      )}
      <div className="flex flex-wrap gap-2" data-testid="quote-actions">
        {actions.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === "reject" || a === "cancel" ? "outline" : a === "revise" && !quote.suresiDoldu ? "outline" : "default"}
            disabled={busy}
            onClick={() => run(a)}
          >
            {ACTION_LABEL[a]}
          </Button>
        ))}
      </div>
      {(modal === "reject" || modal === "cancel") && (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setModal(null)}
          title={modal === "reject" ? "Reddet" : "İptal et"}
          description={modal === "reject" ? "Müşteri teklifi reddetti. Sebep kayda geçer; reddedilen teklif revizyonla yeniden verilebilir." : "Teklif geri çekilir; iptal geri alınmaz."}
          required={modal === "reject"}
          busy={simple.isPending}
          onConfirm={(reason) => simple.mutate({ t: modal, reason })}
        />
      )}
      {modal === "convert" && <ConvertDialog quote={quote} open onOpenChange={(o) => !o && setModal(null)} />}
    </div>
  );
}
