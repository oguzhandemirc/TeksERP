import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";

/**
 * Şifreli yedeğin yedek parolası. Parola yalnız bu bileşenin durumunda yaşar ve
 * gönderilince SİLİNİR — hatırlanmaz, loga/depoya yazılmaz (`@/lib/backup-password`).
 */
export function BackupPasswordPrompt({
  invalid,
  pending,
  onSubmit,
  description = "Bu yedek şifreli. İçeriğini doğrulamak için yedek parolasını girin.",
}: {
  invalid: boolean;
  pending?: boolean;
  onSubmit: (password: string) => void;
  description?: string;
}) {
  const [value, setValue] = useState("");

  function submit() {
    if (!value) return;
    const pw = value;
    setValue("");
    onSubmit(pw);
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRound className="h-4 w-4" />
        Yedek parolası
      </p>
      <p className="text-sm text-muted-foreground">{description}</p>
      {invalid && <Callout tone="danger">Yedek parolası hatalı.</Callout>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          aria-label="Yedek parolası"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
        />
        <Button type="submit" disabled={!value || pending}>
          Doğrula
        </Button>
      </form>
    </div>
  );
}
