// Sidebar-specific "Keva" wordmark. The logo PNG is a big "K"; "eva" is text so
// the pair reads as "Keva".
//
// This renders as a fragment on purpose: the <img> and the "eva" <span> must be
// DIRECT flex children of the SidebarMenuButton, which carries `items-end gap-0`.
// That bottom-aligns the two against the button's baseline — the arrangement that
// reads correctly in the sidebar. (Wrapping them in an inner `items-end` flex,
// nested inside the button's default `items-center`, lifts "eva" above the "K";
// that's why the sidebar gets its own component instead of the shared Wordmark,
// which is tuned for the standalone auth/hero placement.)
//
// Nudges (tuned to this icon + font; re-check if either changes):
//   -ml-1        The icon has ~15% transparent side padding baked in, so the
//                glyph's visual right edge stops short of its box; this pulls
//                "eva" back over that padding so the two kern as one word.
//   translate-y-px  Lands the text baseline on the glyph's visual bottom.
export function SidebarWordmark() {
  return (
    <>
      <img src="/android-chrome-192x192.png" alt="K" className="size-8 object-contain" />
      <span className="-ml-1 translate-y-px font-heading text-[1.8rem] font-semibold leading-none text-primary group-data-[collapsible=icon]:hidden">
        eva
      </span>
    </>
  );
}
