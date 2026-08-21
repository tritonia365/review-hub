// Shared helper, not a route — same underscore-prefix exclusion as
// _rateLimit.js.
//
// Site-wide (not per-IP) usage budget for the endpoints that proxy a paid,
// quota-limited external API. _rateLimit.js only stops one visitor from
// flooding an endpoint; it does nothing to stop many different real
// visitors from collectively exceeding that external API's free tier. This
// tracks one counter per endpoint across ALL callers and refuses new
// requests once it's close to the free tier, so the site fails safely (a
// clear, temporary, reason-and-reset-time message) instead of quietly
// running up real charges.
//
// In-memory, per warm lambda instance — same caveat as _rateLimit.js: this
// resets on a cold start and isn't shared across concurrent instances, so
// the limits passed in by each caller should already sit well under the
// real free-tier ceiling, not at it. Period boundaries are computed in UTC
// (not the external API's own Pacific/US reset clock) for the same reason
// — the margin below the real ceiling is what absorbs that timezone skew.

var counters = new Map();

function periodStart(period, now) {
  return period === "month"
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
function periodEnd(period, start) {
  var d = new Date(start);
  return period === "month"
    ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
    : start + 24 * 60 * 60 * 1000;
}

// key: a name for this budget (e.g. "analyze-daily"). limit: max requests
// allowed within the period. period: "day" | "month".
// Returns { allowed, resetAt } where resetAt is the Date the counter zeroes.
function checkBudget(key, limit, period) {
  var now = new Date();
  var start = periodStart(period, now);
  var entry = counters.get(key);

  if (!entry || entry.start !== start) {
    entry = { start: start, count: 0 };
    counters.set(key, entry);
  }

  entry.count++;

  return {
    allowed: entry.count <= limit,
    resetAt: new Date(periodEnd(period, start))
  };
}

// Renders a reset time as a Korean, KST-localized phrase for end users,
// e.g. "2026년 8월 22일 09:00 (한국시간) 이후" — this site is Seoul-only,
// so every user-facing time should read in KST regardless of the UTC math
// used internally above.
function formatResetKst(date) {
  var formatted = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  return formatted + " (한국시간) 이후";
}

module.exports = { checkBudget: checkBudget, formatResetKst: formatResetKst };
