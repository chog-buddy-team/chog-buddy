# Deployments

| Network | Contract | Address | Admin (deployer) | Writer |
|---|---|---|---|---|
| Monad testnet (10143) | ChogSoul | `0xf9a7E0172a31235d99e3d93Adf33B36A39279EE4` | `0xf04f999a5854a72764793d41346C0C39C4B9C43E` | `0x35bB52996e5465de177efC5f220bb9Ab3bC6CC52` |

## Focus Bets

| Network | Contract | Address | Owner | Settler |
|---|---|---|---|---|
| Monad testnet (10143) | MockChog (mCHOG) | `0x2B75E2E55E8F1F982dD7025ff0F8994abFAE176A` | `0xf04f999a5854a72764793d41346C0C39C4B9C43E` | |
| Monad testnet (10143) | FocusPool | `0x0ae1F74236af4767027ED5e34aFec17D97ec5007` | `0xf04f999a5854a72764793d41346C0C39C4B9C43E` | `0x6768b6Fb9a448e48f744eC113acC6da96a63f3Af` |

Both verified on Sourcify (exact match). Pot seeded with 100,000 mCHOG. The deploy script's last step (`fund`) ran out of gas on Monad (forge's estimate was too low) and was re-sent with `cast send --gas-limit 160000`.

Keys are held in Foundry keystores (`chog-deployer`, `chog-writer`, `chog-settler`), never in `.env`.

## Backend API

| Environment | URL | Notes |
|---|---|---|
| Production (Vercel) | https://chog-buddy-api.vercel.app | Deployed with the Vercel CLI from `web/` (project `chog-buddy-api`). Daily Soul cron at 00:10 UTC. Secrets are Vercel Sensitive env vars. |
