// Stores LinkedIn token server-side, keyed per user so multiple users are isolated.
// Key: token-{personId}  (personId = last segment of urn:li:person:abc123)
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(sc, data) {
  return { statusCode: sc, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function getPersonId(personUrn) {
  // "urn:li:person:abc123" → "abc123"
  if (!personUrn) return null;
  const parts = personUrn.split(':');
  return parts[parts.length - 1] || null;
}

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

    if (event.httpMethod === 'POST') {
      const { token, expiresIn, personUrn, userName } = JSON.parse(event.body || '{}');
      if (!token || !personUrn) return json(400, { error: 'token and personUrn required' });

      const personId = getPersonId(personUrn);
      if (!personId) return json(400, { error: 'Invalid personUrn' });

      const expiresAt = new Date(Date.now() + (expiresIn || 5183999) * 1000).toISOString();
      const tokenData = { token, expiresAt, personUrn, personId, userName };

      // Store per-user (for cron iteration) and also a legacy key for backward compat
      await store.setJSON(`token-${personId}`, tokenData);

      return json(200, { ok: true, expiresAt, personId });
    }

    if (event.httpMethod === 'GET') {
      const { userId } = event.queryStringParameters || {};
      const key = userId ? `token-${userId}` : null;

      if (!key) return json(200, { hasToken: false });

      try {
        const data = await store.get(key, { type: 'json' });
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
