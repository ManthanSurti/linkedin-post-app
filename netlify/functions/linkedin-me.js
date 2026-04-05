// Fetches the logged-in LinkedIn member's profile via OpenID Connect userinfo endpoint
// Proxied here to avoid browser CORS restrictions on api.linkedin.com
exports.handler = async (event) => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No token provided' }) };
  }

  try {
    // Use the OpenID Connect userinfo endpoint (works with "Sign In with LinkedIn using OpenID Connect")
    const res = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await res.json();

    if (!res.ok) {
      return { statusCode: res.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }

    // Map OpenID Connect fields to the format the frontend expects
    // userinfo returns: sub, name, given_name, family_name, picture, email, email_verified
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: data.sub,
        localizedFirstName: data.given_name || '',
        localizedLastName: data.family_name || '',
        name: data.name || '',
        picture: data.picture || '',
        email: data.email || '',
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
