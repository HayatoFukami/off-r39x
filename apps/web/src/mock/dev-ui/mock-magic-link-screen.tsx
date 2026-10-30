import { useId, useState } from "react";
import { isSafeRelativePath } from "../../auth/continuation";
import { resolveBrowserStorage } from "../../config/browser-storage";
import { normalizeEmail, validateResetRequestForm } from "../../features/auth/form-validation";
import { copy } from "../../presentation/copy/ja";
import { useSearchParams } from "../../routing/navigation";
import { systemClock } from "../backend/clock";
import { uuidIdGenerator } from "../backend/ids";
import { openMockMagicLink } from "../backend/mock-auth";

// Stand-in for the mailbox where a login link is opened (dev only, DEV-WEB-012 / 013). The developer
// types the address of the link's owner and opens the link as valid or as expired. Opening the screen or
// typing changes nothing, and the address goes to the mock backend call only: never into a URL, a storage
// or the page text. Each button hands off with a full-page navigation (window.location.assign) to a
// return path that the screen checks again every time it is shown (SEC-WEB-013); nothing in the app
// links to it.

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

export function MockMagicLinkScreen() {
  const query = useSearchParams();
  const emailId = useId();
  const [email, setEmail] = useState("");
  const success = trustedReturnPath(query.getAll("success"));
  const failure = trustedReturnPath(query.getAll("failure"));
  // Both paths must be trusted: with one missing or unsafe, no action does anything.
  const usable = success !== null && failure !== null;

  const openValid = async (): Promise<void> => {
    if (success === null || failure === null) return;
    // An empty or malformed address opens nothing.
    const owner = normalizeEmail(email);
    if (!validateResetRequestForm({ email: owner }).ok) return;
    try {
      const result = await openMockMagicLink(
        { storage: resolveBrowserStorage(), clock: systemClock, idGenerator: uuidIdGenerator },
        owner,
      );
      if (result.kind === "signed_in") window.location.assign(success);
    } catch {
      // The stand-in stays where it is.
    }
  };

  const openExpired = (): void => {
    if (failure !== null) window.location.assign(failure);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{copy.mockMagicLink.heading}</h1>
      <p>{copy.mockMagicLink.note}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="text-sm font-medium">
          {copy.mockMagicLink.emailLabel}
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-h-11 w-full rounded-base border border-border bg-background px-3 py-2"
        />
      </div>
      <p className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!usable}
          className={`${buttonClass} bg-brand text-brand-foreground`}
          onClick={() => void openValid()}
        >
          {copy.mockMagicLink.openValid}
        </button>
        <button type="button" disabled={!usable} className={buttonClass} onClick={openExpired}>
          {copy.mockMagicLink.openExpired}
        </button>
      </p>
    </div>
  );
}
