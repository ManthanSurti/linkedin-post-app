// Generates 7 LinkedIn posts from ONE topic — each post uses a different angle.
// Called by both the UI ("Generate This Week" button) and the weekly cron job.
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

function buildPrompt(topic, category, tone, angleInfo) {
  return `You are a world-class LinkedIn ghostwriter. You write for Manthan Surti — a sharp, credible voice in tech and business. Your posts earn thousands of impressions because they say something real, not something safe.

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: 'GEMINI_API_KEY not set' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { topic, category, tone } = body;
  if (!topic) return json(400, { error: 'topic is required' });

  const results = [];

  for (let i = 0; i < ANGLES.length; i++) {
    const angleInfo = ANGLES[i];
    try {
      if (i > 0) await sleep(7000); // respect 10 RPM rate limit

      const prompt = buildPrompt(topic, category || 'General', tone || 'Conversational & engaging', angleInfo);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 1.0, topP: 0.95, maxOutputTokens: 8192 },
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        results.push({ day: angleInfo.day, angle: angleInfo.angle, error: err.error?.message || `Gemini error ${res.status}` });
        continue;
      }

      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const textPart = parts.find(p => !p.thought && p.text);
      const text = textPart?.text?.trim();
      if (!text) {
        results.push({ day: angleInfo.day, angle: angleInfo.angle, error: 'Empty response from Gemini' });
        continue;
      }

      results.push({ day: angleInfo.day, angle: angleInfo.angle, post: text });
    } catch (e) {
      results.push({ day: angleInfo.day, angle: angleInfo.angle, error: e.message });
    }
  }

  return json(200, { results, topic });
};
