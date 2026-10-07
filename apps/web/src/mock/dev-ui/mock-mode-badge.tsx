import { isUiMockEnabled } from "../../config/ui-mock";
import { copy } from "../../presentation/copy/ja";

/** A small fixed label shown in UI mock mode only. Not part of any navigation, not interactive. */
export function MockModeBadge() {
  // A direct property access lets Next inline NEXT_PUBLIC_UI_MOCK at build time.
  if (!isUiMockEnabled({ NEXT_PUBLIC_UI_MOCK: process.env.NEXT_PUBLIC_UI_MOCK })) return null;
  return (
    <div className="pointer-events-none fixed right-2 bottom-2 z-30 rounded-base bg-tone-pending-bg px-2 py-1 text-xs font-medium text-tone-pending-fg shadow">
      {copy.layout.mockBadge}
    </div>
  );
}
