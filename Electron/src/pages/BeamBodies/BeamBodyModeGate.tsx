// Gövde takibi KAPALIYKEN (devere.beamBodyMode=OFF) sayfa liste çizmez: backend her uçta 403 `BEAM_BODY_MODE_OFF` der.
// Boş tablo "gövde yok" sanılmasın diye neden + ayar yolu söylenir; bayraklar yüklenene dek iskelet.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Callout } from "@/components/ui/callout";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { flagSettingPath, flagSettingTrail } from "@/lib/flag-setting-path";

export function BeamBodyModeGate({ children }: { children: ReactNode }) {
  const q = useFeatureFlags();
  if (q.isLoading) return <p className="p-6 text-sm text-muted-foreground">Yükleniyor…</p>;
  const mode = q.data?.data?.devereBeamBodyMode ?? "OFF";
  if (mode !== "OFF") return <>{children}</>;
  return (
    <div className="p-6">
      <Callout tone="warning" title="Levent gövdesi takibi kapalı">
        <p>Gövde kaydı, QR etiketi ve hareket geçmişi bu ayar açılınca kullanılır. Kapalıyken levent numarası serbest metin kalır.</p>
        <p>
          Açmak için: <Link className="underline" to={flagSettingPath("devereBeamBodyMode")}>{flagSettingTrail("devereBeamBodyMode")}</Link> › “Levent gövdesi takibi”.
        </p>
      </Callout>
    </div>
  );
}
