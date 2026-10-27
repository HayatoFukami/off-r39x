import { readBuildEnv } from "../../config/build-env";
import { isUiMockEnabled } from "../../config/ui-mock";
import { copy } from "../../presentation/copy/ja";

/** A small fixed label shown in UI mock mode only. Not part of any navigation, not interactive. */
export function MockModeBadge() {
  if (!isUiMockEnabled(readBuildEnv())) return null;
  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-30 rounded-base bg-tone-pending-bg px-2 py-1 text-xs font-medium text-tone-pending-fg shadow">
      {copy.layout.mockBadge}
    </div>
  );
}
