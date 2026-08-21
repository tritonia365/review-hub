// Vercel serverless function (CommonJS — no package.json/build step in this repo).
// Deletes the *calling* user's own Supabase Auth account. This must run
// server-side: only the Supabase service_role key can delete auth users,
// and that key must never reach the browser (unlike the anon key, which
// index.html ships directly since Supabase's RLS protects the data, not
// key secrecy — the service_role key bypasses RLS entirely).
//
// POST /api/delete-account
//   Headers: Authorization: Bearer <the caller's Supabase access token>
//   -> 400 if the Authorization header is missing
//   -> 401 if the access token is invalid/expired
//   -> 500 if SUPABASE_SERVICE_ROLE_KEY is not configured on the server
//   -> 200 { ok: true } on success

var checkRateLimit = require("./_rateLimit").checkRateLimit;

var SUPABASE_URL = "https://qpeyzjsmikuchthtntjq.supabase.co";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST 요청만 허용됩니다." });
    return;
  }

  if (!checkRateLimit(req, "delete-account", 5, 60000)) {
    res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  var authHeader = req.headers && req.headers.authorization;
  var accessToken = authHeader && authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    res.status(400).json({ error: "인증 토큰이 필요합니다." });
    return;
  }

  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY가 서버에 설정되어 있지 않습니다." });
    return;
  }

  try {
    // Resolve the access token to the user it belongs to, so a caller can
    // only ever delete their own account (never an arbitrary id).
    var userRes = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: {
        Authorization: "Bearer " + accessToken,
        apikey: serviceKey
      }
    });
    if (!userRes.ok) {
      res.status(401).json({ error: "인증 토큰이 유효하지 않습니다." });
      return;
    }
    var user = await userRes.json();
    if (!user || !user.id) {
      res.status(401).json({ error: "인증 토큰이 유효하지 않습니다." });
      return;
    }

    var deleteRes = await fetch(SUPABASE_URL + "/auth/v1/admin/users/" + encodeURIComponent(user.id), {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + serviceKey,
        apikey: serviceKey
      }
    });

    if (!deleteRes.ok) {
      var body = await deleteRes.text();
      res.status(502).json({ error: "회원 탈퇴 처리 중 오류가 발생했습니다.", detail: body });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: "회원 탈퇴 처리 중 오류가 발생했습니다.", detail: String(err && err.message || err) });
  }
};
