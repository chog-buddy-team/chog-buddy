# Deployments

| Network | Contract | Address | Admin (deployer) | Writer |
|---|---|---|---|---|
| Monad testnet (10143) | ChogSoul | `0xf9a7E0172a31235d99e3d93Adf33B36A39279EE4` | `0xf04f999a5854a72764793d41346C0C39C4B9C43E` | `0x35bB52996e5465de177efC5f220bb9Ab3bC6CC52` |

Keys are held in Foundry keystores (`chog-deployer`, `chog-writer`), never in `.env`.

## Backend API

| Environment | URL | Notes |
|---|---|---|
| Production (Vercel) | https://chog-buddy-api.vercel.app | Deployed with the Vercel CLI from `web/` (project `chog-buddy-api`). Daily Soul cron at 00:10 UTC. Secrets are Vercel Sensitive env vars. |
