"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyIfLatest, invalidateRequests } from "../../api-client/latest-request";
import type { ApiPort } from "../../api-client/port";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { Read } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";

/**
 * One read of the port per mount and one per retry (DEV-WEB-009). `load` must be stable
 * (useCallback). A rejected read is a failed read, never empty. The first state is loading.
 * Only the last-started read is reflected: an older read that finishes later is dropped.
 */
export function useRead<T>(load: (api: ApiPort) => Promise<Read<T>>): {
  read: Loadable<T>;
  reload: () => void;
} {
  const api = useApi();
  const [read, setRead] = useState<Loadable<T>>({ kind: "loading" });
  const requests = useRef(0);

  useEffect(() => {
    const counter = requests;
    void applyIfLatest(counter, settleRead(load(api)), setRead);
    return () => invalidateRequests(counter);
  }, [api, load]);

  const reload = useCallback((): void => {
    setRead({ kind: "loading" });
    void applyIfLatest(requests, settleRead(load(api)), setRead);
  }, [api, load]);

  return { read, reload };
}
