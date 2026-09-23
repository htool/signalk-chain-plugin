# Display chain length and depth

Aimed to be used on phone near windlass to read chain length and depth.

## npm publish

App Store installs come from the npm package [`signalk-chain-plugin`](https://www.npmjs.com/package/signalk-chain-plugin). A GitHub Action patch-bumps and publishes at most once per UTC day when `plugin/` or `public/` changed since the last release (`.github/workflows/release.yml`). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (GitHub OIDC). Once, as package owner on npmjs.com: **Package → Settings → Trusted Publisher → GitHub Actions**, with organization `htool`, repository `signalk-chain-plugin`, workflow filename `release.yml`, and allowed action `npm publish`.
