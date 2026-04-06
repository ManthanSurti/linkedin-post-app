// Runs every hour — checks for approved posts that are due and publishes them to LinkedIn
const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');

const handler = async (event) => {
  const store = getStore({ name: 'app-data', consistency: 'eventual' });

  // 1. Check for a valid LinkedIn token
  let tokenData;
  try {
    tokenData = await store.get('linkedin-token', { type: 'json' });
  } catch {
    console.log('[cron] No LinkedIn token found');
    return { statusCode: 200 };
  }

  if (!tokenData || !tokenData.token) {
    console.log('[cron] No token stored');
    return { statusCode: 200 };
  }
  if (new Date(tokenData.expiresAt) < new Date()) {
    console.log('[cron] Token expired at', tokenData.expiresAt);
    return { statusCode: 200 };
  }

  // 2. Get all posts
  let posts;
  try {
    posts = await store.get('posts', { type: 'json' });
  } catch {
    posts = [];
  }
  if (!posts || !posts.length) return { statusCode: 200 };

  // 3. Find approved posts that are due
  const now = new Date();
  let changed = false;

  for (const post of posts) {
    if (post.status !== 'approved') continue;
    if (!post.scheduledDate) continue;
    if (new Date(post.scheduledDate) > now) continue;

    console.log(`[cron] Publishing post ${post.id}: "${post.topic}"`);

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
    await store.setJSON('posts', posts);
    console.log('[cron] Updated post statuses');
  }

  return { statusCode: 200 };
};

// Run at the top of every hour
module.exports.handler = schedule('0 * * * *', handler);
