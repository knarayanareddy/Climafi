// Single source of truth for the region registry.
//
// `regionId` is the on-chain u64 identifier used in Quote.region_id and
// ObservationSnapshot.region_id. The oracle aggregator (offchain/oracle-aggregator.ts)
// must post observations under the SAME u64 ids so settlement can find them.

export interface Region {
  id: string        // human-readable id, e.g. 'KEN-NRB-001'
  regionId: number  // on-chain u64 region id
  name: string
  country: string
  lat: number
  lon: number
}

export const REGIONS: Region[] = [
  { id: 'KEN-NRB-001', regionId: 1, name: 'Nairobi, Kenya', country: 'Kenya', lat: -1.2921, lon: 36.8219 },
  { id: 'IND-MUM-001', regionId: 2, name: 'Mumbai, India', country: 'India', lat: 19.076, lon: 72.8777 },
  { id: 'PHL-MNL-001', regionId: 3, name: 'Manila, Philippines', country: 'Philippines', lat: 14.5995, lon: 120.9842 },
  { id: 'BRA-SPO-001', regionId: 4, name: 'São Paulo, Brazil', country: 'Brazil', lat: -23.55, lon: -46.63 },
  { id: 'ETH-ADD-001', regionId: 5, name: 'Addis Ababa, Ethiopia', country: 'Ethiopia', lat: 9.01, lon: 38.75 },
  { id: 'BGD-DHK-001', regionId: 6, name: 'Dhaka, Bangladesh', country: 'Bangladesh', lat: 23.81, lon: 90.41 },
]

export function getRegionById(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id)
}

export function getRegionByU64(regionId: number): Region | undefined {
  return REGIONS.find((r) => r.regionId === regionId)
}
