import { getDriverSupplyById } from "../_mockSupply.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const id = String(req.query.id || "").trim();
  const item = getDriverSupplyById(id);
  if (!item) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(200).json(item);
}
