import type { Metadata } from 'next';
import { JetBrains_Mono, Outfit } from 'next/font/google';
import './globals.css';

const code = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-code',
  weight: ['400', '500', '600'],
});

const brand = Outfit({
  subsets: ['latin'],
  variable: '--font-brand',
  weight: ['600', '700'],
});

export const metadata: Metadata = {
  title: 'Scout',
  description: 'AI-powered codebase investigation tool',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${code.variable} ${brand.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('scout-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');else if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})()` }} />
      </head>
      <body className="h-screen flex flex-col overflow-hidden">
        {children}
      </body>
    </html>
  );
}
