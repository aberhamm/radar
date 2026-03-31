import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const apiKey = process.env.SITECORE_API_KEY;
  if (!apiKey) {
    return NextResponse.redirect(new URL('/error', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
