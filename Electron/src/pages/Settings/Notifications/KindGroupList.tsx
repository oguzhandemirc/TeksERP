// Solda grup listesi (yalnız görülebilir türü olan gruplar, sayılı) + sağda tr-katlamalı arama ve tür satırları.
// Liste sunucunun döndüğü türlerden kurulur; arama yalnız sabit katalog içinde metin eşler (kayıt süzmesi değil).
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { matchesKind, setChannel, setMode, type PreferenceDraft } from "@/lib/bildirim/tercih-taslak";
import type { NotificationCatalogKind } from "@/lib/bildirim/types";
import { NOTIFICATION_GROUP_ORDER } from "@/pages/Notifications/group-order";
import { KindRow } from "./KindRow";

type Group = { grup: string; turler: NotificationCatalogKind[] };

function GroupNav({ gruplar, toplam, secili, onSec }: { gruplar: Group[]; toplam: number; secili: string | null; onSec: (g: string | null) => void }) {
  const items = [{ grup: null as string | null, ad: "Tümü", sayi: toplam }, ...gruplar.map((g) => ({ grup: g.grup as string | null, ad: g.grup, sayi: g.turler.length }))];
  return (
    <nav aria-label="Bildirim grupları" className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap">
      {items.map((g) => (
        <button
          key={g.ad}
          type="button"
          aria-pressed={secili === g.grup}
          onClick={() => onSec(g.grup)}
          className={cn(
            "flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-sm",
            secili === g.grup ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {g.ad} <span className="text-xs tabular-nums">({g.sayi})</span>
        </button>
      ))}
    </nav>
  );
}

function GroupSection(p: { g: Group; taslak: PreferenceDraft; setTaslak: Dispatch<SetStateAction<PreferenceDraft>>; onScope: (kod: string) => void; grupToplu: (kodlar: string[], acik: boolean) => void }) {
  const { g, taslak, setTaslak, onScope, grupToplu } = p;
  const kodlar = g.turler.map((k) => k.kod);
  return (
    <section aria-label={g.grup}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.grup}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => grupToplu(kodlar, true)}>Hepsini aç</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => grupToplu(kodlar, false)}>Hepsini kapa</Button>
        </div>
      </div>
      <ul>
        {g.turler.map((k) => {
          const d = taslak[k.kod];
          if (!d) return null;
          return (
            <KindRow
              key={k.kod}
              k={d}
              katalog={k}
              onMode={(m) => setTaslak((x) => setMode(x, k.kod, m))}
              onChannel={(ch, v) => setTaslak((x) => setChannel(x, k.kod, ch, v))}
              onScope={() => onScope(k.kod)}
            />
          );
        })}
      </ul>
    </section>
  );
}

export function KindGroupList(p: {
  turler: readonly NotificationCatalogKind[];
  taslak: PreferenceDraft;
  setTaslak: Dispatch<SetStateAction<PreferenceDraft>>;
  yetkiDisi: number;
  onScope: (kod: string) => void;
  grupToplu: (kodlar: string[], acik: boolean) => void;
}) {
  const { turler, taslak, yetkiDisi } = p;
  const [ara, setAra] = useState("");
  const [grup, setGrup] = useState<string | null>(null);
  const visibleKinds = useMemo(() => turler.filter((k) => taslak[k.kod]), [turler, taslak]);
  const gruplar = useMemo(
    () => NOTIFICATION_GROUP_ORDER.map((g) => ({ grup: g as string, turler: visibleKinds.filter((k) => k.grup === g) })).filter((g) => g.turler.length > 0),
    [visibleKinds],
  );
  const gorunen = gruplar
    .filter((g) => grup === null || g.grup === grup)
    .map((g) => ({ ...g, turler: g.turler.filter((k) => matchesKind(k, ara)) }))
    .filter((g) => g.turler.length > 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)]">
      <GroupNav gruplar={gruplar} toplam={visibleKinds.length} secili={grup} onSec={setGrup} />
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Ara…" aria-label="Bildirim türü ara" className="pl-8" />
          </div>
          {gorunen.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aramanıza uyan bildirim türü yok.</p>}
          {gorunen.map((g) => (
            <GroupSection key={g.grup} g={g} taslak={taslak} setTaslak={p.setTaslak} onScope={p.onScope} grupToplu={p.grupToplu} />
          ))}
          {yetkiDisi > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="yetki-disi">
              {yetkiDisi} tür yetkiniz dışında olduğu için listelenmedi.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
