port module Main exposing (main)

{-| Auto-generated shell for a single-contract dapp targeting
**{{CONTRACT_NAME}}** at `{{CONTRACT_ADDRESS}}` on chain {{CHAIN_ID}}.

This file is your code — edit it. Re-running `dapp-gen` overwrites
`src/Generated/**` but leaves `Main.elm` alone after the first generation.

What's wired:

  - Wallet connect via `Web3.Ui.Wallet` + the standard two-port pattern
    (`web3Cmd` out / `web3Sub` in).
  - All contract-call traffic routes through the same two ports — the
    generated `Generated.Views.{{CONTRACT_MODULE}}.decodePortMsg` decoder
    picks the right `Msg` variant for each inbound message.
  - Pending state lives inside `Generated.Views.{{CONTRACT_MODULE}}.Model`
    so you don't have to manage per-function spinners by hand.

-}

import Browser
import Generated.Views.{{CONTRACT_MODULE}} as Contract
import Html exposing (Html)
import Html.Attributes as Attr
import Json.Decode as D
import Json.Encode as E
import Web3.Chain as Chain
import Web3.Types as T
import Web3.Wallet as Wallet
import Web3.Ui.Wallet as WalletUi



-- PORTS ---------------------------------------------------------------------


port web3Cmd : E.Value -> Cmd msg


port web3Sub : (D.Value -> msg) -> Sub msg



-- MODEL ---------------------------------------------------------------------


type alias Model =
    { wallet : Wallet.State
    , contract : Contract.Model
    }


contractAddress : T.Address
contractAddress =
    case T.address "{{CONTRACT_ADDRESS}}" of
        Just a ->
            a

        Nothing ->
            -- This won't happen at runtime — `dapp-gen` only ever writes a
            -- syntactically-valid address into this template.
            Debug.todo "invalid template address"


chain : Chain.Chain
chain =
    Chain.{{CHAIN_SLUG}}


explorerTxUrl : Maybe String
explorerTxUrl =
    Just (Chain.blockExplorer chain ++ "/tx/")


init : () -> ( Model, Cmd Msg )
init () =
    ( { wallet = Wallet.Disconnected
      , contract = Contract.init
      }
    , Cmd.none
    )



-- UPDATE --------------------------------------------------------------------


type Msg
    = ConnectWallet
    | DisconnectWallet
    | SwitchChain
    | WalletMsg Wallet.Msg
    | ContractMsg Contract.Msg
    | IncomingPort D.Value


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        ConnectWallet ->
            ( { model | wallet = Wallet.startConnect model.wallet }
            , web3Cmd (Wallet.encode Wallet.connect)
            )

        DisconnectWallet ->
            ( model, web3Cmd (Wallet.encode Wallet.disconnect) )

        SwitchChain ->
            ( model, web3Cmd (Wallet.encode (Wallet.switchChain (Chain.chainId chain))) )

        WalletMsg wmsg ->
            ( { model | wallet = Wallet.update (Chain.chainId chain) wmsg model.wallet }
            , Cmd.none
            )

        ContractMsg cmsg ->
            let
                ( newContract, intent ) =
                    Contract.update contractAddress cmsg model.contract
            in
            ( { model | contract = newContract }
            , case intent of
                Contract.NoIntent ->
                    Cmd.none

                Contract.DoCall payload ->
                    web3Cmd payload

                Contract.DoSend payload ->
                    web3Cmd payload
            )

        IncomingPort value ->
            case Contract.decodePortMsg value of
                Just cmsg ->
                    update (ContractMsg cmsg) model

                Nothing ->
                    -- Try wallet decoder
                    case D.decodeValue Wallet.decoder value of
                        Ok wmsg ->
                            update (WalletMsg wmsg) model

                        Err _ ->
                            ( model, Cmd.none )



-- VIEW ----------------------------------------------------------------------


view : Model -> Html Msg
view model =
    Html.div [ Attr.class "app" ]
        [ Html.header [ Attr.class "app__header" ]
            [ Html.h1 [ Attr.class "app__title" ] [ Html.text "{{CONTRACT_NAME}}" ]
            , Html.span [ Attr.class "app__address" ] [ Html.text "{{CONTRACT_ADDRESS}}" ]
            , WalletUi.viewState []
                { onConnect = ConnectWallet
                , onSwitchChain = SwitchChain
                , onDisconnect = DisconnectWallet
                , knownChains = [ chain ]
                }
                model.wallet
            ]
        , Html.main_ [ Attr.class "app__main" ]
            [ Html.map ContractMsg (Contract.view contractAddress explorerTxUrl model.contract) ]
        ]



-- MAIN ----------------------------------------------------------------------


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = \_ -> web3Sub IncomingPort
        }
