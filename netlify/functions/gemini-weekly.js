// Generates 7 LinkedIn posts from ONE topic — each post uses a different angle.
// Uses Gemini 2.5 Flash (fast, fits in Netlify 10s serverless timeout).
// All 7 calls run in parallel — safe under 10 RPM since they fire simultaneously.
// Google Search grounding is enabled so posts cite real, current information.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(sc, data) {
  return { statusCode: sc, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

// 7 distinct angles — one per day of the week
const ANGLES = [
  { day: 'Monday',    angle: 'Data & Statistics',       hint: 'Lead with a surprising stat or research finding. Make the numbers tell a story.' },
  { day: 'Tuesday',   angle: 'Contrarian Take',          hint: 'Challenge conventional wisdom. Disagree with a widely held belief about this topic. Be bold.' },
  { day: 'Wednesday', angle: 'Practical How-To',         hint: 'Give 3-5 actionable steps or a concrete framework. Make it immediately useful.' },
  { day: 'Thursday',  angle: 'Personal Story',           hint: 'Frame it through a personal experience, a lesson learned, or a moment of realization.' },
  { day: 'Friday',    angle: 'Future Prediction',        hint: 'Make a bold, specific prediction about where this topic is heading in 12-24 months.' },
  { day: 'Saturday',  angle: 'Industry Trend',           hint: 'Connect this topic to a broader shift happening in the industry. What signal is everyone missing?' },
  { day: 'Sunday',    angle: 'Mindset & Reflection',     hint: 'Take a philosophical or mindset angle. What deeper truth does this topic reveal?' },
];

function buildPrompt(topic, category, tone, angleInfo, userName) {
  const author = userName ? userName : 'a sharp professional';
  return `You are a world-class LinkedIn ghostwriter. You write for ${author} — a credible voice in tech and business. Your posts earn thousands of impressions because they say something real, not something safe.

TOPIC: "${topic}"
CATEGORY: ${category}
TONE: ${tone}
ANGLE: ${angleInfo.angle}
ANGLE DIRECTION: ${angleInfo.hint}
Every part of this post — the hook, body, and CTA — must serve this specific angle. Don't drift from it.

YOUR MISSION: Write a LinkedIn post that makes professionals stop, read every word, and feel compelled to respond.

STRUCTURAL RULES (non-negotiable):
→ LINE 1 IS EVERYTHING. Bold claim, striking stat, punchy scenario — create instant tension. No "I", no "We".
→ Paragraphs: 1–3 lines max. Blank line between every paragraph.
→ Use → or ✓ for lists. Never dashes or bullet points.
→ Build to an insight the reader didn't see coming.
→ At least one specific, verifiable data point or real-world example.
→ End with ONE open-ended question that sparks genuine debate — not "What do you think?" or "Agree?".
→ Final line: exactly 5 relevant hashtags.

AVOID: "fast-paced world", "game-changer", "synergy", "excited to share", generic advice, padding.

LENGTH: 950–1,350 characters. Every word must earn its place.

Output ONLY the post. No preamble, no quotes. Raw text, ready to publish.`;
}

async function generatePost(apiKey, topic, category, tone, angleInfo, userName) {
  const prompt = buildPrompt(topic, category, tone, angleInfo, userName);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Google Search grounding — Gemini fetches live web results before writing,
        // ensuring stats and trends in the post are current and verifiable.
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 1.0, topP: 0.95, maxOutputTokens: 4096 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini error ${res.status}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find(p => p.text);
  const text = textPart?.text?.trim();
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: 'GEMINI_API_KEY not set' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { topic, category, tone, userName } = body;
  if (!topic) return json(400, { error: 'topic is required' });

  const cat  = category || 'General';
  const tn   = tone || 'Conversational & engaging';

  // Fire all 7 in parallel — Flash is fast (~3-5s each), and 7 simultaneous
  // requests comfortably fits under the 10 RPM free-tier limit.
  const settled = await Promise.allSettled(
    ANGLES.map(angleInfo => generatePost(apiKey, topic, cat, tn, angleInfo, userName))
  );

  const results = ANGLES.map((angleInfo, i) => {
    const outco