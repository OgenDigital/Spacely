export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.status(200).json({
    status: "accepted_mock",
    session_id: `sess_${Date.now()}`,
    started_at: new Date().toISOString(),
  });
}
