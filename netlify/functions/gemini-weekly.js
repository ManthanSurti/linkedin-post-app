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
  return `You are an expert LinkedIn content strategist writing for Manthan Surti, a professional in tech and business.

Write a high-quality LinkedIn post about: "${topic}"
Category: ${category}
Tone: ${tone}
Today's angle: ${angleInfo.angle}
Angle guidance: ${angleInfo.hint}

REQUIREMENTS — follow every single one:
1. Hook (line 1): Must be irresistible and fit the angle above. Do NOT start with "I" or "We". Make people stop scrolling.
2. Body: Include at least 1-2 specific, real, credible data points or recent developments. Weave them naturally.
3. Insight: Share a non-obvious perspective that fits the "${angleInfo.angle}" angle.
4. Structure: Short paragraphs (1-3 lines max), blank lines between sections, arrows (→) or checkmarks for lists. No bullet dashes.
5. Storytelling: A brief concrete example or real-world scenario grounding the insight.
6. CTA: End with a single engaging open-ended question inviting comments.
7. Hashtags: Exactly 5 relevant hashtags on the last line.
8. Length: Between 900–1,400 characters.
9. Tone: No corporate jargon. Sound human, smart, direct.

Output ONLY the post text. No preamble, no explanation, no quotes. Just the raw post ready to copy-paste.`;
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
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        results.push({ day: angleInfo.day, angle: angleInfo.angle, error: err.error?.message || `Gemini error ${res.status}` });
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
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
