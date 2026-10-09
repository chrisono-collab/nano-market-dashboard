// All confirmed against HaHa's API Reference in the haha-dashboard prototype.
// Paths are under hahaConfig.apiVersionPath (/open/api/v1) except obtainToken.
export const ENDPOINTS = {
  obtainToken: "/open/auth/token",
  marketList: "/markets",
  allRestockRecords: "/restock/records",
  restockOperationLogDetail: (marketId: string, opLogId: string | number) =>
    `/markets/${marketId}/restock/op-logs/${opLogId}`,
  planogram: (marketId: string) => `/markets/${marketId}/planograms`,
} as const;
