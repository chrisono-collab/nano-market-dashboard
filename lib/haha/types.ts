export interface HahaEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

export interface TokenData {
  token: string;
  token_type?: string;
  // Unix timestamp in SECONDS (not ISO string, unlike other timestamps in this API).
  expires_at: number;
}

export interface Market {
  marketId: string;
  marketName: string;
  [key: string]: unknown;
}

export interface MarketListData {
  total: number;
  list: Market[];
  [key: string]: unknown;
}

export interface PlanogramCell {
  rowIndex: number;
  columnIndex: number;
  productId: string | null;
  productName: string | null;
  productsCapacity: number;
  [key: string]: unknown;
}

export interface PlanogramRack {
  cells: PlanogramCell[];
  [key: string]: unknown;
}

export interface PlanogramData {
  marketId: string;
  racks: PlanogramRack[];
  lastChangeDtm: string;
  [key: string]: unknown;
}

export interface RestockRecord {
  restockOpLogId: string | number;
  marketId: string;
  // Confirmed live: the list endpoint uses createdAt, NOT operatedAt — that
  // field only exists on the Detail response (RestockOperationLogDetail
  // below). A prior version of this type wrongly declared operatedAt here,
  // which silently broke the oldest-first sort in placement.ts (comparing
  // undefined dates always returns NaN, so the sort was a no-op).
  createdAt: string;
  [key: string]: unknown;
}

export interface RestockRecordListData {
  total: number;
  list: RestockRecord[];
  [key: string]: unknown;
}

export interface ProductChange {
  productId: string;
  productName: string;
  barCode?: string;
  changeNum: number;
  afterNum: number;
  [key: string]: unknown;
}

// GET /open/api/v1/inventory/products is catalogue-wide, not market-scoped —
// each product carries a `markets[]` array with one entry per machine it's
// stocked in, which is what lets us derive per-machine stock (see
// getInventoryForMarket in api.ts).
export interface InventoryMarketEntry {
  marketId: string;
  marketName: string;
  stock: number;
  racks: { name: string; stock: number }[];
  [key: string]: unknown;
}

export interface InventoryItem {
  productId: string;
  productCode?: string;
  productName: string;
  productImage?: string;
  totalStock: number;
  marketCount: number;
  markets: InventoryMarketEntry[];
  [key: string]: unknown;
}

export interface ProductInventoryListData {
  total: number;
  page: number;
  page_size: number;
  next_cursor?: string;
  list: InventoryItem[];
  [key: string]: unknown;
}

// Derived, per-machine view produced by getInventoryForMarket — one entry per
// product actually stocked in the given machine, with that machine's stock.
export interface MarketInventoryItem {
  productId: string;
  productName: string;
  stock: number;
  racks: { name: string; stock: number }[];
}

export interface RestockOperationLogDetail {
  marketId: string;
  marketName: string;
  operatedAt: string;
  operationType: number;
  operationTypeLabel: string;
  restockType: number;
  restockTypeLabel: string;
  productChanges: ProductChange[];
  recordId: number;
  [key: string]: unknown;
}
