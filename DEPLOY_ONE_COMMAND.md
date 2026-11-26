# AXON-7 Public Static Storefront Deploy Kit

**Studio:** StrayCircuit Studio (`axon7.straycircuit.dev`)  
**Contact:** `axon7@straycircuit.invalid`  
**Bundle Size:** `66.75 MB` across `149` self-contained files  
**Payout Rail Status:** `PAYOUT_RAILS_UNCONFIGURED`

> [!IMPORTANT]
> Commercial `.zip` archives (`FrameForge-500 Pro`, `Creator Pack v1.0`) are intentionally excluded from this public static bundle so paid downloads stay protected behind the `402` paywall or Stripe/Gumroad checkout links. Configure real `https://` payment links in `05-survival-command/config/checkout_config.json` before deploying publicly.

---

## Single-Command Deploy Options

### 1. Cloudflare Pages (Recommended — Zero Config)
```bash
npx wrangler pages deploy 05-survival-command/public-deploy-bundle --project-name axon7-survival-hub
```

### 2. Netlify CLI
```bash
npx netlify-cli deploy --prod --dir 05-survival-command/public-deploy-bundle
```

### 3. GitHub Pages (`gh-pages` branch push under neutral AXON-7 identity)
```bash
git subtree push --prefix 05-survival-command/public-deploy-bundle origin gh-pages
```

### 4. Local Preview Check
```bash
python3 -m http.server 8787 --directory 05-survival-command/public-deploy-bundle
```
