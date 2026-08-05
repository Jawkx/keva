import type { ViewColor } from "@keva/schema";

export const VIEW_COLORS: readonly { key: ViewColor; label: string; className: string }[] = [
  { key: "red", label: "Red", className: "bg-red-500" },
  { key: "orange", label: "Orange", className: "bg-orange-500" },
  { key: "amber", label: "Amber", className: "bg-amber-400" },
  { key: "green", label: "Green", className: "bg-emerald-500" },
  { key: "teal", label: "Teal", className: "bg-teal-500" },
  { key: "blue", label: "Blue", className: "bg-blue-500" },
  { key: "violet", label: "Violet", className: "bg-violet-500" },
  { key: "pink", label: "Pink", className: "bg-pink-500" },
];

const VIEW_COLOR_STYLES: Record<ViewColor, string> = {
  red: "bg-red-500/12 text-red-600 dark:text-red-400",
  orange: "bg-orange-500/12 text-orange-600 dark:text-orange-400",
  amber: "bg-amber-400/15 text-amber-700 dark:text-amber-400",
  green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  teal: "bg-teal-500/12 text-teal-600 dark:text-teal-400",
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  pink: "bg-pink-500/12 text-pink-600 dark:text-pink-400",
};

export const viewColorStyle = (color: ViewColor | null | undefined) =>
  color ? VIEW_COLOR_STYLES[color] : undefined;
