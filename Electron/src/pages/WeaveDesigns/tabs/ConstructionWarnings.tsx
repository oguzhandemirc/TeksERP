// Etkin yapı tutarlılık UYARILARI (kaydı reddetmez) — metin sunucudan gelir, istemci yeniden hesaplamaz.
import { Callout } from "@/components/ui/callout";

export function ConstructionWarnings({ warnings }: { warnings: Array<{ code: string; message: string }> }) {
  if (warnings.length === 0) return null;
  return (
    <Callout tone="warning" title="Tutarlılık uyarısı">
      <ul className="list-disc pl-4">
        {warnings.map((w) => <li key={w.code}>{w.message}</li>)}
      </ul>
    </Callout>
  );
}
