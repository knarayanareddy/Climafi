import { NextResponse } from 'next/server'
import { REGIONS } from '../../../../lib/regions'

export async function GET() {
  return NextResponse.json(
    REGIONS.map((r) => ({
      region_id: r.id,
      region_id_u64: r.regionId,
      name: r.name,
      country: r.country,
      lat: r.lat,
      lon: r.lon,
    }))
  )
}
