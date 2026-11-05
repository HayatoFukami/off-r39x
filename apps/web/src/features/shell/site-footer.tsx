"use client";

import { useEffect, useState } from "react";
import { useApi } from "../../api-client/provider";
import { readBuildEnv } from "../../config/build-env";
import { isUiMockEnabled } from "../../config/ui-mock";
import { GlobalFooter } from "../../presentation/layout/global-footer";
import {
  buildSponsorAreaModel,
  type SponsorAreaInput,
} from "../../presentation/layout/sponsor-area-model";
import { usePathname } from "../../routing/navigation";

// The UI mock's Sponsor images are same-origin paths; a real API returns https URLs only (SEC-WEB-026).
// The flag is fixed at build time (DEV-WEB-011), so a non-mock build never accepts a same-origin path.
const SPONSOR_AREA_OPTIONS = { allowSameOriginImagePath: isUiMockEnabled(readBuildEnv()) };

/** Container: loads the Sponsor Logos after mount and passes the view model to the Global Footer. */
export function SiteFooter() {
  const api = useApi();
  const pathname = usePathname();
  const [input, setInput] = useState<SponsorAreaInput>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    api.public.listSponsorLogos().then(
      (result) => {
        if (active) setInput(result);
      },
      () => {
        if (active) setInput({ kind: "unavailable" });
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <GlobalFooter
      sponsors={buildSponsorAreaModel(input, SPONSOR_AREA_OPTIONS)}
      pathname={pathname}
    />
  );
}
