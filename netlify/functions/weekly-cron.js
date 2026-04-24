// Runs every Monday at 6 AM UTC.
// For every user who has weekly auto-post enabled, generates 7 posts and queues them Mon–Sun.
// Uses Gemini 2.5 Flash + Google Search grounding: fast, accurate, and current.
// All 7 posts generated in parallel — no sequential delays needed.
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

const ANGLES = [
  { day: 'Monday',    angle: 'Data & Statistics',   hint: 'Lead with a surprising stat or research finding. Make the numbers tell a story.' },
  { day: 'Tuesday',   angle: 'Contrarian Take',      hint: 'Challenge conventional wisdom. Disagree with a widely held belief about this topic.' },
  { day: 'Wednesday', angle: 'Practical How-To',     hint: 'Give 3-5 actionable steps or a concrete framework. Make it immediately useful.' },
  { day: 'Thursday',  angle: 'Personal Story',       hint: 'Frame it through a personal experience, a lesson learned, or a moment of realization.' },
  { day: 'Friday',    angle: 'Future Prediction',    hint: 'Make a bold, specific prediction about where this topic is heading in 12-24 months.' },
  { day: 'Saturday',  angle: 'Industry Trend',       hint: 'Connect this topic to a broader shift. What signal is everyone missing?' },
  { day: 'Sunday',    angle: 'Mindset & Reflection', hint: 'Take a philosophical/mindset angle. What deeper truth does this topic reveal?' },
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
  const res = await fetch(
    // Flash is sufficient quality for auto-generated posts and ~10x faster than Pro.
    // Google Search grounding replaces the need for high thinkingBudget to get accurate facts.
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(topic, category, tone, angleInfo, userName) }] }],
        // Google Search grounding — Gemini fetches live results so stats are current.
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

const handler = async () => {
  console.log('[weekly-cron] Starting weekly post generation');

  const store = getStore({ name: 'app-data', consistency: 'eventual' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.log('[weekly-cron] GEMINI_API_KEY not set'); return { statusCode: 200 }; }

  // 1. List all users with weekly settings
  let settingKeys = [];
  try {
    const result = await store.list({ prefix: 'weekly-settings-' });
    settingKeys = (result.blobs || []).map(b => b.key);
  } catch (e) {
    console.error('[weekly-cron] Failed to list weekly settings:', e.message);
    return { statusCode: 200 };
  }

  if (!settingKeys.length) {
    console.log('[weekly-cron] No weekly settings found');
    return { statusCode: 200 };
  }

  const now = new Date();

  for (const settingKey of settingKeys) {
    const userId = settingKey.replace('weekly-settings-', '');
    try {
      await processUser(store, apiKey, userId, now);
    } catch (e) {
      console.error(`[weekly-cron] Error for user ${userId}:`, e.message);
    }
  }

  return { statusCode: 200 };
};

async function processUser(store, apiKey, userId, now) {
  // Load weekly settings
  const settings = await store.get(`weekly-settings-${userId}`, { type: 'json' }).catch(() => null);
  if (!settings || !settings.enabled || !settings.topic) {
    console.log(`[weekly-cron] Skipping user ${userId}: disabled or no topic`);
    return;
  }

  // Load app settings (approval required?)
  const appSettings = await store.get(`settings-${userId}`, { type: 'json' }).catch(() => ({ approvalRequired: true }));

  // Build 7 scheduled dates starting from today (Monday)
  const [hh, mm] = (settings.postTime || '10:00').split(':').map(Number);
  const scheduledDates = ANGLES.map((_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    return d;
  });

  // Load existing posts
  let posts = await store.get(`posts-${userId}`, { type: 'json' }).catch(() => []) || [];

  const cat = settings.category || 'General';
  const tn  = settings.tone || 'Conversational & engaging';
  const uName = settings.userName || '';
  const postStatus = (appSettings && appSettings.approvalRequired) ? 'draft' : 'approved';

  // Generate all 7 posts in parallel — Flash is fast enough and 7 simultaneous
  // requests stays under the 10 RPM free-tier limit.
  console.log(`[weekly-cron] User ${userId}: generating 7 posts in parallel`);
  const settled = await Promise.allSettled(
    ANGLES.map(angleInfo => generatePost(apiKey, settings.topic, cat, tn, angleInfo, uName))
  );

  let created = 0;
  for (let i = 0; i < ANGLES.length; i++) {
    const outcome = settled[i];
    const angleInfo = ANGLES[i];
    if (outcome.status === 'fulfilled') {
      posts.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        userId,
        topic: `${settings.topic} — ${angleInfo.angle}`,
        category: cat,
        tone: tn,
        text: outcome.value,
        status: postStatus,
        scheduledDate: scheduledDates[i].toISOString(),
        weeklyAuto: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString