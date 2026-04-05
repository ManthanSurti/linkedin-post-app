// Returns public config to the frontend (client_id is safe to expose)
exports.handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify({
    clientId: process.env.LINKEDIN_CLIENT_ID,
  }),
});
