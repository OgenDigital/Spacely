import { getDriverSupplyMock } from "./_mockSupply.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const segment = String(req.query.segment || "").trim();
  const supply = getDriverSupplyMock(segment);
  res.status(200).json({
    data: supply,
    meta: {
      segment: segment || "all",
      source: "mock_adapter",
      updated_at: new Date().toISOString(),
    },
  });
}
