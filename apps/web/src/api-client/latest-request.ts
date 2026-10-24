// Only the latest-started read is reflected (DEV-WEB-009). A read that is overtaken by a later one,
// and a read that finishes after an unmount or a dependency change (invalidateRequests), is dropped.

export type RequestCounter = { current: number };

export function applyIfLatest<T>(
  counter: RequestCounter,
  request: Promise<T>,
  apply: (value: T) => void,
): Promise<boolean> {
  counter.current += 1;
  const id = counter.current;
  return request.then((value) => {
    if (counter.current !== id) return false;
    apply(value);
    return true;
  });
}

export function invalidateRequests(counter: RequestCounter): void {
  counter.current += 1;
}
