// Cari kilidi sarı şeridi (D4-I3) — gelen belge detayı; metin SUNUCUDAN (`cariHold.message`), istemci üretmez.
import { Lock } from "lucide-react";
import { Callout } from "@/components/ui/callout";

export function CariHoldStrip({ message, title }: { message?: string | null; title: string }) {
  if (!message) return null;
  return (
    <Callout tone="warning" icon={Lock} title={title}>
      {message}
    </Callout>
  );
}
