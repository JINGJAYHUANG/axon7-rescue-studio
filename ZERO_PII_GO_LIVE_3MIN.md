# AXON-7 Zero-PII 3-Minute Public Go-Live Guide

**Brand:** AXON-7 // StrayCircuit Studio (`axon7.straycircuit.dev`)  
**Contact:** `axon7@straycircuit.invalid`  
**Privacy Guarantee:** Zero personal names, emails, tokens, or host paths inside any shipped artifact.

---

## Minute 1 — Configure Neutral Checkout Links

1. Create Stripe Payment Links (or LemonSqueezy / Gumroad / Ko-fi products) under your neutral business profile (`StrayCircuit Studio`):
   - **FrameForge-500 v3.0 Solo / WebGL Studio Pro (`$29`)**
   - **FrameForge-500 v3.0 Studio (`$79`)**
   - **AXON-7 Creator Pack v2.0 (`$19`)**
   - **24h Viral Video Rescue (`$49` Starter / `$149` Growth)**
2. Paste those `https://` links into:
   - `05-survival-command/LAUNCH_IGNITION.json` (used by the static WebGL2 SaaS Studio checkout modal)
   - `05-survival-command/config/checkout_config.json` (or `POST http://127.0.0.1:8707/api/checkout/config`)

---

## Minute 2 — Deploy Zero-Backend WebGL2 Studio & Storefront

Upload `05-survival-command/public-static-saas/` (or `05-survival-command/dist/axon7-public-web-saas-v3.0.zip`) using any static host with zero server runtime required:

```bash
# Option A: Cloudflare Pages
npx wrangler pages deploy 05-survival-command/public-static-saas --project-name axon7-rescue-studio

# Option B: Netlify Drop / CLI
npx netlify-cli deploy --prod --dir 05-survival-command/public-static-saas

# Option C: Local Full-Stack M5 Metal Rescue Server (port 8707)
05-survival-command/.venv/bin/uvicorn server.axon7_app:app --app-dir 05-survival-command --host 127.0.0.1 --port 8707
```

---

## Minute 3 — Fulfill Licenses, Send 10 Deal Pitches & Submit Bounties

1. **Issue deterministic HMAC-SHA256 customer license keys** upon checkout webhook/confirmation:
   ```bash
   05-survival-command/.venv/bin/python 05-survival-command/server/license_tool.py issue --sku PRO --order STRIPE-1001
   ```
   Customers paste their `AXON7-PRO-...` key into the WebGL Studio (`/studio`) to unlock unwatermarked 1080p60 export, or pass `?license_key=...` to `/api/download/frameforge-pro-v3.0.zip`.

2. **Dispatch the 10 proof-backed outbound deal pitches** generated in:
   - `04-monetization-engines/outbound-deals/OUTBOUND_CLOSING_KIT.md`
   - `04-monetization-engines/outbound-deals/pitches/deal_01.html .. deal_10.html`

3. **Dry-run and publish open-source bounty PRs** with an isolated bot token (`AXON7_GITHUB_TOKEN`, never personal `gh` credentials):
   ```bash
   04-monetization-engines/.venv/bin/python 04-monetization-engines/bounties/submit_ready/publish_prs.py --dry-run
   ```
