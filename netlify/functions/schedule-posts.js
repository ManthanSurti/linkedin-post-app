// CRUD for scheduled posts — stored per-user in Netlify Blobs.
// Key: posts-{userId}  (userId = personId from urn:li:person:abc123)
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
  try {
    const { connectLambda } = require('@netlify/blobs');
    if (connectLambda) connectLambda(event);
  } catch (e) {
    console.log('connectLambda not available:', e.message);
  }
  return getStore({ name: 'app-data', consistency: 'eventual' });
}

async function getPosts(store, userId) {
  const key = userId ? `posts-${userId}` : 'posts';
  try {
    const data = await store.get(key, { type: 'json' });
    return data || [];
  } catch (e) {
    console.log('getPosts error (likely first run):', e.message);
    return [];
  }
}

async function savePosts(store, userId, posts) {
  const key = userId ? `posts-${userId}` : 'posts';
  await store.setJSON(key, posts);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const store = getPostStore(event);
    const qs = event.queryStringParameters || {};

    // ── LIST ──
    if (event.httpMethod === 'GET') {
      const userId = qs.userId || null;
      if (!userId) return json(401, { error: 'userId required' });
      return json(200, { posts: await getPosts(store, userId) });
    }

    // ── CREATE / UPDATE ──
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const userId = body.userId || null;
      if (!userId) return json(401, { error: 'userId required' });

      const posts = await getPosts(store, userId);
      const now = new Date().toISOString();

      if (body.id) {
        // Update existing post
        const idx = posts.findIndex(p => p.id === body.id);
        if (idx < 0) return json(404, { error: 'Post not found' });
        posts[idx] = { ...posts[idx], ...body, userId, updatedAt: now };
      } else {
        // Create new post
        posts.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          userId,
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

      await savePosts(store, userId, posts);
      return json(200, { ok: true, posts });
    }

    // ── DELETE ──
    if (event.httpMethod === 'DELETE') {
      const { id, userId } = qs;
      if (!id || !userId) return json(400, { error: 'id and userId required' });
      let posts = await getPosts(store, userId);
      posts = posts.filter(p => p.id !== id);
      await savePosts(store, userId, posts);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    console.error('schedule-posts error:', e);
    return json(500, { error: 'Server error: ' + e.message });
  }
};
