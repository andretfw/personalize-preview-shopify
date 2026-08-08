import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { addDocumentResponseHeaders } from "./shopify.server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);

  let didError = false;
  const stream = await renderToReadableStream(
    <ServerRouter context={reactRouterContext} url={request.url} />,
    {
      onError(error) {
        didError = true;
        console.error(error);
      },
    },
  );

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");

  return new Response(stream, {
    headers: responseHeaders,
    status: didError ? 500 : responseStatusCode,
  });
}
