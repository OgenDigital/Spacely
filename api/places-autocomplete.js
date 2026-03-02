export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const q = String(req.query.q || "").trim();
  const language = String(req.query.lang || "he");
  const sessionToken = String(req.query.sessionToken || "");
  if (!q || q.length < 2) {
    res.status(200).json({ suggestions: [] });
    return;
  }
  const fallback = async () => {
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", q);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", "6");
      url.searchParams.set("countrycodes", "il");
      const r = await fetch(url.toString(), {
        headers: {
          "User-Agent": "SpaceLyDemo/1.0 (parking search demo)",
          Accept: "application/json",
        },
      });
      if (!r.ok) return [];
      const data = await r.json();
      return (Array.isArray(data) ? data : [])
        .map((x) => ({
          placeId: "",
          name: x.display_name || "",
          lat: Number(x.lat),
          lng: Number(x.lon),
        }))
        .filter((x) => x.name && Number.isFinite(x.lat) && Number.isFinite(x.lng));
    } catch {
      return [];
    }
  };

  if (!apiKey) {
    const suggestions = await fallback();
    res.status(200).json({ suggestions, provider: "osm_fallback" });
    return;
  }

  try {
    const body = {
      input: q,
      languageCode: language === "en" ? "en" : "he",
      regionCode: "IL",
      ...(sessionToken ? { sessionToken } : {}),
    };

    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const suggestions = await fallback();
      res.status(200).json({ suggestions, provider: "osm_fallback" });
      return;
    }

    const data = await response.json();
    const suggestions = (data.suggestions || [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        placeId: p.placeId,
        name: p.text?.text || "",
      }))
      .filter((x) => x.placeId && x.name);

    if (!suggestions.length) {
      const fallbackSuggestions = await fallback();
      res.status(200).json({ suggestions: fallbackSuggestions, provider: "osm_fallback" });
      return;
    }
    res.status(200).json({ suggestions, provider: "google_places" });
  } catch (err) {
    const suggestions = await fallback();
    res.status(200).json({ suggestions, provider: "osm_fallback", error: err?.message || "network_error" });
  }
}
