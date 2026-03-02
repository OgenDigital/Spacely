export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || "";
  res.status(200).json({
    provider: apiKey ? "google_maps" : "leaflet_fallback",
    keyExists: Boolean(apiKey),
    apiKey,
  });
}
