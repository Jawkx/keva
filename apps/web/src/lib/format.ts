import type { PropertyValue } from "@keva/schema";
import { Schema } from "effect";

export const formatBytes = (size: number | null): string => {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

export const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

export const formatRelative = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = (date.getTime() - Date.now()) / 1000;
  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return relativeFormatter.format(Math.round(seconds / secondsInUnit), unit);
    }
  }
  return relativeFormatter.format(Math.round(seconds), "second");
};

const CONTENT_TYPE_LABELS = new Map([
  ["jpeg", "JPEG"],
  ["json", "JSON"],
  ["pdf", "PDF"],
  ["csv", "CSV"],
  ["svg", "SVG"],
  ["html", "HTML"],
  ["xml", "XML"],
  ["plain", "Text"],
  ["markdown", "Markdown"],
  ["octet-stream", "Binary"],
]);

export const formatContentType = (contentType: string): string => {
  const subtype = contentType.split(";")[0]?.split("/")[1] ?? contentType;
  const clean = subtype.replace(/^(x-|vnd\.)/, "").split("+")[0] ?? subtype;
  return CONTENT_TYPE_LABELS.get(clean) ?? clean.toUpperCase();
};

export const formatPropertyValue = (value: PropertyValue): string => {
  if (value === null) return "Tag";
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  return Schema.is(Schema.String)(value) ? value : "";
};
