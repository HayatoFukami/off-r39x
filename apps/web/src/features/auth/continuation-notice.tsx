import type { ContinuationNotice } from "./continuation-view";

/** The authentication-required notice. Plain text only; it is not a live region. */
export function ContinuationNoticeView({ notice }: { notice: ContinuationNotice | null }) {
  if (notice === null) return null;
  return (
    <div className="flex flex-col gap-1 rounded-base border border-border bg-muted p-3 text-sm">
      <p className="font-bold">{notice.notice}</p>
      <p>{notice.purposeLabel}</p>
      <p>{notice.returnAfter}</p>
      <p>{notice.revalidate}</p>
    </div>
  );
}
