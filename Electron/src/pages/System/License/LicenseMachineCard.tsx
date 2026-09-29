import { Badge } from "@/components/ui/badge";
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

/** Kurulum kimliği, lisans deposu ve parmak izi — değer değil, yalnız "ölçülebildi mi". */
export function LicenseMachineCard({ d }: { d: LicenseDetail }) {
  const p = d.parmakIzi;
  return (
    <LicenseCard
      title="Kurulum ve parmak izi"
      action={p.karar ? <Badge variant={p.karar === "ESLESMEDI" ? "destructive" : "secondary"}>{DECISION[p.karar]}</Badge> : null}
    >
      <InfoRow label="Kurulum kimliği">
        <span className="font-mono text-xs">{d.kurulum.kurulumId ?? "Hazır değil"}</span>
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
