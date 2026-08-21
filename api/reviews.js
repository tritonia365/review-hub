// Vercel serverless function (CommonJS — no package.json/build step in this repo).
// Looks up a single restaurant on Google Places API (New) — Text Search — and
// returns its rating, review count, review list, and Google Maps link. The
// Google Places API key stays server-side only (process.env.GOOGLE_PLACES_API_KEY),
// never shipped to the browser, same pattern as api/search.js for Kakao.
//
// Local dev: `vercel dev` reads .env automatically and fills process.env.
// Production (Vercel): set GOOGLE_PLACES_API_KEY in Project Settings ->
// Environment Variables and redeploy — .env itself is never part of the deployment.
//
// GET /api/reviews?name=...&lat=...&lng=...
//   -> 400 if `name`, `lat`, or `lng` is missing or lat/lng don't parse as numbers
//   -> 500 if GOOGLE_PLACES_API_KEY is not configured on the server
//   -> mirrors Google's status code + body on a non-2xx Google response
//   -> 200 { found: false } if nothing matches within 200m of the given coordinates
//   -> 200 { found: true, place: {...} } on success
//
// Places API (New) Text Search's `locationRestriction` only accepts a rectangle
// (not a circle) and doesn't apply to name-based text queries anyway, and
// `locationBias.circle` is only a ranking hint, not a hard filter — so the
// actual "within 200m" requirement is enforced here, server-side, via a
// Haversine distance check against each candidate's returned location.

var SEARCH_RADIUS_METERS = 200;
var EARTH_RADIUS_METERS = 6371000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  var toRad = function (deg) { return (deg * Math.PI) / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

var checkRateLimit = require("./_rateLimit").checkRateLimit;

module.exports = async (req, res) => {
  if (!checkRateLimit(req, "reviews", 30, 60000)) {
    res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  var name = req.query && req.query.name;
  var latRaw = req.query && req.query.lat;
  var lngRaw = req.query && req.query.lng;
  var lat = parseFloat(latRaw);
  var lng = parseFloat(lngRaw);

  if (!name || !latRaw || !lngRaw || !isFinite(lat) || !isFinite(lng)) {
    res.status(400).json({ error: "name, lat, lng 파라미터가 필요합니다." });
    return;
  }

  var googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleKey) {
    res.status(500).json({ error: "GOOGLE_PLACES_API_KEY가 서버에 설정되어 있지 않습니다." });
    return;
  }

  try {
    var googleRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleKey,
        "X-Goog-FieldMask":
          "places.displayName,places.location,places.rating,places.userRatingCount,places.reviews,places.googleMapsUri"
      },
      body: JSON.stringify({
        textQuery: name,
        languageCode: "ko",
        maxResultCount: 5,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: SEARCH_RADIUS_METERS
          }
        }
      })
    });

    var body = await googleRes.text();

    if (!googleRes.ok) {
      res.status(googleRes.status);
      try {
        res.json(JSON.parse(body));
      } catch (parseErr) {
        res.json({ error: "Google Places API 오류", status: googleRes.status, body: body });
      }
      return;
    }

    var data = JSON.parse(body);
    var candidates = (data && data.places) || [];

    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      var loc = candidate && candidate.location;
      if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") continue;
      var distance = haversineMeters(lat, lng, loc.latitude, loc.longitude);
      if (distance <= SEARCH_RADIUS_METERS && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    if (!best) {
      res.status(200).json({ found: false });
      return;
    }

    var reviews = (best.reviews || []).map(function (r) {
      return {
        author: (r.authorAttribution && r.authorAttribution.displayName) || "익명",
        rating: typeof r.rating === "number" ? r.rating : null,
        relativeTime: r.relativePublishTimeDescription || "",
        text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || ""
      };
    });

    res.status(200).json({
      found: true,
      place: {
        name: (best.displayName && best.displayName.text) || name,
        rating: typeof best.rating === "number" ? best.rating : null,
        reviewCount: typeof best.userRatingCount === "number" ? best.userRatingCount : 0,
        reviews: reviews,
        mapsUri: best.googleMapsUri || null
      }
    });
  } catch (err) {
    res.status(502).json({ error: "Google 리뷰 조회 중 오류가 발생했습니다.", detail: String(err && err.message || err) });
  }
};
