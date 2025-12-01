const BASE_URL = 'http://65.108.206.214:4000';

export default async function handler(req: any, res: any) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path ?? '';
  const targetUrl = `${BASE_URL}/${path}`;
  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    };
    const response = await fetch(targetUrl, fetchOptions as any);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error: any) {
    res.status(502).json({ error: error.message ?? 'Proxy request failed' });
  }
}
