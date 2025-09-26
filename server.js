// Express server for Cedarville–Canva Integration
//
// This server implements the OAuth 2.0 authorization code flow with PKCE to
// authenticate users with Canva and obtain an access token.  It also exposes
// REST endpoints that wrap key Canva Connect API endpoints: listing
// designs, retrieving a single design (to get its edit URL), and
// optionally importing designs from a URL.
//
// To use this server you need to register an integration in the Canva
// Developer Portal and set the corresponding environment variables in a
// `.env` file (see `.env.example`).  Start the server with `node server.js`.

const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const session = require('cookie-session');
const bodyParser = require('body-parser');

// Load environment variables.  In development you can create a `.env`
// file and use a package like `dotenv` to load it.  For simplicity we
// rely on process.env directly.
const {
  CANVA_CLIENT_ID,
  CANVA_CLIENT_SECRET,
  BASE_URL,
  REDIRECT_URI,
  SESSION_SECRET,
} = process.env;

if (!CANVA_CLIENT_ID || !CANVA_CLIENT_SECRET || !BASE_URL || !REDIRECT_URI) {
  console.warn('WARNING: One or more required environment variables are missing.');
  console.warn('Ensure CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, BASE_URL and REDIRECT_URI are set.');
}

const app = express();
app.use(bodyParser.json());

// Configure session handling.  This stores the authorization state,
// code_verifier and tokens in an encrypted cookie.  In production you
// should store tokens in a database keyed by the user.
app.use(
  session({
    name: 'cedarville-canva-session',
    keys: [SESSION_SECRET || 'dev-secret-key'],
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  })
);

// Step 1: Start the OAuth flow by redirecting to Canva's authorize endpoint.
app.get('/oauth/login', (req, res) => {
  // Generate a random state and code verifier for PKCE
  const state = crypto.randomBytes(24).toString('base64url');
  const codeVerifier = crypto.randomBytes(96).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  // Persist state and code verifier in the session
  req.session.oauthState = state;
  req.session.codeVerifier = codeVerifier;

  // Scope determines what the app can do.  Start with read‑only meta; add
  // additional scopes when you need them (e.g., design:content:read).
  const scopes = encodeURIComponent('design:meta:read');
  const authorizeUrl =
    'https://www.canva.com/api/oauth/authorize' +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(CANVA_CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
    '&scope=' + scopes +
    '&code_challenge=' + codeChallenge +
    '&code_challenge_method=s256' +
    '&state=' + state;

  res.redirect(authorizeUrl);
});

// Step 2: OAuth callback.  Canva redirects here after the user grants access.
// This route exchanges the authorization code for an access token.
app.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid OAuth state or missing code');
  }
  try {
    // Exchange authorization code for access and refresh tokens
    const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: req.session.codeVerifier,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('Failed to exchange code for token', tokenJson);
      return res.status(400).send('Failed to exchange code for token');
    }
    // Store tokens in the session; in production use a persistent store
    req.session.accessToken = tokenJson.access_token;
    req.session.refreshToken = tokenJson.refresh_token;
    req.session.expiresAt = Date.now() + tokenJson.expires_in * 1000;
    res.send('Authorization complete! You can close this tab and return to ChatGPT.');
  } catch (err) {
    console.error('OAuth callback error', err);
    res.status(500).send('OAuth callback error');
  }
});

// Middleware: Ensure we have a valid access token before calling Canva APIs.
async function requireAccessToken(req, res, next) {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated', authUrl: `${BASE_URL}/oauth/login` });
  }
  // TODO: implement token refresh when expired using refresh_token
  next();
}

// Endpoint: List designs.  Optionally filter by query (?q=searchTerm)
app.get('/designs', requireAccessToken, async (req, res) => {
  const query = req.query.q || '';
  try {
    const url = new URL('https://api.canva.com/rest/v1/designs');
    if (query) url.searchParams.set('query', query);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${req.session.accessToken}` },
    });
    const json = await response.json();
    res.status(response.status).json(json);
  } catch (err) {
    console.error('Error listing designs', err);
    res.status(500).json({ error: 'Error listing designs' });
  }
});

// Endpoint: Get a single design by ID; returns metadata including edit_url
app.get('/designs/:id', requireAccessToken, async (req, res) => {
  const { id } = req.params;
  try {
    const response = await fetch(`https://api.canva.com/rest/v1/designs/${id}`, {
      headers: { Authorization: `Bearer ${req.session.accessToken}` },
    });
    const json = await response.json();
    res.status(response.status).json(json);
  } catch (err) {
    console.error('Error fetching design', err);
    res.status(500).json({ error: 'Error fetching design' });
  }
});

// Optional Endpoint: Import a design from a URL.  This starts an import job.
app.post('/imports/url', requireAccessToken, async (req, res) => {
  const { fileUrl } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl is required' });
  try {
    const response = await fetch('https://api.canva.com/rest/v1/design-imports/url', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: fileUrl }),
    });
    const json = await response.json();
    res.status(response.status).json(json);
  } catch (err) {
    console.error('Error importing design', err);
    res.status(500).json({ error: 'Error importing design' });
  }
});

// Health check
app.get('/', (_, res) => {
  res.send('Cedarville–Canva Integration server is running');
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Cedarville–Canva Integration server listening on port ${port}`);
});
