import { useState } from "react";
import { Loader2, ShieldCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * İKİNCİ FAKTÖR ADIMI — yalnız UZAKTAN (tünel) girişte görünür.
 *
 * ⚠️ Bu ekran ASLA KENDİLİĞİNDEN AÇILMAZ. İstemci önce kodsuz dener; sunucu
 * `409 TOTP_REQUIRED` dediğinde açılır. "Her ihtimale karşı sor" yaklaşımı,
 * fabrikadaki her operatöre hiç kullanmayacağı bir alan gösterirdi.
 *
 * Alan hem TOTP kodunu (6 hane) hem kurtarma kodunu (XXXX-XXXX) kabul eder —
 * ayrımı sunucu yapar. Tek kutu olması bilinçli: telefonunu kaybetmiş biri
 * "kurtarma kodu" sekmesini aramak zorunda kalmasın, elindekini yazsın.
 */
export interface TotpStepProps {
  submitting: boolean;
  /** Son denemede kod yanlış mıydı (401 TOTP_INVALID) — alanı kırmızıya çeker. */
  invalid: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}

export function TotpStep({ submitting, invalid, onSubmit, onCancel }: TotpStepProps) {
  const [code, setCode] = useState("");
  const trimmed = code.trim();

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-emerald-500/20 via-teal-500/15 to-blue-500/20 blur-2xl" />
          <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-muted shadow-lg ring-1 ring-white/10">
            <ShieldCheck className="h-9 w-9 text-emerald-500" />
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Doğrulama kodu</h2>
          <p className="text-sm text-muted-foreground">
            Telefonundaki doğrulama uygulamasında görünen 6 haneli kodu gir.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
        className="space-y-4"
      >
        <Input
          autoFocus
          // ⚠️ `inputMode="numeric"` ama `type="text"`: kurtarma kodu HARF içerir
          // (XXXX-XXXX) ve `type="number"` onu tamamen engellerdi. Telefonda yine
          // sayı klavyesi açılır — asıl kullanım TOTP.
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          aria-label="Doğrulama kodu"
          aria-invalid={invalid}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`text-center text-2xl tracking-[0.4em] ${invalid ? "border-destructive" : ""}`}
        />

        {invalid && (
          <p className="text-center text-sm text-destructive">
            Kod doğrulanamadı. Uygulamadaki güncel kodu ya da bir kurtarma kodunu gir.
          </p>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Telefonuna ulaşamıyorsan kurtarma kodlarından birini yazabilirsin.
        </p>

        <Button type="submit" className="w-full" disabled={submitting || !trimmed}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Doğrula ve gir
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onCancel}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Geri dön
        </Button>
      </form>
    </div>
  );
}
