# Release runbook

The three packages publish in a fixed order driven by their dep chain:

```
elm-web3 ──┐
           ├──→ elm-web3-ui ──┐
                              ├──→ @intrepidshape/dapp-gen
                              ┘
```

`dapp-gen` is the CLI; it consumes both Elm packages at codegen time. The Elm
packages must be on the [Elm registry](https://package.elm-lang.org) before
`dapp-gen`'s generated `elm.json` will resolve.

## Step-by-step

### 1. `intrepidshape/elm-web3` 1.2.0

```sh
cd elm-web3
# Verify clean state
git status
elm make --docs=docs.json    # must succeed
npx elm-test                  # must pass
# Publish (interactive — confirms README, version, license)
elm publish
```

After this, `elm install intrepidshape/elm-web3` resolves to 1.2.0 anywhere.

### 2. `intrepidshape/elm-web3-ui` 1.9.0

```sh
cd elm-web3-ui
# docs.json regen now succeeds because elm-web3 1.2.0 is on the registry
rm -f docs.json
elm make --docs=docs.json    # must succeed and emit 34-module docs.json
git add docs.json
git commit -m "release: 1.9.0 docs.json"
git tag -a 1.9.0 -m 'release: 1.9.0'
git push origin master 1.9.0
elm publish
```

Order matters: docs.json regen fails until elm-web3 1.2.0 is reachable.

### 3. `@intrepidshape/dapp-gen` 0.2.0

```sh
cd dapp-gen
# Update package.json version
# Run full test suite end-to-end
bun test
# Publish to npm
npm publish --access public
```

`dapp-gen`'s tests now resolve against the published Elm packages — verify
once before publishing.

## Verification matrix

After all three are published, the cold-machine smoke test:

```sh
mkdir /tmp/cold && cd /tmp/cold
bunx @intrepidshape/dapp-gen --chain ethereum \
    --address 0x6B175474E89094C44Da98b954EedeAC495271d0F \
    --out ./dai
cd dai
elm make src/Main.elm --output=elm.js
bun --hot index.html
```

Open the served HTML in a browser with MetaMask connected to mainnet.
Connect → fill `balanceOf(<your address>)` → click Read → see your balance.

If all three of the above complete clean, the release is good.

## What can fail

| Step | Failure | Recovery |
|---|---|---|
| `elm publish` (elm-web3) | docs incomplete | Add `@docs` lines for any newly-exposed names; rerun |
| `elm publish` (elm-web3-ui) | version not bumped past 1.0.0 | Elm requires monotonic increase per namespace; check what's live and bump past it |
| `npm publish` | scope not claimed | Login to npm; `npm org create intrepidshape` then retry |
| Cold smoke | `elm install` fails | Elm registry caching lag; wait ~10 min and retry |
