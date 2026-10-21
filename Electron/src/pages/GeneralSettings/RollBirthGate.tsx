// "Dokuma topu nerede doğar" satırının KAPISI: KK1_* (taslak) seçiliyken Devere'nin levent bağı/otomatik
// tüketim anahtarları kapalıysa amber bant — top doğar ama levent düşümü yazılmaz. Kaydı ENGELLEMEZ.
// Ayar adları ve menü yolu katalogdan okunur (elle yol yazılmaz; ekran adı değişince bant yalan söylemez).
import type { DokumaRollBirth, FeatureFlags } from "@/services/featureFlagService";
import { SETTINGS_CATEGORIES, settingsCategoryTrail, type FlagGateProps } from "./settings-config";

const LEVENT_KEYS = ["devereMountTracking", "devereAutoConsume"] as const satisfies ReadonlyArray<keyof FeatureFlags>;

export function isKk1RollBirth(mode: unknown): boolean {
  return mode === ("KK1_LABEL_OR_ORDER" satisfies DokumaRollBirth) || mode === ("KK1_LABEL_ONLY" satisfies DokumaRollBirth);
}

export function RollBirthGate({ draftOf, children }: FlagGateProps) {
  const body = children({ blockOn: null });
  if (!isKk1RollBirth(draftOf("dokumaRollBirth"))) return <>{body}</>;

  // Döngüsel import güvenli: katalog yalnız çizimde okunur (modül yüklemesinde değil).
  const devere = SETTINGS_CATEGORIES.find((c) => c.id === "devere");
  const titleOf = (k: string) => devere?.flags?.find((f) => f.key === k)?.title ?? k;
  const moduleOn = draftOf("devereEnabled") === true;
  const rows = LEVENT_KEYS.map((k) => ({ key: k, title: titleOf(k), on: draftOf(k) === true }));
  if (moduleOn && rows.every((r) => r.on)) return <>{body}</>;

  const trail = devere ? settingsCategoryTrail(devere) : "Devere / Levent";
  return (
    <>
      {body}
      <div
        className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        data-testid="roll-birth-levent-warning"
        role="status"
      >
        <p>
          Levent dengesi için {trail} altında {rows.map((r) => `“${r.title}”`).join(" ve ")} açık olmalı; kapalıyken
          top doğar ama leventten düşüm yazılmaz.
        </p>
        <ul className="mt-1 list-disc pl-4">
          {!moduleOn ? <li>Devere modülü: kapalı</li> : null}
          {rows.map((r) => (
            <li key={r.key}>
              {r.title}: <span className="font-semibold">{r.on ? "açık" : "kapalı"}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
