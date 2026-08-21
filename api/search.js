// Vercel serverless function (CommonJS — no package.json/build step in this repo).
// Proxies Kakao Local keyword search so the Kakao REST API key stays server-side
// only (process.env.KAKAO_REST_API_KEY), never shipped to the browser.
//
// Local dev: `vercel dev` reads .env automatically and fills process.env.
// Production (Vercel): set KAKAO_REST_API_KEY in Project Settings -> Environment
// Variables and redeploy — .env itself is never part of the deployment.
//
// GET /api/search?query=...&category_group_code=FD6&size=15
//   -> 400 if `query` is missing
//   -> 500 if KAKAO_REST_API_KEY is not configured on the server
//   -> mirrors Kakao's status code + body on a non-2xx Kakao response
//   -> 200 + Kakao's raw JSON (including `documents`) on success

var checkRateLimit = require("./_rateLimit").checkRateLimit;

module.exports = async (req, res) => {
  if (!checkRateLimit(req, "search", 30, 60000)) {
    res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  var query = req.query && req.query.query;
  var categoryGroupCode = req.query && req.query.category_group_code;
  var size = (req.query && req.query.size) || "15";

  if (!query) {
    res.status(400).json({ error: "query 파라미터가 필요합니다." });
    return;
  }

  var kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) {
    res.status(500).json({ error: "KAKAO_REST_API_KEY가 서버에 설정되어 있지 않습니다." });
    return;
  }

  var url = "https://dapi.kakao.com/v2/local/search/keyword.json?query=" + encodeURIComponent(query) + "&size=" + encodeURIComponent(size);
  if (categoryGroupCode) {
    url += "&category_group_code=" + encodeURIComponent(categoryGroupCode);
  }

  try {
    var kakaoRes = await fetch(url, {
      headers: { Authorization: "KakaoAK " + kakaoKey }
    });
    var body = await kakaoRes.text();

    if (!kakaoRes.ok) {
      res.status(kakaoRes.status);
      try {
        res.json(JSON.parse(body));
      } catch (parseErr) {
        res.json({ error: "카카오 API 오류", status: kakaoRes.status, body: body });
      }
      return;
    }

    var data = JSON.parse(body);
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: "카카오 API 호출 중 오류가 발생했습니다.", detail: String(err && err.message || err) });
  }
};
