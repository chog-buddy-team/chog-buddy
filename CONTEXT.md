# Chog Buddy

A desktop companion that brings a Chog NFT to life on its owner's screen. It reacts to the owner's day and builds a lasting character tied to the token.

## Language

### The creature

**Chog**:
A Chog Genesis NFT (ERC-721 on Monad), identified by its token ID.
_Avoid_: NFT, token, character

**Pet**:
The animated on-screen embodiment of a Chog while it runs on an Owner's desktop.
_Avoid_: buddy, avatar, sprite (sprite is the image asset, not the concept)

**Active Chog**:
The single Chog an Owner has chosen to embody as their Pet right now. Only the Active Chog's Soul drifts.
_Avoid_: selected Chog, current pet

**Traits**:
The fixed attributes in a Chog's metadata (Eyes, Head, Body, Aura, Tier, etc.).
_Avoid_: properties, stats

**Archetype**:
The personality family a Chog belongs to, derived from its Traits. It decides the Pet's voice and reactions.
_Avoid_: personality type, class, mood

### Memory

**Soul**:
The public, onchain character of a Chog: its Axes, Level and Owner Count. Stays with the Chog when it changes hands.
_Avoid_: memory, profile, history

**Axis**:
One of four Soul dimensions scored 0-100: Night Owl / Early Bird, Grinder / Slacker, Social / Hermit, Creator / Consumer.
_Avoid_: stat, trait (Traits are fixed, Axes move)

**Drift**:
The daily change in a Soul's Axes, caused by the Owner's Activity. Capped per day.
_Avoid_: evolution, leveling

**Level**:
How many days a Chog has been an Active Chog, plus focus-streak bonuses. Cannot be bought.
_Avoid_: XP, rank

**Owner Count**:
How many different wallets have owned the Chog while it was an Active Chog.

**Diary**:
The private daily summary a Pet writes about its Owner's day. Belongs to the Owner, lives only on the Owner's machine, and is wiped when the Owner no longer holds the Chog.
_Avoid_: memory, log, journal

### The owner's day

**Owner**:
The wallet that currently holds a Chog, as proven by signing in.
_Avoid_: user, holder, player

**Activity**:
What the Owner is doing on their computer, reduced to Categories and durations. Never raw content.
_Avoid_: tracking, telemetry, usage

**Category**:
A coarse bucket of Activity: coding, design, chat, browsing, video, meeting, idle, or other.
_Avoid_: tag, type

**Reaction**:
Something the Pet says or does in response to a Trigger.
_Avoid_: message, notification, comment

**Trigger**:
An event that can cause a Reaction (switching Category, a long session, returning from idle, a meeting soon, a GitHub notification).
_Avoid_: event, hook

**Focus Mode**:
A state the Owner turns on, during which the Pet scolds visits to distracting Categories.

### Later phase

**Focus Bet**:
$CHOG an Owner stakes on reaching a daily focus goal, judged by their Pet's observed Activity.
_Avoid_: wager, challenge

**Focus Pool**:
The daily shared pot of Focus Bets. Owners who hit their goal split the stakes of those who missed.

**Poke**:
A random check-in from the Pet that the Owner must click to prove they are present.

**Chog Park**:
The public web page showing every active Pet's Soul and public mood line. Never shows Diary content.

**Judge Mode**:
A labeled, read-only way to run the team's demo Chog without owning one, for hackathon judges.
_Avoid_: demo mode, guest mode
