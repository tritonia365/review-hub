// Vercel serverless function (CommonJS — no package.json/build step in this repo).
// Sends a place's Google reviews (already fetched via api/reviews.js) to Gemini
// for sentiment/keyword/summary analysis. The Gemini key stays server-side only
// (process.env.GEMINI_API_KEY), never shipped to the browser — same pattern as
// api/search.js and api/reviews.js.
//
// Local dev: `vercel dev` reads .env automatically and fills process.env.
// Production (Vercel): set GEMINI_API_KEY in Project Settings -> Environment
// Variables and redeploy — .env itself is never part of the deployment.
//
// POST /api/analyze  body: { placeName: string, reviews: [{ rating: number|null, text: string }] }
//   -> 405 if method isn't POST
//   -> 400 if placeName is missing or reviews isn't a non-empty array
//   -> 500 if GEMINI_API_KEY is not configured on the server
//   -> mirrors Gemini's status code + body on a non-2xx Gemini response
//   -> 502 if Gemini didn't return a usable candidate, or its output doesn't
//      parse as the requested JSON shape
//   -> 200 { sentiment: {positive,neutral,negative}, keywords: [...], summary }

var MODEL = "gemini-3.1-flash-lite";

var RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    sentiment: {
      type: "OBJECT",
      properties: {
        positive: { type: "INTEGER" },
        neutral: { type: "INTEGER" },
        negative: { type: "INTEGER" }
      },
      required: ["positive", "neutral", "negative"]
    },
    keywords: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          word: { type: "STRING" },
          score: { type: "INTEGER" },
          context: { type: "STRING", enum: ["positive", "negative"] }
        },
        required: ["word", "score", "context"]
      }
    },
    summary: { type: "STRING" }
  },
  required: ["sentiment", "keywords", "summary"]
};

function buildPrompt(placeName, reviews) {
  var reviewLines = reviews.map(function (r, i) {
    var ratingPart = typeof r.rating === "number" ? "별점 " + r.rating + "점" : "별점 정보 없음";
    return (i + 1) + ". (" + ratingPart + ") " + String(r.text || "").slice(0, 1000);
  }).join("\n");

  return [
    "다음은 '" + placeName + "'라는 가게에 대한 Google 리뷰 " + reviews.length + "개입니다.",
    "",
    reviewLines,
    "",
    "위 리뷰를 바탕으로 아래 세 가지 작업을 수행해서 지정된 JSON 스키마로만 응답하세요.",
    "1. 각 리뷰를 긍정/보통/부정 중 하나로 분류하고, 각 분류에 속하는 리뷰 개수를 세세요. positive+neutral+negative의 합은 반드시 " + reviews.length + "이어야 합니다.",
    "2. 리뷰에서 자주 언급되는 핵심 단어를 8~15개 뽑으세요. 음식 이름, 맛, 분위기, 서비스 관련 단어를 우선하세요. 각 단어마다 이 가게를 평가하는 데 얼마나 중요한지 1~10 사이 정수 점수(score)를 매기고, 그 단어가 리뷰에서 주로 긍정적 맥락으로 쓰였는지(positive) 부정적 맥락으로 쓰였는지(negative)를 context에 표시하세요.",
    "3. 이 가게에 대한 리뷰 전체를 한국어 존댓말 한 문장(40자 내외)으로 요약하세요."
  ].join("\n");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST 요청만 지원합니다." });
    return;
  }

  var body = req.body || {};
  var placeName = body.placeName;
  var reviews = body.reviews;

  if (!placeName || !Array.isArray(reviews) || reviews.length === 0) {
    res.status(400).json({ error: "placeName과 비어 있지 않은 reviews 배열이 필요합니다." });
    return;
  }

  var geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY가 서버에 설정되어 있지 않습니다." });
    return;
  }

  try {
    var geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(placeName, reviews) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.3
          }
        })
      }
    );

    var bodyText = await geminiRes.text();

    if (!geminiRes.ok) {
      res.status(geminiRes.status);
      try {
        res.json(JSON.parse(bodyText));
      } catch (parseErr) {
        res.json({ error: "Gemini API 오류", status: geminiRes.status, body: bodyText });
      }
      return;
    }

    var data = JSON.parse(bodyText);
    var candidate = data && data.candidates && data.candidates[0];
    var text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;

    if (!text) {
      res.status(502).json({ error: "AI 분석에 실패했습니다.", detail: "빈 응답" });
      return;
    }

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      res.status(502).json({ error: "AI 분석 결과를 해석하지 못했습니다." });
      return;
    }

    if (!parsed || !parsed.sentiment || !Array.isArray(parsed.keywords) || typeof parsed.summary !== "string") {
      res.status(502).json({ error: "AI 분석 결과 형식이 올바르지 않습니다." });
      return;
    }

    res.status(200).json({
      sentiment: {
        positive: parsed.sentiment.positive || 0,
        neutral: parsed.sentiment.neutral || 0,
        negative: parsed.sentiment.negative || 0
      },
      keywords: parsed.keywords,
      summary: parsed.summary
    });
  } catch (err) {
    res.status(502).json({ error: "AI 분석 중 오류가 발생했습니다.", detail: String(err && err.message || err) });
  }
};
