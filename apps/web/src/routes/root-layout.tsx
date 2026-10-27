import { Outlet } from "react-router";

// Temporary scaffold: the real root layout (providers, header, the single main landmark, footer, scroll
// restoration, document title) replaces this component in the root-layout step of the migration.
export default function RootLayout() {
  return <Outlet />;
}
