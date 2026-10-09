import { hahaGet, sleep } from "./client";
import { ENDPOINTS } from "./endpoints";
import type {
  Market,
  MarketListData,
  PlanogramData,
  RestockOperationLogDetail,
  RestockRecord,
  RestockRecordListData,
} from "./types";

// HaHa quota is ~100 req/min per API type; keeps pagination loops well under it.
const LIST_PAGE_DELAY_MS = 200;

export async function getAllMarkets(): Promise<Market[]> {
  const { list } = await hahaGet<MarketListData>(ENDPOINTS.marketList, { page: 1, page_size: 100 });
  return list;
}

export function getPlanogram(marketId: string): Promise<PlanogramData> {
  return hahaGet<PlanogramData>(ENDPOINTS.planogram(marketId));
}

export function getRestockOperationLogDetail(
  marketId: string,
  restockOpLogId: string | number
): Promise<RestockOperationLogDetail> {
  return hahaGet<RestockOperationLogDetail>(
    ENDPOINTS.restockOperationLogDetail(marketId, restockOpLogId)
  );
}

/**
 * Fleet-wide restock records newer than `sinceCreatedAt`, grouped by marketId.
 * HaHa ignores the marketId query param on this endpoint (confirmed live), so
 * one fleet-wide walk serves every machine. Relies on the list being
 * newest-first (inferred from its id_desc cursor), so paging stops at the
 * first record at or before the watermark.
 */
export async function getRestockRecordsSince(sinceCreatedAt: string | null): Promise<RestockRecord[]> {
  const records: RestockRecord[] = [];
  const sinceMs = sinceCreatedAt ? new Date(sinceCreatedAt).getTime() : null;
  let page = 1;
  while (true) {
    const { list } = await hahaGet<RestockRecordListData>(ENDPOINTS.allRestockRecords, {
      page,
      page_size: 100,
    });
    if (list.length === 0) break;
    let hitWatermark = false;
    for (const r of list) {
      if (sinceMs !== null && new Date(r.createdAt).getTime() <= sinceMs) {
        hitWatermark = true;
        break;
      }
      records.push(r);
    }
    if (hitWatermark || list.length < 100) break;
    page += 1;
    await sleep(LIST_PAGE_DELAY_MS);
  }
  return records;
}
