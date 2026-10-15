import type { Metadata } from 'next';
import { Bagel_Fat_One, JetBrains_Mono, Rubik } from 'next/font/google';
import './globals.css';

// Display: fat rounded sticker lettering. Body: Rubik. Labels: JetBrains Mono for sticker print codes (token ids, levels).
const display = Bagel_Fat_One({ variable: '--font-display', subsets: ['latin'], weight: '400' });
const body = Rubik({ variable: '--font-body', subsets: ['latin'] });
const mono = JetBrains_Mono({ variable: '--font-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Chog Buddy',
  description: 'Your Chog NFT, alive on your desktop. It reacts to your day, keeps a private diary and grows an onchain Soul.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
