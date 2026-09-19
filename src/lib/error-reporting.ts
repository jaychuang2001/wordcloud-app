// Generic client-side error reporter for the React error boundary in
// src/routes/__root.tsx. Prod React does not rethrow boundary-caught errors
// to window.onerror, so without this they'd never reach any logging.
//
// Currently just logs to the console. If you add an error-tracking service
// (Sentry, etc.), call it from here.
export function reportRuntimeError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  // Loaders and server fns commonly throw a raw Response; String(it) is the
  // opaque "[object Response]", so pull out the status and URL instead.
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  console.error("[runtime error]", message, {
    route: window.location.pathname,
    stack: error instanceof Error ? error.stack : undefined,
    ...context,
  });
}
