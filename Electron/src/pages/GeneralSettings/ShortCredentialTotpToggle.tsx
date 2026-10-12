import { FlagToggle } from "./SettingRow";
import type { HintVariant } from "./SettingHint";
import { SHORT_CREDENTIAL_TOTP_DESC } from "./session-settings-text";

/** PIN/kart girişinde ikinci faktör (Y-02) — süperadminde ayardan bağımsız hep açık. */
export function ShortCredentialTotpToggle({
  hint,
  checked,
  disabled,
  onChange,
}: {
  hint: HintVariant;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="border-t pt-4">
      <FlagToggle
        hint={hint}
        title="PIN ve kart girişinde doğrulama kodu iste"
        desc={SHORT_CREDENTIAL_TOTP_DESC}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
