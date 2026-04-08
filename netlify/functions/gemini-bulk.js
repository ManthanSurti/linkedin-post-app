// Generates multiple LinkedIn posts in one call — one per topic
// Uses Gemini 2.5 Flash (free tier: 10 RPM, 250/day)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(sc, data) {
  return { statusCode: sc, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: 'GEMINI_API_KEY not set' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { topics, category, tone } = body;
  if (!topics || !topics.length) return json(400, { error: 'topics array is required' });
  if (topics.length > 14) return json(400, { error: 'Maximum 14 topics per batch' });

  const results = [];

  for (const topic of topics) {
    try {
      // Small delay between requests to respect rate limits (10 RPM)
      if (results.length > 0) await sleep(7000);

      const prompt = buildPrompt(topic.trim(), category || 'General', tone || 'Conversational & engaging');
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
        results.push({ topic, error: err.error?.message || `Gemini error ${res.status}` });
        continue;
      }

      const data = await res.json();
      const bParts = data.candidates?.[0]?.content?.parts || [];
      const bTextPart = bParts.find(p => !p.thought && p.text);
      const text = bTextPart?.text?.trim();
      if (!text) {
        results.push({ topic, error: 'Empty response from Gemini' });
        continue;
      }

      results.push({ topic, post: text });
    } catch (e) {
      results.push({ topic, error: e.message });
    }
  }

  return json(200, { results });
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildPrompt(topic, category, tone) {
  return `You are an expert LinkedIn content strategist writing for Manthan Surti, a professional in tech and business.

Write a high-quality, unique LinkedIn post about: "${topic}"
Category: ${category}
Tone: ${tone}

REQUIREMENTS:
1. Hook (line 1): Bold contrarian statement, surprising stat, short provocative question, or vivid scenario. Do NOT start with "I" or "We".
2. Body: Include 1-2 specific, credible data points or recent developments woven naturally.
3. Insight: Share a non-obvious perspective that makes the reader think differently.
4. Structure: Short paragraphs (1-3 lines max), blank lines between sections, arrows or checkmarks for lists.
5. Storytelling: Include a brief concrete example or real-world scenario.
6. CTA: End with a single engaging open-ended question inviting comments.
7. Hashtags: Exactly 5 relevant hashtags on the last line.
8. Length: Between 900-1,400 characters.
9. Tone: No corporate jargon. Sound human, smart, and direct.

Output ONLY the post text. No preamble, no explanation.`;
}
