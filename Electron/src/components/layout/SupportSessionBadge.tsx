import { useAuthStore } from "@/store/auth";

/** Destek (süperadmin) hesabıyla açılmış oturumun sürekli işareti; diğer hesaplarda çizilmez. */
export function SupportSessionBadge() {
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  if (!isSystemAccount) return null;
  return (
    <span
      data-testid="destek-hesabi-rozeti"
      title="Bu oturum satıcının destek hesabıdır. Fabrikanın günlük işi kendi hesaplarıyla yapılır."
      className="flex items-center rounded-md border border-amber-500/60 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
    >
      Destek hesabıyla girdiniz
    </span>
  );
}
