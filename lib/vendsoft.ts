const VENDSOFT_BASE = 'https://secure.vendsoft.com/api/v2'
const API_KEY = process.env.VENDSOFT_API_KEY!

export interface Machine {
  machineCode: string
  machineName: string
  locationName: string
  locationCode: string
}

export interface SalesSummary {
  machineCode: string
  machineName: string
  locationName: string
  totalAmount: number
  totalTransactions: number
}

export interface DateRange {
  from: string // YYYY-MM-DD
  to: string
}

async function vsGet(path: string) {
  const res = await fetch(`${VENDSOFT_BASE}${path}`, {
    headers: { api_key: API_KEY },
    next: { revalidate: 0 },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`VendSoft ${path} → ${res.status}: ${text}`)
  }
  return res.json()
}

export async function getMachines(): Promise<Machine[]> {
  const data = await vsGet('/machines')
  // Normalize — VendSoft returns array or wrapped object
  const list = Array.isArray(data) ? data : data.machines ?? data.data ?? []
  return list.map((m: any) => ({
    machineCode: m.machineCode ?? m.MachineCode ?? m.code,
    machineName: m.machineName ?? m.MachineName ?? m.name,
    locationName: m.locationName ?? m.LocationName ?? m.location ?? '',
    locationCode: m.locationCode ?? m.LocationCode ?? '',
  }))
}

export async function getMachineSales(
  machineCode: string,
  range: DateRange
): Promise<{ amount: number; transactions: number }> {
  try {
    const data = await vsGet(
      `/machines/${machineCode}/sales?from=${range.from}&to=${range.to}`
    )
    // Normalize various response shapes
    const amount =
      data.totalAmount ?? data.TotalAmount ?? data.total ?? data.revenue ?? 0
    const transactions =
      data.totalTransactions ??
      data.TotalTransactions ??
      data.transactions ??
      data.count ??
      (Array.isArray(data) ? data.length : 0)
    return { amount: Number(amount), transactions: Number(transactions) }
  } catch {
    return { amount: 0, transactions: 0 }
  }
}

export async function getAllLocationsSales(range: DateRange): Promise<SalesSummary[]> {
  const machines = await getMachines()
  const results = await Promise.allSettled(
    machines.map(async (m) => {
      const sales = await getMachineSales(m.machineCode, range)
      return {
        machineCode: m.machineCode,
        machineName: m.machineName,
        locationName: m.locationName || m.machineName,
        ...sales,
      }
    })
  )
  return results
    .filter((r): r is PromiseFulfilledResult<SalesSummary> => r.status === 'fulfilled')
    .map((r) => r.value)
}
