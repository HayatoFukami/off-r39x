/** A failure of the service (not of the input): the only alert of the form while it is shown. */
export function ServiceFailure({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
    >
      {message}
    </p>
  );
}
