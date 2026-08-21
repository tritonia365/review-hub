// Shared helper, not a route — Vercel does not deploy files under /api that
// start with "_" as serverless functions.
//
// Best-effort per-IP rate limiter for the other api/*.js functions, all of
// which proxy paid/quota-limited third-party keys (Kakao, Google Places,
// Gemini) with no login requirement. This exists to blunt casual scripted
// abuse that would otherwise drain those quotas, not as a hard security
// boundary: the counters live in memory on a single warm lambda instance,
// and Vercel can run several instances concurrently, so a determined caller
// spreading requests across instances (or waiting for a cold start) can get
// a higher effective rate. That's an accepted tradeoff for a project with
// no database/build step to back a real distributed limiter.

var buckets = new Map();

function getClientIp(req) {
  var fwd = req.headers && req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// `key` scopes the limit per endpoint (so e.g. /api/search and /api/analyze
// don't share one budget). Returns true if this request is within the
// allowed `limit` requests per `windowMs` for the caller's IP, false if it
// should be rejected with 429.
function checkRateLimit(req, key, limit, windowMs) {
  var ip = getClientIp(req);
  var bucketKey = key + ":" + ip;
  var now = Date.now();
  var bucket = buckets.get(bucketKey);

  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(bucketKey, bucket);
  }

  bucket.count++;

  // Opportunistic cleanup so `buckets` doesn't grow unbounded on a
  // long-lived warm instance.
  if (buckets.size > 5000) {
    buckets.forEach(function (b, k) {
      if (now - b.start > windowMs) buckets.delete(k);
    });
  }

  return bucket.count <= limit;
}

module.exports = { checkRateLimit: checkRateLimit };
