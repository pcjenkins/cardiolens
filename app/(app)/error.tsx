"use client";

// Error boundary for every page in the app shell (must be a client component).
// In production Next.js hides server error messages; the digest ties this view to the server log line.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card">
      <h1>Couldn&apos;t load this page</h1>
      <p className="muted">
        {process.env.NODE_ENV === "development" ? error.message : "The data service returned an error or isn't reachable."}
        {error.digest && <> (ref {error.digest})</>}
      </p>
      <p className="hint">Running locally? Check that Postgres and the data API are up: <code>npm run stack</code>.</p>
      <button type="button" onClick={reset}>Try again</button>
    </section>
  );
}
