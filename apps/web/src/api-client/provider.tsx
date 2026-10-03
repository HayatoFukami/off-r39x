"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { createApiPort } from "./index";
import type { ApiPort } from "./port";

const ApiContext = createContext<ApiPort | null>(null);

export function ApiProvider({ children, port }: { children: ReactNode; port?: ApiPort }) {
  // Created once: a lazy initializer keeps the port stable across renders.
  const [value] = useState<ApiPort>(() => port ?? createApiPort());
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiPort {
  const port = useContext(ApiContext);
  if (port === null) throw new Error("useApi must be used within ApiProvider");
  return port;
}
