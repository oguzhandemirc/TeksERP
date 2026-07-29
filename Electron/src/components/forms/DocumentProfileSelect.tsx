import { useQuery } from "@tanstack/react-query";
import { documentProfileService } from "@/services/documentProfileService";

/**
 * Belge şablon profili seçici — müşteri/fason kartında kullanılır.
 * Boş seçim = genel Belge Şablonları ayarı (profil override'ı yok).
 */
export function DocumentProfileSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const q = useQuery({
    queryKey: ["document-profiles", "picker"],
    queryFn: () => documentProfileService.list(),
    staleTime: 60_000,
  });
  const profiles = q.data?.data ?? [];

  return (
    <select
      value={value ?? ""}
      disabled={disabled || q.isLoading}
      onChange={(e) => onChange(e.target.value || null)}
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">Genel ayar (profil yok)</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
