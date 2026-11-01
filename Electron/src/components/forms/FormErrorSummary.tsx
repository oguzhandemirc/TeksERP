import type { FieldErrors, FieldValues } from "react-hook-form";

/** Hatalı alan(lar) varken Kaydet SESSİZ kalmasın: ilk hatalı alan görünüm dışında kalsa da
 *  düğmenin yanında özet çıkar (sunum provası: çözgü kartı düzenle→Kaydet hiçbir şey demiyordu). */
export function collectErrorMessages(errors: FieldErrors<FieldValues>): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const msg = (node as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) {
      out.push(msg);
      return;
    }
    for (const [k, v] of Object.entries(node)) if (k !== "ref") walk(v);
  };
  walk(errors);
  return Array.from(new Set(out));
}

export function FormErrorSummary({ errors, submitCount }: { errors: FieldErrors<FieldValues>; submitCount: number }) {
  if (submitCount === 0) return null;
  const messages = collectErrorMessages(errors);
  if (messages.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p className="font-medium">Kaydedilemedi — işaretli alanları düzeltin:</p>
      <ul className="mt-1 list-disc pl-5">
        {messages.slice(0, 5).map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
