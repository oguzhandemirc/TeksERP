import { memo, type ReactNode } from "react";
import { Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { auditRecordTarget } from "@/lib/audit-record-link";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { Anlati, AnlatiParca } from "@/types/systemLog";

// =============================================================================
// AUDIT ANLATI SATIRI — Etkinlik akışı, işlem ayrıntısı ve ⓘ Geçmiş'in TEK çizicisi
// =============================================================================
// Cümleyi SUNUCU kurar (okuma anında, B2); burada yalnız parçalar çizilir:
// kişi kalın, kayıt tıklanır bağlantı, değer vurgulu. İki ekran ayrı çizseydi
// biri bağlantıyı öğrenirken öteki düz metinde kalırdı (bekçi: audit-narrative-row.test).
// `anlati` yoksa (eski backend) çağıranın eski satırı (`fallback`) basılır.
// =============================================================================

interface Props {
  anlati?: Anlati | null;
  /** Eski backend düşüşü: anlatı yoksa bu çizilir. */
  fallback?: ReactNode;
  /** Reddedilen deneme: kırmızımsı ikon + renk. */
  reddedildi?: boolean;
  className?: string;
  /** Akış satırı gibi tek satıra sığdırılan yerlerde kırp. */
  truncate?: boolean;
}

export const AuditNarrativeRow = memo(function AuditNarrativeRow({
  anlati,
  fallback,
  reddedildi,
  className,
  truncate,
}: Props) {
  if (!anlati || !Array.isArray(anlati.parcalar) || anlati.parcalar.length === 0) {
    return <>{fallback ?? null}</>;
  }
  return (
    <span
      className={cn(
        "text-sm leading-snug",
        truncate ? "line-clamp-2" : "break-words",
        reddedildi && "text-red-700 dark:text-red-300",
        className,
      )}
      data-testid="audit-narrative"
      title={anlati.metin}
    >
      {reddedildi && (
        <Ban className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-red-600 dark:text-red-400" aria-label="Reddedildi" />
      )}
      {anlati.parcalar.map((p, i) => (
        <NarrativePart key={i} part={p} />
      ))}
    </span>
  );
});

function NarrativePart({ part }: { part: AnlatiParca }) {
  if (part.t === "kisi") return <strong className="font-semibold">{part.text}</strong>;
  if (part.t === "deger") {
    return <mark className="rounded bg-amber-100 px-0.5 text-foreground dark:bg-amber-500/20">{part.text}</mark>;
  }
  if (part.t === "kayit") return <RecordPart part={part} />;
  return <>{part.text}</>;
}

function RecordPart({ part }: { part: AnlatiParca }) {
  const { hasAnyPermission } = useRoleAccess();
  const target = part.ref ? auditRecordTarget(part.ref.table, part.ref.id, part.text) : null;
  if (!target || !hasAnyPermission(target.permissions)) {
    return <span className="font-medium">{part.text}</span>;
  }
  return (
    <a
      href="#"
      className="font-medium text-primary underline-offset-2 hover:underline"
      onClick={(e) => {
        // Satırın kendi tıklaması (ayrıntı açma) tetiklenmesin.
        e.preventDefault();
        e.stopPropagation();
        // Sekme deposu tıklamada yüklenir: statik ithal, ⓘ Geçmiş'i kullanan her
        // ekrana rota/sekme ağacını taşıyordu (ölçüldü: ModuleProfilePage testi düştü).
        void import("@/components/layout/tabs/use-tab-target").then(({ openTargetNow }) =>
          openTargetNow("topLevel", target.to, undefined, target.state ? target.state : undefined),
        );
      }}
    >
      {part.text}
    </a>
  );
}
