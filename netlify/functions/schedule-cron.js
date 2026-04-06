// Runs every hour — finds all users with stored tokens, publishes their approved due posts.
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

const handler = async () => {
  const store = getStore({ name: 'app-data', consistency: 'eventual' });
  const now = new Date();

  // 1. List all stored user tokens
  let tokenKeys = [];
  try {
    const result = await store.list({ prefix: 'token-' });
    tokenKeys = (result.blobs || []).map(b => b.key);
  } catch (e) {
    console.error('[cron] Failed to list tokens:', e.message);
    return { statusCode: 200 };
  }

  if (!tokenKeys.length) {
    console.log('[cron] No user tokens found');
    return { statusCode: 200 };
  }

  console.log(`[cron] Found ${tokenKeys.length} user token(s)`);

  // 2. For each user, check token validity and publish due posts
  for (const tokenKey of tokenKeys) {
    const personId = tokenKey.replace('token-', '');
    try {
      await processUser(store, personId, now);
    } catch (e) {
      console.error(`[cron] Error processing user ${personId}:`, e.message);
    }
  }

  return { statusCode: 200 };
};

async function processUser(store, personId, now) {
  // Load token
  let tokenData;
  try {
    tokenData = await store.get(`token-${personId}`, { type: 'json' });
  } catch {
    console.log(`[cron] No token for user ${personId}`);
    return;
  }

  if (!tokenData || !tokenData.token) {
    console.log(`[cron] Empty token for user ${personId}`);
    return;
  }

  if (new Date(tokenData.expiresAt) < now) {
    console.log(`[cron] Token expired for user ${personId} at ${tokenData.expiresAt}`);
    return;
  }

  // Load this user's posts
  let posts;
  try {
    posts = await store.get(`posts-${personId}`, { type: 'json' });
  } catch {
    posts = [];
  }
  if (!posts || !posts.length) return;

  // Find approved posts that are due
  let changed = false;

  for (const post of posts) {
    if (post.status !== 'approved') continue;
    if (!post.scheduledDate) continue;
    if (new Date(post.scheduledDate) > now) continue;

    console.log(`[cron] Publishing post ${post.id} for user ${personId}: "${post.topic}"`);

    try {
      const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author: tokenData.personUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text: post.text },
              shareMediaCategory: 'NONE',
            },
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        }),
      });

      if (res.ok) {
        post.status = 'published';
        post.publishedAt = now.toISOString();
        console.log(`[cron] Published OK: ${post.id}`);
      } else {
        const err = await res.text().catch(() => '');
        post.status = 'failed';
        post.error = `HTTP ${res.status}: ${err.slice(0, 200)}`;
        console.log(`[cron] Failed: ${post.id} — ${post.error}`);
      }
      changed = true;
    } catch (e) {
      post.status = 'failed';
      post.error = e.message;
      changed = true;
      console.log(`[cron] Error: ${post.id} — ${e.message}`);
    }
  }

  if (changed) {
    await store.setJSON(`posts-${personId}`, posts);
    console.log(`[cron] Updated posts for user ${personId}`);
  }
}

// Run at the top of every hour
module.exports.handler = schedule('0 * * * *', handler);
