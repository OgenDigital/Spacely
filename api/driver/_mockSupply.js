const MOCK_SUPPLY = [
  {
    id: "lot_1",
    name: "SpaceLy Lot 1",
    address: "11 Demo Avenue",
    city: "Tel Aviv",
    location: { lat: 32.0839, lng: 34.7829 },
    segment_type: "structured",
    hourly_rate: 16,
    daily_max: 85,
    available_spots: 74,
    is_active: true,
    operating_hours: { open: "06:00", close: "23:59", is_24h: false },
  },
  {
    id: "lot_2",
    name: "TLV Blue&White Center",
    address: "23 Ibn Gabirol",
    city: "Tel Aviv",
    location: { lat: 32.0821, lng: 34.7812 },
    segment_type: "municipal_blue_white",
    hourly_rate: 12,
    daily_max: 70,
    available_spots: 31,
    is_active: true,
    operating_hours: { open: "07:00", close: "20:00", is_24h: false },
  },
  {
    id: "lot_3",
    name: "Private Spot - Arlozorov",
    address: "57 Arlozorov",
    city: "Tel Aviv",
    location: { lat: 32.0899, lng: 34.7811 },
    segment_type: "private_hourly",
    hourly_rate: 20,
    daily_max: 100,
    available_spots: 1,
    is_active: true,
    operating_hours: { open: "00:00", close: "23:59", is_24h: true },
  },
];

export function getDriverSupplyMock(segment = "") {
  if (!segment || segment === "all") return MOCK_SUPPLY;
  return MOCK_SUPPLY.filter((item) => item.segment_type === segment);
}

export function getDriverSupplyById(id) {
  return MOCK_SUPPLY.find((item) => item.id === id) || null;
}
