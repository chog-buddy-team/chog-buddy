import type { ChogApi, HistoryPayload } from '../preload';

declare global {
  interface Window { chog: ChogApi }
}

const title = document.getElementById('title') as HTMLHeadingElement;
const list = document.getElementById('list') as HTMLElement;
const tabs = { chats: document.getElementById('tab-chats') as HTMLButtonElement, diary: document.getElementById('tab-diary') as HTMLButtonElement };
let tab: keyof typeof tabs = 'chats';
let last: HistoryPayload | null = null;

function empty(text: string) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  list.append(p);
}

// textContent only, never innerHTML: chat and diary text is untrusted (a model can echo anything back).
function render() {
  for (const [k, b] of Object.entries(tabs)) b.setAttribute('aria-selected', String(k === tab));
  list.replaceChildren();
  if (!last) return;
  const { name, messages, diary } = last;
  if (tab === 'diary') {
    title.textContent = `${name}'s diary`;
    if (!diary.length) return empty('No diary entries yet. Your Chog writes one each evening.');
    for (const e of diary) {
      const card = document.createElement('article');
      card.className = 'entry';
      const h = document.createElement('h2');
      h.textContent = new Date(`${e.day}T12:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
      const text = document.createElement('div');
      text.textContent = e.text;
      card.append(h, text);
      list.append(card);
    }
    return;
  }
  title.textContent = `Chats with ${name}`;
  if (!messages.length) return empty('No chats yet. Click your Chog to talk!');
  for (const m of messages) {
    const bubble = document.createElement('div');
    bubble.className = `msg ${m.role === 'user' ? 'me' : 'chog'}`;
    const text = document.createElement('div');
    text.textContent = m.content;
    const time = document.createElement('time');
    time.textContent = new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    bubble.append(text, time);
    list.append(bubble);
  }
  if (follow) window.scrollTo(0, document.body.scrollHeight); // only when the reader was already at the bottom
}

for (const [k, b] of Object.entries(tabs)) b.addEventListener('click', () => { tab = k as keyof typeof tabs; window.scrollTo(0, 0); render(); });
let follow = true;
window.addEventListener('scroll', () => { follow = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40; });
window.chog.onHistory((p) => { last = p; render(); });
