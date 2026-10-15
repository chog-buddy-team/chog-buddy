import Link from 'next/link';
import ui from './ui/sticker.module.css';
import s from './page.module.css';

const RELEASES = 'https://github.com/faroukobayanju/chog-buddy/releases';

// The skin stickers scattered around the hero, each with its own short label sticker.
const SCATTER = [
  { img: 'chog-hoodie', alt: 'Chog in a blue hoodie, talking', label: 'Reacts to your day', spot: s.spotA },
  { img: 'chog-jacket', alt: 'Chog in a red jacket, eyes closed, writing', label: 'Keeps a private diary', spot: s.spotB },
  { img: 'chog-dress', alt: 'Chog in a lavender dress, cheering', label: 'Grows an onchain Soul', spot: s.spotC },
];

export default function Home() {
  return (
    <main className={`${ui.page} ${s.main}`}>
      <section className={s.hero}>
        <div className={s.copy}>
          <h1 className={`${ui.lettering} ${s.title}`}>Chog<br />Buddy</h1>
          <p className={s.hook}>Your Chog NFT, alive on your desktop.</p>
          <p className={s.sub}>A pixel Chog that walks your taskbar, reacts to your day, keeps a diary that never leaves your computer, and grows a Soul on Monad. No Chog, no buddy: the pet is the NFT.</p>
          <nav className={s.actions} aria-label="Get started">
            <a className={ui.btn} href={RELEASES} target="_blank" rel="noopener noreferrer">Get Chog Buddy</a>
            <Link className={ui.btnQuiet} href="/park">Visit Chog Park</Link>
          </nav>
          <p className={`${ui.label} ${s.platforms}`}>Mac + Windows · Free · Judge Mode included</p>
        </div>
        <div className={s.stage}>
          <img className={`${ui.cutout} ${s.heroChog}`} src="/chog/chog-classic.png" alt="The canonical pixel Chog: purple spiky hood, cream face, pink blush" width={256} height={376} />
          <p className={`${ui.sticker} ${s.bubble}`}>gm! I live on your taskbar now.</p>
          {SCATTER.map((t) => (
            <figure key={t.img} className={`${s.spot} ${t.spot}`}>
              <img className={ui.cutout} src={`/chog/${t.img}.png`} alt={t.alt} width={128} height={188} />
              <figcaption className={`${ui.sticker} ${s.tag}`}>{t.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <p className={`${ui.sticker} ${ui.peel} ${s.privacy}`}>
        <strong>Private by default.</strong> Only minutes per category (coding, video, meetings…) leave your computer. App names, window titles and the diary never do.
      </p>

      <footer className={`${ui.label} ${s.footer}`}>Chogathon 2026 · Chog Genesis on Monad · Souls on Monad testnet</footer>
    </main>
  );
}
