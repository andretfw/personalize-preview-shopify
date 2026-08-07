import { createRequestHandler } from "react-router";
import * as build from "../build/server/index.js";

const requestHandler = createRequestHandler(build, "production");

export default {
  fetch(request) {
    return requestHandler(request);
  },
};
