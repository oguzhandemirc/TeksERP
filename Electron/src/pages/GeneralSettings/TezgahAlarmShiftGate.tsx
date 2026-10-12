// "Tezgah alarmı" anahtarının KAPISI: REQUIRE_SHIFT kipinde vardiya tanımı yokken anahtarı AÇMAK pasif + neden.
// Kilit TASLAK kipe bakar (kullanıcının yapmak üzere olduğu eylem); şerit KAYITLI durumu anlatır (sunucu `notice`).
// Sunucu aynı kapıyı 400 `TEZGAH_ALARM_SHIFT_REQUIRED` ile ayrıca uygular.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { featureFlagService, type TezgahAlarmNoShiftMode } from "@/services/featureFlagService";
import { SHIFT_DEFINITIONS_PATH } from "@/lib/alarm-shift-notice";
import { AlarmShiftStrip, useShiftDefinitionsLinkVisible } from "@/components/AlarmShiftStrip";
import type { FlagGateProps } from "./settings-config";

export const TEZGAH_ALARM_SHIFT_BLOCK_REASON = "Vardiya tanımlı değil — “Vardiya olmadan açılamasın” kipinde tezgah alarmı açılamaz.";

export function TezgahAlarmShiftGate({ draftOf, serverOf, children }: FlagGateProps) {
  const linkVisible = useShiftDefinitionsLinkVisible();
  // Anahtar sunucunun kayıtlı değerlerini taşır: Kaydet'ten sonra şerit tazelenir.
  const q = useQuery({
    queryKey: ["tezgah-alarm-shift-status", serverOf("tezgahAlarmEnabled"), serverOf("tezgahAlarmNoShiftMode")],
    queryFn: () => featureFlagService.getTezgahAlarmShiftStatus(),
    staleTime: 30_000,
  });
  const status = q.data?.data;
  const draftMode = (draftOf("tezgahAlarmNoShiftMode") ?? "WARN") as TezgahAlarmNoShiftMode;
  const blockOn = status?.enableBlockedModes.includes(draftMode) ? TEZGAH_ALARM_SHIFT_BLOCK_REASON : null;
  return (
    <>
      {children({ blockOn })}
      {blockOn ? (
        <p className="mt-2 pl-1 text-xs text-amber-700 dark:text-amber-400" data-testid="tezgah-alarm-block-reason">
          {blockOn}{" "}
          {linkVisible ? (
            <Link to={SHIFT_DEFINITIONS_PATH} className="font-semibold underline underline-offset-2">
              Vardiya Tanımları
            </Link>
          ) : null}
        </p>
      ) : null}
      <div className="mt-2">
        <AlarmShiftStrip notice={status?.notice} linkVisible={linkVisible} />
      </div>
    </>
  );
}
