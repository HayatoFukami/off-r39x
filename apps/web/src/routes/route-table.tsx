import type { RouteObject } from "react-router";
import { NotFoundView } from "../presentation/components/not-found-view";
import * as emailVerification from "./auth/email-verification";
import * as login from "./auth/login";
import * as passwordReset from "./auth/password-reset";
import * as passwordResetComplete from "./auth/password-reset-complete";
import * as register from "./auth/register";
import DevLayout from "./dev/dev-layout";
import * as errorProbe from "./dev/error-probe";
import * as mockCheckout from "./dev/mock-checkout";
import * as scenarios from "./dev/scenarios";
import * as announcementDetail from "./public/announcement-detail";
import * as announcements from "./public/announcements";
import * as cart from "./public/cart";
import * as entry from "./public/entry";
import * as goods from "./public/goods";
import * as goodsDetail from "./public/goods-detail";
import * as home from "./public/home";
import * as karaoke from "./public/karaoke";
import * as karaokeDay from "./public/karaoke-day";
import * as karaokeSlot from "./public/karaoke-slot";
import RootError from "./root-error";
import RootLayout from "./root-layout";
import RouteError from "./route-error";
import * as mypageEntryTicketDetail from "./self/mypage-entry-ticket-detail";
import * as mypageEntryTicketQr from "./self/mypage-entry-ticket-qr";
import * as mypageEntryTickets from "./self/mypage-entry-tickets";
import * as mypageGoods from "./self/mypage-goods";
import * as mypageGoodsItemDetail from "./self/mypage-goods-item-detail";
import * as mypageKaraoke from "./self/mypage-karaoke";
import MypageLayout from "./self/mypage-layout";
import * as mypageOrderDetail from "./self/mypage-order-detail";
import * as mypageOrders from "./self/mypage-orders";
import * as mypageOverview from "./self/mypage-overview";
import * as mypageProfile from "./self/mypage-profile";
import * as mypageReservationDetail from "./self/mypage-reservation-detail";
import * as mypageReservationQr from "./self/mypage-reservation-qr";
import * as purchaseOrder from "./self/purchase-order";
import SelfLayout from "./self/self-layout";

// Matching is case-sensitive (as the former Next routes were, and as `_headers` is), so `/MYPAGE` is an unknown URL.
// Every application URL (SPEC-050 7) as an absolute path; the layouts are pathless routes (DEV-WEB-001).
// - SelfLayout (AuthGate) covers /purchase/* and /mypage/*. The unknown-URL route stays outside it, so a Guest
//   sees Not Found there and not a login redirect.
// - Dynamic segment names stay the same as in the former file-system routes.
// - Two error boundaries: the root one for a layout that cannot render, and one around every page so the header
//   and footer stay (SEC-WEB-012).
// - A route module exports its page as the default component and its title as `handle` (see route-handle.ts).
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RootError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { path: "/", caseSensitive: true, Component: home.default },
          {
            path: "/announcements",
            caseSensitive: true,
            Component: announcements.default,
            handle: announcements.handle,
          },
          {
            path: "/announcements/:announcementRef",
            caseSensitive: true,
            Component: announcementDetail.default,
            handle: announcementDetail.handle,
          },
          { path: "/entry", caseSensitive: true, Component: entry.default, handle: entry.handle },
          {
            path: "/karaoke",
            caseSensitive: true,
            Component: karaoke.default,
            handle: karaoke.handle,
          },
          {
            path: "/karaoke/schedule/:date",
            caseSensitive: true,
            Component: karaokeDay.default,
            handle: karaokeDay.handle,
          },
          {
            path: "/karaoke/slots/:slotRef",
            caseSensitive: true,
            Component: karaokeSlot.default,
            handle: karaokeSlot.handle,
          },
          { path: "/goods", caseSensitive: true, Component: goods.default, handle: goods.handle },
          {
            path: "/goods/:goodsRef",
            caseSensitive: true,
            Component: goodsDetail.default,
            handle: goodsDetail.handle,
          },
          { path: "/cart", caseSensitive: true, Component: cart.default, handle: cart.handle },
          {
            path: "/account/register",
            caseSensitive: true,
            Component: register.default,
            handle: register.handle,
          },
          {
            path: "/account/email-verification",
            caseSensitive: true,
            Component: emailVerification.default,
            handle: emailVerification.handle,
          },
          {
            path: "/account/login",
            caseSensitive: true,
            Component: login.default,
            handle: login.handle,
          },
          {
            path: "/account/password-reset",
            caseSensitive: true,
            Component: passwordReset.default,
            handle: passwordReset.handle,
          },
          {
            path: "/account/password-reset/complete",
            caseSensitive: true,
            Component: passwordResetComplete.default,
            handle: passwordResetComplete.handle,
          },
          {
            element: <SelfLayout />,
            children: [
              {
                path: "/purchase/orders/:orderRef",
                caseSensitive: true,
                Component: purchaseOrder.default,
                handle: purchaseOrder.handle,
              },
              {
                element: <MypageLayout />,
                children: [
                  {
                    path: "/mypage",
                    caseSensitive: true,
                    Component: mypageOverview.default,
                    handle: mypageOverview.handle,
                  },
                  {
                    path: "/mypage/profile",
                    caseSensitive: true,
                    Component: mypageProfile.default,
                    handle: mypageProfile.handle,
                  },
                  {
                    path: "/mypage/orders",
                    caseSensitive: true,
                    Component: mypageOrders.default,
                    handle: mypageOrders.handle,
                  },
                  {
                    path: "/mypage/orders/:orderRef",
                    caseSensitive: true,
                    Component: mypageOrderDetail.default,
                    handle: mypageOrderDetail.handle,
                  },
                  {
                    path: "/mypage/entry-tickets",
                    caseSensitive: true,
                    Component: mypageEntryTickets.default,
                    handle: mypageEntryTickets.handle,
                  },
                  {
                    path: "/mypage/entry-tickets/:ticketRef",
                    caseSensitive: true,
                    Component: mypageEntryTicketDetail.default,
                    handle: mypageEntryTicketDetail.handle,
                  },
                  {
                    path: "/mypage/entry-tickets/:ticketRef/qr",
                    caseSensitive: true,
                    Component: mypageEntryTicketQr.default,
                    handle: mypageEntryTicketQr.handle,
                  },
                  {
                    path: "/mypage/karaoke",
                    caseSensitive: true,
                    Component: mypageKaraoke.default,
                    handle: mypageKaraoke.handle,
                  },
                  {
                    path: "/mypage/karaoke/:reservationRef",
                    caseSensitive: true,
                    Component: mypageReservationDetail.default,
                    handle: mypageReservationDetail.handle,
                  },
                  {
                    path: "/mypage/karaoke/:reservationRef/qr",
                    caseSensitive: true,
                    Component: mypageReservationQr.default,
                    handle: mypageReservationQr.handle,
                  },
                  {
                    path: "/mypage/goods",
                    caseSensitive: true,
                    Component: mypageGoods.default,
                    handle: mypageGoods.handle,
                  },
                  {
                    path: "/mypage/goods/:goodsItemRef",
                    caseSensitive: true,
                    Component: mypageGoodsItemDetail.default,
                    handle: mypageGoodsItemDetail.handle,
                  },
                ],
              },
            ],
          },
          // DEV-WEB-012/013: the dev area. DevLayout shows Not Found unless UI mock mode is on, and deleting
          // src/routes/dev together with this block removes the area.
          {
            element: <DevLayout />,
            children: [
              { path: "/dev/scenarios", caseSensitive: true, Component: scenarios.default },
              {
                path: "/dev/mock-checkout/:orderRef",
                caseSensitive: true,
                Component: mockCheckout.default,
                handle: mockCheckout.handle,
              },
              { path: "/dev/error-probe", caseSensitive: true, Component: errorProbe.default },
            ],
          },
          // PG-XFN-002: any other URL. It is outside SelfLayout, so it never asks for a Session.
          { path: "*", element: <NotFoundView /> },
        ],
      },
    ],
  },
];
