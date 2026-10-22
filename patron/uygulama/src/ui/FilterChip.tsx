// Süzgeç çipi: "Durum: Tümü" biçimi (süzgeç adı etikette); dokununca çağıran DOĞRUDAN sheet/modal açar (combobox yok).
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text } from "react-native";
import { haptic } from "./haptics";
import { makeStyles, useTokens } from "./theme-context";
import { radius, space, typography } from "./tokens";

export interface FilterChipProps {
  readonly label: string;
  readonly value: string;
  readonly onPress: () => void;
  /** Varsayılandan farklı bir değer seçiliyse vurgulanır. */
  readonly selected?: boolean;
  readonly testID?: string;
}

export function FilterChip({ label, value, onPress, selected, testID }: FilterChipProps) {
  const t = useTokens();
  const s = useStyles();
  const fg = selected ? t.tint : t.text;
  return (
    <Pressable
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ selected: !!selected }}
      hitSlop={6}
      style={({ pressed }) => [s.chip, selected && { backgroundColor: t.tintContainer, borderColor: t.tintContainer }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.text, { color: fg }]} numberOfLines={1}>{`${label}: ${value}`}</Text>
      <Ionicons name="chevron-down" size={14} color={fg} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  chip: {
    minHeight: 36,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.xs,
    paddingHorizontal: space.m,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: t.separator,
    backgroundColor: t.surface,
    alignSelf: "flex-start" as const,
  },
  text: { ...typography.subhead, fontWeight: "600" as const },
}));
