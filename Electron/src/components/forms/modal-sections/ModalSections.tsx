// MODAL BÖLÜM GÖRÜNÜRLÜĞÜ (2026-11-19): kapsam (`ModalSectionsScope`) modalın bölümlerini toplar ve × yanına
// "Bölümleri göster/gizle" tetiğini çizer; bölüm `ModalSection id` ile beyan edilir (FormCard/FormSection `sectionId`).
// Gizli bölüm çizilmez (değer üst durumda/RHF'de kalır); zorunlu ya da hatalı bölüm gizlenemez.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useFormContext, useFormState, type FieldValues } from "react-hook-form";
import { useModalSectionPrefs, isSectionHidden } from "./section-visibility";
import { ModalSectionsMenu } from "./ModalSectionsMenu";

export interface SectionEntry {
  id: string;
  title: string;
  required: boolean;
  hasError: boolean;
}

/** Kartı/bölümü modal bölümü olarak beyan eder (FormCard · FormSection): `sectionId` verilince menüde listelenir. */
export interface SectionDecl {
  sectionId?: string;
  /** Zorunlu alan içerir → gizlenemez. */
  sectionRequired?: boolean;
  /** RHF alan adları; hatalıysa bölüm gizliyken de görünür. */
  errorFields?: readonly string[];
  /** RHF dışı formda hata işareti. */
  sectionError?: boolean;
}

interface ScopeValue {
  hidden: readonly string[];
  register: (entry: SectionEntry) => void;
  unregister: (id: string) => void;
}

const ScopeContext = createContext<ScopeValue | null>(null);

/** Modal gövdesini sarar; `modalId` tercih anahtarıdır (ör. `warp-spec.form`). Bölüm yoksa tetik çizilmez. */
export function ModalSectionsScope({ modalId, children }: { modalId: string; children: ReactNode }) {
  const { hidden, setHidden, reset } = useModalSectionPrefs(modalId);
  const [entries, setEntries] = useState<SectionEntry[]>([]);

  const register = useCallback((entry: SectionEntry) => {
    setEntries((cur) => {
      const i = cur.findIndex((e) => e.id === entry.id);
      if (i === -1) return [...cur, entry];
      const old = cur[i];
      if (old && old.title === entry.title && old.required === entry.required && old.hasError === entry.hasError) return cur;
      const next = [...cur];
      next[i] = entry;
      return next;
    });
  }, []);
  const unregister = useCallback((id: string) => setEntries((cur) => cur.filter((e) => e.id !== id)), []);
  const value = useMemo(() => ({ hidden, register, unregister }), [hidden, register, unregister]);

  return (
    <ScopeContext.Provider value={value}>
      {children}
      {entries.length > 0 ? (
        // × (dialog.tsx: right-4 top-4, 16 px) solunda; DialogContent konumlandırma bağlamıdır.
        <div className="absolute right-10 top-3 z-10">
          <ModalSectionsMenu entries={entries} hidden={hidden} onToggle={setHidden} onReset={reset} />
        </div>
      ) : null}
    </ScopeContext.Provider>
  );
}

/** Anahtar verilmişse kapsam açar, yoksa çocukları olduğu gibi çizer (ortak iskeletlerde isteğe bağlı katılım). */
export function MaybeSections({ sectionsKey, children }: { sectionsKey?: string; children: ReactNode }) {
  return sectionsKey ? <ModalSectionsScope modalId={sectionsKey}>{children}</ModalSectionsScope> : <>{children}</>;
}

interface SectionProps {
  id: string;
  title: string;
  /** Zorunlu alan içerir → gizlenemez. */
  required?: boolean;
  /** RHF alan adları: bu alanlarda hata varsa bölüm gizliyken de görünür (form bağlamı yoksa yok sayılır). */
  fields?: readonly string[];
  /** RHF dışı formlar için doğrudan hata işareti. */
  hasError?: boolean;
  children: ReactNode;
}

/** Bölüm beyanı. Kapsam dışında (bölüm beyanlı olmayan modal / sayfa) çocukları olduğu gibi çizer. */
export function ModalSection({ id, title, required = false, fields, hasError = false, children }: SectionProps) {
  const scope = useContext(ScopeContext);
  const rhf = useFormContext<FieldValues>() as ReturnType<typeof useFormContext> | null;
  const [rhfError, setRhfError] = useState(false);
  const error = hasError || rhfError;
  const register = scope?.register;
  const unregister = scope?.unregister;

  useLayoutEffect(() => {
    register?.({ id, title, required, hasError: error });
  }, [register, id, title, required, error]);
  useEffect(() => () => unregister?.(id), [unregister, id]);

  const probe = rhf && fields && fields.length > 0 ? <ErrorProbe fields={fields} onChange={setRhfError} /> : null;
  if (scope && isSectionHidden(scope.hidden, id, required || error)) return probe;
  return (
    <>
      {probe}
      {children}
    </>
  );
}

/** Hata aboneliği ayrı bileşende: `useFormState` form bağlamı olmadan çağrılamaz (koşullu kanca yerine koşullu çizim). */
function ErrorProbe({ fields, onChange }: { fields: readonly string[]; onChange: (v: boolean) => void }) {
  const { errors } = useFormState({ name: fields as string[] });
  const has = fields.some((f) => readPath(errors, f) != null);
  useEffect(() => onChange(has), [has, onChange]);
  return null;
}

function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
