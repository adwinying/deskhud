export const Page = ({ children }: { children: JSX.Element }) => (
  <>
    {"<!doctype html>"}
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>deskhud</title>
        <style>
          {`[un-cloak] { display: none; }
          body { font-family: "Noto Sans JP", sans-serif; }`}
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
        data-init="@get('/events')"
      >
        <div class="mx-auto max-w-lg p-3">{children}</div>
      </body>
    </html>
  </>
)
