import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CatchAllPage({
  params,
}: {
  params: { site: string; locale: string; path?: string[] };
}) {
  return <div>Page</div>;
}
