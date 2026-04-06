// Stores LinkedIn token server-side so the cron publisher can use it
const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(sc, data) {
  return { statusCode: sc, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  connectLambda(event);
  const store = getStore({ name: 'app-data', consistency: 'strong' });

  // ── SAVE TOKEN ──
  if (event.httpMethod === 'POST') {
    const { token, expiresIn, personUrn, userName } = JSON.parse(event.body || '{}');
    if (!token) return json(400, { error: 'token required' });

    const expiresAt = new Date(Date.now() + (expiresIn || 5183999) * 1000).toISOString();
    await store.setJSON('linkedin-token', { token, expiresAt, personUrn, userName });
    return json(200, { ok: true, expiresAt });
  }

  // ── CHECK TOKEN STATUS ──
  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get('linkedin-token', { type: 'json' });
      if (!data) return json(200, { hasToken: false });
      const expired = new Date(data.expiresAt) < new Date();
      return json(200, { hasToken: !expired, expiresAt: data.expiresAt, userName: data.userName, expired });
    } catch {
      return json(200, { hasToken: false });
    }
  }

  return json(405, { error: 'Method not allowed' });
};
