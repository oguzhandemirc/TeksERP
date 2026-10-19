import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type FeatureFlags } from "@/services/featureFlagService";
import { useRegisterSettingsDirty } from "./settings-dirty";

type DeviceFlagKey =
  | "devicePairingRequired"
  | "shortCredentialApprovedDeviceOnly"
  | "deviceProofRequired"
  | "deviceUnpairedPasswordLogin";
type DeviceFlags = Record<DeviceFlagKey, boolean>;

/** Sunucu değeri değişince (kayıt sonrası / geç yükleme) taslağı ona eşitler. */
function useServerDraft(server: boolean) {
  const [draft, setDraft] = useState(server);
  useEffect(() => setDraft(server), [server]);
  return [draft, setDraft] as const;
}

/**
 * Cihaz eşleştirme bölümünün dört bayrağı için taslak + kaydet. Kısa kimlik kuralı açıkken
 * eşleştirme etkin zorunludur — taslak da onu yansıtır; PATCH yalnız değişen alanı taşır.
 */
export function useDevicePairingDrafts() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const f = flagsQ.data?.data as Partial<FeatureFlags> | undefined;
  const server: DeviceFlags = {
    devicePairingRequired: f?.devicePairingRequired ?? false,
    shortCredentialApprovedDeviceOnly: f?.shortCredentialApprovedDeviceOnly ?? false,
    deviceProofRequired: f?.deviceProofRequired ?? false,
    deviceUnpairedPasswordLogin: f?.deviceUnpairedPasswordLogin ?? false,
  };
  const [pairing, setPairing] = useServerDraft(server.devicePairingRequired);
  const [short, setShort] = useServerDraft(server.shortCredentialApprovedDeviceOnly);
  const [proof, setProof] = useServerDraft(server.deviceProofRequired);
  const [unpaired, setUnpaired] = useServerDraft(server.deviceUnpairedPasswordLogin);

  const draft: DeviceFlags = {
    devicePairingRequired: pairing || short,
    shortCredentialApprovedDeviceOnly: short,
    deviceProofRequired: proof,
    deviceUnpairedPasswordLogin: unpaired,
  };
  const changed = (Object.keys(draft) as DeviceFlagKey[]).filter((k) => draft[k] !== server[k]);
  const dirty = changed.length > 0;
  useRegisterSettingsDirty(dirty);

  const mut = useMutation({
    mutationFn: () => featureFlagService.update(Object.fromEntries(changed.map((k) => [k, draft[k]]))),
    onSuccess: () => {
      toast.success("Cihaz ayarları kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const reset = () => {
    setPairing(server.devicePairingRequired);
    setShort(server.shortCredentialApprovedDeviceOnly);
    setProof(server.deviceProofRequired);
    setUnpaired(server.deviceUnpairedPasswordLogin);
  };

  return {
    isLoading: flagsQ.isLoading,
    server,
    draft,
    set: { pairing: setPairing, short: setShort, proof: setProof, unpaired: setUnpaired },
    dirty,
    mut,
    reset,
  };
}
