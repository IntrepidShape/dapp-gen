/**
 * ABI → Elm UI module codegen.
 *
 * Reads one contract's verified bundle (`VerifiedBundle` from fetch.ts) and
 * emits an Elm module that renders every public function as a typed form
 * using `Web3.Ui.ContractRead` / `Web3.Ui.ContractWrite` / `Web3.Ui.AbiInput`
 * from `intrepidshape/elm-web3-ui`, plus a self-contained Model/Msg/update
 * pair that wires user clicks through to encoded port payloads.
 *
 * The generated module exposes:
 *   - Model        — record with input-buffer + status fields per function
 *   - init         — empty Model
 *   - Msg          — one variant per user action + per result
 *   - Intent       — NoIntent | DoCall E.Value | DoSend E.Value
 *   - update       — pure state transition + Intent describing port work
 *   - view         — composes ContractRead/ContractWrite forms
 *   - decodePortMsg — turns incoming JSON port data into a Msg
 *
 * Output is plain Elm a human could have written. Users fork and customise.
 */

import { toFunctionSelector } from "viem";
import type { AbiItem, AbiParam, MethodDoc, NatSpec, VerifiedBundle } from "./fetch.ts";

export interface GenerateOptions {
    readonly moduleName: string;           // e.g. "Generated.Views.Erc20"
    readonly contractsModule: string;      // e.g. "Generated.Contracts.Erc20" — typed wrappers from elm-web3 codegen
}

export function generateUiModule(
    bundle: VerifiedBundle,
    options: GenerateOptions,
): string {
    const fns = (bundle.abi ?? []).filter(isCallable);
    const reads = fns.filter(isRead);
    const writes = fns.filter(isWrite);

    return [
        renderModuleHeader(options.moduleName, options.contractsModule, bundle),
        renderImports(),
        renderModelType(fns),
        renderInit(fns),
        renderMsgType(fns),
        renderIntentType(),
        renderUpdate(fns),
        renderDecodePortMsg(fns),
        renderView(reads, writes),
        renderFieldDefs(fns),
        renderReadViews(reads, bundle.natspec),
        renderWriteViews(writes, bundle.natspec),
        renderResultParsers(reads, fns),
    ].join("\n\n\n");
}


// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function isCallable(item: AbiItem): boolean {
    return item.type === "function" && typeof item.name === "string";
}

function isRead(item: AbiItem): boolean {
    return item.stateMutability === "view" || item.stateMutability === "pure";
}

function isWrite(item: AbiItem): boolean {
    return item.stateMutability === "nonpayable" || item.stateMutability === "payable";
}

function isPayable(item: AbiItem): boolean {
    return item.stateMutability === "payable";
}


// ---------------------------------------------------------------------------
// Name helpers — collision-safe
// ---------------------------------------------------------------------------

/**
 * Make a unique selector for a function within its module. Solidity allows
 * overloads (same name, different arg types) so we suffix `_N` when needed.
 */
function functionKey(fn: AbiItem, index: number, all: AbiItem[]): string {
    const name = fn.name ?? `fn${index}`;
    const collisions = all.filter((f) => f.name === name);
    if (collisions.length <= 1) return name;
    const ownIndex = collisions.indexOf(fn);
    return `${name}_${ownIndex}`;
}

/**
 * Elm identifier rules: must start with a letter (`camel` lowercase, `pascal`
 * uppercase). Solidity permits leading underscores (Compound's
 * `_setComptroller`, `_acceptAdmin`, …); strip them so the generated Elm
 * compiles, while keeping the original name in the user-facing label.
 */
function camel(s: string): string {
    const stripped = s.replace(/^_+/, "");
    if (stripped.length === 0) return "fn";
    return stripped[0]!.toLowerCase() + stripped.slice(1);
}

function pascal(s: string): string {
    const stripped = s.replace(/^_+/, "");
    if (stripped.length === 0) return "Fn";
    return stripped[0]!.toUpperCase() + stripped.slice(1);
}

function ensureParamName(p: AbiParam, i: number): string {
    return p.name && p.name.length > 0 ? p.name : `arg${i}`;
}

function methodSignature(fn: AbiItem): string {
    const inputs = (fn.inputs ?? [])
        .map((p) => canonicalAbiType(p))
        .join(",");
    return `${fn.name}(${inputs})`;
}

function canonicalAbiType(p: AbiParam): string {
    if (p.type.startsWith("tuple")) {
        const inner = (p.components ?? []).map(canonicalAbiType).join(",");
        // tuple, tuple[], tuple[N] → (a,b,c), (a,b,c)[], (a,b,c)[N]
        const suffix = p.type.slice("tuple".length);
        return `(${inner})${suffix}`;
    }
    return p.type;
}


// ---------------------------------------------------------------------------
// Header / imports
// ---------------------------------------------------------------------------

function renderModuleHeader(
    moduleName: string,
    contractsModule: string,
    bundle: VerifiedBundle,
): string {
    return `module ${moduleName} exposing
    ( Model, init
    , Msg, Intent(..)
    , update, view
    , decodePortMsg
    )

{-| Auto-generated UI for **${bundle.contractName}** (\`${bundle.address}\` on chain ${bundle.chainId}).

Generated by \`@intrepidshape/dapp-gen\` from the verified Sourcify bundle.
Compiler: \`${bundle.compilerVersion}\`. Match kind: \`${bundle.matchKind}\`.

This is your code — edit it freely. Re-running \`dapp-gen\` will overwrite the
file unless you tell it not to. Typed wrappers live in
[\`${contractsModule}\`](${contractsModule}-).

@docs Model, init
@docs Msg, Intent
@docs update, view
@docs decodePortMsg

-}`;
}

function renderImports(): string {
    return `import Html exposing (Html)
import Html.Attributes as Attr
import Json.Decode as D
import Json.Encode as E
import Web3.Abi.Calldata as Calldata
import Web3.Abi.Decode as AbiDecode
import Web3.BigInt as BigInt
import Web3.Contract.Call as Call
import Web3.Contract.Send as Send
import Web3.Transaction as Tx
import Web3.Types as T
import Web3.Ui.AbiInput as AbiInput
import Web3.Ui.ContractRead as Read
import Web3.Ui.ContractWrite as Write`;
}


// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function renderModelType(fns: AbiItem[]): string {
    const fields: string[] = [];

    fns.forEach((fn, idx) => {
        const key = functionKey(fn, idx, fns);
        const inputs = fn.inputs ?? [];

        for (const [i, p] of inputs.entries()) {
            const argName = ensureParamName(p, i);
            fields.push(`${camel(key)}_${argName} : AbiInput.Value`);
            fields.push(`${camel(key)}_${argName}_err : Maybe String`);
        }

        if (isRead(fn)) {
            fields.push(`${camel(key)}_status : Read.Status`);
        } else if (isWrite(fn)) {
            fields.push(`${camel(key)}_tx : Tx.Status`);
            if (isPayable(fn)) {
                fields.push(`${camel(key)}_msgValue : String`);
            }
        }
    });

    if (fields.length === 0) {
        return `type alias Model =
    {}`;
    }

    return [
        `{-| Per-function input buffers, validation errors, and lifecycle state. -}`,
        `type alias Model =`,
        `    { ${fields[0]}`,
        ...fields.slice(1).map((f) => `    , ${f}`),
        `    }`,
    ].join("\n");
}

function renderInit(fns: AbiItem[]): string {
    const fields: string[] = [];

    fns.forEach((fn, idx) => {
        const key = functionKey(fn, idx, fns);
        const inputs = fn.inputs ?? [];

        for (const [i, p] of inputs.entries()) {
            const argName = ensureParamName(p, i);
            fields.push(`${camel(key)}_${argName} = AbiInput.initFor ${fieldDefName(key, argName)}`);
            fields.push(`${camel(key)}_${argName}_err = Nothing`);
        }

        if (isRead(fn)) {
            fields.push(`${camel(key)}_status = Read.Idle`);
        } else if (isWrite(fn)) {
            fields.push(`${camel(key)}_tx = Tx.Idle`);
            if (isPayable(fn)) {
                fields.push(`${camel(key)}_msgValue = ""`);
            }
        }
    });

    if (fields.length === 0) {
        return `{-| Empty model. -}
init : Model
init =
    {}`;
    }

    return [
        `{-| Empty model with every input cleared. -}`,
        `init : Model`,
        `init =`,
        `    { ${fields[0]}`,
        ...fields.slice(1).map((f) => `    , ${f}`),
        `    }`,
    ].join("\n");
}


// ---------------------------------------------------------------------------
// Msg
// ---------------------------------------------------------------------------

function renderMsgType(fns: AbiItem[]): string {
    const variants: string[] = [];

    fns.forEach((fn, idx) => {
        const key = functionKey(fn, idx, fns);
        const ctor = pascal(key);
        const inputs = fn.inputs ?? [];

        for (const [i, p] of inputs.entries()) {
            const argName = ensureParamName(p, i);
            variants.push(`${ctor}${pascal(argName)}Changed AbiInput.Value`);
        }

        if (isRead(fn)) {
            variants.push(`${ctor}Read`);
            variants.push(`${ctor}Result (Result String String)`);
        } else if (isWrite(fn)) {
            if (isPayable(fn)) {
                variants.push(`${ctor}MsgValueChanged String`);
            }
            variants.push(`${ctor}Send`);
            variants.push(`${ctor}TxMsg Tx.Msg`);
        }
    });

    if (variants.length === 0) {
        return `{-| No callable functions. -}
type Msg
    = Noop`;
    }

    return [
        `{-| User actions and incoming results. -}`,
        `type Msg`,
        `    = ${variants[0]}`,
        ...variants.slice(1).map((v) => `    | ${v}`),
    ].join("\n");
}


// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

function renderIntentType(): string {
    return `{-| Side-effect description returned by [\`update\`](#update). The host
threads \`DoCall\` and \`DoSend\` payloads through its single \`web3Cmd\` port.
-}
type Intent
    = NoIntent
    | DoCall E.Value
    | DoSend E.Value`;
}


// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

function renderUpdate(fns: AbiItem[]): string {
    if (fns.length === 0) {
        return `{-| No-op update. -}
update : T.Address -> Msg -> Model -> ( Model, Intent )
update _ Noop model =
    ( model, NoIntent )`;
    }

    const branches: string[] = [];

    fns.forEach((fn, idx) => {
        const key = functionKey(fn, idx, fns);
        const ctor = pascal(key);
        const inputs = fn.inputs ?? [];
        const methodSig = methodSignature(fn);

        // …Changed branches
        for (const [i, p] of inputs.entries()) {
            const argName = ensureParamName(p, i);
            branches.push(
                [
                    `        ${ctor}${pascal(argName)}Changed v ->`,
                    `            ( { model | ${camel(key)}_${argName} = v, ${camel(key)}_${argName}_err = Nothing }, NoIntent )`,
                ].join("\n"),
            );
        }

        const argParseLines = inputs.map((p, i) => {
            const argName = ensureParamName(p, i);
            return `                Result.andThen
                    (\\xs ->
                        AbiInput.parseSlot ${fieldDefName(key, argName)} model.${camel(key)}_${argName}
                            |> Result.map (\\x -> xs ++ [ x ])
                    )`;
        });

        const parseSlotsExpr =
            inputs.length === 0
                ? `(Ok [])`
                : [`(Ok [])`, ...argParseLines].join("\n                    |> ");

        // Selector is computed at codegen time via viem — never shipped.
        const selector = toFunctionSelector(methodSig).slice(2);

        if (isRead(fn)) {
            branches.push(
                [
                    `        ${ctor}Read ->`,
                    `            case ${parseSlotsExpr} of`,
                    `                Ok slots ->`,
                    `                    ( { model | ${camel(key)}_status = Read.Pending }`,
                    `                    , DoCall`,
                    `                        (Call.encode`,
                    `                            (Call.readCallRaw`,
                    `                                { contract = contract`,
                    `                                , data = Calldata.calldata "${selector}" slots`,
                    `                                , decoder = D.succeed ""`,
                    `                                , id = "${callId(key)}"`,
                    `                                }`,
                    `                            )`,
                    `                        )`,
                    `                    )`,
                    `                Err err ->`,
                    `                    ( { model | ${camel(key)}_status = Read.Failed err }, NoIntent )`,
                ].join("\n"),
            );

            branches.push(
                [
                    `        ${ctor}Result res ->`,
                    `            case res of`,
                    `                Ok rendered ->`,
                    `                    ( { model | ${camel(key)}_status = Read.Success rendered }, NoIntent )`,
                    `                Err err ->`,
                    `                    ( { model | ${camel(key)}_status = Read.Failed err }, NoIntent )`,
                ].join("\n"),
            );
        } else if (isWrite(fn)) {
            if (isPayable(fn)) {
                branches.push(
                    [
                        `        ${ctor}MsgValueChanged v ->`,
                        `            ( { model | ${camel(key)}_msgValue = v }, NoIntent )`,
                    ].join("\n"),
                );
            }

            const sendCall = isPayable(fn)
                ? [
                      `                            (Send.payableCallRaw`,
                      `                                { contract = contract`,
                      `                                , data = Calldata.calldata "${selector}" slots`,
                      `                                , value = BigInt.fromString model.${camel(key)}_msgValue |> Maybe.withDefault BigInt.zero`,
                      `                                }`,
                      `                            )`,
                  ].join("\n")
                : [
                      `                            (Send.writeCallRaw`,
                      `                                { contract = contract`,
                      `                                , data = Calldata.calldata "${selector}" slots`,
                      `                                }`,
                      `                            )`,
                  ].join("\n");

            branches.push(
                [
                    `        ${ctor}Send ->`,
                    `            case ${parseSlotsExpr} of`,
                    `                Ok slots ->`,
                    `                    ( { model | ${camel(key)}_tx = Tx.AwaitingSignature }`,
                    `                    , DoSend`,
                    `                        (Send.encode`,
                    sendCall,
                    `                        )`,
                    `                    )`,
                    `                Err err ->`,
                    `                    ( { model | ${camel(key)}_tx = Tx.Failed err }, NoIntent )`,
                ].join("\n"),
            );

            branches.push(
                [
                    `        ${ctor}TxMsg txMsg ->`,
                    `            ( { model | ${camel(key)}_tx = Tx.update txMsg model.${camel(key)}_tx }, NoIntent )`,
                ].join("\n"),
            );
        }
    });

    return [
        `{-| Pure state transition + an [\`Intent\`](#Intent) describing any port work.`,
        ``,
        `\`contract\` is the deployed address the calls target; pass it in from your`,
        `app's Model so the same generated module can serve multiple deployments.`,
        `-}`,
        `update : T.Address -> Msg -> Model -> ( Model, Intent )`,
        `update contract msg model =`,
        `    case msg of`,
        branches.join("\n\n"),
    ].join("\n");
}

function callId(key: string): string {
    return `__gen_${key}`;
}


// ---------------------------------------------------------------------------
// decodePortMsg
// ---------------------------------------------------------------------------

function renderDecodePortMsg(fns: AbiItem[]): string {
    if (fns.length === 0) {
        return `{-| No port messages to decode. -}
decodePortMsg : D.Value -> Maybe Msg
decodePortMsg _ =
    Nothing`;
    }

    const readBranches = fns
        .filter(isRead)
        .map((fn) => {
            const idx = fns.indexOf(fn);
            const key = functionKey(fn, idx, fns);
            const ctor = pascal(key);
            return [
                `        "${callId(key)}" ->`,
                `            D.oneOf`,
                `                [ D.field "result" D.string`,
                `                    |> D.map (\\hex -> Just (${ctor}Result (${resultParserName(key)} hex)))`,
                `                , D.field "error" D.string`,
                `                    |> D.map (\\e -> Just (${ctor}Result (Err e)))`,
                `                ]`,
            ].join("\n");
        })
        .join("\n\n");

    return [
        `{-| Route an incoming port-bound JSON value to a Msg, by matching its \`id\`.`,
        ``,
        `Returns \`Nothing\` for unrelated traffic (e.g. wallet events).`,
        `-}`,
        `decodePortMsg : D.Value -> Maybe Msg`,
        `decodePortMsg value =`,
        `    case D.decodeValue (D.field "id" D.string) value of`,
        `        Ok id ->`,
        `            case D.decodeValue (dispatcher id) value of`,
        `                Ok m ->`,
        `                    m`,
        ``,
        `                Err _ ->`,
        `                    Nothing`,
        ``,
        `        Err _ ->`,
        `            Nothing`,
        ``,
        ``,
        `dispatcher : String -> D.Decoder (Maybe Msg)`,
        `dispatcher id =`,
        `    case id of`,
        readBranches.length > 0 ? readBranches : `        _ ->\n            D.succeed Nothing`,
        ``,
        `        _ ->`,
        `            D.succeed Nothing`,
    ].join("\n");
}


// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

function renderView(reads: AbiItem[], writes: AbiItem[]): string {
    const all = [...reads, ...writes];
    const readItems = reads.map((fn) => {
        const idx = all.indexOf(fn);
        const key = functionKey(fn, idx, all);
        return `readView_${camel(key)} model`;
    });
    const writeItems = writes.map((fn) => {
        const idx = all.indexOf(fn);
        const key = functionKey(fn, idx, all);
        return `writeView_${camel(key)} contract explorerUrl model`;
    });

    if (readItems.length === 0 && writeItems.length === 0) {
        return `{-| Empty view — contract has no callable functions. -}
view : T.Address -> Maybe String -> Model -> Html Msg
view _ _ _ =
    Html.div [ Attr.class "generated-view generated-view--empty" ] []`;
    }

    const readsList = elmList(readItems, "            ");
    const writesList = elmList(writeItems, "            ");

    return [
        `{-| Render every callable function as a read or write card.`,
        ``,
        `\`contract\` is the target contract address. \`explorerUrl\` is an optional`,
        `block-explorer URL prefix for tx-hash links (\`Nothing\` = local dev).`,
        `-}`,
        `view : T.Address -> Maybe String -> Model -> Html Msg`,
        `view contract explorerUrl model =`,
        `    Html.div [ Attr.class "generated-view" ]`,
        `        [ Html.div [ Attr.class "generated-view__section generated-view__section--reads" ]`,
        `            ${readsList}`,
        `        , Html.div [ Attr.class "generated-view__section generated-view__section--writes" ]`,
        `            ${writesList}`,
        `        ]`,
    ].join("\n");
}

/** Render an Elm list literal, one element per line, comma-leading style. */
function elmList(items: string[], indent: string): string {
    if (items.length === 0) return "[]";
    if (items.length === 1) return `[ ${items[0]} ]`;
    const first = items[0]!;
    const rest = items.slice(1).map((i) => `, ${i}`).join(`\n${indent}`);
    return `[ ${first}\n${indent}${rest}\n${indent}]`;
}


// ---------------------------------------------------------------------------
// Field defs
// ---------------------------------------------------------------------------

function fieldDefName(key: string, argName: string): string {
    return `${camel(key)}_${argName}_field`;
}

function renderFieldDefs(fns: AbiItem[]): string {
    const defs: string[] = [];
    fns.forEach((fn, idx) => {
        const key = functionKey(fn, idx, fns);
        const inputs = fn.inputs ?? [];
        for (const [i, p] of inputs.entries()) {
            const argName = ensureParamName(p, i);
            defs.push(`${fieldDefName(key, argName)} : AbiInput.Field
${fieldDefName(key, argName)} =
    ${fieldExpr(p, argName)}`);
        }
    });
    if (defs.length === 0) {
        return `-- (no input fields)`;
    }
    return `-- INPUT FIELD DEFINITIONS --------------------------------------------------\n\n\n${defs.join("\n\n\n")}`;
}

function fieldExpr(p: AbiParam, displayName: string): string {
    if (p.type.startsWith("tuple")) {
        const children = (p.components ?? []).map((cp, i) =>
            fieldExpr(cp, ensureParamName(cp, i)),
        );
        const childrenText =
            children.length === 0
                ? `[]`
                : `[ ${children.join("\n                , ")}\n                ]`;
        return `AbiInput.field
        { name = "${displayName}"
        , solType = "${p.type}"
        , children =
            ${childrenText.replace(/\n/g, "\n            ")}
        }`;
    }
    return `AbiInput.field { name = "${displayName}", solType = "${p.type}", children = [] }`;
}


// ---------------------------------------------------------------------------
// Read views
// ---------------------------------------------------------------------------

function renderReadViews(reads: AbiItem[], natspec: NatSpec): string {
    if (reads.length === 0) return `-- (no read functions)`;
    const blocks = reads.map((fn) => {
        const idx = reads.indexOf(fn);
        const key = functionKey(fn, idx, reads);
        const argConfigs = (fn.inputs ?? []).map((p, i) => {
            const argName = ensureParamName(p, i);
            return [
                `            { field = ${fieldDefName(key, argName)}`,
                `            , value = model.${camel(key)}_${argName}`,
                `            , onChange = ${pascal(key)}${pascal(argName)}Changed`,
                `            , error = model.${camel(key)}_${argName}_err`,
                `            }`,
            ].join("\n");
        });

        const argsBody =
            argConfigs.length === 0
                ? `        , args = []`
                : [
                      `        , args =`,
                      `            [ ${argConfigs[0]?.trimStart()}`,
                      ...argConfigs.slice(1).map((c) => `            , ${c.trimStart()}`),
                      `            ]`,
                  ].join("\n");

        const returnLabel = renderReturnLabel(fn);
        const docBlock = renderDocBlock(fn, natspec, "readView");

        return `readView_${camel(key)} : Model -> Html Msg
readView_${camel(key)} model =
    Html.div [ Attr.class "generated-card" ]
        [${docBlock}
        Read.view []
            { name = "${fn.name}"
            , solType = "${returnLabel}"
${argsBody.replace(/^ {8}/gm, "            ")}
            , status = model.${camel(key)}_status
            , onRead = ${pascal(key)}Read
            , readLabel = "Read"
            }
        ]`;
    });
    return `-- READ VIEWS -----------------------------------------------------------------\n\n\n${blocks.join("\n\n\n")}`;
}

function renderReturnLabel(fn: AbiItem): string {
    const outs = fn.outputs ?? [];
    if (outs.length === 0) return "()";
    if (outs.length === 1) return outs[0]!.type;
    return `(${outs.map((o) => o.type).join(", ")})`;
}


// ---------------------------------------------------------------------------
// Write views
// ---------------------------------------------------------------------------

function renderWriteViews(writes: AbiItem[], natspec: NatSpec): string {
    if (writes.length === 0) return `-- (no write functions)`;
    const blocks = writes.map((fn) => {
        const idx = writes.indexOf(fn);
        const key = functionKey(fn, idx, writes);
        const argConfigs = (fn.inputs ?? []).map((p, i) => {
            const argName = ensureParamName(p, i);
            return [
                `            { field = ${fieldDefName(key, argName)}`,
                `            , value = model.${camel(key)}_${argName}`,
                `            , onChange = ${pascal(key)}${pascal(argName)}Changed`,
                `            , error = model.${camel(key)}_${argName}_err`,
                `            }`,
            ].join("\n");
        });

        const argsBody =
            argConfigs.length === 0
                ? `        , args = []`
                : [
                      `        , args =`,
                      `            [ ${argConfigs[0]?.trimStart()}`,
                      ...argConfigs.slice(1).map((c) => `            , ${c.trimStart()}`),
                      `            ]`,
                  ].join("\n");

        const payableBody = isPayable(fn)
            ? [
                  `        , payable =`,
                  `            Just`,
                  `                { value = model.${camel(key)}_msgValue`,
                  `                , onValueChange = ${pascal(key)}MsgValueChanged`,
                  `                , valid = True`,
                  `                }`,
              ].join("\n")
            : `        , payable = Nothing`;

        const label = pascal(fn.name ?? key);
        const pendingLabel = `${label}…`;
        const docBlock = renderDocBlock(fn, natspec, "writeView");

        return `writeView_${camel(key)} : T.Address -> Maybe String -> Model -> Html Msg
writeView_${camel(key)} _ explorerUrl model =
    Html.div [ Attr.class "generated-card" ]
        [${docBlock}
        Write.view []
            { name = "${fn.name}"
${argsBody.replace(/^ {8}/gm, "            ")}
${payableBody.replace(/^ {8}/gm, "            ")}
            , txStatus = model.${camel(key)}_tx
            , onSend = ${pascal(key)}Send
            , sendLabel = "${label}"
            , pendingLabel = "${pendingLabel}"
            , explorerUrl = explorerUrl
            }
        ]`;
    });
    return `-- WRITE VIEWS ----------------------------------------------------------------\n\n\n${blocks.join("\n\n\n")}`;
}


/**
 * Render the NatSpec doc block above a function's form, if any.
 *
 * Looks up the function's canonical signature in the bundle's NatSpec, then
 * emits a small Elm `Html.div` carrying:
 *   - `@notice` as the primary description (user-facing)
 *   - `@dev` as a secondary "developer" note
 *   - `@param` notes inline next to argument labels (TODO — Phase 3)
 *   - `@return` as a returns-note line
 *
 * Returns an empty string (no block) if NatSpec is absent for this function,
 * so contracts compiled without docs degrade silently.
 */
function renderDocBlock(
    fn: AbiItem,
    natspec: NatSpec,
    _viewKind: "readView" | "writeView",
): string {
    const sig = methodSignature(fn);
    const doc: MethodDoc | undefined = natspec.methods[sig];
    if (!doc) return ` `; // single space inside the [ — Elm tolerates empty list
    const lines: string[] = [];
    if (doc.notice) {
        lines.push(`Html.p [ Attr.class "generated-card__notice" ] [ Html.text ${elmString(doc.notice)} ]`);
    }
    if (doc.details && doc.details !== doc.notice) {
        lines.push(`Html.p [ Attr.class "generated-card__details" ] [ Html.text ${elmString(doc.details)} ]`);
    }
    if (typeof doc.returns === "string") {
        lines.push(`Html.p [ Attr.class "generated-card__returns" ] [ Html.text ("returns: " ++ ${elmString(doc.returns)}) ]`);
    }
    if (lines.length === 0) return ` `;
    return `\n        Html.div [ Attr.class "generated-card__doc" ]\n            [ ${lines.join("\n            , ")}\n            ]\n        ,`;
}

function elmString(s: string): string {
    return `"${s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")}"`;
}


// ---------------------------------------------------------------------------
// Output decoders
// ---------------------------------------------------------------------------

function resultParserName(key: string): string {
    return `${camel(key)}_resultParser`;
}

/**
 * Emit per-function result parsers. Each one has type
 * `String -> Result String String` — takes the raw `eth_call` result hex and
 * returns the pretty-printed value (or a typed error).
 *
 * Slot extraction uses `Web3.Abi.Decode.{uint256,address,bool,…}Slot`, which
 * understand the canonical 32-byte ABI layout: scalars right-aligned (or
 * left-aligned for `bytesN`), arrays/strings as `offset, length, data`.
 */
function renderResultParsers(reads: AbiItem[], all: AbiItem[]): string {
    if (reads.length === 0) return `-- (no read result parsers)`;
    const blocks = reads.map((fn) => {
        const idx = all.indexOf(fn);
        const key = functionKey(fn, idx, all);
        const body = parserBody(fn);
        return `${resultParserName(key)} : String -> Result String String
${resultParserName(key)} hex =
${body}`;
    });
    const helper = `combineResults : List (Result String String) -> Result String (List String)
combineResults xs =
    List.foldr
        (\\r acc ->
            case ( r, acc ) of
                ( Err e, _ ) -> Err e
                ( _, Err e ) -> Err e
                ( Ok v, Ok rest ) -> Ok (v :: rest)
        )
        (Ok [])
        xs`;
    return `-- RESULT PARSERS ------------------------------------------------------------\n\n\n${helper}\n\n\n${blocks.join("\n\n\n")}`;
}

function parserBody(fn: AbiItem): string {
    const outs = fn.outputs ?? [];
    if (outs.length === 0) {
        return `    Ok "()"`;
    }
    if (outs.length === 1) {
        return scalarParserBody(outs[0]!, 0);
    }
    // Multi-output: each slot picked at its index, then joined.
    const lines: string[] = [`    let`];
    outs.forEach((p, i) => {
        const name = ensureParamName(p, i);
        lines.push(`        ${name}Res =`);
        lines.push(scalarParserBody(p, i).replace(/^ {4}/gm, "            "));
    });
    lines.push(`    in`);
    // Combine into "(a, b, c)" string. If any fails, return first error.
    const refs = outs.map((p, i) => `${ensureParamName(p, i)}Res`);
    lines.push(`    case combineResults [ ${refs.join(", ")} ] of`);
    lines.push(`        Ok parts -> Ok ("(" ++ String.join ", " parts ++ ")")`);
    lines.push(`        Err e -> Err e`);
    return lines.join("\n");
}

/**
 * Render the parser-body for a single scalar at slot index `slot`.
 * Result type: `Result String String`. Indentation is 4 spaces (the body is
 * always wrapped under `<name> hex =\n`).
 */
function scalarParserBody(p: AbiParam, slot: number): string {
    const t = p.type;
    if (t === "address") {
        return `    case AbiDecode.addressSlot ${slot} hex of
        Just a -> Ok (T.addressToString a)
        Nothing -> Err ("decode failed (address @ slot ${slot}): " ++ hex)`;
    }
    if (t === "bool") {
        return `    case AbiDecode.boolSlot ${slot} hex of
        Just True -> Ok "true"
        Just False -> Ok "false"
        Nothing -> Err ("decode failed (bool @ slot ${slot}): " ++ hex)`;
    }
    if (t.startsWith("uint")) {
        return `    case AbiDecode.uint256Slot ${slot} hex of
        Just n -> Ok (BigInt.toString n)
        Nothing -> Err ("decode failed (uint @ slot ${slot}): " ++ hex)`;
    }
    if (t.startsWith("int")) {
        // int256 — treat as uint for display (two's-complement rendering is a
        // user-fork concern).
        return `    case AbiDecode.uint256Slot ${slot} hex of
        Just n -> Ok (BigInt.toString n)
        Nothing -> Err ("decode failed (int @ slot ${slot}): " ++ hex)`;
    }
    if (t === "bytes32") {
        return `    Ok ("0x" ++ AbiDecode.hexSlot ${slot} hex)`;
    }
    if (/^bytes\d+$/.test(t)) {
        // bytesN — right-aligned within slot.
        const n = parseInt(t.slice(5), 10);
        return `    Ok ("0x" ++ String.left ${n * 2} (AbiDecode.hexSlot ${slot} hex))`;
    }
    if (t === "string") {
        return `    case AbiDecode.stringSlot ${slot} hex of
        Just s -> Ok s
        Nothing -> Err ("decode failed (string @ slot ${slot}): " ++ hex)`;
    }
    if (t === "bytes") {
        // Dynamic bytes — show as 0x-prefixed hex with length-prefix stripped.
        return `    Ok ("0x" ++ AbiDecode.hexSlot ${slot + 1} hex)`;
    }
    if (t.endsWith("[]")) {
        // Dynamic array — slot is an offset, then length, then elements.
        // Phase 2A: render as the raw hex with a label noting offset. Phase 3
        // recurses into the element type with proper offset arithmetic.
        return `    Ok ("[…] (raw at slot ${slot}; see AbiDecode for typed access)")`;
    }
    if (t.startsWith("tuple")) {
        return `    Ok ("(tuple at slot ${slot}; see AbiDecode for typed access)")`;
    }
    // Unknown — fall back to raw slot hex.
    return `    Ok ("0x" ++ AbiDecode.hexSlot ${slot} hex)`;
}
