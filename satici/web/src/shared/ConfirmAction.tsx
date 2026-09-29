// YIKICI / DEFTERE YAZAN EYLEM ONAYI — etkilenen kaydı ADIYLA gösterir (soyut sayı değil), sebep
// ister (sunucuda zorunlu) ve ağır eylemde (K4 · K5 · kısa K3) ikinci onay olarak lisans numarasının
// AYNEN yazılmasını bekler. İşlem kimliği pencere ömrü boyunca tek denemedir (useWrite).
import { useState, type ReactNode } from "react";
import { useWrite } from "./attempt";
import { Button, ErrorText, Field, Modal, ModalActions } from "./ui";

export interface ConfirmActionProps<R> {
  readonly title: string;
  /** Eylemin ne yapacağı (tek cümle). */
  readonly description: ReactNode;
  /** Etkilenen kayıt(lar) — adıyla. */
  readonly targets: readonly string[];
  readonly confirmLabel: string;
  readonly danger?: boolean;
  /** Sebep sunucuda zorunluysa true (varsayılan). */
  readonly requireReason?: boolean;
  /** İkinci onay: bu metin AYNEN yazılmadan düğme açılmaz (ör. lisans numarası). */
  readonly typedConfirmation?: { readonly expected: string; readonly label: string };
  readonly extra?: ReactNode;
  readonly send: (body: { sebep?: string; onay?: string; clientToken: string }) => Promise<R>;
  readonly onDone: (result: R) => void;
  readonly onClose: () => void;
}

export function ConfirmAction<R>(p: ConfirmActionProps<R>) {
  const requireReason = p.requireReason ?? true;
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const write = useWrite<R>((body) => p.send(body as { sebep?: string; onay?: string; clientToken: string }));
  const typedOk = !p.typedConfirmation || typed.trim() === p.typedConfirmation.expected;
  const reasonOk = !requireReason || reason.trim().length > 0;

  const submit = async () => {
    const r = await write.run({ ...(requireReason ? { sebep: reason.trim() } : {}), ...(p.typedConfirmation ? { onay: typed.trim() } : {}) });
    if (r.ok) p.onDone(r.data);
  };

  return (
    <Modal title={p.title} onClose={p.onClose} busy={write.pending}>
      <p>{p.description}</p>
      <div className="affected">
        <span className="field-label">Etkilenen kayıt{p.targets.length > 1 ? `lar (${p.targets.length})` : ""}</span>
        <ul>
          {p.targets.map((t) => (
            <li key={t}>
              <strong>{t}</strong>
            </li>
          ))}
        </ul>
      </div>
      {p.extra}
      {requireReason ? (
        <Field label="Sebep (zorunlu, deftere yazılır)">
          <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ) : null}
      {p.typedConfirmation ? (
        <Field label={p.typedConfirmation.label} hint={<>Onay için aynen yazın: <code>{p.typedConfirmation.expected}</code></>}>
          <input value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      ) : null}
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={p.onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant={p.danger ? "danger" : "primary"} onClick={submit} disabled={write.pending || !typedOk || !reasonOk}>
          {write.pending ? "İşleniyor…" : p.confirmLabel}
        </Button>
      </ModalActions>
    </Modal>
  );
}
