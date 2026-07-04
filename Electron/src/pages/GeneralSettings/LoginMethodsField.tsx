import type { LoginMethod } from "@/services/featureFlagService";

export const METHOD_LABELS: Record<LoginMethod, string> = {
  list: "Kullanıcı + Şifre",
  pin: "Hızlı PIN",
  card: "QR Personel Kartı",
};
const METHOD_DESCS: Record<LoginMethod, string> = {
  list: "Klasik: kullanıcı listeden seçilir, şifre/PIN girilir.",
  pin: "SALT PIN: kullanıcı seçme yok — kişiye özel BENZERSİZ 6 haneli hızlı PIN kimliği belirler.",
  card: "QR personel kartı okutulur — kullanıcı seçme ve PIN gerekmez.",
};

/**
 * Mobil giriş yöntemleri seçimi (etkin yöntemler + öncelikli yöntem). Durumu
 * üst bileşen (SessionSettingsSection) tutar — tek Kaydet ile birlikte gönderilir.
 */
export function LoginMethodsField({
  enabled,
  primary,
  valid,
  onToggle,
  onPrimaryChange,
}: {
  enabled: LoginMethod[];
  primary: LoginMethod;
  valid: boolean;
  onToggle: (m: LoginMethod, on: boolean) => void;
  onPrimaryChange: (m: LoginMethod) => void;
}) {
  return (
    <div className="border-t pt-4">
      <span className="text-sm font-medium">Mobil giriş yöntemleri</span>
      <p className="text-xs text-muted-foreground">
        En az bir yöntem seçili olmalı. Sahadaki giriş ekranı <b>öncelikli</b> yöntemle
        açılır; diğer seçili yöntemler "Diğer giriş yöntemlerini dene" tuşuyla sunulur.
        Kartlar ve hızlı PIN'ler Yetkilendirme → Kullanıcılar'dan yönetilir.
      </p>
      <div className="mt-2 space-y-2">
        {(Object.keys(METHOD_LABELS) as LoginMethod[]).map((m) => (
          <label key={m} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enabled.includes(m)}
              onChange={(e) => onToggle(m, e.target.checked)}
            />
            <span>
              {METHOD_LABELS[m]}
              <span className="block text-xs text-muted-foreground">{METHOD_DESCS[m]}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3">
        <label htmlFor="primary-method" className="text-xs font-medium">
          Öncelikli yöntem
        </label>
        <select
          id="primary-method"
          className="mt-1 flex h-9 w-64 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          value={primary}
          onChange={(e) => onPrimaryChange(e.target.value as LoginMethod)}
        >
          {enabled.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      {!valid && (
        <p className="mt-1 text-xs text-destructive">
          En az bir yöntem seçin; öncelikli yöntem seçililerden biri olmalı.
        </p>
      )}
    </div>
  );
}
