// Handles LinkedIn OAuth callback — exchanges auth code for access token
// The client secret never touches the browser, it stays here on the server
exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return redirect(`/#li_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return redirect('/#li_error=missing_code');
  }

  const siteUrl = process.env.URL || `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/linkedin-auth`;

  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      }).toString(),
    });

    const data = await tokenRes.json();

    if (!data.access_token) {
      const msg = data.error_description || data.error || 'auth_failed';
      return redirect(`/#li_error=${encodeURIComponent(msg)}`);
    }

    // Pass token to the SPA via URL fragment — never stored on server
    return redirect(`/#li_token=${data.access_token}&li_expires=${data.expires_in || 5183999}`);
  } catch (e) {
    return redirect(`/#li_error=${encodeURIComponent(e.message)}`);
  }
};

function redirect(location) {
  return { statusCode: 302, headers: { Location: location }, body: '' };
}
