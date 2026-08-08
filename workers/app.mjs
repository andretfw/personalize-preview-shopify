import { createRequestHandler } from "react-router";
import * as build from "../build/server/index.js";

const requestHandler = createRequestHandler(build, "production");

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/assets/")) {
      return env.ASSETS.fetch(request);
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
};
