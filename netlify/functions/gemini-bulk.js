// Generates multiple LinkedIn posts in one call — one per topic
// Uses Gemini 2.5 Flash with Google Search grounding (current, verifiable facts).
// Fires up to 9 requests in parallel per batch to stay under 10 RPM.
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

  const { topics, category, tone, userName } = body;
  if (!topics || !topics.length) return json(400, { error: 'topics array is required' });
  if (topics.length > 14) return json(400, { error: 'Maximum 14 topics per batch' });

  const cat = category || 'General';
  const tn  = tone || 'Conversational & engaging';

  // Batch into groups of 9 to stay safely under 10 RPM.
  // Within each batch all calls run in parallel — much faster than sequential.
  const BATCH_SIZE = 9;
  const results = [];

  for (let i = 0; i < topics.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(62000); // wait ~1 min between batches to reset RPM window
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
        // Google Search grounding — ensures stats and examples are real and current.
        tools: [{ googleSearch: {} }],
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

function buildPrompt(topic, category, tone, userName) {
  const author = userName ? userName : 'a sharp professional';
  return `You are an expert LinkedIn content strategist writing for ${author}, a professional in tech and business.

Write a high-quality, unique LinkedIn post about: "${topic}"
Category: ${category}
Tone: ${tone}

REQUIREMENTS:
1. Hook