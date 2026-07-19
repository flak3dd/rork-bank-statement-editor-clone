# Google Document AI setup (Statement Lens)

## What the app needs

| Env var | Purpose |
|---------|---------|
| `VITE_GOOGLE_DOCAI_PROJECT` | GCP project id |
| `VITE_GOOGLE_DOCAI_LOCATION` | Region (`us` or `eu`) |
| `VITE_GOOGLE_DOCAI_PROCESSOR` | Processor id (not full path) |
| `VITE_GOOGLE_DOCAI_TOKEN` | OAuth access token (`Bearer`) |

Stored in `web/.env.local` (gitignored).

## Current workspace setup

- **Project:** `my-oauth-app-2026`
- **Location:** `us`
- **Bank Statement processor:** `f76ec843c1974666`
- **Form Parser (backup):** `3d75c8f15912e38`

## Refresh token (hourly)

Google user access tokens expire (~1 hour):

```bash
cd web && ./scripts/refresh-docai-token.sh
# then restart: npm run dev
```

## Create processors (console)

1. https://console.cloud.google.com/ai/document-ai  
2. Enable **Document AI API**  
3. Create **Bank Statement** or **Form Parser** processor  
4. Copy **Processor ID** into `.env.local`

## Use in the app

1. Restart Vite after env changes  
2. Upload screen → parser **Document AI**  
3. API status strip should show Document AI ready  
4. Tools → Doc AI for version admin

## Billing note

Document AI requires a billing-enabled project. Suspended projects return `CONSUMER_SUSPENDED`.
