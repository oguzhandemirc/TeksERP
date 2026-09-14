// =============================================================================
// LEVENT LİSTESİ — sekmeler: Planlı (sar / taslak sil) · Bugün sarılan (iptal, yetenek izniyle) · Tezgahta (Faz 3, bayrakla)
// =============================================================================
import React, { useState } from "react";
import { View, StyleSheet, FlatList } from "react-native";
import {
  Text,
  Button,
  ActivityIndicator,
  SegmentedButtons,
} from "react-native-paper";
import { colors, spacing, radius, typography } from "../../../theme";
import type { WarpBeam } from "../../../services/warpBeam.service";
import { ORIGIN_LABEL, STATUS_LABEL, beamActionsEnabled } from "./beamPayload";
import type { DevereScreenState } from "./useDevereScreen";
import MountedTab from "./MountedTab";

type Tab = "planned" | "today" | "mounted";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function Row({ beam, state }: { beam: WarpBeam; state: DevereScreenState }) {
  const planned = beam.status === "PLANNED";
  const locked = !state.isOnline || state.busy;
  const shippedOut = beam.status === "SHIPPED_OUT";
  return (
    <View style={styles.rowCard}>
      <View style={styles.grow}>
        <View style={styles.codeRow}>
          <Text style={styles.code}>{beam.beamNo}</Text>
          {shippedOut ? (
            <Text style={styles.badge}>{STATUS_LABEL[beam.status]}</Text>
          ) : null}
        </View>
        <Text
          style={styles.meta}
        >{`${beam.warpSpec.code} — ${beam.warpSpec.name} · ${beam.warpSpec.endsCount} tel`}</Text>
        <Text style={styles.meta}>
          {planned
            ? `Plan ${beam.plannedLengthM} m`
            : `${beam.wound?.lengthM ?? beam.remainingM} m · ${fmtTime(beam.wound?.createdAt ?? beam.createdAt)}`}
          {` · ${ORIGIN_LABEL[beam.originKind]}`}
          {beam.physicalBeamNo ? ` · ${beam.physicalBeamNo}` : ""}
          {beam.wound?.machine ? ` · ${beam.wound.machine.name}` : ""}
        </Text>
      </View>
      {planned ? (
        <View style={styles.actions}>
          <Button
            mode="outlined"
            compact
            icon="delete-outline"
            disabled={locked}
            onPress={() => state.setModal({ kind: "delete", beam })}
          >
            Sil
          </Button>
          <Button
            mode="contained"
            compact
            icon="rotate-right"
            disabled={locked}
            onPress={() => state.openWind(beam)}
            contentStyle={styles.tallButton}
          >
            SAR
          </Button>
        </View>
      ) : (
        state.canCancel &&
        beamActionsEnabled(beam.status) && (
          <Button
            mode="outlined"
            compact
            icon="undo"
            disabled={locked}
            onPress={() => state.setModal({ kind: "cancel", beam })}
          >
            İptal
          </Button>
        )
      )}
    </View>
  );
}

export default function BeamList({ state }: { state: DevereScreenState }) {
  const [tab, setTab] = useState<Tab>("planned");
  const rows = tab === "planned" ? state.planned : state.todayWound;
  const loading = tab === "planned" ? state.plannedLoading : state.readyLoading;
  const mountedTab = tab === "mounted" && state.mountTracking;
  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <SegmentedButtons
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          buttons={[
            {
              value: "planned",
              label: `Planlı (${state.planned.length})`,
              icon: "clipboard-list-outline",
            },
            {
              value: "today",
              label: `Bugün sarılan (${state.todayWound.length})`,
              icon: "check-circle-outline",
            },
            // Faz 3: sekme yalnız bağlam `mountTracking` derse — kapalıyken ekran Faz 1b ile birebir.
            ...(state.mountTracking
              ? [
                  {
                    value: "mounted",
                    label: `Tezgahta (${state.liveBeams.filter((b) => b.status === "MOUNTED").length})`,
                    icon: "connection",
                  },
                ]
              : []),
          ]}
        />
      </View>
      {mountedTab ? (
        <MountedTab
          beams={state.liveBeams}
          loading={state.liveLoading}
          locked={!state.isOnline || state.busy}
          onMount={state.mountForm.open}
        />
      ) : (
        <>
          {loading ? <ActivityIndicator style={styles.spinner} /> : null}
          {state.plannedError ? (
            <Text style={styles.error}>Liste yüklenemedi — yenileyin.</Text>
          ) : null}
          <FlatList
            data={rows}
            keyExtractor={(b) => b.id}
            renderItem={({ item }) => <Row beam={item} state={state} />}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              loading ? null : (
                <Text style={styles.empty}>
                  {tab === "planned"
                    ? 'Planlı levent yok — "Yeni levent" ile plan açın.'
                    : "Bugün sarılmış levent yok."}
                </Text>
              )
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { padding: spacing.md },
  spinner: { marginTop: spacing.md },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  grow: { flex: 1, gap: 2 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  code: {
    fontSize: 20,
    fontWeight: typography.weight.bold,
    color: colors.text,
  },
  badge: {
    fontSize: typography.size.sm,
    color: colors.warningText,
    backgroundColor: colors.warningContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
  actions: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  tallButton: { height: 48 },
  empty: {
    textAlign: "center",
    color: colors.textMuted,
    marginTop: spacing.xl,
    fontSize: typography.size.base,
  },
  error: {
    color: colors.dangerText,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
