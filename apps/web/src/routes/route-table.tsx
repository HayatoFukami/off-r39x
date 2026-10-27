import type { RouteObject } from "react-router";
import { NotFoundView } from "../presentation/components/not-found-view";
import * as emailVerification from "./auth/email-verification";
import * as login from "./auth/login";
import * as passwordReset from "./auth/password-reset";
import * as passwordResetComplete from "./auth/password-reset-complete";
import * as register from "./auth/register";
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
import RootLayout from "./root-layout";
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

// Every application URL (SPEC-050 7) as an absolute path; the layouts are pathless routes (DEV-WEB-001).
// - SelfLayout (AuthGate) covers /purchase/* and /mypage/*. The unknown-URL route stays outside it, so a Guest
//   sees Not Found there and not a login redirect.
// - Dynamic segment names stay the same as in the former file-system routes.
// - A route module exports its page as the default component and its title as `handle` (see route-handle.ts).
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      {
        children: [
          { path: "/", Component: home.default },
          {
            path: "/announcements",
            Component: announcements.default,
            handle: announcements.handle,
          },
          {
            path: "/announcements/:announcementRef",
            Component: announcementDetail.default,
            handle: announcementDetail.handle,
          },
          { path: "/entry", Component: entry.default, handle: entry.handle },
          { path: "/karaoke", Component: karaoke.default, handle: karaoke.handle },
          {
            path: "/karaoke/schedule/:date",
            Component: karaokeDay.default,
            handle: karaokeDay.handle,
          },
          {
            path: "/karaoke/slots/:slotRef",
            Component: karaokeSlot.default,
            handle: karaokeSlot.handle,
          },
          { path: "/goods", Component: goods.default, handle: goods.handle },
          {
            path: "/goods/:goodsRef",
            Component: goodsDetail.default,
            handle: goodsDetail.handle,
          },
          { path: "/cart", Component: cart.default, handle: cart.handle },
          { path: "/account/register", Component: register.default, handle: register.handle },
          {
            path: "/account/email-verification",
            Component: emailVerification.default,
            handle: emailVerification.handle,
          },
          { path: "/account/login", Component: login.default, handle: login.handle },
          {
            path: "/account/password-reset",
            Component: passwordReset.default,
            handle: passwordReset.handle,
          },
          {
            path: "/account/password-reset/complete",
            Component: passwordResetComplete.default,
            handle: passwordResetComplete.handle,
          },
          {
            element: <SelfLayout />,
            children: [
              {
                path: "/purchase/orders/:orderRef",
                Component: purchaseOrder.default,
                handle: purchaseOrder.handle,
              },
              {
                element: <MypageLayout />,
                children: [
                  {
                    path: "/mypage",
                    Component: mypageOverview.default,
                    handle: mypageOverview.handle,
                  },
                  {
                    path: "/mypage/profile",
                    Component: mypageProfile.default,
                    handle: mypageProfile.handle,
                  },
                  {
                    path: "/mypage/orders",
                    Component: mypageOrders.default,
                    handle: mypageOrders.handle,
                  },
                  {
                    path: "/mypage/orders/:orderRef",
                    Component: mypageOrderDetail.default,
                    handle: mypageOrderDetail.handle,
                  },
                  {
                    path: "/mypage/entry-tickets",
                    Component: mypageEntryTickets.default,
                    handle: mypageEntryTickets.handle,
                  },
                  {
                    path: "/mypage/entry-tickets/:ticketRef",
                    Component: mypageEntryTicketDetail.default,
                    handle: mypageEntryTicketDetail.handle,
                  },
                  {
                    path: "/mypage/entry-tickets/:ticketRef/qr",
                    Component: mypageEntryTicketQr.default,
                    handle: mypageEntryTicketQr.handle,
                  },
                  {
                    path: "/mypage/karaoke",
                    Component: mypageKaraoke.default,
                    handle: mypageKaraoke.handle,
                  },
                  {
                    path: "/mypage/karaoke/:reservationRef",
                    Component: mypageReservationDetail.default,
                    handle: mypageReservationDetail.handle,
                  },
                  {
                    path: "/mypage/karaoke/:reservationRef/qr",
                    Component: mypageReservationQr.default,
                    handle: mypageReservationQr.handle,
                  },
                  {
                    path: "/mypage/goods",
                    Component: mypageGoods.default,
                    handle: mypageGoods.handle,
                  },
                  {
                    path: "/mypage/goods/:goodsItemRef",
                    Component: mypageGoodsItemDetail.default,
                    handle: mypageGoodsItemDetail.handle,
                  },
                ],
              },
            ],
          },
          // PG-XFN-002: any other URL. It is outside SelfLayout, so it never asks for a Session.
          { path: "*", element: <NotFoundView /> },
        ],
      },
    ],
  },
];
