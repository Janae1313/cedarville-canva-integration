# Cedarville–Canva Integration

This repository contains a simple Node/Express server that bridges
ChatGPT with the Canva Connect APIs.  It implements the OAuth 2.0
authorization code flow with PKCE to authenticate users against Canva and
provides a few endpoints that let you list your Canva designs, fetch
details for a specific design (including the temporary edit link) and
optionally import a design from a URL.

The goal of this project is to allow Cedarville University’s Women’s
Basketball staff to search for Canva templates and open them for
editing directly from a custom GPT.  The server encapsulates all
authorization logic so your GPT never needs to store secrets.

## Features

- **OAuth 2.0 with PKCE** – Securely obtains access and refresh tokens from
  Canva.  Tokens are stored in an encrypted cookie.
- **Design search** – `GET /designs?q=searchTerm` calls the
  [List designs](https://www.canva.dev/docs/connect-api/reference/rest/v1/designs/#operation/Designs_List)
  endpoint to search for templates in your account.
- **Fetch design metadata** – `GET /designs/:id` calls the
  [Get design](https://www.canva.dev/docs/connect-api/reference/rest/v1/designs/#operation/Designs_Get)
  endpoint and returns metadata including `urls.edit_url` – a
  temporary link you can open in Canva’s editor.
- **Import design from URL** – `POST /imports/url` wraps the
  [Import from URL](https://www.canva.dev/docs/connect-api/reference/rest/v1/design-imports/#operation/Imports_Design_FromUrl)
  endpoint.  Use this to generate new designs based on external files.

## Prerequisites

- Node.js v18+ installed on your local machine.
- A Canva developer account with an integration registered in the
  Developer Portal.  Record your **Client ID**, **Client Secret** and
  configure a **redirect URI** that points to `/oauth/callback` on
  your server (e.g. `http://127.0.0.1:3000/oauth/callback`).
- (Optional) A publicly accessible HTTPS endpoint if you plan to use
  this server with a custom GPT.  You can start with a local tunnel
  using ngrok while testing.

## Getting Started

1. **Clone the repository.**

   ```bash
   git clone https://github.com/your‑username/cedarville-canva-integration.git
   cd cedarville-canva-integration
   ```

2. **Install dependencies.**

   ```bash
   npm install
   ```

3. **Configure environment variables.**  Copy `.env.example` to `.env`
   and fill in your Canva Client ID, Client Secret, Base URL and
   Redirect URI.

   ```bash
   cp .env.example .env
   # edit .env with your credentials
   ```

4. **Run the server.**

   ```bash
   node server.js
   ```

5. **Authorize with Canva.**  In a browser, navigate to
   `http://127.0.0.1:3000/oauth/login`.  Canva will prompt you to log
   in and authorize the integration.  After authorization you will see
   a confirmation message; you can close the tab.

6. **Make API calls.**  Once authorized you can call the endpoints with
   your preferred HTTP client (e.g. cURL, Postman) or from your GPT
   Action.  For example:

   ```bash
   curl http://127.0.0.1:3000/designs?q=basketball

   curl http://127.0.0.1:3000/designs/DAGiMoGkG1s

   curl -X POST http://127.0.0.1:3000/imports/url \
     -H "Content-Type: application/json" \
     -d '{"fileUrl":"https://example.com/graphic.png"}'
   ```

## Using with a Custom GPT

When configuring an Action for your custom GPT, set the **Base URL**
to your deployed server.  Define endpoints in the OpenAPI schema as
follows:

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Cedarville–Canva Bridge", "version": "1.0.0" },
  "servers": [{ "url": "https://your-host.example.com" }],
  "paths": {
    "/designs": {
      "get": {
        "operationId": "searchDesigns",
        "parameters": [
          { "in": "query", "name": "q", "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "OK" } }
      }
    },
    "/designs/{id}": {
      "get": {
        "operationId": "getDesign",
        "parameters": [
          { "in": "path", "name": "id", "required": true, "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "OK" } }
      }
    },
    "/imports/url": {
      "post": {
        "operationId": "importDesignFromUrl",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": { "fileUrl": { "type": "string", "format": "uri" } },
                "required": ["fileUrl"]
              }
            }
          }
        },
        "responses": { "200": { "description": "OK" } }
      }
    }
  }
}
```

If a user hasn’t authenticated yet, the server will return a 401 response
with an `authUrl` pointing to `/oauth/login`.  Your GPT can show this
link to the user, who will click it once to authorize the integration.

## Security Notes

- **Do not commit your Canva Client Secret** to the repository.  Use a
  `.env` file or your hosting platform’s secret store.
- The tokens returned by Canva expire after a few hours.  To keep the
  session alive in production, implement a token refresh flow using the
  `refresh_token` (left as a TODO in `server.js`).
- Limit the scopes requested to only those your application requires.

## License

This project is provided under the MIT License.  See the
[`LICENSE`](LICENSE) file for details.
