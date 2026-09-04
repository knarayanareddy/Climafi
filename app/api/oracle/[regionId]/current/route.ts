import { NextResponse } from 'next/server'
import { getRegionById, getRegionByU64 } from '../../../../../lib/regions'

export async function GET(
  _request: Request,
  { params }: { params: { regionId: string } }
) {
  const id = params.regionId
  const region = getRegionById(id) ?? getRegionByU64(Number(id))
  if (!region) {
    return NextResponse.json({ error: `Unknown region: ${id}` }, { status: 404 })
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${region.lat}&longitude=${region.lon}` +
      `&daily=precipitation_sum&start_date=${today}&end_date=${today}&timezone=UTC`
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`)
    }
    const data = await res.json()
    const mm: number = data?.daily?.precipitation_sum?.[0] ?? 0

    return NextResponse.json({
      regionId: region.id,
      region_id_u64: region.regionId,
      name: region.name,
      date: today,
      rain_mm: mm,
      rain_mm_x100: Math.round(mm * 100),
      source: 'open-meteo',
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
