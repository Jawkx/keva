declare const __KEVA_ENVIRONMENT__: "development" | "staging" | "production";
declare const __KEVA_ICON_BASE__: string;

export const brandIconUrl = `${__KEVA_ICON_BASE__}/main-icon.png`;
export const brandWordmarkColorClass =
  __KEVA_ENVIRONMENT__ === "development"
    ? "text-[#2768D8]"
    : __KEVA_ENVIRONMENT__ === "staging"
      ? "text-[#041834]"
      : "text-primary";
