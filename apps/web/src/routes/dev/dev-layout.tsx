import { Outlet } from "react-router";
import { readBuildEnv } from "../../config/build-env";
import { isDevAreaEnabled } from "../../config/ui-mock";
import { NotFoundView } from "../../presentation/components/not-found-view";

// DEV-WEB-012: the dev area exists only in UI mock mode and never in a production deployment; elsewhere /dev/* is
// the ordinary Not Found view. It is kept out of search indexes (React 19 places the meta element in the head).
export default function DevLayout() {
  if (!isDevAreaEnabled(readBuildEnv())) return <NotFoundView />;
  return (
    <>
      <meta name="robots" content="noindex, nofollow" />
      <Outlet />
    </>
  );
}
