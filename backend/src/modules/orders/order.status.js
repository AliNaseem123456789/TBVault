export const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"]

// Which status each status may move to. Anything not listed is rejected.
export const NEXT_STATUS = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["shipped", "cancelled"],
    shipped: ["delivered"],
    delivered: [],
    cancelled: [],
}

export const canTransition = (from, to) => Boolean(NEXT_STATUS[from]?.includes(to))
