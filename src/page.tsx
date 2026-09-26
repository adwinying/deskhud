export const Page = ({ children }: { children: JSX.Element }) => (
  <>
    {"<!doctype html>"}
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Already dark: stops Android WebView auto-dark from inverting white/black. */}
        <meta name="color-scheme" content="dark" />
        <title>deskhud</title>
        <style>
          {`[un-cloak] { display: none; }
          /* The drift must not make the page pannable sideways. */
          html { overflow-x: clip; }
          body {
            font-family: "Noto Sans JP", sans-serif;
            animation: drift 1920s step-end infinite;
          }
          /* OLED burn-in guard: 8 whole-pixel offsets, one hop every 4 minutes. */
          @keyframes drift {
            0% { transform: translate(0, 0); }
            12.5% { transform: translate(2px, 1px); }
            25% { transform: translate(-1px, 2px); }
            37.5% { transform: translate(-2px, -1px); }
            50% { transform: translate(1px, -2px); }
            62.5% { transform: translate(2px, 2px); }
            75% { transform: translate(-2px, 0); }
            87.5% { transform: translate(0, -2px); }
          }`}
        </style>
        <link
          rel="stylesheet"
          href="https://fonts.bunny.net/css?family=noto-sans-jp:400,600&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@unocss/reset@66.10.5/tailwind.min.css"
        />
        <script src="https://cdn.jsdelivr.net/npm/@unocss/runtime@66.10.5/uno.global.js" />
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.4/bundles/datastar.js"
        />
      </head>
      <body
        un-cloak
        class="bg-black text-neutral-100"
        data-init="@get('/events', { openWhenHidden: true, retry: 'always', retryMaxCount: Infinity })"
        // Screen wake: start from the top in case the page was left scrolled.
        data-on:visibilitychange__document="!document.hidden && window.scrollTo(0, 0)"
      >
        <div class="mx-auto mt-10 max-w-md p-3">{children}</div>
      </body>
    </html>
  </>
)
