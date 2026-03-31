import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = process.env.JSS_EDITING_SECRET;
  if (req.query.secret !== secret) {
    return res.status(401).json({ message: 'Invalid secret' });
  }
  return res.status(200).json({ rendered: true });
}
