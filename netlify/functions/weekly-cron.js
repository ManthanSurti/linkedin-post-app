// Runs every Monday at 6 AM UTC.
// For every user who has weekly auto-post enabled, generates 7 posts and queues them Mon–Sun.
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildPrompt(topic, category, tone, angleInfo) {
  return `You are an expert LinkedIn content strategist writing for a professional in tech and business.

Write a high-quality LinkedIn post about: "${topic}"
Category: ${category}
Tone: ${tone}
Today's angle: ${angleInfo.angle}
Angle guidance: ${angleInfo.hint}

REQUIREMENTS:
1. Hook (line 1): Irresistible, fits the angle. Do NOT start with "I" or "We".
2. Body: 1-2 specific data points woven naturally.
3. Insight: Non-obvious perspective matching the "${angleInfo.angle}" angle.
4. Structure: Short paragraphs (1-3 lines), blank lines between, arrows or checkmarks for lists.
5. Storytelling: Brief concrete example or real-world scenario.
6. CTA: One engaging open-ended question.
7. Hashtags: Exactly 5 on the last line.
8. Length: 900–1,400 characters.
9. Tone: No jargon. Human, smart, direct.

Output ONLY the post text. No preamble, no explanation.`;
}

async function generatePost(apiKey, topic, category, tone, angleInfo) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: buildPrompt(topic, category, tone, angleInfo) }] }] }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini error ${res.status}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
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

  // Generate and queue each post
  let created = 0;
  for (let i = 0; i < ANGLES.length; i++) {
    const angleInfo = ANGLES[i];
    try {
      if (i > 0) await sleep(7000); // respect Gemini 10 RPM limit

      console.log(`[weekly-cron] User ${userId}: generating post ${i + 1}/7 (${angleInfo.angle})`);
      const text = await generatePost(apiKey, settings.topic, settings.category || 'General', settings.tone || 'Conversational & engaging', angleInfo);

      posts.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        userId,
        topic: `${settings.topic} — ${angleInfo.angle}`,
        category: settings.category || 'General',
        tone: settings.tone || 'Conversational & engaging',
        text,
        status: (appSettings && appSettings.approvalRequired) ? 'draft' : 'approved',
        scheduledDate: scheduledDates[i].toISOString(),
        weeklyAuto: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      created++;
    } catch (e) {
      console.error(`[weekly-cron] User ${userId}, ${angleInfo.day} failed:`, e.message);
    }
  }

  if (created > 0) {
    await store.setJSON(`posts-${userId}`, posts);
    settings.lastGeneratedWeek = now.toISOString();
    await store.setJSON(`weekly-settings-${userId}`, settings);
    console.log(`[weekly-cron] User ${userId}: queued ${created}/7 posts`);
  }
}

// Every Monday at 6:00 AM UTC
module.exports.handler = schedule('0 6 * * 1', handler);
