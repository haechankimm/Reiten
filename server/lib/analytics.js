/* Google Analytics 4 방문자 통계 조회(선택 기능) — GA4_SERVICE_ACCOUNT_JSON/GA4_PROPERTY_ID가
   .env에 없으면 client가 null로 남고 getVisitorStats()는 항상 null을 반환한다. 호출부(server.js)는
   그 null을 그대로 클라이언트에 내려주고, Works 대시보드는 null이면 그 섹션만 숨긴다(PortOne 등
   다른 선택 연동과 같은 "설정 안 하면 조용히 꺼짐" 패턴). */
const { BetaAnalyticsDataClient } = require("@google-analytics/data");

let client = null;
if (process.env.GA4_SERVICE_ACCOUNT_JSON && process.env.GA4_PROPERTY_ID) {
  try {
    const credentials = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON);
    client = new BetaAnalyticsDataClient({ credentials });
  } catch (e) {
    console.error("[analytics] GA4_SERVICE_ACCOUNT_JSON 파싱 실패:", e.message);
  }
}

async function getVisitorStats(days = 30) {
  if (!client) return null;

  const property = `properties/${process.env.GA4_PROPERTY_ID}`;
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "today" }];

  const [[deviceReport], [sourceReport]] = await Promise.all([
    client.runReport({
      property,
      dateRanges,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }],
    }),
    client.runReport({
      property,
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    }),
  ]);

  return {
    days,
    byDevice: (deviceReport.rows || []).map((r) => ({
      device: r.dimensionValues[0].value,
      users: Number(r.metricValues[0].value),
    })),
    bySource: (sourceReport.rows || []).map((r) => ({
      source: r.dimensionValues[0].value,
      sessions: Number(r.metricValues[0].value),
    })),
  };
}

module.exports = { getVisitorStats };
