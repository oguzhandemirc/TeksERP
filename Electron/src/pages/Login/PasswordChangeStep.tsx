import { useState } from "react";
import { Loader2, KeyRound, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH, passwordPolicyViolation } from "@/lib/password-policy";

/**
 * ZORUNLU PAROLA DEĞİŞİMİ ADIMI — yalnız giriş cevabı `mustChangePassword: true` taşırsa
 * görünür (ilk kurulumda üretilmiş parolayla açılan hesap). Politika istemcide de
 * denetlenir (gereksiz tur olmasın); son söz sunucunun — onun cevabı `serverError`.
 */
export interface PasswordChangeStepProps {
  submitting: boolean;
  /** Son denemenin sunucu cevabı (mevcut parola yanlış · politika · deneme kilidi). */
  serverError: string | null;
  onSubmit: (newPassword: string) => void;
  onCancel: () => void;
}

export function PasswordChangeStep({ submitting, serverError, onSubmit, onCancel }: PasswordChangeStepProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [attempted, setAttempted] = useState(false);

  const policyError = passwordPolicyViolation(password);
  const mismatch = confirm !== password ? "Parolalar eşleşmiyor." : null;
  const localError = attempted ? (policyError ?? mismatch) : null;
  const shownError = localError ?? serverError;

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-amber-500/20 via-orange-500/15 to-rose-500/20 blur-2xl" />
          <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-muted shadow-lg ring-1 ring-white/10">
            <KeyRound className="h-9 w-9 text-amber-500" />
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Yeni parola belirleyin</h2>
          <p className="text-sm text-muted-foreground">
            Bu hesap ilk kurulumda üretilmiş bir parolayla açıldı. Devam etmek için yeni bir parola
            belirleyin (en az {PASSWORD_MIN_LENGTH} karakter).
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          if (!policyError && !mismatch) onSubmit(password);
        }}
        className="space-y-4"
      >
        <Input
          autoFocus
          type="password"
          autoComplete="new-password"
          placeholder={`Yeni parola (en az ${PASSWORD_MIN_LENGTH} karakter)`}
          aria-label="Yeni parola"
          aria-invalid={attempted && policyError !== null}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="Yeni parola (tekrar)"
          aria-label="Yeni parola (tekrar)"
          aria-invalid={attempted && mismatch !== null}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {shownError && (
          <p role="alert" className="text-center text-sm text-destructive">
            {shownError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={submitting || !password}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Parolayı değiştir
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onCancel} disabled={submitting}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Vazgeç
        </Button>
      </form>
    </div>
  );
}
