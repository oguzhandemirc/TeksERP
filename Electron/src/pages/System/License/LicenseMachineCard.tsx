import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { copyText } from "@/lib/clipboard";
import { licenseService } from "@/services/licenseService";
import type { FingerprintFactor, LicenseDetail } from "@/types/license";
import { InfoRow, LicenseCard, when } from "./LicenseParts";
import { FACTOR_LABEL } from "./labels";

const FACTORS: FingerprintFactor[] = ["f1", "f2", "f3", "f4", "f5"];
const DECISION: Record<string, string> = { ESLESTI: "Eşleşti", ESLESMEDI: "Eşleşmedi", OLCULEMEDI: "Ölçülemedi" };
const STORE_PROBLEM: Record<string, string> = {
  APP_ICINDE: "Lisans klasörü program klasörünün içinde",
  YEDEK_ICINDE: "Lisans klasörü yedek klasörünün içinde",
  OKUNAMADI: "Lisans klasörü okunamadı",
  YAZILAMADI: "Lisans klasörüne yazılamadı",
};

/** Kimlik + kopyala düğmesi (portal/destek ile yazışırken elle yazılmasın). */
function CopyableId({ value, label, testId }: { value: string | null; label: string; testId: string }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs" data-testid={testId}>
        {value}
      </span>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`${label} kopyala`}
        onClick={() => void copyText(value).then(() => toast.success(`${label} kopyalandı.`))}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/**
 * Kimlikler, lisans deposu ve parmak izi — değer değil, yalnız "ölçülebildi mi".
 * İKİ kimlik ayrı durur (D14): lisans kimliği (`kurulumId`, portalda üretilir, lisans
 * klasöründe) hakkın bağlandığı kimliktir; veritabanı kimliği yalnız bilgidir — veritabanını
 * taşıyan kopya (DR/test) lisansı taşımaz.
 */
export function LicenseMachineCard({ d }: { d: LicenseDetail }) {
  const p = d.parmakIzi;
  const db = useQuery({ queryKey: ["license", "db-kimligi"], queryFn: licenseService.databaseInstallationId, staleTime: 5 * 60_000 });
  return (
    <LicenseCard
      title="Kurulum ve parmak izi"
      action={p.karar ? <Badge variant={p.karar === "ESLESMEDI" ? "destructive" : "secondary"}>{DECISION[p.karar]}</Badge> : null}
    >
      <InfoRow label="Lisans kimliği (kurulum)">
        <CopyableId value={d.kurulum.kurulumId} label="Lisans kimliği" testId="lisans-kurulum-kimligi" />
      </InfoRow>
      <InfoRow label="Veritabanı kimliği (bilgi)">
        <CopyableId value={db.data ?? null} label="Veritabanı kimliği" testId="lisans-db-kimligi" />
      </InfoRow>
      <InfoRow label="Kurulum anahtarı">
        <span className="font-mono text-xs">{d.kurulum.anahtarKimligi ?? "—"}</span>
      </InfoRow>
      <InfoRow label="Lisans klasörü">
        {d.depo.sorun ? <span className="text-destructive">{STORE_PROBLEM[d.depo.sorun]}</span> : (d.depo.dizin ?? "—")}
      </InfoRow>
      {d.depo.bozukAnahtarKenaraAlindi && (
        <InfoRow label="Anahtar">Bozuk anahtar kenara alındı — taşıma talebi gerekir</InfoRow>
      )}
      <InfoRow label="Eşleşme">
        {p.eslesen ?? "—"} / {p.olculebilen ?? "—"} etken · ölçüm {when(p.olculdu)}
      </InfoRow>
      <ul className="grid grid-cols-1 gap-0.5 pt-1 text-xs sm:grid-cols-2">
        {FACTORS.map((f) => (
          <li key={f} className={p.uyusmayan.includes(f) ? "text-destructive" : "text-muted-foreground"}>
            {p.olculen?.[f] ? "●" : "○"} {FACTOR_LABEL[f]}
            {p.uyusmayan.includes(f) ? " · uyuşmuyor" : p.olculen && !p.olculen[f] ? " · ölçülemedi" : ""}
          </li>
        ))}
      </ul>
    </LicenseCard>
  );
}
