export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = "cdn.vocadesk.com";

    const originRequest = new Request(url, request);
    originRequest.headers.set("Host", "cdn.vocadesk.com");

    return fetch(originRequest);
  },
};
