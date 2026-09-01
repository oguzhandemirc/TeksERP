import { Check, Copy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Kurulum tamamlandıktan sonra kurtarma kodlarını gösterir.
 *
 * ⚠️ BU EKRAN BİR DAHA AÇILMAZ. Kodlar sunucuda hash'li saklanıyor; buradan
 * çıkıldığında düz metinleri hiçbir yerde YOKTUR. Bu yüzden "devam et" düğmesi
 * bilinçli olarak bir ONAY kutusuyla kapılı — tek tıkla geçilebilseydi kimse
 * okumadan geçer ve telefonunu kaybettiği gün hesap kurtarılamaz olurdu.
 */
export interface RecoveryCodesPanelProps {
  username: string;
  codes: string[];
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  onDone: () => void;
}

export function RecoveryCodesPanel({
  username,
  codes,
  acknowledged,
  onAcknowledgedChange,
  onDone,
}: RecoveryCodesPanelProps) {
  return (
    <div className="w-full max-w-md space-y-6">
      <div className="flex flex-col items-center space-y-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-emerald-500/10">
          <ShieldCheck className="h-8 w-8 text-emerald-500" />
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Kurulum tamamlandı</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{username}</span> için iki adımlı
            doğrulama açıldı.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="text-sm font-medium">
          Kurtarma kodların — bunlar bir daha gösterilmeyecek
        </p>
        <p className="text-xs text-muted-foreground">
          Telefonunu kaybedersen giriş yapmanın tek yolu bunlardır. Her kod bir kez
          kullanılır. Yazdır ya da parola yöneticine kaydet.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded bg-background p-3 font-mono text-sm">
          {codes.map((c) => (
            <span key={c} className="tracking-wider">
              {c}
            </span>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            void navigator.clipboard.writeText(codes.join("\n"));
            toast.success("Kurtarma kodları kopyalandı");
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Hepsini kopyala
        </Button>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange(e.target.checked)}
        />
        <span>Kurtarma kodlarımı güvenli bir yere kaydettim.</span>
      </label>

      <Button type="button" className="w-full" disabled={!acknowledged} onClick={onDone}>
        <Check className="mr-2 h-4 w-4" />
        Girişe dön
      </Button>
    </div>
  );
}
