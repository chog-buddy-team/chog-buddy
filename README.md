# Chog Buddy

Your Chog NFT comes alive as a desktop pet that lives on your screen, reacts to your day, and grows a permanent onchain soul shaped by how you live.

Built for [Chogathon 2026](https://chogathon.chog.xyz/).

## What we're building

- **Pet:** connect your wallet, pick a Chog you own, and it drops onto your screen (Mac + Windows). It walks along the Dock/taskbar, perches on windows, and can be dragged.
- **Personality from Traits:** each Chog's Traits map to an Archetype, so two Chogs react differently to the same moment.
- **Reactions:** it notices which kind of app you're in, long sessions, idle returns, upcoming meetings and GitHub notifications, then comments in speech bubbles. Focus Mode makes it scold distractions.
- **Diary:** a private end-of-day summary of your day, kept only on your machine.
- **Soul:** four onchain Axes (Night Owl, Grinder, Social, Creator), plus Level and Owner Count, that drift with how you use your computer and stay with the Chog forever.
- **Later:** $CHOG Focus Bets, Chog Park, Judge Mode polish. Stretch: Chog visits, tips, Chog FC.

Read these first:
- [CONTEXT.md](CONTEXT.md): shared vocabulary. Use these words in code and chat.
- [docs/designs/chog-buddy.md](docs/designs/chog-buddy.md): full approved design (mechanics, API, platform notes, schedule).
- [docs/adr/](docs/adr/): decisions and why.

## Planned layout

```
app/        Electron desktop pet (frontend + local Activity tracking)
web/        Next.js on Vercel: SIWE auth, ownership check, LLM proxy, daily Soul cron, Chog Park
contracts/  ChogSoul (and later FocusPool) for Monad
```

## Team split

| Days | Frontend/backend | Backend/contracts |
|---|---|---|
| 1-5 | Electron Pet window, sprite, walking/drag/perch, Activity tracker, Categorizer, templated Reactions, Archetype table | `ChogSoul` + tests on Monad testnet, server wallet, Next.js API skeleton with SIWE + `ownerOf` check |
| 6-8 | Wire app to API: sign-in, Chog picker, Diary, Judge Mode, GitHub + Calendar | Daily Soul cron (batched), Diary endpoint, image proxy cache |
| 9-11 | Focus Bets UI, Chog Park page | `FocusPool`, mock $CHOG, settlement oracle |
| 12-14 | Polish, installers, demo video, submission | Deploy, verify contracts, docs |

## Key facts

- Chog Genesis: ERC-721 on Monad mainnet, `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`, 1,969 supply, not enumerable (use `ownerOf`).
- Metadata: `ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/<n>.json`. Always resolve through `tokenURI` because token IDs are shuffled. Gateway: `https://chog-genesis.mypinata.cloud/ipfs/`.
- $CHOG: `0x350035555E10d9AfAF1566AaebfCeD5BA6C27777`. **Unverified, so confirm onchain before use.**
- Budget: $0. Free tiers only.

## Open questions (ask in Chog Discord)

- Is testnet OK for judging?
- Are trait art layers available?
- What is the official $CHOG address?
