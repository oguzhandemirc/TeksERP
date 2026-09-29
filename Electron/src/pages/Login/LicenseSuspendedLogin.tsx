import { Callout } from "@/components/ui/callout";
import { Button } from "@/components/ui/button";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { LoginForm, type LoginFormProps } from "./LoginForm";

/**
 * K5 GİRİŞ DALI — lisans DURDURULDU (`login-methods.lisansDurduruldu`, yalnız zorlamada). Giriş
 * yalnız "verilerimi al" içindir: yönetici girince kabuk yerine `pages/LicenseSuspended` açılır
 * (yedek + dışa aktarma + çıkış). Veri erişimi her kademede açıktır (kullanıcı kararı, K5).
 */
export function LicenseSuspendedLogin(props: Pick<LoginFormProps, "form" | "submitting" | "onSubmit">) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5" data-testid="giris-lisans-durduruldu">
      <Callout tone="danger" title="Program durduruldu">
        Bu kurulumun lisansı durduruldu; kayıt yapılamaz. Verileriniz korunuyor: yönetici hesabıyla
        giriş yaparak yedek alabilir ve kayıtları dışa aktarabilirsiniz.
      </Callout>
      <LoginForm
        {...props}
        subtitle="Verilerimi al — yönetici hesabıyla giriş yapın."
        submitLabel="Giriş yap ve verilerimi al"
      />
      {IS_ELECTRON && (
        <Button type="button" variant="ghost" className="w-full" onClick={() => window.api?.window?.close?.()}>
          Uygulamadan çık
        </Button>
      )}
    </div>
  );
}
