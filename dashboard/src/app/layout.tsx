import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const code = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-code',
  weight: ['400', '500', '600'],
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
    <html lang="en" className={code.variable}>
      <body className="h-screen flex flex-col overflow-hidden">
        {children}
      </body>
    </html>
  );
}
