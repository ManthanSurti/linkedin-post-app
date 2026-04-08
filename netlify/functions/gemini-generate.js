// Calls Google Gemini 2.5 Flash API — fast enough for Netlify serverless (10s timeout)
// Pro is too slow (thinking model, 30s+). Pro is used only in weekly-cron (background, 15 min timeout).
exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

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

  const { topic, category, tone, angle, angleHint } = body;
  if (!topic) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'topic is required' }) };
  }

  const prompt = buildPrompt(topic, category || 'General', tone || 'Conversational & engaging', angle, angleHint);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 1.0,
            topP: 0.95,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 2048 },
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini error ${res.status}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    // Gemini 2.5 Pro is a thinking model — skip thought parts, get the real output
    const textPart = parts.find(p => !p.thought && p.text);
    const text = textPart?.text?.trim();
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

function buildPrompt(topic, category, tone, angle, angleHint) {
  const toneInstructions = {
    'Conversational & engaging': 'Write like a sharp, self-aware professional talking to a peer over coffee. Direct, warm, no fluff.',
    'Thought leadership — data-driven, authoritative': 'Write like a respected industry expert making a well-reasoned, evidence-backed argument. Authoritative without being arrogant.',
    'Storytelling — personal experience, lessons learned': 'Write like someone sharing a hard-won lesson. Vulnerable enough to be relatable, specific enough to be credible.',
    'Punchy & bold — contrarian takes, provocative': 'Write like someone who genuinely disagrees with the mainstream. Bold claims, sharp edges, zero hedging.',
  };

  const toneGuide = toneInstructions[tone] || toneInstructions['Conversational & engaging'];

  const angleSection = angle ? `
ANGLE FOR THIS POST: ${angle}
Angle direction: ${angleHint}
Every part of this post — the hook, body, and CTA — must serve this specific angle. Don't drift from it.
` : '';

  return `You are a world-class LinkedIn ghostwriter. You write for Manthan Surti — a sharp, credible voice in tech and business. Your posts earn thousands of impressions because they say something real, not something safe.

TOPIC: "${topic}"
CATEGORY: ${category}
TONE DIRECTION: ${toneGuide}
${angleSection}
YOUR MISSION: Write a LinkedIn post that makes professionals stop, read every word, and feel compelled to respond. Not a generic take — a specific, unexpected, well-argued one.

STRUCTURAL RULES (non-negotiable):
→ LINE 1 IS EVERYTHING. It must create instant curiosity or tension. No "I", no "We", no questions starting with "Have you ever". Use a bold claim, a striking stat, a short punchy sentence, or a scenario that creates FOMO. Think: what would make someone pause mid-scroll?
→ Keep paragraphs to 1–3 lines max. Use blank lines between every paragraph.
→ Use → or ✓ for any list items. Never use dashes or bullet points.
→ Build to an insight the reader didn't see coming. The best LinkedIn posts teach something the reader didn't know they needed to know.
→ Use at least one specific, verifiable data point or real-world example. Vague claims kill credibility.
→ End with ONE open-ended question that sparks a genuine debate or reflection — not "What do you think?" or "Agree?".
→ Final line: exactly 5 hashtags, highly relevant, no spaces between them.

WHAT TO AVOID:
✗ "In today's fast-paced world..."
✗ "Game-changer", "synergy", "leverage", "paradigm shift"
✗ "I'm excited/thrilled/honoured to share..."
✗ Generic advice that could apply to any industry
✗ Fake humility or false modesty
✗ Padding sentences that add length but not meaning

LENGTH: 950–1,350 characters. Every word must earn its place.

Output ONLY the post. No preamble, no "Here's the post:", no quotes. Raw text, ready to publish.`;
}
