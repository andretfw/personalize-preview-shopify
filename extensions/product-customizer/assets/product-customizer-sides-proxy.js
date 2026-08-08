(() => {
  const SIDES_PATH = "/apps/personalize-preview/sides";
  const PROXY_PATH = "/apps/personalize-preview";
  const nativeFetch = window.fetch.bind(window);

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url || "";
  }

  window.fetch = async (input, init) => {
    const rawUrl = requestUrl(input);
    let pathname = "";

    try {
      pathname = new URL(rawUrl, window.location.origin).pathname;
    } catch {
      pathname = rawUrl;
    }

    if (pathname !== SIDES_PATH) {
      return nativeFetch(input, init);
    }

    let productId = "";
    try {
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      productId = typeof body?.productId === "string" ? body.productId : "";
    } catch {
      // The normal side loader will surface the invalid response.
    }

    const response = await nativeFetch(PROXY_PATH, {
      ...init,
      method: "POST",
      credentials: "same-origin",
      headers: {
        ...(init?.headers || {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ action: "config", productId }),
    });

    let payload = null;
    try {
      payload = await response.clone().json();
    } catch {
      return response;
    }

    if (!payload?.ok || !payload?.config) {
      return response;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        front: payload.config.front || null,
        back: payload.config.back || null,
      }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  };
})();
