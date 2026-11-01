// Jenerik veri görünümleri: kayıt alanları, anlık özet, imleçli liste. Şekil fabrikadan gelir; uygulama yalnız biçimler.
// `ProjectionList` ilk sayfayı `useRemote` ile çeker → değişim akışı/zil etiketi (`invalidate([projeksiyon])`) listeye ulaşır.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import { errorMessage } from "../api/client";
import type { Page, ProjectionRecord } from "../api/wire";
import { formatAgo, formatDateTime, formatMoney, syncIsLate } from "../lib/format";
import { FINANCE_FIELD, isMoneyField, moneyCurrencyOf } from "../lib/labels/finans";
import { formatValue, humanize, isHiddenKey, nestedEntries, recordSubtitle, recordTitle, scalarEntries } from "../lib/present";
import { useSession } from "../state/session";
import { useRemote } from "../state/useRemote";
import { Banner, Button, Card, Muted } from "./kit";
import { ListGroup, ListRow, type ListRowProps } from "./ListRow";
import { Empty, LoadingSkeleton, OfflineBand, ReadOnlyBand, SyncLateBand } from "./StateViews";
import { makeStyles, useTokens } from "./theme-context";
import { radius, space, tabularNums, typography, type Domain } from "./tokens";

interface FieldRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/** Para alt satırı (`.finans`): tutar alanları kaydın dövizi ile (`…Tl` alanı ₺), kur/oran düz sayı; döviz bilinmiyorsa ("") simge uydurulmaz. */
function moneyEntries(obj: unknown, currency: string): FieldRow[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>)
    .filter(([k, v]) => !isHiddenKey(k) && (v === null || typeof v !== "object"))
    .map(([k, v]) => ({
      key: k,
      label: FINANCE_FIELD[k] ?? humanize(k),
      value: currency !== "" && isMoneyField(k) && (typeof v === "string" || typeof v === "number") ? formatMoney(v, moneyCurrencyOf(k, currency)) : formatValue(k, v),
    }));
}

/** Alan → (fabrika enum değeri → Türkçe ad); ekranda "SALES"/"CONFIRMED" gibi ham değer basılmaz. */
export type FieldEnums = Readonly<Record<string, Readonly<Record<string, string>>>>;

function withEnumLabel(r: FieldRow, value: unknown, enums: FieldEnums): FieldRow {
  const raw = (value as Record<string, unknown>)[r.key];
  const label = typeof raw === "string" ? enums[r.key]?.[raw] : undefined;
  return label ? { ...r, value: label } : r;
}

/**
 * Kaydın skaler alanları: gruplu satırlar (ad solda gri, değer sağda). `currency` verilirse alanlar PARA alt satırıdır:
 * her tutar o para birimiyle basılır (uygulama hesap yapmaz; değer fabrikanın).
 */
export function Fields({ value, currency, enums }: { value: unknown; currency?: string; enums?: FieldEnums }) {
  const s = useFieldStyles();
  const raw = currency !== undefined ? moneyEntries(value, currency) : scalarEntries(value);
  const rows = enums ? raw.map((r) => withEnumLabel(r, value, enums)) : raw;
  if (rows.length === 0) return <Muted>Gösterilecek alan yok</Muted>;
  return (
    <View>
      {rows.map((r, i) => (
        <View key={r.key} style={[s.row, i > 0 && s.sep]} accessible accessibilityLabel={`${r.label}: ${r.value}`}>
          <Text style={s.label}>{r.label}</Text>
          <Text style={s.value} selectable>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

const SNAPSHOT_ROWS = 20;

/** Blok başlığına çıkan alan (ör. `ad`) satırlarda yinelenmez. */
function withoutTitle(item: object): Record<string, unknown> {
  const title = recordTitle(item);
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== title));
}

/** Dizi: ilk 20 satır kart, "Tümünü göster" genişletir. */
function SnapshotArray({ value, depth }: { value: readonly unknown[]; depth: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? value : value.slice(0, SNAPSHOT_ROWS);
  const s = useFieldStyles();
  return (
    <View>
      {shown.map((item, i) =>
        typeof item === "object" && item !== null ? (
          <View key={i} style={s.block}>
            <Text style={s.blockTitle}>{recordTitle(item) === "Kayıt" ? `${i + 1}. satır` : recordTitle(item)}</Text>
            <Fields value={withoutTitle(item)} />
            {depth < 3 ? <SnapshotNested value={item} depth={depth + 1} /> : null}
          </View>
        ) : (
          <Text key={i} style={s.value}>{formatValue("", item)}</Text>
        ),
      )}
      {value.length > SNAPSHOT_ROWS ? (
        <Button
          label={all ? "Daha az göster" : `Tümünü göster (${value.length} satır)`}
          tone="plain"
          icon={all ? "chevron-up" : "chevron-down"}
          onPress={() => setAll((x) => !x)}
          testID="anlik-tumu"
        />
      ) : null}
    </View>
  );
}

function SnapshotNested({ value, depth }: { value: unknown; depth: number }) {
  const s = useFieldStyles();
  return (
    <>
      {nestedEntries(value).map((n) => (
        <View key={n.key} style={{ marginTop: space.m }}>
          <Text style={s.section} accessibilityRole="header">{n.label}</Text>
          <SnapshotView value={n.value} depth={depth} />
        </View>
      ))}
    </>
  );
}

/** Anlık özet: üst düzey sayılar kutucuk, iç nesneler bölüm, diziler ilk 20 satır (+ tümü). */
export function SnapshotView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const s = useFieldStyles();
  if (Array.isArray(value)) {
    if (value.length === 0) return <Muted>Satır yok</Muted>;
    return <SnapshotArray value={value} depth={depth} />;
  }
  const stats = scalarEntries(value);
  return (
    <View>
      {stats.length > 0 ? (
        <View style={s.stats}>
          {stats.map((x) => (
            <View key={x.key} style={s.stat} accessible accessibilityLabel={`${x.label}: ${x.value}`}>
              <Text style={s.statLabel} numberOfLines={2}>{x.label}</Text>
              <Text style={s.statValue} numberOfLines={2} adjustsFontSizeToFit>{x.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {depth < 3 ? <SnapshotNested value={value} depth={depth + 1} /> : null}
    </View>
  );
}

const useFieldStyles = makeStyles((t) => ({
  row: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "flex-start" as const, gap: space.m, paddingVertical: space.s + 2 },
  sep: { borderTopWidth: 1, borderTopColor: t.separator },
  label: { ...typography.subhead, color: t.textSecondary, flexShrink: 1 },
  value: { ...typography.callout, ...tabularNums, color: t.text, flexShrink: 1, textAlign: "right" as const },
  block: { backgroundColor: t.surfaceAlt, borderRadius: radius.cardInner, paddingHorizontal: space.m, paddingVertical: space.s, marginBottom: space.s },
  blockTitle: { ...typography.headline, color: t.text, marginTop: space.xs },
  section: { ...typography.headline, color: t.text, marginBottom: space.s },
  stats: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.s },
  stat: { flexGrow: 1, flexBasis: 140, backgroundColor: t.surfaceAlt, borderRadius: radius.cardInner, padding: space.m },
  statLabel: { ...typography.caption, color: t.textSecondary },
  statValue: { ...typography.title2, ...tabularNums, color: t.text, marginTop: space.xs },
}));

/** Ekran üstü şerit: çevrimdışı (son veri) ve eşitleme gecikmesi. */
export function StatusBands() {
  const { offline, offlineSince, facility } = useSession();
  const last = facility?.esitleme?.sonEsitleme ?? null;
  // Eski sunucu/önbellek `hizmet` taşımayabilir → açık say (bugünkü davranış).
  const service = facility?.hizmet;
  const readOnly = service?.asama === "SALT_OKUNUR";
  return (
    <View>
      {offline ? <OfflineBand text={`Çevrimdışı — son veri ${offlineSince ? formatAgo(offlineSince) : "bilinmiyor"}. Değişiklik yapılamaz.`} /> : null}
      {readOnly ? (
        <ReadOnlyBand
          text={`TeksERP Yönetim hizmeti ${formatDateTime(service?.bitis)} tarihinde sona erdi — veriler ${formatDateTime(service?.saltOkunurBitis)} tarihine kadar yalnız görüntülenir ve dışa aktarılabilir (Hesaplar › Dışa aktar); yeni kayıt girilemez.`}
        />
      ) : null}
      {facility && !readOnly && syncIsLate(last) ? (
        <SyncLateBand text={last ? `Fabrikadan eşitleme gecikti — son eşitleme ${formatAgo(last)}` : "Fabrikadan henüz veri gelmedi"} />
      ) : null}
    </View>
  );
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View>
      <Banner tone="error" text={text} />
      {onRetry ? <Button label="Tekrar dene" tone="plain" icon="refresh" onPress={onRetry} /> : null}
    </View>
  );
}

export interface ListFilter {
  readonly durum?: string;
  readonly cariKartId?: string;
  readonly ara?: string;
  readonly suzgec?: string;
  readonly kategoriAnahtari?: string;
}

/** Satırı `ListRow` olarak çizen eşleme (dokunma ve testID listeden gelir). */
export type ProjectionRowView = Omit<ListRowProps, "onPress" | "testID">;

export interface ProjectionListProps {
  readonly projection: string;
  readonly filter?: ListFilter;
  readonly onOpen?: (r: ProjectionRecord) => void;
  readonly empty?: string;
  /** Yalnız başlık + alt satır (seçici). */
  readonly compact?: boolean;
  /** Verilirse her kayıt bu `ListRow` görünümüyle çizilir (compact/alan dökümü yerine). */
  readonly row?: (r: ProjectionRecord) => ProjectionRowView;
  /** Boş durum ve kart şeridi rengi. */
  readonly domain?: Domain;
  /** Geçersizleştirme etiketleri; verilmezse projeksiyonun adı. */
  readonly tags?: readonly string[];
  /** Listenin başında (veri varken) çizilecek içerik, ör. bölüm başlığı. */
  readonly header?: ReactNode;
}

interface MorePages {
  readonly of: Page<ProjectionRecord> | null;
  readonly items: readonly ProjectionRecord[];
  readonly next: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const NO_MORE: MorePages = { of: null, items: [], next: null, loading: false, error: null };

/**
 * İmleçli projeksiyon listesi (sunucu süzer ve arar; "Daha fazla" sonraki sayfayı aynı süzgeçle ekler).
 * İlk sayfa (aramasız) `useRemote` ile saklanır ve etiketle tazelenir; arama sonucu ve sonraki sayfalar saklanmaz.
 */
export function ProjectionList(p: ProjectionListProps) {
  const { api, cache } = useSession();
  const { durum, cariKartId, ara, suzgec, kategoriAnahtari } = p.filter ?? {};
  const search = typeof ara === "string" && ara !== "";
  const key = `veri:${p.projection}:liste:${durum ?? ""}:${cariKartId ?? ""}:${suzgec ?? ""}${kategoriAnahtari === undefined ? "" : `:k=${kategoriAnahtari}`}`;
  const first = useRemote(
    search ? null : key,
    () => api.list(p.projection, { imlec: undefined, limit: 50, durum, cariKartId, ara: undefined, suzgec, kategoriAnahtari }),
    { tags: p.tags ?? [p.projection] },
  );

  // Arama: her terim ayrı istek; geç dönen eski arama yeni sonucu ezmez.
  const seq = useRef(0);
  const [found, setFound] = useState<{ page: Page<ProjectionRecord> | null; loading: boolean; error: string | null }>({ page: null, loading: false, error: null });
  const [searchTick, setSearchTick] = useState(0);
  useEffect(() => {
    if (!search || !cache) return;
    const mine = ++seq.current;
    setFound({ page: null, loading: true, error: null });
    api
      .list(p.projection, { imlec: undefined, limit: 50, durum, cariKartId, ara, suzgec, kategoriAnahtari })
      .then((page) => {
        if (mine === seq.current) setFound({ page, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (mine === seq.current) setFound({ page: null, loading: false, error: errorMessage(err) });
      });
  }, [search, cache, api, p.projection, durum, cariKartId, ara, suzgec, kategoriAnahtari, searchTick]);

  const base: Page<ProjectionRecord> | null = search ? found.page : first.data;
  const baseNext = search ? (found.page?.sonraki ?? null) : first.offline ? null : (first.data?.sonraki ?? null);
  const [more, setMore] = useState<MorePages>(NO_MORE);
  const extra = base !== null && more.of === base ? more : null;
  const items = base ? (extra ? [...base.kayitlar, ...extra.items] : base.kayitlar) : [];
  const next = extra ? extra.next : baseNext;

  const loadMore = useCallback(async () => {
    const of = base;
    const cursor = next;
    if (!of || !cursor) return;
    setMore((m) => ({ of, items: m.of === of ? m.items : [], next: cursor, loading: true, error: null }));
    try {
      const page = await api.list(p.projection, { imlec: cursor, limit: 50, durum, cariKartId, ara: search ? ara : undefined, suzgec, kategoriAnahtari });
      setMore((m) => (m.of !== of ? m : { of, items: [...m.items, ...page.kayitlar], next: page.sonraki, loading: false, error: null }));
    } catch (err) {
      setMore((m) => (m.of !== of ? m : { ...m, loading: false, error: errorMessage(err) }));
    }
  }, [api, base, next, p.projection, durum, cariKartId, ara, search, suzgec, kategoriAnahtari]);

  const loading = search ? found.loading : first.loading && !first.data;
  const error = search ? found.error : first.data ? null : first.error;
  const retry = search ? () => setSearchTick((x) => x + 1) : first.reload;
  const open = p.onOpen;

  const rows = items.map((r) => {
    const onPress = open ? () => open(r) : undefined;
    if (p.row) return <ListRow key={r.id} {...p.row(r)} onPress={onPress} testID={`kayit-${r.id}`} />;
    if (p.compact) return <ListRow key={r.id} title={recordTitle(r.kayit)} subtitle={recordSubtitle(r.kayit) || undefined} onPress={onPress} testID={`kayit-${r.id}`} />;
    return (
      <Card key={r.id} domain={p.domain} onPress={onPress} testID={`kayit-${r.id}`}>
        <RecordHead title={recordTitle(r.kayit)} chevron={!!onPress} />
        <Fields value={r.kayit} />
      </Card>
    );
  });

  return (
    <View>
      {error ? <ErrorBox text={error} onRetry={retry} /> : null}
      {items.length > 0 ? p.header : null}
      {p.row || p.compact ? items.length > 0 ? <ListGroup iconSize={p.row ? undefined : 0}>{rows}</ListGroup> : null : rows}
      {!loading && !error && items.length === 0 ? <Empty text={p.empty ?? "Kayıt yok"} domain={p.domain} /> : null}
      {loading && items.length === 0 ? <LoadingSkeleton rows={3} /> : null}
      {extra?.error ? <ErrorBox text={extra.error} onRetry={() => void loadMore()} /> : null}
      {next && !loading ? (
        <Button label="Daha fazla" tone="plain" icon="chevron-down" busy={extra?.loading ?? false} onPress={() => void loadMore()} testID={`daha-fazla-${p.projection}`} />
      ) : null}
    </View>
  );
}

function RecordHead({ title, chevron }: { title: string; chevron: boolean }) {
  const t = useTokens();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.s, marginBottom: space.xs }}>
      <Text style={{ ...typography.headline, color: t.text, flex: 1 }} numberOfLines={2}>{title}</Text>
      {chevron ? <Ionicons name="chevron-forward" size={18} color={t.textMuted} /> : null}
    </View>
  );
}
