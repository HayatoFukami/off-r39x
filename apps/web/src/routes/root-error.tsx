import { copy } from "../presentation/copy/ja";

// The root error boundary: shown only when the root layout itself cannot render (for example a port factory that
// fails closed), so this is then the only main landmark in the document. SEC-WEB-012: fixed wording only, the
// error object is never touched.
export default function RootError() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-6xl flex-1 px-3 py-6 outline-none"
    >
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{copy.errorPage.title}</h1>
        <p>{copy.errorPage.description}</p>
      </div>
    </main>
  );
}
