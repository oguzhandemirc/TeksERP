import { AlertTriangle } from "lucide-react";

/**
 * Bir giriş yöntemi (Hızlı PIN / QR kart) panelden KAPALIYKEN ilgili sekmenin
 * üstünde gösterilen uyarı — sekme yine çalışır (ileride açılacaksa kimlik hazır olur).
 */
export function MethodDisabledNotice({ label }: { label: string }) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <b>{label}</b> giriş yöntemi şu an kapalı — sahadaki giriş ekranında kullanılmaz.
        Sistem → Şirket &amp; Güvenlik → Oturum &amp; Güvenlik'ten açabilirsiniz. Buradan yine de kimlik
        atayabilirsiniz (yöntem açılınca hazır olur).
      </span>
    </div>
  );
}
