import { FlagToggle } from "./SettingRow";
import type { HintVariant } from "./SettingHint";

/** Çevrimdışı kilit ertelemesi (denetim Y5): kilit açma sunucu ister; kesintide kilitlenen tablet açılamaz. */
export function OfflineLockDeferToggle({
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
        title="İnternet yokken tablet kilitlenmesin"
        desc="Kapalıyken (varsayılan) tablet bağlantı kesikken de hareketsizlik ve uygulamadan çıkma kilidine girer; kilit açmak sunucuya bağlanmayı gerektirdiği için kesinti bitene dek açılamaz. Açıkken sunucuya ulaşılamadığı sürece bu iki kilit ertelenir, operatör açık ekranda çalışmaya ve kayıtları kuyruğa yazmaya devam eder; bağlantı dönünce kilit süresi yeniden başlar; kesinti sırasında uygulamadan çıkıldıysa tablet bağlantı dönünce kilitlenir. Tablette PIN saklanmaz. Dikkat: kesinti boyunca başında kimse olmayan tablet açık kalır."
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
