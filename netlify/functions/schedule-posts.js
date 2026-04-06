// CRUD for scheduled posts — stored in Netlify Blobs
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function json(statusCode, data) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function getPostStore(event) {
  // connectLambda approach — pass the event context so Blobs can auth
  try {
    const { connectLambda } = require('@netlify/blobs');
    if (connectLambda) connectLambda(event);
  } catch (e) {
    console.log('connectLambda not available, proceeding without it:', e.message);
  }
  return getStore({ name: 'app-data', consistency: 'eventual' });
}

async function getPosts(store) {
  try {
    const data = await store.get('posts', { type: 'json' });
    return data || [];
  } catch (e) {
    console.log('getPosts error (likely first run):', e.message);
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const store = getPostStore(event);

    // ── LIST ──
    if (event.httpMethod === 'GET') {
      return json(200, { posts: await getPosts(store) });
    }

    // ── CREATE / UPDATE ──
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const posts = await getPosts(store);
      const now = new Date().toISOString();

      if (body.id) {
        const idx = posts.findIndex(p => p.id === body.id);
        if (idx < 0) return json(404, { error: 'Post not found' });
        posts[idx] = { ...posts[idx], ...body, updatedAt: now };
      } else {
        posts.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          topic: body.topic || '',
          category: body.category || '',
          tone: body.tone || '',
          text: body.text || '',
          status: body.status || 'draft',
          scheduledDate: body.scheduledDate || null,
          createdAt: now,
          updatedAt: now,
        });
      }

      await store.setJSON('posts', posts);
      return json(200, { ok: true, posts });
    }

    // ── DELETE ──
    if (event.httpMethod === 'DELETE') {
      const { id } = event.queryStringParameters || {};
      if (!id) return json(400, { error: 'id required' });
      let posts = await getPosts(store);
      posts = posts.filter(p => p.id !== id);
      await store.setJSON('posts', posts);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    console.error('schedule-posts error:', e);
    return json(500, { error: 'Server error: ' + e.message });
  }
};
