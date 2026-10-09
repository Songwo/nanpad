const ENDPOINTS = new Set([
  "https://connect.linux.do/oauth2/token",
  "https://connect.linux.do/api/user",
]);

function proxyAddress(value) {
  if (value === undefined || value === null || value === "") return null;
  const invalid = () => new Error("OUTBOUND_PROXY_URL 必须是无凭据的本机 HTTP 代理地址。");
  if (typeof value !== "string" || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/?$/.test(value))
    throw invalid();
  let address;
  try {
    address = new URL(value);
  } catch {
    throw invalid();
  }
  if (Number(address.port) < 1024 || Number(address.port) > 65535) throw invalid();
  return address.origin;
}

/** 代理仅供本服务的官方身份接口使用，不修改全局网络配置。 */
export async function createProxiedFetch(
  proxyUrl,
  { fetchImpl = fetch, loadUndici = () => import("undici") } = {},
) {
  const address = proxyAddress(proxyUrl);
  let dispatcher;
  let send = fetchImpl;
  if (address) {
    const undici = await loadUndici();
    dispatcher = new undici.ProxyAgent({
      uri: address,
      requestTls: { rejectUnauthorized: true },
    });
    send = undici.fetch;
  }
  let closing;
  return {
    async fetch(url, options = {}) {
      if (!ENDPOINTS.has(url)) throw new Error("登录上游请求目标无效。");
      return send(url, {
        ...options,
        redirect: "error",
        credentials: "omit",
        dispatcher,
      });
    },
    close() {
      closing ??= dispatcher ? dispatcher.close() : Promise.resolve();
      return closing;
    },
  };
}
