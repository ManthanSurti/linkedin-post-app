// Stores app settings (like approval toggle) in Netlify Blobs
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(sc, data) {
  return { statusCode: sc, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

const DEFAULTS = { approvalRequired: true };

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

    if (event.httpMethod === 'GET') {
      try {
        const data = await store.get('settings', { type: 'json' });
        return json(200, data || DEFAULTS);
      } catch {
        return json(200, DEFAULTS);
      }
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const settings = { approvalRequired: body.approvalRequired !== false };
      await store.setJSON('settings', settings);
      return json(200, { ok: true, ...settings });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    console.error('schedule-settings error:', e);
    return json(500, { error: 'Server error: ' + e.message });
  }
};
