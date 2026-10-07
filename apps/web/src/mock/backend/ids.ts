/** Returns a new canonical lowercase UUID on every call. */
export type IdGenerator = () => string;

/** Default id source for the running mock. Tests inject a deterministic generator instead. */
export const uuidIdGenerator: IdGenerator = () => globalThis.crypto.randomUUID();
