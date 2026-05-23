import type { LucideIcon } from "lucide-react";
import { navGroups } from "./nav-config";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { definitionGroups } from "@/pages/Definitions/groups-config";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { accessTiles } from "@/pages/Access/tile-config";

export interface CommandEntry {
  key: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  to: string;
  permission?: string;
  adminOnly?: boolean;
}

export interface CommandSection {
  heading: string;
  entries: CommandEntry[];
}

export const commandSections: CommandSection[] = [
  ...navGroups.map<CommandSection>((group) => ({
    heading: group.label,
    entries: group.items.map((item) => ({
      key: `nav:${item.to}`,
      label: item.label,
      icon: item.icon,
      to: item.to,
      permission: item.permission,
      adminOnly: item.adminOnly,
    })),
  })),
  {
    heading: "Operasyon",
    entries: operationsTiles.map((tile) => ({
      key: `ops:${tile.key}`,
      label: tile.title,
      description: tile.description,
      icon: tile.icon,
      to: tile.to,
      permission: tile.permission,
    })),
  },
  ...definitionGroups.map<CommandSection>((group) => ({
    heading: `Tanımlar · ${group.title}`,
    entries: definitionTiles
      .filter((tile) => tile.group === group.key)
      .map((tile) => ({
        key: `def:${tile.key}`,
        label: tile.title,
        description: tile.description,
        icon: tile.icon,
        to: tile.to,
        permission: tile.permission,
      })),
  })),
  {
    heading: "Yetkilendirme",
    entries: accessTiles.map((tile) => ({
      key: `access:${tile.key}`,
      label: tile.title,
      description: tile.description,
      icon: tile.icon,
      to: tile.to,
      adminOnly: true,
    })),
  },
];
