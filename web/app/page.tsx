import Link from 'next/link';
import s from './page.module.css';

export default function Home() {
  return (
    <main className={s.main}>
      <h1>Chog Buddy</h1>
      <p>Your Chog NFT, alive on your desktop. It reacts to your day, keeps a private diary and grows an onchain Soul.</p>
      <nav className={s.links}>
        <Link className={s.primary} href="/park">Visit Chog Park</Link>
        <a href="https://github.com/faroukobayanju/chog-buddy" target="_blank" rel="noopener noreferrer">Get the app</a>
      </nav>
    </main>
  );
}
