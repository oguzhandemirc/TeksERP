import { Callout } from "@/components/ui/callout";
import { formatNumber } from "@/lib/format";
import type { ImpactGroup, RestoreImpact } from "./restore-impact.types";

function CountValue({ count }: { count: number | null }) {
  // `null` ile `0` ARASINDAKİ FARK kritik: "ölçemedik" ile "hiç yok" aynı şey değil
  // ve operatör yıkıcı kararı bu ayrıma dayanarak veriyor.
  if (count === null) {
    return <span className="text-xs text-muted-foreground">ölçülemedi</span>;
  }
  return (
    <span className={count > 0 ? "font-medium tabular-nums" : "tabular-nums text-muted-foreground"}>
      {formatNumber(count)}
    </span>
  );
}

function Group({ group }: { group: ImpactGroup }) {
  const rows = group.rows.filter((r) => r.count === null || r.count > 0);
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {group.label}
      </h4>
      <ul className="divide-y rounded-lg border">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
            <span>
              {r.label}
              {r.note && <span className="ml-1.5 text-xs text-muted-foreground">({r.note})</span>}
            </span>
            <CountValue count={r.count} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Kaybolacak YENİ kayıtlar — kök CLAUDE.md'nin "etkilenen kayıtları somut listele"
 * kuralının geri yükleme karşılığı.
 *
 * Başındaki uyarı bu bileşenin en önemli parçası: sayımlar yalnız INSERT'leri
 * yakalıyor. Bunu söylemezsek operatör "34 top kaybederim" diye okur ve statüsü
 * değişmiş yüzlerce kaydın da geri sarılacağını fark etmez.
 */
export function RestoreImpactCounts({ impact }: { impact: RestoreImpact }) {
  const business = impact.groups.filter((g) => g.key !== "system");
  const system = impact.groups.find((g) => g.key === "system");
  const nothing = business.every((g) => g.rows.every((r) => r.count === 0));

  return (
    <div className="space-y-3">
      <Callout tone="warning" title="Bu sayılar yalnız YENİ EKLENEN kayıtlardır">
        Var olan kayıtlarda yapılan <b>değişiklikler</b> (top durumu, tartı, kalite, sipariş
        onayı, sevk ataması) bu listede <b>görünmez</b> — ama onlar da geri alınır. Gerçek
        kayıp aşağıdaki sayılardan <b>daha büyüktür</b>; alt sınır olarak okuyun.
      </Callout>

      {nothing ? (
        <Callout tone="info">
          Bu yedekten sonra yeni iş kaydı oluşmamış görünüyor. Yine de mevcut kayıtlarda
          yapılmış değişiklikler geri alınacak — aşağıdaki değişiklik izine bakın.
        </Callout>
      ) : (
        <>
          <p className="text-sm">
            Geri dönerseniz <b>en az {formatNumber(impact.totalCreated)}</b> yeni iş kaydı
            kaybolacak
            {!impact.measuredAllRows && " (bazı satırlar ölçülemedi — gerçek sayı daha yüksek)"}:
          </p>
          {business.map((g) => (
            <Group key={g.key} group={g} />
          ))}
        </>
      )}

      {system && (
        <details className="rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {system.label} (iş kaybı değil)
          </summary>
          <ul className="mt-1.5 divide-y">
            {system.rows.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-3 py-1.5">
                <span>
                  {r.label}
                  {r.note && <span className="ml-1.5 text-xs text-muted-foreground">({r.note})</span>}
                </span>
                <CountValue count={r.count} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
