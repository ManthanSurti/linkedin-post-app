// Stores weekly auto-post settings per user in Netlify Blobs
// Key: weekly-settings-{userId}
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(sc, data) {
  return { statusCode: sc, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

const DEFAULTS = {
  topic: '',
  category: 'AI & Technology',
  tone: 'Conversational & engaging',
  postTime: '10:00',
  enabled: false,
  lastGeneratedWeek: null,
};

function getBlobStore(event) {
  try {
    const { connectLambda } = require('@netlify/blobs');
    if (connectLambda) connectLambda(event);
  } catch (e) {
    console.log('connectLambda not available:', e.message);
  }
  return getStore({ name: 'app-data', consistency: 'eventual' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const store = getBlobStore(event);
    const qs = event.queryStringParameters || {};

    if (event.httpMethod === 'GET') {
      const userId = qs.userId || null;
      if (!userId) return json(200, DEFAULTS);
      try {
        const data = await store.get(`weekly-settings-${userId}`, { type: 'json' });
        return json(200, { ...DEFAULTS, ...(data || {}) });
      } catch {
        return json(200, DEFAULTS);
      }
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const userId = body.userId || null;
      if (!userId) return json(400, { error: 'userId required' });

      // Merge with existing so partial updates don't wipe state
      let existing = DEFAULTS;
      try {
        const stored = await store.get(`weekly-settings-${userId}`, { type: 'json' });
        if (stored) existing = { ...DEFAULTS, ...stored };
      } catch {}

      const settings = {
        ...existing,
        ...(body.topic             !== undefined ? { topic: body.topic }                         : {}),
        ...(body.category          !== undefined ? { category: body.category }                   : {}),
        ...(body.tone              !== undefined ? { tone: body.tone }                           : {}),
        ...(body.postTime          !== undefined ? { postTime: body.postTime }                   : {}),
        ...(body.enabled           !== undefined ? { enabled: body.enabled }                     : {}),
        ...(body.lastGeneratedWeek !== undefined ? { lastGeneratedWeek: body.lastGeneratedWeek } : {}),
      };

      await store.setJSON(`weekly-settings-${userId}`, settings);
      return json(200, { ok: true, ...settings });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    console.error('weekly-settings error:', e);
    return json(500, { error: 'Server error: ' + e.message });
  }
};
