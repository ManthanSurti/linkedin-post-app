// Generates multiple LinkedIn posts — one per topic, batched in parallel.
// Uses Gemini 2.5 Flash. Batches of 9 to stay under 10 RPM.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(sc, data) {
  return { statusCode: sc, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGemini(apiKey, topic, category, tone, userName) {
  const prompt = buildPrompt(topic, category, tone, userName);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, topP: 0.95, maxOutputTokens: 4096 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`[Gemini ${res.status}] ${err.error?.message || JSON.stringify(err)}`);
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find(p => p.text);
  const text = textPart?.text?.trim();
  if (!text) throw new Error(`Empty response. finishReason=${data.candidates?.[0]?.finishReason}`);
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

  const { topics, category, tone, userName } = body;
  if (!topics || !topics.length) return json(400, { error: 'topics array is required' });
  if (topics.length > 14) return json(400, { error: 'Maximum 14 topics per batch' });

  const cat = category || 'General';
  const tn  = tone || 'Conversational & engaging';

  // Batch in groups of 9 — stays under 10 RPM. Wait 62s between batches.
  const BATCH_SIZE = 9;
  const results = [];

  for (let i = 0; i < topics.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(62000);
    const batch = topics.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(topic => callGemini(apiKey, topic.trim(), cat, tn, userName))
    );
    for (let j = 0; j < batch.length; j++) {
      const outcome = settled[j];
      if (outcome.status === 'fulfilled') {
        results.push({ topic: batch[j], post: outcome.value });
      } else {
        results.push({ topic: batch[j], error: outcome.reason?.message || 'Unknown error' });
      }
    }
  }

  return json(200, { results });
};

function buildPrompt(topic, category, tone, userName) {
  const author = userName ? userName : 'a sharp professional';
  return `You are an expert LinkedIn content strategist writing for ${author}, a professional in tech and business.

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
