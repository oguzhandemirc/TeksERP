// =============================================================================
// TESLİM BORDROSU — "KAYDEDİNCE NE OLACAK" (hareket fişi, K3)
// =============================================================================
// Backend taslağının planını GÖSTERİR (kendi planını üretmez). Engelli satırlar adıyla ve
// nedeniyle yazılır: kayıt zaten hepsini birden 409'la reddederdi, kullanıcı önceden görsün.
// Aynı liste kaydın 409 `DELIVERY_ROWS_BLOCKED` cevabını da gösterir (`issues`).
// =============================================================================
import { STATUS_LABEL } from "./labels";
import { MOVEMENT_LABEL, type MovementPlan, type RowIssue } from "./chequeNoteMovement";

interface Props {
  plan?: MovementPlan;
  /** Kaydın satır reddi (409) — plan yerine ya da yanında. */
  issues?: RowIssue[];
}

export function BordroMovementPlan({ plan, issues }: Props) {
  const ok = plan?.rows.filter((r) => !r.blockedReason) ?? [];
  const blocked: RowIssue[] = issues?.length
    ? issues
    : (plan?.rows ?? []).flatMap((r) => (r.blockedReason ? [{ chequeId: r.chequeId, docNo: r.docNo, reason: r.blockedReason }] : []));
  if (!plan?.type && blocked.length === 0) return null;
  const first = ok[0];

  return (
    <div className="space-y-2 text-xs">
      {plan?.type && first && (
        <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
          Kaydedince <strong>{ok.length} kıymet {MOVEMENT_LABEL[plan.type]}</strong> ({STATUS_LABEL[first.fromStatus]} →{" "}
          {STATUS_LABEL[first.toStatus]}). Bordroyu iptal etmek bu hareketi geri alır.
        </div>
      )}
      {blocked.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
          <p className="font-medium text-destructive">{blocked.length} kıymet bu bordroyla hareket edemez:</p>
          <ul className="mt-1 list-disc pl-4">
            {blocked.map((b) => (
              <li key={b.chequeId}>
                <strong>{b.docNo}</strong> — {b.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
