// Runs every Monday at 6 AM UTC.
// If weekly auto-post is enabled, generates 7 posts from the saved topic
// and schedules them Mon–Sun at the configured posting time.
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
  return `You are an expert LinkedIn content strategist writing for Manthan Surti, a professional in tech and business.

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

  // 1. Load weekly settings
  let settings;
  try {
    settings = await store.get('weekly-settings', { type: 'json' });
  } catch (e) {
    console.log('[weekly-cron] No weekly settings found:', e.message);
    return { statusCode: 200 };
  }

  if (!settings || !settings.enabled || !settings.topic) {
    console.log('[weekly-cron] Weekly auto-post disabled or no topic set. Skipping.');
    return { statusCode: 200 };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[weekly-cron] GEMINI_API_KEY not set');
    return { statusCode: 200 };
  }

  // 2. Load app settings (approval required?)
  let appSettings = { approvalRequired: true };
  try {
    const s = await store.get('settings', { type: 'json' });
    if (s) appSettings = s;
  } catch {}

  // 3. Build the 7 scheduled dates (Mon–Sun) starting from today (Monday)
  const now = new Date();
  const [hh, mm] = (settings.postTime || '10:00').split(':').map(Number);

  const scheduledDates = ANGLES.map((_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i); // i=0 is today (Monday), i=6 is Sunday
    d.setHours(hh, mm, 0, 0);
    return d;
  });

  // 4. Load existing posts
  let posts = [];
  try {
    posts = await store.get('posts', { type: 'json' }) || [];
  } catch {}

  // 5. Generate & schedule each post
  let created = 0;
  for (let i = 0; i < ANGLES.length; i++) {
    const angleInfo = ANGLES[i];
    try {
      if (i > 0) await sleep(7000); // respect Gemini 10 RPM rate limit

      console.log(`[weekly-cron] Generating post ${i + 1}/7: ${angleInfo.angle}`);
      const text = await generatePost(apiKey, settings.topic, settings.category, settings.tone, angleInfo);

      const postObj = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        topic: `${settings.topic} (${angleInfo.angle})`,
        category: settings.category,
        tone: settings.tone,
        text,
        status: appSettings.approvalRequired ? 'draft' : 'approved',
        scheduledDate: scheduledDates[i].toISOString(),
        weeklyAuto: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      posts.push(postObj);
      created++;
      console.log(`[weekly-cron] Queued: ${angleInfo.day} at ${scheduledDates[i].toISOString()}`);
    } catch (e) {
      console.error(`[weekly-cron] Failed for ${angleInfo.day}:`, e.message);
    }
  }

  // 6. Save updated posts
  if (created > 0) {
    await store.setJSON('posts', posts);
    console.log(`[weekly-cron] Done — ${created}/7 posts queued.`);

    // Update lastGeneratedWeek so the UI can show it
    settings.lastGeneratedWeek = now.toISOString();
    await store.setJSON('weekly-settings', settings);
  }

  return { statusCode: 200 };
};

// Every Monday at 6:00 AM UTC
module.exports.handler = schedule('0 6 * * 1', handler);
