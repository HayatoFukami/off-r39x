import { isSafeRelativePath } from "../../auth/continuation";
import { resolveBrowserStorage } from "../../config/browser-storage";
import { copy } from "../../presentation/copy/ja";
import { useSearchParams } from "../../routing/navigation";
import { systemClock } from "../backend/clock";
import { uuidIdGenerator } from "../backend/ids";
import { allowMockGoogleSignIn } from "../backend/mock-auth";

// Stand-in for the Google sign-in screen (dev only, DEV-WEB-012 / 013). There is no input field: it
// never asks for an email, and no email reaches the URL or a storage. Opening it changes nothing. Each
// button hands off with a full-page navigation (window.location.assign) to a return path that the
// screen checks again every time it is shown (SEC-WEB-013); nothing in the app links to it.

const DEMO_EMAIL = "demo@example.com";
const NEW_EMAIL = "google.new@example.com";
const RETURN_PAGES: readonly string[] = ["/account/login", "/account/register"];

/** A return path is used only when it is a safe same-origin path of Login or Registration. */
function trustedReturnPath(values: readonly string[]): string | null {
  const [path] = values;
  if (values.length !== 1 || path === undefined || !isSafeRelativePath(path)) return null;
  const end = path.search(/[?#]/);
  return RETURN_PAGES.includes(end === -1 ? path : path.slice(0, end)) ? path : null;
}

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-base border border-border px-4 py-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50";

export function MockGoogleScreen() {
  const query = useSearchParams();
  const success = trustedReturnPath(query.getAll("success"));
  const failure = trustedReturnPath(query.getAll("failure"));
  // Both paths must be trusted: with one missing or unsafe, no action does anything.
  const usable = success !== null && failure !== null;

  const allow = async (email: string): Promise<void> => {
    if (success === null || failure === null) return;
    try {
      const result = await allowMockGoogleSignIn(
        { storage: resolveBrowserStorage(), clock: systemClock, idGenerator: uuidIdGenerator },
        email,
      );
      if (result.kind === "signed_in") window.location.assign(success);
    } catch {
      // The stand-in stays where it is; a malformed email cannot come from the fixed buttons.
    }
  };

  const cancel = (): void => {
    if (failure !== null) window.location.assign(failure);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{copy.mockGoogle.heading}</h1>
      <p>{copy.mockGoogle.note}</p>
      <p className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!usable}
          className={`${buttonClass} bg-brand text-brand-foreground`}
          onClick={() => void allow(DEMO_EMAIL)}
        >
          {copy.mockGoogle.allowDemo}
        </button>
        <button
          type="button"
          disabled={!usable}
          className={`${buttonClass} bg-brand text-brand-foreground`}
          onClick={() => void allow(NEW_EMAIL)}
        >
          {copy.mockGoogle.allowNew}
        </button>
        <button type="button" disabled={!usable} className={buttonClass} onClick={cancel}>
          {copy.mockGoogle.cancel}
        </button>
      </p>
    </div>
  );
}
