export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const event = {
    lot_id: "lot_1",
    available_spots: 70,
    hourly_rate: 16,
    updated_at: new Date().toISOString(),
  };
  res.write(`event: availability\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
}
