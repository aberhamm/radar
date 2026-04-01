import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'repo-audit-agent',
  description: 'Live agent investigation dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </body>
    </html>
  );
}
