// Japanese UI copy dictionary (SPEC-050 section 24.3 / 27). Leaves are strings or templates.

export const copy = {
  order: {
    state: {
      PREPARED: "支払い手続き未開始 / 準備済み",
      AWAITING_PAYMENT: "支払い結果を確認中",
      CONFIRMED: "購入確定",
      PAYMENT_FAILED: "支払い不成立",
      CANCELED: "購入手続き取消済み",
      EXPIRED: "購入手続き失効",
      REVIEW_REQUIRED: "購入状態を確認中",
    },
    description: {
      PREPARED: "支払い手続きはまだ始まっていません。同じ購入手続きで支払い開始を再試行できます。",
      AWAITING_PAYMENT: "支払い結果を確認しています。結果が確定するまでお待ちください。",
      CONFIRMED: "購入が確定しました。Ticket / Reservation / Goodsを利用できます。",
      PAYMENT_FAILED: "支払いが成立しませんでした。必要な場合は新しく購入してください。",
      CANCELED: "この購入手続きは取り消されました。",
      EXPIRED: "この購入手続きは有効期限が切れました。",
      REVIEW_REQUIRED: "購入状態を確認しています。確認が終わるまでお待ちください。",
    },
    action: {
      retry_checkout: "支払い開始を再試行",
      recheck_status: "状態を再確認",
      view_purchase: "購入内容を見る",
      view_entitlements: "Ticket / Reservation / Goodsを見る",
      purchase_again: "もう一度購入する",
    },
  },
  purpose: {
    ENTRY_TICKET_PURCHASE: "Entry Ticketの購入",
    KARAOKE_PURCHASE: "Karaoke Ticketの購入",
    GOODS_PURCHASE: "Goodsの購入",
    ENTRY_GOODS_PURCHASE: "Entry TicketとGoodsの購入",
  },
  qr: {
    ENTRY: "Entry Ticket / 入場受付用",
    KARAOKE: "Karaoke Ticket / Karaoke受付用",
  },
  entryTicket: {
    label: {
      VALID: "利用可能",
      USED: "使用済み",
      CANCELED: "取消済み",
      EXPIRED: "失効済み",
    },
    description: {
      VALID: "入場受付でQRを提示できます。",
      USED: "このEntry Ticketはすでに使用されています。",
      CANCELED: "このEntry Ticketは取り消されています。",
      EXPIRED: "このEntry Ticketは有効期限が切れています。",
    },
    disabledReason: {
      USED: "使用済みのためQRは表示できません。",
      CANCELED: "取消済みのためQRは表示できません。",
      EXPIRED: "失効済みのためQRは表示できません。",
    },
  },
  karaoke: {
    slot: {
      label: {
        AVAILABLE: "選択可能",
        HELD: "他の方が確保中",
        SOLD: "販売済み",
        SALES_STOPPED: "販売停止",
      },
      description: {
        AVAILABLE: "この枠を選択できます。",
        HELD: "現在確保中のため選択できません。",
        SOLD: "この枠は販売済みです。",
        SALES_STOPPED: "この枠は販売を停止しています。",
      },
    },
    hold: {
      label: {
        ACTIVE: "購入試行中の確保",
        COMMITTED: "確定購入に使用済み",
        RELEASED: "確保は終了",
        EXPIRED: "確保は期限切れ",
      },
      description: {
        ACTIVE: "購入手続き中の仮確保です。Reservationの確定ではありません。",
        COMMITTED: "この確保は確定購入に使用されました。",
        RELEASED: "この確保は終了しており、再利用できません。",
        EXPIRED: "確保の期限が切れました。新しく枠を確保してください。",
      },
    },
    reservation: {
      CONFIRMED: "予約確定",
      CANCELED: "予約取消済み",
    },
    ticket: {
      VALID: "受付利用可能",
      USED: "使用済み",
      CANCELED: "取消済み",
      EXPIRED: "失効済み",
    },
    primary: {
      VALID: "受付利用可能",
      USED: "使用済み",
      CANCELED: "取消済み",
      EXPIRED: "失効済み",
    },
    disabledReason: {
      reservationCanceled: "予約が取り消されたためQRは表示できません。",
      USED: "使用済みのためQRは表示できません。",
      CANCELED: "取消済みのためQRは表示できません。",
      EXPIRED: "失効済みのためQRは表示できません。",
    },
  },
  goods: {
    item: {
      PENDING_PAYMENT: "支払未確定・受け取り不可",
      FULFILLABLE: "支払確定済み",
      CANCELED: "取消済み・受け取り不可",
    },
    handoff: {
      PENDING: "未受け渡し",
      COMPLETED: "受け渡し済み",
      VOID: "受け渡し対象外",
    },
    awaiting: "会場受け取り待ち",
    description: {
      canceled: "このGoodsは取り消されており、受け取れません。",
      pendingPayment: "支払いが確定するまで受け取れません。",
      completed: "このGoodsはすでに受け渡し済みです。",
      awaiting: "会場で受け取ってください。",
    },
  },
  notification: {
    PENDING: {
      label: "確認Emailを送信中",
      message: "確認Emailを準備しています。購入内容には影響しません。",
    },
    SENT: {
      label: "確認Emailを送信済み",
      message: "確認Emailを送信しました。",
    },
    FAILED_RETRYABLE: {
      label: "確認Emailの送信に失敗または遅延",
      message:
        "購入は確定済みです。確認Emailの送信に失敗または遅延しています。購入内容はこの画面とMypageで確認できます",
    },
  },
  availability: {
    label: {
      ON_SALE: "販売中",
      BEFORE_SALES: "販売開始前",
      SALES_ENDED: "販売終了",
      SUSPENDED: "販売停止",
      SOLD_OUT: "売り切れ",
      INSUFFICIENT_QUANTITY: "数量不足",
      PURCHASE_LIMIT_EXCEEDED: "購入上限により購入不可",
      NOT_PUBLIC: "現在取り扱っていません",
      UNAVAILABLE: "状態を確認できません",
      ALLOCATION_CONFLICT: "在庫の確保に失敗",
    },
    description: {
      ON_SALE: "購入できます。",
      BEFORE_SALES: "販売開始前のため購入できません。",
      SALES_ENDED: "販売期間は終了しました。",
      INSUFFICIENT_QUANTITY: "在庫が不足しています。数量を変更してください。",
      SUSPENDED: "現在、販売を停止しています。",
      SOLD_OUT: "売り切れのため購入できません。",
      PURCHASE_LIMIT_EXCEEDED: "購入上限を超えるため購入できません。",
      NOT_PUBLIC: "この商品は現在取り扱っていません。",
      UNAVAILABLE: "現在の状態を取得できません。時間をおいて再度お試しください。",
      ALLOCATION_CONFLICT: "他の購入と重なり確保できませんでした。内容を確認してください。",
    },
    beforeSales: (startsAtText: string): string => `${startsAtText}から販売を開始します。`,
    insufficientQuantity: (max: string): string =>
      `在庫が不足しています。数量を${max}以下に変更してください。`,
  },
  layout: {
    skipLink: "メインコンテンツへ移動",
    nav: {
      primaryLabel: "メインナビゲーション",
      footerLabel: "フッターナビゲーション",
      items: {
        event: "Event",
        entry: "Entry Ticket",
        karaoke: "Karaoke",
        goods: "Goods",
        cart: "カート",
      },
    },
    cta: { buyTickets: "チケットを購入する" },
    cart: { label: "カート", labelWithCount: (count: number): string => `カート（${count}点）` },
    account: {
      login: "ログイン",
      register: "アカウント登録",
      mypage: "マイページ",
      menuButton: "アカウントメニュー",
      menuLabel: "アカウント",
      profile: "プロフィール",
      orders: "注文",
      entryTickets: "Entry Ticket",
      karaoke: "Karaoke",
      goods: "Goods",
      logout: "ログアウト",
    },
    drawer: { open: "メニューを開く", close: "メニューを閉じる", title: "メニュー" },
    sponsors: { regionLabel: "協賛", externalSuffix: "（外部サイト）" },
    mockBadge: "UIモック表示中",
  },
  notFound: {
    title: "ページを表示できません",
    description: "お探しのページは存在しないか、現在表示できません。",
    homeLink: "Event Homeへ戻る",
  },
  errorPage: {
    title: "問題が発生しました",
    description: "ページを表示できませんでした。時間をおいて、もう一度お試しください。",
    retry: "再試行",
    homeLink: "Event Homeへ戻る",
  },
} as const;
