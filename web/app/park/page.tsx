import { loadPark } from '@/lib/park';
import s from './park.module.css';

export const revalidate = 300; // rebuild at most every 5 minutes
export const metadata = { title: 'Chog Park', description: 'Every active Chog Buddy, its onchain Soul and today’s focus leaderboard.' };

const AXES = [['nightOwl', 'Night owl'], ['grinder', 'Grinder'], ['social', 'Social'], ['creator', 'Creator']] as const;

export default async function Park() {
  let park: Awaited<ReturnType<typeof loadPark>> | null = null;
  try { park = await loadPark(); } catch (e) { console.error('chog park', e); park = null; }
  const contract = process.env.SOUL_CONTRACT;
  return (
    <main className={s.main}>
      <header className={s.header}>
        <h1>Chog Park</h1>
        <p>Every Chog living on someone’s desktop. Souls grow onchain from real days; diaries stay private.</p>
        {contract && <a href={`https://testnet.monadexplorer.com/address/${contract}`} target="_blank" rel="noopener noreferrer">ChogSoul contract on Monad testnet ↗</a>}
      </header>
      {!park ? <p className={s.empty}>The Park is closed for a moment. Try again soon.</p> : (
        <>
          <section className={s.board} aria-labelledby="lb">
            <h2 id="lb">Today’s focus leaderboard</h2>
            {park.leaderboard.length === 0 ? <p className={s.empty}>No focus minutes yet today.</p> : (
              <ol>{park.leaderboard.map((l) => <li key={l.tokenId}><span>{l.name}</span><b>{l.focusMinutes} min</b></li>)}</ol>
            )}
          </section>
          {park.chogs.length === 0 ? <p className={s.empty}>No Chogs in the Park yet. Install Chog Buddy and yours will show up here.</p> : (
            <ul className={s.grid}>
              {park.chogs.map((c) => (
                <li key={c.tokenId} className={s.card}>
                  {c.image ? <img src={c.image} alt={c.name} loading="lazy" width={96} height={96} /> : <div className={s.noimg} aria-hidden />}
                  <h3>{c.name}{c.demo && <span className={s.demo}>Demo</span>}</h3>
                  {c.archetypeName && <p className={s.arch}>{c.archetypeName}</p>}
                  <p className={s.mood}>“{c.mood}”</p>
                  {c.soul ? (
                    <>
                      <p className={s.level}>Level {c.soul.level}</p>
                      {AXES.map(([k, label]) => (
                        <div key={k} className={s.axis}>
                          <span>{label}</span>
                          <meter min={0} max={100} value={c.soul![k]} aria-label={`${label} ${c.soul![k]} of 100`} />
                        </div>
                      ))}
                    </>
                  ) : <p className={s.level}>Soul forming…</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
