"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useApi } from "../../api-client/provider";
import { GlobalFooter } from "../../presentation/layout/global-footer";
import {
  buildSponsorAreaModel,
  type SponsorAreaInput,
} from "../../presentation/layout/sponsor-area-model";

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

  return <GlobalFooter sponsors={buildSponsorAreaModel(input)} pathname={pathname} />;
}
