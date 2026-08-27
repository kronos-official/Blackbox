import { ENV } from "../server/_core/env.ts";

const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
const url = new URL("images.v1.ImageService/ListModels", baseUrl).toString();
const response = await fetch(url, {
  method: "POST",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
    "connect-protocol-version": "1",
    authorization: `Bearer ${ENV.forgeApiKey}`,
  },
  body: "{}",
});
console.log(JSON.stringify({ status: response.status, body: await response.text() }, null, 2));
