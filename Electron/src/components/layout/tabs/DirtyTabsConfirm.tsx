import { useEffect } from "react";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { dirtyConfirmText, useDirtyConfirmStore } from "./dirty-close-guard";
import { getDirtyTabIds, installDirtyTabListener } from "./dirty-tabs";

/** Kirli sekme onayı — kabukta TEK kez çizilir (sekme dışı, tam ekran modal). */
export function DirtyTabsConfirm() {
  const pending = useDirtyConfirmStore((s) => s.pending);
  const confirm = useDirtyConfirmStore((s) => s.confirm);
  const cancel = useDirtyConfirmStore((s) => s.cancel);
  useEffect(() => installDirtyTabListener(), []);
  useBeforeUnloadWhenDirty();

  return (
    <ConfirmDialog
      open={pending != null}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
      title="Kaydedilmemiş değişiklik var"
      description={pending ? dirtyConfirmText(pending) : undefined}
      confirmLabel={pending?.kind === "logout" ? "Çıkış yap" : "Kapat"}
      cancelLabel="Vazgeç"
      destructive
      onConfirm={confirm}
    />
  );
}

/**
 * Pencere/uygulama kapanışı ve yenileme: kirli sekme varsa yüklemeyi bırakmayı engeller. Masaüstünde ana süreç
 * (`electron/window-close-guard.ts`) bunu yakalayıp yerel "Yine de kapat?" sorusunu sorar; webde tarayıcı sorar.
 */
function useBeforeUnloadWhenDirty(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (getDirtyTabIds().size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
