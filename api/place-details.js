export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const placeId = String(req.query.placeId || "").trim();
  const language = String(req.query.lang || "he");
  const sessionToken = String(req.query.sessionToken || "");
  if (!placeId) {
    res.status(400).json({ error: "placeId is required" });
    return;
  }
  if (!apiKey) {
    res.status(400).json({ error: "missing_api_key" });
    return;
  }

  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
    url.searchParams.set("languageCode", language === "en" ? "en" : "he");
    if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

    const response = await fetch(url.toString(), {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(400).json({ error: text || "place_details_failed" });
      return;
    }

    const data = await response.json();
    res.status(200).json({
      placeId: data.id,
      name: data.displayName?.text || data.formattedAddress || "",
      address: data.formattedAddress || "",
      lat: data.location?.latitude,
      lng: data.location?.longitude,
    });
  } catch (err) {
    res.status(400).json({ error: err?.message || "network_error" });
  }
}

