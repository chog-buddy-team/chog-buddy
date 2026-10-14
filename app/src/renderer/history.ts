import type { ChogApi } from '../preload';

declare global {
  interface Window { chog: ChogApi }
}

const title = document.getElementById('title') as HTMLHeadingElement;
const list = document.getElementById('list') as HTMLElement;

// textContent only, never innerHTML: chat text is untrusted (a model can echo anything back).
window.chog.onHistory(({ name, messages }) => {
  title.textContent = `Chats with ${name}`;
  list.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No chats yet. Click your Chog to talk!';
    list.append(empty);
    return;
  }
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
  window.scrollTo(0, document.body.scrollHeight);
});
