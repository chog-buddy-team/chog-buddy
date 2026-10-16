# Roadmap

Chog Buddy v0.1 is what we shipped for Chogathon 2026: the desktop Pet, the onchain Soul, the private Diary, Chog Park and Focus Bets. This page covers where it goes next, and why. Every item keeps the rule the project started with: **the Chog NFT has to be essential**, never decoration.

![Roadmap](diagrams/roadmap.png)

<sub>Source: [diagrams/roadmap.mmd](diagrams/roadmap.mmd), editable as [roadmap.excalidraw](diagrams/roadmap.excalidraw)</sub>

## Next: make what exists easier to trust

| Plan | Why |
|---|---|
| **Signed and notarized installers** | Today macOS and Windows warn about an unknown developer, because signing certificates cost money and this was a $0 build ([ADR 0003](adr/0003-unsigned-installers-no-web-fallback.md)). An Apple Developer ID and a Windows code-signing certificate remove the warning. The one-line macOS installer is the stopgap. |
| **Auto-update** | The release already publishes `latest.yml` for Windows. Wiring in `electron-updater` means holders get fixes without reinstalling. |
| **Bring your own Claude or OpenAI key** | Chat works for free through our server today, or with Ollama or a Gemini key. Adding Anthropic and OpenAI keys is one small provider file each, stored encrypted like the Gemini key. |
| **Chog Park opt-out** | The Park shows every Chog that uploaded this week. A tray toggle lets an owner hide their Chog without giving up the Soul. |
| **Live mainnet Soul viewer** | A page per token, `/chog/<id>`, showing the Soul's history over time, so a buyer can see the Chog's past before trading. |

## Soon: deeper intelligence, still private

| Plan | Why |
|---|---|
| **MCP server for Claude Desktop** | The Pet becomes a set of tools Claude can use: "How was my day? Ask my Chog." Claude reads the local Diary and today's category minutes, and can make the Chog speak on your desktop. It runs locally over stdio, so nothing goes through our server. ChatGPT only accepts remote connectors, so it comes later and needs a privacy design of its own. |
| **Offline brain** | An optional download (around 400 MB) of a small local model that runs inside the app. That means chat, diary and flavour lines with no internet and no account. Ollama users already have this; this makes it one click. |
| **Owner-signed Soul updates** | Today the server is the only Soul writer ([ADR 0002](adr/0002-server-is-sole-soul-writer.md)), which keeps it cheap and consistent. Next, the owner's wallet co-signs each daily update, so the Soul is provably the holder's own history and not just our server's claim. |
| **Weekly Soul recap** | A shareable card every week ("Grinder +6, Night Owl −3, Level 14") posted from the Park. Social proof that the NFT is alive. |

## Later: new bodies for the Chog

| Plan | Why |
|---|---|
| **3D Chog** | A rigged 3D model of the canonical Chog, built from the official art (purple spiky hood, cream face, blush). It renders with Three.js in the same transparent window. Skins become 3D outfits, and **My NFT skin** maps your traits to 3D accessories. We tried generating 3D from the NFT images early on, but the NFTs are cropped busts that can't be reconstructed reliably. A uniform model with trait-driven accessories is the approach that holds up across all 1,969 tokens. The pixel Chog stays as the default and the low-power option. |
| **Phone companion** | A Chog widget for iOS and Android that shows the Soul, today's mood line and a Focus Bet countdown. iOS doesn't let apps see what you do in other apps, so on phones the Chog reacts to Focus modes and Shortcuts instead of reading apps. Android can use usage stats with permission. |
| **Chog visits and tips** | Your Chog walks onto a friend's desktop for a visit, carrying its Soul with it. Friends can tip a Chog in $CHOG for a streak or a win. |
| **More skins and trait art** | If the Chog team shares trait art layers, the NFT skin can use the real hat and outfit art instead of matching it with our own pixel drawings. |

## Big bets

| Plan | Why |
|---|---|
| **Chog FC** | Chogs form clubs and play matches whose results come from their Souls: Grinders train harder, Social Chogs pass better. It needs the Soul to have real history first, which the daily updates are building now. |
| **Real $CHOG Focus Bets on mainnet** | Focus Bets run on Monad testnet with mock $CHOG today. Moving to real $CHOG needs a contract audit, an anti-cheat review of self-reported focus, and the official token address confirmed. |
| **Soul on mainnet** | The Soul moves from testnet to Monad mainnet next to Chog Genesis itself, so it shows in wallets and marketplaces. |

## Known gaps we'll close along the way

- Calendar warnings handle daily and weekly repeats, but not monthly or yearly ones.
- GitHub reactions stop counting past 50 unread notifications.
- Chog Park fetches metadata per Chog and slows down past about 200 active Chogs. The fix is to cache metadata in the database.
- Ctrl+Shift+Space can clash with keyboard-layout switching on some Windows setups. The shortcut should be configurable.

Have an idea? Open an issue at [chog-buddy-team/chog-buddy](https://github.com/chog-buddy-team/chog-buddy/issues).
