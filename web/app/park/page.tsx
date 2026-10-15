import Link from 'next/link';
import { loadPark } from '@/lib/park';
import ui from '../ui/sticker.module.css';
import { Arrow } from '../ui/Arrow';
import s from './park.module.css';

export const revalidate = 300; // rebuild at most every 5 minutes
export const metadata = { title: 'Chog Park', description: 'Every active Chog Buddy, its onchain Soul and today’s focus leaderboard.' };

const AXES = [['nightOwl', 'Night owl'], ['grinder', 'Grinder'], ['social', 'Social'], ['creator', 'Creator']] as const;
// A stable, slightly different tilt per sticker, so the album looks hand-placed.
const tilt = (id: number) => `${((id * 37) % 7) - 3}deg`;

export default async function Park() {
  let park: Awaited<ReturnType<typeof loadPark>> | null = null;
  try { park = await loadPark(); } catch (e) { console.error('chog park', e); park = null; }
  const contract = process.env.SOUL_CONTRACT;
  return (
    <main className={`${ui.page} ${s.main}`}>
      <div className={s.top}>
      <header className={s.header}>
        <Link href="/" className={`${ui.label} ${s.home}`}><Arrow /> Chog Buddy</Link>
        <h1 className={`${ui.lettering} ${s.title}`}>Chog Park</h1>
        <p className={s.intro}>Every Chog living on someone’s desktop this week. Souls grow onchain from real days. Diaries stay private, always.</p>
        {contract && <a className={`${ui.label} ${s.contract}`} href={`https://testnet.monadexplorer.com/address/${contract}`} target="_blank" rel="noopener noreferrer">ChogSoul contract on Monad testnet <Arrow dir="out" /></a>}
      </header>

      {park && (
          <section className={s.board} aria-labelledby="lb">
            <h2 id="lb" className={s.boardTitle}>Today’s focus leaderboard</h2>
            <p className={`${ui.label} ${s.boardNote}`}>Coding + design minutes · resets daily</p>
            {park.leaderboard.length === 0 ? <p className={s.boardEmpty}>No focus minutes yet today. Be the first.</p> : (
              <ol className={s.ranks}>
                {park.leaderboard.map((l, i) => (
                  <li key={l.tokenId}>
                    <span className={s.rank}>{i + 1}</span>
                    <span className={s.rankName}>{l.name}</span>
                    <b className={ui.label}>{l.focusMinutes} min</b>
                  </li>
                ))}
              </ol>
            )}
          </section>
      )}
      </div>

      {!park ? (
        <div className={s.blank}><p>The Park is closed for a moment. Try again soon.</p></div>
      ) : (
        <>
          {park.chogs.length === 0 ? (
            <div className={s.blank}><p>No Chogs in the Park yet. Install Chog Buddy and yours peels in here.</p></div>
          ) : (
            <ul className={s.album} aria-label="Active Chogs">
              {park.chogs.map((c) => (
                <li key={c.tokenId} className={s.slot} style={{ '--tilt': tilt(c.tokenId) } as React.CSSProperties}>
                  <article className={`${ui.sticker} ${s.chog}`}>
                    {c.image ? <img src={c.image} alt={c.name} loading="lazy" width={240} height={240} className={`${s.art} ${c.image.startsWith('/') ? s.pixel : ''}`} /> : <div className={s.noart} aria-hidden />}
                    <p className={s.mood}>{c.mood}</p>
                    <h3 className={s.name}>{c.name}{c.demo && <span className={`${ui.label} ${s.demo}`}>Demo</span>}</h3>
                    <p className={`${ui.label} ${s.code}`}>
                      <span>#{c.tokenId}</span>
                      {c.archetypeName && <span>{c.archetypeName}</span>}
                      <span>{c.soul ? `Lv ${c.soul.level}` : 'Soul forming'}</span>
                    </p>
                    {c.soul && (
                      <dl className={s.axes}>
                        {AXES.map(([k, label]) => (
                          <div key={k} className={s.axis}>
                            <dt>{label}</dt>
                            <dd><span className={s.bar} style={{ width: `${c.soul![k]}%` }} /><span className={`${ui.label} ${s.val}`}>{c.soul![k]}</span></dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </article>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
