// Stores LinkedIn token server-side so the cron publisher can use it
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(sc, data) {
  return { statusCode: sc, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function getBlobStore(event) {
  try {
    const { connectLambda } = require('@netlify/blobs');
    if (connectLambda) connectLambda(event);
  } catch (e) {
    console.log('connectLambda not available:', e.message);
  }
  return getStore({ name: 'app-data', consistency: 'strong' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const store = getBlobStore(event);

    if (event.httpMethod === 'POST') {
      const { token, expiresIn, personUrn, userName } = JSON.parse(event.body || '{}');
      if (!token) return json(400, { error: 'token required' });
      const expiresAt = new Date(Date.now() + (expiresIn || 5183999) * 1000).toISOString();
      await store.setJSON('linkedin-token', { token, expiresAt, personUrn, userName });
      return json(200, { ok: true, expiresAt });
    }

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
  } catch (e) {
    console.error('schedule-token error:', e);
    return json(500, { error: 'Server error: ' + e.message });
  }
};
