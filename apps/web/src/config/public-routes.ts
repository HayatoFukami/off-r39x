// Same-site hrefs of the public pages (SPEC-050 5, 7). Never the Administrator / Staff area or the dev area (SPEC-050 27).

export const ANNOUNCEMENTS_HREF = "/announcements";
export const ENTRY_HREF = "/entry";
export const KARAOKE_HREF = "/karaoke";
export const GOODS_HREF = "/goods";

export function announcementHref(ref: string): string {
  return `${ANNOUNCEMENTS_HREF}/${ref}`;
}

export function karaokeDayHref(date: string): string {
  return `${KARAOKE_HREF}/schedule/${date}`;
}

export function karaokeSlotHref(ref: string): string {
  return `${KARAOKE_HREF}/slots/${ref}`;
}

export function goodsHref(ref: string): string {
  return `${GOODS_HREF}/${ref}`;
}
