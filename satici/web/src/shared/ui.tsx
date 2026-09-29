// Ortak arayüz parçaları — sade, satır içi stil YOK (CSP style-src 'self'); görünüm styles.css'te.
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { errorMessage } from "./api";

export function Button({ variant = "default", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost" }) {
  return <button type="button" className={`btn btn-${variant}${className ? ` ${className}` : ""}`} {...rest} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {errorMessage(error)}
    </p>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "danger" | "info"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h2>{title}</h2>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="muted">{sub}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </div>
  );
}

export function Loading() {
  return <p className="muted">Yükleniyor…</p>;
}

export function QueryState({ isLoading, error }: { isLoading: boolean; error: unknown }) {
  if (isLoading) return <Loading />;
  if (error) return <ErrorText error={error} />;
  return null;
}

export interface Column<T> {
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly className?: string;
}

export function Table<T>({ rows, columns, rowKey, empty = "Kayıt yok" }: { rows: readonly T[]; columns: readonly Column<T>[]; rowKey: (row: T) => string; empty?: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.header} className={c.className}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValues({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Kipli pencere: Escape ve arka plan tıklaması kapatır (işlem sürerken kapanmaz). */
export function Modal({ title, onClose, children, busy = false, wide = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" aria-label="Kapat" onClick={onClose} disabled={busy}>
            ✕
          </Button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}

/** "Daha fazla" düğmesi: imleçli listelerde sonraki sayfa. */
export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="load-more">
      <Button onClick={onClick} disabled={loading}>
        {loading ? "Yükleniyor…" : "Daha fazla"}
      </Button>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageTitle title="Sayfa bulunamadı" />
      <p className="muted">Adres yanlış ya da bu sayfayı görme yetkiniz yok.</p>
    </>
  );
}
