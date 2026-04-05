// Calls Google Gemini API using the key stored as a Netlify environment variable
// The key is never exposed to the browser
exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'GEMINI_API_KEY is not set in Netlify environment variables.' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { topic, category, tone } = body;
  if (!topic) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'topic is required' }) };
  }

  const prompt = buildPrompt(topic, category || 'General', tone || 'Conversational & engaging');

  try {
    // Use gemini-1.5-flash — better free tier availability than 2.0-flash
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini error ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!text) throw new Error('Empty response from Gemini');

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ post: text }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};

function buildPrompt(topic, category, tone) {
  return `You are an expert LinkedIn content strategist writing for Manthan Surti, a professional in tech and business.

Write a high-quality, unique LinkedIn post about: "${topic}"
Category: ${category}
Tone: ${tone}

REQUIREMENTS — follow every single one:
1. Hook (line 1): Must be irresistible. Use a bold contrarian statement, a surprising stat, a short provocative question, or a vivid scenario. Do NOT start with "I" or "We". Make people stop scrolling.
2. Body: Include at least 1-2 specific, real, credible data points or recent developments. Weave them naturally — don't just list stats.
3. Insight: Share a non-obvious perspective or contrarian take that makes the reader think differently.
4. Structure: Use short paragraphs (1-3 lines max), blank lines between sections, and arrows (→) or checkmarks for lists. Never use bullet points with dashes.
5. Storytelling: Include a brief concrete example or real-world scenario that grounds the insight.
6. CTA: End with a single engaging open-ended question that invites comments.
7. Hashtags: Add exactly 5 highly relevant hashtags on the last line.
8. Length: Between 900–1,400 characters (optimal for LinkedIn algorithm).
9. Tone check: No corporate jargon. No "In today's fast-paced world". No "I'm excited to share". Sound human, smart, and direct.

Output ONLY the post text. No preamble, no explanation, no quotes around it. Just the raw post ready to copy-paste.`;
}
