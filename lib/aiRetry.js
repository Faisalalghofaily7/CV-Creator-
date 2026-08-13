import { APIError } from "@anthropic-ai/sdk";

// Server-only. Bounded, backed-off retry for AI calls that must eventually
// resolve to *some* usable result or a graceful fallback — never leave the
// customer stuck waiting on a hung request, and never give up on the first
// hiccup either.
//
// Retries on ANY failure — a thrown error (network error, timeout, any
// HTTP status, an unparseable/malformed response) OR a successful-looking
// response that isn't actually usable (see each route's attempt function,
// which throws when the shape/content isn't right — a wrong item count, a
// JSON parse failure, empty text — unifying both cases into "this attempt
// didn't produce a usable result, try again"). The bounded window (not a
// fixed attempt count) is what "any failure" needs: a route with a fast,
// cheap failure mode should get several tries in the same time a route
// with a slow one gets fewer, rather than one hardcoded number for both.
//
// EXCEPTION: errors that will deterministically fail identically on every
// retry — a missing/invalid API key (401/403) or a genuinely malformed
// request on our own end (400) — skip straight to the fallback instead of
// burning the whole window on retries that can't ever succeed.
const DEFAULT_WINDOW_MS = 40_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 8000;

function isNonRetryableError(err) {
  const status = err instanceof APIError ? err.status : err?.status;
  return status === 401 || status === 403 || status === 400;
}

function describeError(err) {
  if (err instanceof APIError) {
    return `${err.name || "APIError"} status=${err.status} type=${err.type || "?"} — ${err.message}`;
  }
  return err?.message || err?.name || String(err);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `attemptFn(attemptNumber)` repeatedly within a bounded time window,
 * with exponential backoff between tries. `attemptFn` must either return
 * the usable result or throw — there is no separate "is this usable"
 * check here, so callers encode their own validation (line counts, JSON
 * shape, non-empty text, ...) as a thrown error on a bad attempt.
 *
 * `logTag` is a bracketed prefix (e.g. "[SUMMARY-RETRY]") logged on every
 * single attempt with its outcome and reason, so production logs show
 * exactly what's failing and how often — not just the final result.
 *
 * Resolves to { ok: true, result, attempts } on success, or
 * { ok: false, error, attempts, stoppedEarly } once the window is
 * exhausted or a non-retryable error is hit.
 */
export async function retryWithBackoff(attemptFn, { logTag, windowMs = DEFAULT_WINDOW_MS } = {}) {
  const start = Date.now();
  let attempt = 0;
  let lastError = null;

  while (true) {
    attempt += 1;
    try {
      const result = await attemptFn(attempt);
      console.log(`${logTag} attempt ${attempt} succeeded (${Date.now() - start}ms elapsed).`);
      return { ok: true, result, attempts: attempt };
    } catch (err) {
      lastError = err;
      const elapsed = Date.now() - start;
      console.warn(`${logTag} attempt ${attempt} failed (${elapsed}ms elapsed): ${describeError(err)}`);

      if (isNonRetryableError(err)) {
        console.warn(`${logTag} non-retryable error (auth/bad-request) — skipping remaining retries, falling back now.`);
        return { ok: false, error: err, attempts: attempt, stoppedEarly: true };
      }
    }

    const elapsed = Date.now() - start;
    const remaining = windowMs - elapsed;
    if (remaining <= 250) {
      console.warn(`${logTag} bounded window (${windowMs}ms) exhausted after ${attempt} attempt(s) — falling back.`);
      break;
    }

    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS, remaining);
    await sleep(backoff);
  }

  return { ok: false, error: lastError, attempts: attempt };
}
