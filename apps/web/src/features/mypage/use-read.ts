"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiPort } from "../../api-client/port";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { Read } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";

/**
 * One read of the port per mount and one per retry (DEV-WEB-009). `load` must be stable
 * (useCallback). A rejected read is a failed read, never empty. The first state is loading.
 */
export function useRead<T>(load: (api: ApiPort) => Promise<Read<T>>): {
  read: Loadable<T>;
  reload: () => void;
} {
  const api = useApi();
  const [read, setRead] = useState<Loadable<T>>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void settleRead(load(api)).then((value) => {
      if (active) setRead(value);
    });
    return () => {
      active = false;
    };
  }, [api, load]);

  const reload = useCallback((): void => {
    setRead({ kind: "loading" });
    void settleRead(load(api)).then((value) => setRead(value));
  }, [api, load]);

  return { read, reload };
}
