// F7b: sunucu tevkifat önerisini bir kuralla kapattıysa (`withholdingOffReason`) formda nedenini günlük dille söyler;
// yoksa kullanıcı "carinin tevkifatı neden gelmedi" diye kalır. Kod gösterilmez, cümle gösterilir.
import { Info } from "lucide-react";
import type { WithholdingOffReason } from "./service";

const TEXT: Record<string, string> = {
  PERFORMER_SUPPLIED_MATERIAL: "Ana hammaddeyi işi yapan taraf olarak biz verdik; bu işte tevkifat önerilmedi.",
};

export function withholdingOffText(reason: WithholdingOffReason | null | undefined): string | null {
  if (!reason) return null;
  return TEXT[reason] ?? "Bu faturada tevkifat önerilmedi (kural gereği kapalı).";
}

export function WithholdingOffNote({ reason }: { reason: WithholdingOffReason | null | undefined }) {
  const text = withholdingOffText(reason);
  if (!text) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground" data-testid="withholding-off-note">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Tevkifat: {text} Gerekirse satırda elle girebilirsiniz.
      </span>
    </p>
  );
}
