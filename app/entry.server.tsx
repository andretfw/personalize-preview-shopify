import { renderToString } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { addDocumentResponseHeaders } from "./shopify.server";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);

  const markup = renderToString(
    <ServerRouter context={reactRouterContext} url={request.url} />,
  );

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");

  return new Response(`<!DOCTYPE html>${markup}`, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
